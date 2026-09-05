import {
  AddTaskNoteInput,
  CreateManualTaskInput,
  CreateTaskFolderInput,
  CreateTaskListInput,
  DeleteTaskFolderInput,
  DeleteTaskInput,
  DeleteTaskListInput,
  MANUAL_TASK_PROVIDER,
  type Task,
  type TaskAttachmentsResult,
  type TaskCommentsResult,
  TaskFolder,
  TaskList,
  type TaskNote,
  TaskNote as TaskNoteSchema,
  TaskFacets,
  TaskId,
  type TaskLinksResult,
  type TaskQueryFilter,
  type TaskQueryResult,
  Task as TaskSchema,
  type TaskPanel,
  type TaskProviderConnectionStatus,
  type TaskProviderId,
  type TaskProviderState,
  type TaskStatusCategory,
  QueryTasksInput,
  ThreadId,
  UpdateTaskInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { Fragment } from "effect/unstable/sql/Statement";

import { type SecretStoreError, ServerSecretStore } from "../auth/ServerSecretStore.ts";
import {
  type TaskProviderAdapter,
  TaskProviderError,
  TaskProviderRegistry,
  TaskProviderRegistryLive,
} from "./providers/types.ts";

const TASK_PAGE_SIZE_DEFAULT = 10;
const TASK_PAGE_SIZE_MAX = 200;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

interface TaskRow {
  readonly id: string;
  readonly provider: TaskProviderId;
  readonly title: string;
  readonly description: string;
  readonly statusLabel: string;
  readonly statusCategory: TaskStatusCategory;
  readonly statusColor: string | null;
  readonly linkedThreadId: string | null;
  readonly listId: string | null;
  readonly listName: string | null;
  readonly externalTaskId: string | null;
  readonly externalCustomId: string | null;
  readonly externalUrl: string | null;
  readonly assigneesJson: string;
  readonly syncedAt: string | null;
  readonly externalUpdatedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Write-shaped task row; listName is derived by join on read, never stored. */
type TaskUpsertRow = Omit<TaskRow, "listName">;

interface TaskNoteRow {
  readonly id: string;
  readonly taskId: string;
  readonly body: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface TaskFolderRow {
  readonly id: string;
  readonly provider: TaskProviderId;
  readonly externalFolderId: string | null;
  readonly name: string;
}

interface TaskListRow {
  readonly id: string;
  readonly provider: TaskProviderId;
  readonly externalListId: string | null;
  readonly folderId: string | null;
  readonly name: string;
}

interface ProviderConfigRow {
  readonly provider: TaskProviderId;
  readonly configJson: string;
  readonly lastSyncAt: string | null;
  readonly lastSyncError: string | null;
}

interface NormalizedTaskQueryFilter {
  readonly listIds: ReadonlyArray<string>;
  readonly folderIds: ReadonlyArray<string>;
  readonly taskIds: ReadonlyArray<string>;
  readonly statuses: ReadonlyArray<TaskStatusCategory>;
  readonly assignees: ReadonlyArray<string>;
  readonly linkedThreadId: string | null;
  readonly query: string | null;
  readonly page: number;
  readonly pageSize: number;
}

export class TaskServiceError extends Schema.TaggedErrorClass<TaskServiceError>()(
  "TaskServiceError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `${this.operation}: ${this.detail}`;
  }
}
const isTaskServiceError = Schema.is(TaskServiceError);

const taskServiceError = (operation: string, detail: string, cause?: unknown) =>
  new TaskServiceError({
    operation,
    detail,
    ...(cause === undefined ? {} : { cause }),
  });

type TaskServiceFailure = TaskServiceError;

function bytesToString(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

function stringToBytes(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function parseJsonArray(value: string | null): ReadonlyArray<string> {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function stringifyJsonArray(value: ReadonlyArray<string>): string {
  return JSON.stringify(value);
}

/** Provider-backed registry rows use deterministic ids; local rows use uuids. */
const externalRowId = (provider: string, externalId: string): string => `${provider}:${externalId}`;

const decodeNoteRow = Schema.decodeSync(TaskNoteSchema);
const decodeTaskRow = Schema.decodeSync(TaskSchema);
const decodeFacets = Schema.decodeSync(TaskFacets);
const decodeTaskListRow = Schema.decodeSync(TaskList);

function mapNoteRow(row: TaskNoteRow): TaskNote {
  return decodeNoteRow({
    id: row.id,
    taskId: row.taskId,
    body: row.body,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function mapTaskRow(row: TaskRow, notes: ReadonlyArray<TaskNote>): Task {
  return decodeTaskRow({
    id: row.id,
    provider: row.provider,
    title: row.title,
    description: row.description,
    statusLabel: row.statusLabel,
    statusCategory: row.statusCategory,
    statusColor: row.statusColor,
    linkedThreadId: row.linkedThreadId,
    listId: row.listId,
    listName: row.listName,
    externalTaskId: row.externalTaskId,
    externalCustomId: row.externalCustomId,
    externalUrl: row.externalUrl,
    assignees: parseJsonArray(row.assigneesJson),
    syncedAt: row.syncedAt,
    externalUpdatedAt: row.externalUpdatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    notes,
  });
}

export class TaskService extends Context.Service<
  TaskService,
  {
    readonly getPanel: () => Effect.Effect<TaskPanel, TaskServiceFailure>;
    readonly queryTasks: (
      input: QueryTasksInput,
    ) => Effect.Effect<TaskQueryResult, TaskServiceFailure>;
    readonly listLinks: () => Effect.Effect<TaskLinksResult, TaskServiceFailure>;
    readonly createManualTask: (
      input: CreateManualTaskInput,
    ) => Effect.Effect<Task, TaskServiceFailure>;
    readonly createList: (
      input: CreateTaskListInput,
    ) => Effect.Effect<TaskList, TaskServiceFailure>;
    readonly createFolder: (
      input: CreateTaskFolderInput,
    ) => Effect.Effect<TaskFolder, TaskServiceFailure>;
    readonly updateTask: (input: UpdateTaskInput) => Effect.Effect<Task, TaskServiceFailure>;
    readonly deleteTask: (input: DeleteTaskInput) => Effect.Effect<void, TaskServiceFailure>;
    readonly deleteList: (input: DeleteTaskListInput) => Effect.Effect<void, TaskServiceFailure>;
    readonly deleteFolder: (
      input: DeleteTaskFolderInput,
    ) => Effect.Effect<void, TaskServiceFailure>;
    readonly addNote: (input: AddTaskNoteInput) => Effect.Effect<Task, TaskServiceFailure>;
    readonly getTaskAttachments: (
      taskId: TaskId,
    ) => Effect.Effect<TaskAttachmentsResult, TaskServiceFailure>;
    readonly getTaskComments: (
      taskId: TaskId,
    ) => Effect.Effect<TaskCommentsResult, TaskServiceFailure>;
    readonly setProviderCredential: (input: {
      readonly providerId: string;
      readonly token: string;
    }) => Effect.Effect<void, TaskServiceFailure>;
    readonly clearProviderCredential: (input: {
      readonly providerId: string;
    }) => Effect.Effect<void, TaskServiceFailure>;
    readonly getProviderStatus: (input: {
      readonly providerId: string;
    }) => Effect.Effect<TaskProviderConnectionStatus, TaskServiceFailure>;
    readonly syncProviderTasks: (input: {
      readonly providerId: string;
    }) => Effect.Effect<TaskPanel, TaskServiceFailure>;
  }
>()("t3/tasks/TaskService") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const crypto = yield* Crypto.Crypto;
  const secretStore = yield* ServerSecretStore;
  const registry = yield* TaskProviderRegistry;

  const nowIso = () => DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const readCredential = (adapter: TaskProviderAdapter) =>
    Effect.gen(function* () {
      const token = yield* secretStore.get(adapter.credentialSecretKey);
      return Option.match(token, {
        onNone: () => null,
        onSome: (value) => adapter.normalizeCredential(bytesToString(value)) || null,
      });
    });

  const loadProviderConfigRow = (providerId: string) =>
    sql<ProviderConfigRow>`
      SELECT
        provider,
        config_json AS "configJson",
        last_sync_at AS "lastSyncAt",
        last_sync_error AS "lastSyncError"
      FROM task_provider_configs
      WHERE provider = ${providerId}
    `.pipe(Effect.map((rows) => rows[0] ?? null));

  const upsertProviderConfigRow = (input: {
    readonly providerId: string;
    readonly configJson: string;
    readonly lastSyncAt?: string | null;
    readonly lastSyncError?: string | null;
  }) =>
    sql`
      INSERT INTO task_provider_configs (
        provider,
        config_json,
        last_sync_at,
        last_sync_error
      )
      VALUES (
        ${input.providerId},
        ${input.configJson},
        ${input.lastSyncAt ?? null},
        ${input.lastSyncError ?? null}
      )
      ON CONFLICT (provider)
      DO UPDATE SET
        config_json = excluded.config_json,
        last_sync_at = excluded.last_sync_at,
        last_sync_error = excluded.last_sync_error
    `.pipe(Effect.asVoid);

  const normalizeQueryFilter = (filter: TaskQueryFilter | undefined): NormalizedTaskQueryFilter => {
    const dedupe = (values: ReadonlyArray<string>): Array<string> => [
      ...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)),
    ];
    return {
      listIds: dedupe(filter?.listIds ?? []),
      folderIds: dedupe(filter?.folderIds ?? []),
      taskIds: dedupe(filter?.taskIds ?? []),
      statuses: [...new Set(filter?.statuses ?? [])],
      assignees: dedupe(filter?.assignees ?? []),
      linkedThreadId: filter?.linkedThreadId?.trim() || null,
      query: filter?.query?.trim() || null,
      page: Math.max(1, Math.floor(filter?.page ?? 1)),
      pageSize: Math.min(
        TASK_PAGE_SIZE_MAX,
        Math.max(1, Math.floor(filter?.pageSize ?? TASK_PAGE_SIZE_DEFAULT)),
      ),
    };
  };

  const taskFilterFragment = (filter: NormalizedTaskQueryFilter) => {
    const clauses: Array<string | Fragment> = [];
    // A selection can name lists directly, folders (resolved through their
    // lists), both, or specific tasks — any of the named scopes match.
    const scope: Array<Fragment> = [];
    if (filter.listIds.length > 0) {
      scope.push(sql.in("tasks.list_id", filter.listIds));
    }
    if (filter.folderIds.length > 0) {
      scope.push(
        sql`tasks.list_id IN (
          SELECT task_lists.list_id FROM task_lists
          WHERE ${sql.in("task_lists.folder_id", filter.folderIds)}
        )`,
      );
    }
    if (filter.taskIds.length > 0) {
      scope.push(sql.in("tasks.task_id", filter.taskIds));
    }
    const scopeClause = scope.length === 0 ? null : scope.length === 1 ? scope[0] : sql.or(scope);
    if (scopeClause) {
      clauses.push(scopeClause);
    }
    if (filter.statuses.length > 0) {
      clauses.push(sql.in("status_category", filter.statuses));
    }
    if (filter.assignees.length > 0) {
      clauses.push(
        sql`EXISTS (
          SELECT 1 FROM json_each(tasks.assignees_json) AS assignee
          WHERE ${sql.in("assignee.value", filter.assignees)}
        )`,
      );
    }
    if (filter.linkedThreadId) {
      clauses.push(sql`linked_thread_id = ${filter.linkedThreadId}`);
    }
    if (filter.query) {
      // Union match so manual tasks (no provider ids) still match on title.
      const needle = `%${filter.query.replace(/[\\%_]/g, "\\$&")}%`;
      clauses.push(
        sql`(
          tasks.title LIKE ${needle} ESCAPE '\\'
          OR tasks.external_custom_id LIKE ${needle} ESCAPE '\\'
          OR tasks.external_task_id LIKE ${needle} ESCAPE '\\'
        )`,
      );
    }
    return sql.and(clauses);
  };

  const countFilteredTasks = (where: Fragment) =>
    sql<{ readonly count: number }>`
      SELECT COUNT(*) AS "count"
      FROM tasks
      WHERE ${where}
    `.pipe(Effect.map((rows) => rows[0]?.count ?? 0));

  const taskRowSelection = sql`
    SELECT
      tasks.task_id AS "id",
      tasks.provider AS "provider",
      tasks.title AS "title",
      tasks.description AS "description",
      tasks.status_label AS "statusLabel",
      tasks.status_category AS "statusCategory",
      tasks.status_color AS "statusColor",
      tasks.linked_thread_id AS "linkedThreadId",
      tasks.list_id AS "listId",
      task_lists.name AS "listName",
      tasks.external_task_id AS "externalTaskId",
      tasks.external_custom_id AS "externalCustomId",
      tasks.external_url AS "externalUrl",
      tasks.assignees_json AS "assigneesJson",
      tasks.synced_at AS "syncedAt",
      tasks.external_updated_at AS "externalUpdatedAt",
      tasks.created_at AS "createdAt",
      tasks.updated_at AS "updatedAt"
    FROM tasks
    LEFT JOIN task_lists ON task_lists.list_id = tasks.list_id
  `;

  const listFilteredTasks = (where: Fragment, page: number, pageSize: number) =>
    sql<TaskRow>`
      ${taskRowSelection}
      WHERE ${where}
      ORDER BY
        CASE tasks.status_category
          WHEN 'done' THEN 1
          ELSE 0
        END ASC,
        tasks.updated_at DESC,
        tasks.created_at DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `;

  const listNotesByTaskIds = (taskIds: ReadonlyArray<string>) =>
    taskIds.length === 0
      ? Effect.succeed([] as TaskNoteRow[])
      : sql<TaskNoteRow>`
          SELECT
            note_id AS "id",
            task_id AS "taskId",
            body,
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM task_notes
          WHERE ${sql.in("task_id", taskIds)}
          ORDER BY created_at ASC, note_id ASC
        `;

  const loadTaskFacets = () =>
    Effect.gen(function* () {
      const [folderRows, listRows, statusRows, assigneeRows] = yield* Effect.all([
        sql<{
          readonly id: string;
          readonly provider: TaskProviderId;
          readonly name: string;
          readonly count: number;
        }>`
          SELECT
            task_folders.folder_id AS "id",
            task_folders.provider,
            task_folders.name,
            COUNT(tasks.task_id) AS "count"
          FROM task_folders
          LEFT JOIN task_lists ON task_lists.folder_id = task_folders.folder_id
          LEFT JOIN tasks ON tasks.list_id = task_lists.list_id
          GROUP BY task_folders.folder_id
          ORDER BY task_folders.name ASC
        `,
        sql<{
          readonly id: string;
          readonly provider: TaskProviderId;
          readonly name: string | null;
          readonly folderId: string | null;
          readonly folderName: string | null;
          readonly count: number;
        }>`
          SELECT
            task_lists.list_id AS "id",
            task_lists.provider,
            task_lists.name,
            task_lists.folder_id AS "folderId",
            task_folders.name AS "folderName",
            COUNT(tasks.task_id) AS "count"
          FROM task_lists
          LEFT JOIN task_folders ON task_folders.folder_id = task_lists.folder_id
          LEFT JOIN tasks ON tasks.list_id = task_lists.list_id
          GROUP BY task_lists.list_id
          ORDER BY task_lists.name ASC
        `,
        sql<{ readonly value: string; readonly count: number }>`
          SELECT status_category AS "value", COUNT(*) AS "count"
          FROM tasks
          GROUP BY status_category
          ORDER BY "count" DESC
        `,
        sql<{ readonly value: string; readonly count: number }>`
          SELECT assignee.value AS "value", COUNT(*) AS "count"
          FROM tasks AS task, json_each(task.assignees_json) AS assignee
          GROUP BY assignee.value
          ORDER BY "count" DESC, assignee.value ASC
        `,
      ]);
      return decodeFacets({
        folders: folderRows.map((row) => ({
          id: row.id,
          provider: row.provider,
          name: row.name,
          count: row.count,
        })),
        lists: listRows.flatMap((row) => {
          const name = row.name?.trim() ?? "";
          if (name.length === 0) return [];
          const folderId = row.folderId?.trim() ?? "";
          const folderName = row.folderName?.trim() ?? "";
          const hasFolder = folderId.length > 0 && folderName.length > 0;
          return [
            {
              id: row.id,
              provider: row.provider,
              name,
              count: row.count,
              folderId: hasFolder ? folderId : null,
              folderName: hasFolder ? folderName : null,
            },
          ];
        }),
        statuses: statusRows,
        assignees: assigneeRows,
      });
    });

  const loadTaskRowById = (taskId: TaskId) =>
    Effect.gen(function* () {
      const rows = yield* sql<TaskRow>`
        ${taskRowSelection}
        WHERE task_id = ${taskId}
      `;
      const row = rows[0];
      if (!row) {
        return yield* taskServiceError("tasks.loadTask", `Unknown task: ${taskId}`);
      }
      return row;
    });

  const loadTaskById = (taskId: TaskId) =>
    Effect.gen(function* () {
      const row = yield* loadTaskRowById(taskId);
      const noteRows = yield* listNotesByTaskIds([taskId]);
      const notes = noteRows.map(mapNoteRow);
      return mapTaskRow(row, notes);
    });

  const upsertFolderRow = (row: TaskFolderRow, timestamp: string) =>
    sql`
      INSERT INTO task_folders (
        folder_id,
        provider,
        external_folder_id,
        name,
        created_at,
        updated_at
      )
      VALUES (
        ${row.id},
        ${row.provider},
        ${row.externalFolderId},
        ${row.name},
        ${timestamp},
        ${timestamp}
      )
      ON CONFLICT (folder_id)
      DO UPDATE SET
        name = excluded.name,
        updated_at = excluded.updated_at
    `.pipe(Effect.asVoid);

  const upsertListRow = (row: TaskListRow, timestamp: string) =>
    sql`
      INSERT INTO task_lists (
        list_id,
        provider,
        external_list_id,
        folder_id,
        name,
        created_at,
        updated_at
      )
      VALUES (
        ${row.id},
        ${row.provider},
        ${row.externalListId},
        ${row.folderId},
        ${row.name},
        ${timestamp},
        ${timestamp}
      )
      ON CONFLICT (list_id)
      DO UPDATE SET
        -- A payload's folder ref can regress to null (hidden folders); keep
        -- the previously known folder when the fresh one is missing.
        folder_id = COALESCE(excluded.folder_id, task_lists.folder_id),
        name = excluded.name,
        updated_at = excluded.updated_at
    `.pipe(Effect.asVoid);

  const upsertTaskRow = (row: TaskUpsertRow) =>
    sql`
      INSERT INTO tasks (
        task_id,
        provider,
        title,
        description,
        status_label,
        status_category,
        status_color,
        linked_thread_id,
        list_id,
        external_task_id,
        external_custom_id,
        external_url,
        assignees_json,
        synced_at,
        external_updated_at,
        created_at,
        updated_at
      )
      VALUES (
        ${row.id},
        ${row.provider},
        ${row.title},
        ${row.description},
        ${row.statusLabel},
        ${row.statusCategory},
        ${row.statusColor},
        ${row.linkedThreadId},
        ${row.listId},
        ${row.externalTaskId},
        ${row.externalCustomId},
        ${row.externalUrl},
        ${row.assigneesJson},
        ${row.syncedAt},
        ${row.externalUpdatedAt},
        ${row.createdAt},
        ${row.updatedAt}
      )
      ON CONFLICT (task_id)
      DO UPDATE SET
        provider = excluded.provider,
        title = excluded.title,
        description = excluded.description,
        status_label = excluded.status_label,
        status_category = excluded.status_category,
        status_color = excluded.status_color,
        linked_thread_id = excluded.linked_thread_id,
        list_id = excluded.list_id,
        external_task_id = excluded.external_task_id,
        external_custom_id = excluded.external_custom_id,
        external_url = excluded.external_url,
        assignees_json = excluded.assignees_json,
        synced_at = excluded.synced_at,
        external_updated_at = excluded.external_updated_at,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `.pipe(Effect.asVoid);

  const getPanel: TaskService["Service"]["getPanel"] = () =>
    Effect.gen(function* () {
      // Fully local reads: clients poll the panel, so no provider network calls
      // live here. Account labels come from stored configs; discovery only
      // happens in sync and status paths.
      const [facets, providerStates] = yield* Effect.all([
        loadTaskFacets(),
        Effect.forEach(
          registry.providers,
          (adapter) =>
            Effect.gen(function* () {
              const [credential, configRow] = yield* Effect.all([
                readCredential(adapter),
                loadProviderConfigRow(adapter.id),
              ]);
              return {
                providerId: adapter.id,
                label: adapter.label,
                credentialConfigured: credential !== null,
                accountLabel: adapter.cachedAccountLabel(configRow?.configJson ?? null),
                lastSyncAt: configRow?.lastSyncAt ?? null,
                lastSyncError: configRow?.lastSyncError ?? null,
              } satisfies TaskProviderState;
            }),
          { discard: false },
        ),
      ]);
      return {
        providers: providerStates,
        facets,
      } satisfies TaskPanel;
    }).pipe(
      Effect.mapError((cause) =>
        taskServiceError("tasks.getPanel", "Failed to load task panel", cause),
      ),
    );

  const queryTasks: TaskService["Service"]["queryTasks"] = (input) =>
    Effect.gen(function* () {
      const filter = normalizeQueryFilter(input.filter);
      const where = taskFilterFragment(filter);
      const total = yield* countFilteredTasks(where);
      // Clamp the requested page against the filtered total so an out-of-range
      // page (e.g. after deletions) still renders the last available page.
      const totalPages = Math.max(1, Math.ceil(total / filter.pageSize));
      const page = Math.min(filter.page, totalPages);
      const taskRows = yield* listFilteredTasks(where, page, filter.pageSize);
      const noteRows = yield* listNotesByTaskIds(taskRows.map((task) => task.id));
      const notesByTaskId = new Map<string, TaskNote[]>();
      for (const note of noteRows) {
        const entry = notesByTaskId.get(note.taskId) ?? [];
        entry.push(mapNoteRow(note));
        notesByTaskId.set(note.taskId, entry);
      }
      return {
        tasks: taskRows.map((task) => mapTaskRow(task, notesByTaskId.get(task.id) ?? [])),
        total,
        page,
        pageSize: filter.pageSize,
      } satisfies TaskQueryResult;
    }).pipe(
      Effect.mapError((cause) =>
        taskServiceError("tasks.queryTasks", "Failed to query tasks", cause),
      ),
    );

  const listLinks: TaskService["Service"]["listLinks"] = () =>
    Effect.gen(function* () {
      const rows = yield* sql<{
        readonly taskId: string;
        readonly threadId: string;
        readonly title: string;
        readonly statusCategory: TaskStatusCategory;
        readonly provider: TaskProviderId;
      }>`
        SELECT
          task_id AS "taskId",
          linked_thread_id AS "threadId",
          title,
          status_category AS "statusCategory",
          provider
        FROM tasks
        WHERE linked_thread_id IS NOT NULL
        ORDER BY updated_at DESC
      `;
      return {
        links: rows.map((row) => ({
          taskId: TaskId.make(row.taskId),
          threadId: ThreadId.make(row.threadId),
          title: row.title,
          statusCategory: row.statusCategory,
          provider: row.provider,
        })),
      } satisfies TaskLinksResult;
    }).pipe(
      Effect.mapError((cause) =>
        taskServiceError("tasks.listLinks", "Failed to load task links", cause),
      ),
    );

  const requireListAdapter = (listId: string) =>
    Effect.gen(function* () {
      const rows = yield* sql<TaskListRow>`
        SELECT
          list_id AS "id",
          provider,
          external_list_id AS "externalListId",
          folder_id AS "folderId",
          name
        FROM task_lists
        WHERE list_id = ${listId}
      `;
      const row = rows[0];
      if (!row) {
        return yield* taskServiceError("tasks.createManualTask", `Unknown task list: ${listId}`);
      }
      return row;
    });

  const createManualTask: TaskService["Service"]["createManualTask"] = (input) =>
    Effect.gen(function* () {
      const createdAt = yield* nowIso();
      const id = yield* crypto.randomUUIDv4;
      if (input.listId) {
        yield* requireListAdapter(input.listId);
      }
      const row: TaskUpsertRow = {
        id,
        provider: MANUAL_TASK_PROVIDER,
        title: input.title,
        description: input.description?.trim() ?? "",
        statusLabel: "To do",
        statusCategory: "open",
        statusColor: null,
        linkedThreadId: null,
        listId: input.listId ?? null,
        externalTaskId: null,
        externalCustomId: null,
        externalUrl: null,
        assigneesJson: stringifyJsonArray([]),
        syncedAt: null,
        externalUpdatedAt: null,
        createdAt,
        updatedAt: createdAt,
      };
      yield* upsertTaskRow(row);
      return yield* loadTaskById(TaskId.make(id));
    }).pipe(
      Effect.mapError((cause) =>
        taskServiceError("tasks.createManualTask", "Failed to create manual task", cause),
      ),
    );

  const createList: TaskService["Service"]["createList"] = (input) =>
    Effect.gen(function* () {
      let folderId: string | null = null;
      if (input.folderId) {
        const folderRows = yield* sql<TaskFolderRow>`
          SELECT
            folder_id AS "id",
            provider,
            external_folder_id AS "externalFolderId",
            name
          FROM task_folders
          WHERE folder_id = ${input.folderId}
        `;
        const folder = folderRows[0];
        if (!folder) {
          return yield* taskServiceError(
            "tasks.createList",
            `Unknown task folder: ${input.folderId}`,
          );
        }
        if (folder.provider !== MANUAL_TASK_PROVIDER) {
          return yield* taskServiceError(
            "tasks.createList",
            "Manual lists can only nest under manual folders.",
          );
        }
        folderId = folder.id;
      }
      const createdAt = yield* nowIso();
      const id = yield* crypto.randomUUIDv4;
      const row: TaskListRow = {
        id,
        provider: MANUAL_TASK_PROVIDER,
        externalListId: null,
        folderId,
        name: input.name,
      };
      yield* sql`
        INSERT INTO task_lists (
          list_id,
          provider,
          external_list_id,
          folder_id,
          name,
          created_at,
          updated_at
        )
        VALUES (
          ${row.id},
          ${row.provider},
          ${row.externalListId},
          ${row.folderId},
          ${row.name},
          ${createdAt},
          ${createdAt}
        )
      `;
      return decodeTaskListRow({
        id: row.id,
        provider: row.provider,
        externalListId: row.externalListId,
        folderId: row.folderId,
        name: row.name,
      });
    }).pipe(
      Effect.mapError((cause) =>
        taskServiceError("tasks.createList", "Failed to create list", cause),
      ),
    );

  const createFolder: TaskService["Service"]["createFolder"] = (input) =>
    Effect.gen(function* () {
      const timestamp = yield* nowIso();
      const id = yield* crypto.randomUUIDv4;
      const row: TaskFolderRow = {
        id,
        provider: MANUAL_TASK_PROVIDER,
        externalFolderId: null,
        name: input.name,
      };
      yield* upsertFolderRow(row, timestamp);
      return {
        id,
        provider: row.provider,
        externalFolderId: row.externalFolderId,
        name: row.name,
      } satisfies TaskFolder;
    }).pipe(
      Effect.mapError((cause) =>
        taskServiceError("tasks.createFolder", "Failed to create folder", cause),
      ),
    );

  const updateTask: TaskService["Service"]["updateTask"] = (input) =>
    Effect.gen(function* () {
      const current = yield* loadTaskRowById(input.taskId);
      const updatedAt = yield* nowIso();
      yield* upsertTaskRow({
        id: current.id,
        provider: current.provider,
        title: input.title ?? current.title,
        description: input.description ?? current.description,
        statusLabel: input.statusLabel ?? current.statusLabel,
        statusCategory: input.statusCategory ?? current.statusCategory,
        statusColor: current.statusColor,
        linkedThreadId:
          input.linkedThreadId !== undefined ? input.linkedThreadId : current.linkedThreadId,
        listId: current.listId,
        externalTaskId: current.externalTaskId,
        externalCustomId: current.externalCustomId,
        externalUrl: current.externalUrl,
        assigneesJson: current.assigneesJson,
        syncedAt: current.syncedAt,
        externalUpdatedAt: current.externalUpdatedAt,
        createdAt: current.createdAt,
        updatedAt,
      });
      return yield* loadTaskById(input.taskId);
    }).pipe(
      Effect.mapError((cause) =>
        taskServiceError("tasks.updateTask", "Failed to update task", cause),
      ),
    );

  const deleteTask: TaskService["Service"]["deleteTask"] = (input) =>
    Effect.gen(function* () {
      const current = yield* loadTaskById(input.taskId);
      if (current.provider !== MANUAL_TASK_PROVIDER) {
        return yield* taskServiceError(
          "tasks.deleteTask",
          "Only manual tasks can be deleted; synced tasks are managed by their provider.",
        );
      }
      yield* sql`
        DELETE FROM task_notes
        WHERE task_id = ${input.taskId}
      `;
      yield* sql`
        DELETE FROM tasks
        WHERE task_id = ${input.taskId}
      `;
    }).pipe(
      Effect.mapError((cause) =>
        taskServiceError("tasks.deleteTask", "Failed to delete task", cause),
      ),
    );

  /** Manual lists go with everything they hold; synced lists are the provider's. */
  const deleteList: TaskService["Service"]["deleteList"] = (input) =>
    Effect.gen(function* () {
      const rows = yield* sql<TaskListRow>`
        SELECT
          list_id AS "id",
          provider,
          external_list_id AS "externalListId",
          folder_id AS "folderId",
          name
        FROM task_lists
        WHERE list_id = ${input.listId}
      `;
      const list = rows[0];
      if (!list) {
        return yield* taskServiceError("tasks.deleteList", `Unknown task list: ${input.listId}`);
      }
      if (list.provider !== MANUAL_TASK_PROVIDER) {
        return yield* taskServiceError(
          "tasks.deleteList",
          "Only manual lists can be deleted; synced lists are managed by their provider.",
        );
      }
      yield* sql`
        DELETE FROM task_notes
        WHERE task_id IN (SELECT task_id FROM tasks WHERE list_id = ${input.listId})
      `;
      yield* sql`
        DELETE FROM tasks WHERE list_id = ${input.listId}
      `;
      yield* sql`
        DELETE FROM task_lists WHERE list_id = ${input.listId}
      `;
    }).pipe(
      Effect.mapError((cause) =>
        taskServiceError("tasks.deleteList", "Failed to delete list", cause),
      ),
    );

  /** Recursive: a folder takes its lists and their tasks' notes with it. */
  const deleteFolder: TaskService["Service"]["deleteFolder"] = (input) =>
    Effect.gen(function* () {
      const rows = yield* sql<TaskFolderRow>`
        SELECT
          folder_id AS "id",
          provider,
          external_folder_id AS "externalFolderId",
          name
        FROM task_folders
        WHERE folder_id = ${input.folderId}
      `;
      const folder = rows[0];
      if (!folder) {
        return yield* taskServiceError(
          "tasks.deleteFolder",
          `Unknown task folder: ${input.folderId}`,
        );
      }
      if (folder.provider !== MANUAL_TASK_PROVIDER) {
        return yield* taskServiceError(
          "tasks.deleteFolder",
          "Only manual folders can be deleted; synced folders are managed by their provider.",
        );
      }
      yield* sql`
        DELETE FROM task_notes
        WHERE task_id IN (
          SELECT task_id FROM tasks
          WHERE list_id IN (SELECT list_id FROM task_lists WHERE folder_id = ${input.folderId})
        )
      `;
      yield* sql`
        DELETE FROM tasks
        WHERE list_id IN (SELECT list_id FROM task_lists WHERE folder_id = ${input.folderId})
      `;
      yield* sql`
        DELETE FROM task_lists WHERE folder_id = ${input.folderId}
      `;
      yield* sql`
        DELETE FROM task_folders WHERE folder_id = ${input.folderId}
      `;
    }).pipe(
      Effect.mapError((cause) =>
        taskServiceError("tasks.deleteFolder", "Failed to delete folder", cause),
      ),
    );

  const addNote: TaskService["Service"]["addNote"] = (input) =>
    Effect.gen(function* () {
      const task = yield* loadTaskById(input.taskId);
      const timestamp = yield* nowIso();
      const noteId = yield* crypto.randomUUIDv4;
      yield* sql`
        INSERT INTO task_notes (
          note_id,
          task_id,
          body,
          created_at,
          updated_at
        )
        VALUES (
          ${noteId},
          ${input.taskId},
          ${input.body},
          ${timestamp},
          ${timestamp}
        )
      `;
      yield* sql`
        UPDATE tasks
        SET updated_at = ${timestamp}
        WHERE task_id = ${task.id}
      `;
      return yield* loadTaskById(input.taskId);
    }).pipe(
      Effect.mapError((cause) =>
        taskServiceError("tasks.addNote", "Failed to add task note", cause),
      ),
    );

  /** Detail fetches dispatch to the task's own provider; manual tasks answer empty. */
  const providerFetchForTaskRow = (row: TaskRow) => {
    if (row.provider === MANUAL_TASK_PROVIDER || !row.externalTaskId) return null;
    const adapter = registry.get(row.provider);
    if (!adapter) return null;
    return { adapter, externalTaskId: row.externalTaskId };
  };

  const getTaskAttachments: TaskService["Service"]["getTaskAttachments"] = (taskId) =>
    Effect.gen(function* () {
      const row = yield* loadTaskRowById(taskId);
      const target = providerFetchForTaskRow(row);
      if (!target) {
        return { attachments: [] } satisfies TaskAttachmentsResult;
      }
      const credential = yield* readCredential(target.adapter);
      if (!credential) {
        return { attachments: [] } satisfies TaskAttachmentsResult;
      }
      const attachments = yield* target.adapter
        .fetchTaskAttachments({ credential, externalTaskId: target.externalTaskId })
        .pipe(Effect.mapError((cause) => providerFailure("tasks.getTaskAttachments", cause)));
      return { attachments } satisfies TaskAttachmentsResult;
    }).pipe(
      Effect.mapError((cause) =>
        taskServiceError("tasks.getTaskAttachments", "Failed to load task attachments", cause),
      ),
    );

  const getTaskComments: TaskService["Service"]["getTaskComments"] = (taskId) =>
    Effect.gen(function* () {
      const row = yield* loadTaskRowById(taskId);
      const target = providerFetchForTaskRow(row);
      if (!target) {
        return { comments: [] } satisfies TaskCommentsResult;
      }
      const credential = yield* readCredential(target.adapter);
      if (!credential) {
        return { comments: [] } satisfies TaskCommentsResult;
      }
      const comments = yield* target.adapter
        .fetchTaskComments({ credential, externalTaskId: target.externalTaskId })
        .pipe(Effect.mapError((cause) => providerFailure("tasks.getTaskComments", cause)));
      return { comments } satisfies TaskCommentsResult;
    }).pipe(
      Effect.mapError((cause) =>
        taskServiceError("tasks.getTaskComments", "Failed to load task comments", cause),
      ),
    );

  const isProviderError = Schema.is(TaskProviderError);

  const providerFailure = (operation: string, cause: unknown): TaskServiceError =>
    isProviderError(cause)
      ? taskServiceError(operation, cause.message, cause.cause)
      : isTaskServiceError(cause)
        ? cause
        : taskServiceError(operation, "Provider request failed", cause);

  const setProviderCredential: TaskService["Service"]["setProviderCredential"] = (input) =>
    Effect.gen(function* () {
      const adapter = registry.get(input.providerId);
      if (!adapter) {
        return yield* taskServiceError(
          "tasks.setProviderCredential",
          `Unknown task provider: ${input.providerId}`,
        );
      }
      const normalized = adapter.normalizeCredential(input.token);
      if (normalized.length === 0) {
        return yield* taskServiceError(
          "tasks.setProviderCredential",
          `Paste a valid ${adapter.label} credential, without a Bearer prefix.`,
        );
      }
      yield* secretStore
        .set(adapter.credentialSecretKey, stringToBytes(normalized))
        .pipe(
          Effect.mapError((cause: SecretStoreError) =>
            taskServiceError(
              "tasks.setProviderCredential",
              `Failed to store ${adapter.label} credential`,
              cause,
            ),
          ),
        );
    }).pipe(
      Effect.mapError((cause) =>
        taskServiceError(
          "tasks.setProviderCredential",
          isTaskServiceError(cause) ? cause.message : "Failed to store provider credential",
          cause,
        ),
      ),
    );

  const clearProviderCredential: TaskService["Service"]["clearProviderCredential"] = (input) =>
    Effect.gen(function* () {
      const adapter = registry.get(input.providerId);
      if (!adapter) {
        return yield* taskServiceError(
          "tasks.clearProviderCredential",
          `Unknown task provider: ${input.providerId}`,
        );
      }
      yield* secretStore.get(adapter.credentialSecretKey).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.void,
            onSome: () => secretStore.remove(adapter.credentialSecretKey),
          }),
        ),
        Effect.mapError((cause: SecretStoreError) =>
          taskServiceError(
            "tasks.clearProviderCredential",
            `Failed to clear ${adapter.label} credential`,
            cause,
          ),
        ),
      );
    }).pipe(
      Effect.mapError((cause) =>
        taskServiceError(
          "tasks.clearProviderCredential",
          isTaskServiceError(cause) ? cause.message : "Failed to clear provider credential",
          cause,
        ),
      ),
    );

  const getProviderStatus: TaskService["Service"]["getProviderStatus"] = (input) =>
    Effect.gen(function* () {
      const adapter = registry.get(input.providerId);
      if (!adapter) {
        return yield* taskServiceError(
          "tasks.getProviderStatus",
          `Unknown task provider: ${input.providerId}`,
        );
      }
      const [credential, configRow] = yield* Effect.all([
        readCredential(adapter),
        loadProviderConfigRow(adapter.id),
      ]);
      let accountLabel = adapter.cachedAccountLabel(configRow?.configJson ?? null);
      if (credential && !accountLabel) {
        accountLabel = yield* adapter
          .accountLabel({ credential, configJson: configRow?.configJson ?? null })
          .pipe(Effect.orElseSucceed(() => null));
      }
      return {
        credentialConfigured: credential !== null,
        accountLabel,
        lastSyncAt: configRow?.lastSyncAt ?? null,
        lastSyncError: configRow?.lastSyncError ?? null,
      } satisfies TaskProviderConnectionStatus;
    }).pipe(
      Effect.mapError((cause) =>
        taskServiceError(
          "tasks.getProviderStatus",
          isTaskServiceError(cause) ? cause.message : "Failed to read provider status",
          cause,
        ),
      ),
    );

  const runProviderSync = (input: {
    readonly adapter: TaskProviderAdapter;
    readonly credential: string;
    readonly configJson: string;
    readonly previousLastSyncAt: string | null;
  }) =>
    Effect.gen(function* () {
      const { adapter } = input;
      const syncedAt = yield* nowIso();
      const result = yield* Effect.result(
        adapter.fetchSyncTasks({ credential: input.credential, configJson: input.configJson }),
      );
      if (result._tag === "Failure") {
        const failure = result.failure;
        const detail = failure instanceof Error ? failure.message : String(failure);
        yield* upsertProviderConfigRow({
          providerId: adapter.id,
          configJson: input.configJson,
          lastSyncAt: input.previousLastSyncAt,
          lastSyncError: detail,
        });
        yield* Effect.logWarning(`${adapter.label} sync failed`, { cause: failure });
        return;
      }

      for (const snapshot of result.success) {
        if (snapshot.externalFolderId && snapshot.externalFolderName) {
          yield* upsertFolderRow(
            {
              id: externalRowId(adapter.id, snapshot.externalFolderId),
              provider: adapter.id,
              externalFolderId: snapshot.externalFolderId,
              name: snapshot.externalFolderName,
            },
            syncedAt,
          );
        }
        let listId: string | null = null;
        if (snapshot.externalListId) {
          listId = externalRowId(adapter.id, snapshot.externalListId);
          yield* upsertListRow(
            {
              id: listId,
              provider: adapter.id,
              externalListId: snapshot.externalListId,
              folderId: snapshot.externalFolderId
                ? externalRowId(adapter.id, snapshot.externalFolderId)
                : null,
              name: snapshot.externalListName ?? snapshot.externalListId,
            },
            syncedAt,
          );
        }
        const existingRows = yield* sql<{
          readonly id: string;
          readonly createdAt: string;
          readonly statusColor: string | null;
          readonly linkedThreadId: ThreadId | null;
          readonly existingCustomId: string | null;
        }>`
          SELECT
            task_id AS "id",
            created_at AS "createdAt",
            status_color AS "statusColor",
            linked_thread_id AS "linkedThreadId",
            external_custom_id AS "existingCustomId"
          FROM tasks
          WHERE provider = ${adapter.id}
            AND external_task_id = ${snapshot.externalTaskId}
          LIMIT 1
        `;
        const existing = existingRows[0] ?? null;
        const taskId = existing?.id ?? TaskId.make(yield* crypto.randomUUIDv4);
        yield* upsertTaskRow({
          id: taskId,
          provider: adapter.id,
          title: snapshot.title,
          description: snapshot.description,
          statusLabel: snapshot.statusLabel,
          statusCategory: snapshot.statusCategory,
          // A provider that drops the color later should not erase the one
          // the user already saw.
          statusColor: snapshot.statusColor ?? existing?.statusColor ?? null,
          linkedThreadId: existing?.linkedThreadId ?? null,
          listId,
          externalTaskId: snapshot.externalTaskId,
          externalCustomId: snapshot.externalCustomId ?? existing?.existingCustomId ?? null,
          externalUrl: snapshot.externalUrl,
          assigneesJson: stringifyJsonArray(snapshot.assignees),
          syncedAt,
          externalUpdatedAt: snapshot.externalUpdatedAt,
          // The provider's creation timestamp is the task's real age; the sync
          // time is only a fallback for payloads that omit it.
          createdAt: snapshot.externalCreatedAt ?? existing?.createdAt ?? syncedAt,
          updatedAt: syncedAt,
        });
      }

      yield* upsertProviderConfigRow({
        providerId: adapter.id,
        configJson: input.configJson,
        lastSyncAt: syncedAt,
        lastSyncError: null,
      });
      yield* Effect.logInfo(`${adapter.label} sync completed`, {
        tasks: result.success.length,
      });
    });

  const syncProviderTasks: TaskService["Service"]["syncProviderTasks"] = (input) =>
    Effect.gen(function* () {
      const adapter = registry.get(input.providerId);
      if (!adapter) {
        return yield* taskServiceError(
          "tasks.syncProviderTasks",
          `Unknown task provider: ${input.providerId}`,
        );
      }
      const credential = yield* readCredential(adapter);
      if (!credential) {
        return yield* taskServiceError(
          "tasks.syncProviderTasks",
          `Configure a ${adapter.label} credential before syncing tasks.`,
        );
      }
      let configRow = yield* loadProviderConfigRow(adapter.id);
      let configJson = configRow?.configJson ?? null;
      if (!configJson) {
        configJson = yield* adapter
          .bootstrapConfig(credential)
          .pipe(Effect.mapError((cause) => providerFailure("tasks.syncProviderTasks", cause)));
        yield* upsertProviderConfigRow({
          providerId: adapter.id,
          configJson,
          lastSyncAt: null,
          lastSyncError: null,
        });
        configRow = yield* loadProviderConfigRow(adapter.id);
      }

      // Sync runs in a detached fiber: provider paging plus row writes take
      // minutes, and holding the HTTP response open exposes it to every hop's
      // timeout. Clients poll the panel for lastSyncAt/lastSyncError instead.
      yield* Effect.forkDetach(
        runProviderSync({
          adapter,
          credential,
          configJson,
          previousLastSyncAt: configRow?.lastSyncAt ?? null,
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning(`${adapter.label} sync crashed`, {
              cause,
            }),
          ),
        ),
      );
      return yield* getPanel();
    }).pipe(
      Effect.mapError((cause) =>
        taskServiceError(
          "tasks.syncProviderTasks",
          isTaskServiceError(cause) ? cause.message : "Failed to start provider sync",
          cause,
        ),
      ),
    );

  return TaskService.of({
    getPanel,
    queryTasks,
    listLinks,
    createManualTask,
    createList,
    createFolder,
    updateTask,
    deleteTask,
    deleteList,
    deleteFolder,
    addNote,
    getTaskAttachments,
    getTaskComments,
    setProviderCredential,
    clearProviderCredential,
    getProviderStatus,
    syncProviderTasks,
  });
});

// The registry rides along so consumers only need TaskServiceLive; its
// HttpClient requirement flows up to whoever already serves the adapters.
export const TaskServiceLive = Layer.effect(TaskService, make).pipe(
  Layer.provideMerge(TaskProviderRegistryLive),
);
