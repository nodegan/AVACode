import {
  AddTaskCommentInput,
  type ClickUpConnectionStatus,
  CreateManualTaskInput,
  type ClickUpWorkspaceSummary,
  DeleteTaskInput,
  type Task,
  type TaskComment,
  TaskComment as TaskCommentSchema,
  TaskFacets,
  TaskId,
  type TaskLinksResult,
  type TaskQueryFilter,
  type TaskQueryResult,
  Task as TaskSchema,
  type TaskPanel,
  type TaskStatusCategory,
  type TaskSyncConfig,
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
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import { type SecretStoreError, ServerSecretStore } from "../auth/ServerSecretStore.ts";

const CLICKUP_TOKEN_SECRET = "clickup-api-token";
const CLICKUP_SYNC_PROVIDER = "clickup";
const TASK_PAGE_SIZE_DEFAULT = 10;
const TASK_PAGE_SIZE_MAX = 200;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

interface TaskRow {
  readonly id: string;
  readonly source: Task["source"];
  readonly title: string;
  readonly description: string;
  readonly statusLabel: string;
  readonly statusCategory: TaskStatusCategory;
  readonly statusColor: string | null;
  readonly linkedThreadId: string | null;
  readonly externalTaskId: string | null;
  readonly externalCustomId: string | null;
  readonly externalUrl: string | null;
  readonly externalListId: string | null;
  readonly externalListName: string | null;
  readonly externalFolderId: string | null;
  readonly externalFolderName: string | null;
  readonly assigneesJson: string;
  readonly syncedAt: string | null;
  readonly externalUpdatedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface TaskCommentRow {
  readonly id: string;
  readonly taskId: string;
  readonly body: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface TaskSyncConfigRow {
  readonly workspaceId: string;
  readonly workspaceName: string | null;
  readonly listIdsJson: string;
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
  readonly page: number;
  readonly pageSize: number;
}

interface ClickUpWorkspaceResponse {
  readonly teams?: ReadonlyArray<{
    readonly id?: string | number;
    readonly name?: string;
  }>;
}

interface ClickUpAssigneeResponse {
  readonly id?: string | number | null;
  readonly username?: string | null;
}

interface ClickUpTaskResponse {
  readonly id?: string | number;
  readonly custom_id?: string | null;
  readonly name?: string;
  readonly description?: string | null;
  readonly markdown_description?: string | null;
  readonly url?: string | null;
  readonly date_created?: string | number | null;
  readonly date_updated?: string | number | null;
  readonly status?: {
    readonly status?: string;
    readonly type?: string;
    readonly color?: string | null;
  } | null;
  readonly assignees?: ReadonlyArray<ClickUpAssigneeResponse | null>;
  readonly list?: {
    readonly id?: string | number | null;
    readonly name?: string | null;
  } | null;
  readonly folder?: {
    readonly id?: string | number | null;
    readonly name?: string | null;
    readonly hidden?: boolean | null;
  } | null;
}

interface ClickUpTaskListResponse {
  readonly tasks?: ReadonlyArray<ClickUpTaskResponse>;
  readonly last_page?: boolean;
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

export function taskStatusCategory(input: {
  statusType?: string | null;
  statusLabel?: string | null;
}): TaskStatusCategory {
  const type = input.statusType?.toLowerCase() ?? "";
  const label = input.statusLabel?.toLowerCase() ?? "";
  if (
    type.includes("done") ||
    type.includes("closed") ||
    label.includes("done") ||
    label.includes("closed")
  ) {
    return "done";
  }
  if (
    type.includes("progress") ||
    label.includes("progress") ||
    label.includes("doing") ||
    label.includes("active")
  ) {
    return "in_progress";
  }
  if (label.includes("block")) {
    return "blocked";
  }
  if (
    type.includes("open") ||
    label.includes("todo") ||
    label.includes("to do") ||
    label.includes("open")
  ) {
    return "open";
  }
  return "unknown";
}

/**
 * Users paste "Bearer pk_…" copied from docs and other tools; ClickUp wants
 * the raw token in the Authorization header. Normalized on save and on read so
 * already-stored tokens recover without re-entry.
 */
export function normalizeClickUpToken(token: string): string {
  return token
    .trim()
    .replace(/^bearer\b\s*/i, "")
    .trim();
}

/**
 * ClickUp timestamps are millisecond epoch strings ("1567780450202"). Absent
 * fields come back as null/empty rather than "0", which would decode as 1970.
 */
export function parseClickUpTimestamp(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (raw.length === 0) return null;
  const millis = Number(raw);
  if (!Number.isFinite(millis) || millis <= 0) return null;
  return Option.getOrNull(DateTime.make(millis).pipe(Option.map(DateTime.formatIso)));
}

/** Keep only well-formed hex colors ("#rgb"/"#rrggbb"), uppercased. */
export function normalizeStatusColor(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = value.trim().toUpperCase();
  return /^#(?:[0-9A-F]{3}|[0-9A-F]{6})$/.test(raw) ? raw : null;
}

/** Prefer the markdown description ClickUp can serve over the HTML fallback. */
export function pickClickUpDescription(task: ClickUpTaskResponse): string {
  const markdown = task.markdown_description?.trim() ?? "";
  if (markdown.length > 0) return markdown;
  return task.description?.trim() ?? "";
}

export function clickUpListRef(task: ClickUpTaskResponse): {
  externalListId: string | null;
  externalListName: string | null;
} {
  const id = task.list?.id == null ? null : String(task.list.id).trim();
  const name = task.list?.name?.trim() ?? null;
  return {
    externalListId: id && id.length > 0 ? id : null,
    externalListName: name && name.length > 0 ? name : null,
  };
}

/** Assignee usernames are the stable display value used for panel filters. */
export function clickUpAssignees(task: ClickUpTaskResponse): ReadonlyArray<string> {
  const names = new Set<string>();
  for (const assignee of task.assignees ?? []) {
    const name = assignee?.username?.trim() ?? "";
    if (name.length > 0) names.add(name);
  }
  return [...names].toSorted((left, right) => left.localeCompare(right));
}

/**
 * Folderless lists surface a hidden folder named after their space; treat
 * those as having no folder so they browse at the top level.
 */
export function clickUpFolderRef(task: ClickUpTaskResponse): {
  externalFolderId: string | null;
  externalFolderName: string | null;
} {
  const folder = task.folder;
  const id = folder?.id == null ? null : String(folder.id).trim();
  const name = folder?.name?.trim() ?? "";
  if (folder?.hidden === true || !id || !name) {
    return { externalFolderId: null, externalFolderName: null };
  }
  return { externalFolderId: id, externalFolderName: name };
}

const decodeCommentRow = Schema.decodeSync(TaskCommentSchema);
const decodeTaskRow = Schema.decodeSync(TaskSchema);
const decodeFacets = Schema.decodeSync(TaskFacets);

function mapCommentRow(row: TaskCommentRow): TaskComment {
  return decodeCommentRow({
    id: row.id,
    taskId: row.taskId,
    body: row.body,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function mapTaskRow(row: TaskRow, comments: ReadonlyArray<TaskComment>): Task {
  return decodeTaskRow({
    id: row.id,
    source: row.source,
    title: row.title,
    description: row.description,
    statusLabel: row.statusLabel,
    statusCategory: row.statusCategory,
    statusColor: row.statusColor,
    linkedThreadId: row.linkedThreadId,
    externalTaskId: row.externalTaskId,
    externalCustomId: row.externalCustomId,
    externalUrl: row.externalUrl,
    externalListId: row.externalListId,
    externalListName: row.externalListName,
    assignees: parseJsonArray(row.assigneesJson),
    syncedAt: row.syncedAt,
    externalUpdatedAt: row.externalUpdatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    comments,
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
    readonly updateTask: (input: UpdateTaskInput) => Effect.Effect<Task, TaskServiceFailure>;
    readonly deleteTask: (input: DeleteTaskInput) => Effect.Effect<void, TaskServiceFailure>;
    readonly addComment: (input: AddTaskCommentInput) => Effect.Effect<Task, TaskServiceFailure>;
    readonly setClickUpToken: (token: string) => Effect.Effect<void, TaskServiceFailure>;
    readonly clearClickUpToken: () => Effect.Effect<void, TaskServiceFailure>;
    readonly getClickUpStatus: () => Effect.Effect<ClickUpConnectionStatus, TaskServiceFailure>;
    readonly syncClickUpTasks: () => Effect.Effect<TaskPanel, TaskServiceFailure>;
  }
>()("t3/tasks/TaskService") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const crypto = yield* Crypto.Crypto;
  const httpClient = yield* HttpClient.HttpClient;
  const secretStore = yield* ServerSecretStore;

  const nowIso = () => DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const getClickUpToken = Effect.gen(function* () {
    const token = yield* secretStore.get(CLICKUP_TOKEN_SECRET);
    return Option.match(token, {
      onNone: () => null,
      onSome: (value) => normalizeClickUpToken(bytesToString(value)) || null,
    });
  });

  const fetchJson = <T>(input: { readonly url: string; readonly token: string }) =>
    httpClient
      .execute(
        HttpClientRequest.get(input.url).pipe(
          HttpClientRequest.acceptJson,
          HttpClientRequest.setHeader("Authorization", input.token),
        ),
      )
      .pipe(
        Effect.mapError((cause) =>
          taskServiceError("clickup.fetch", `Request failed for ${input.url}`, cause),
        ),
        Effect.flatMap(
          HttpClientResponse.matchStatus({
            "2xx": (response) =>
              response.json.pipe(
                Effect.map((body) => body as T),
                Effect.mapError((cause) =>
                  taskServiceError("clickup.fetch", "ClickUp returned invalid JSON", cause),
                ),
              ),
            orElse: (response) =>
              response.text.pipe(
                Effect.mapError((cause) =>
                  taskServiceError("clickup.fetch", "Failed to read ClickUp error response", cause),
                ),
                Effect.flatMap((body) =>
                  taskServiceError(
                    "clickup.fetch",
                    response.status === 401
                      ? "ClickUp rejected this token (401). Save a personal API token (pk_…), without a Bearer prefix."
                      : `Request failed (${response.status}): ${body || "unexpected response"}`,
                  ),
                ),
              ),
          }),
        ),
      );

  const fetchClickUpWorkspaces = (token: string) =>
    Effect.gen(function* () {
      const payload = yield* fetchJson<ClickUpWorkspaceResponse>({
        url: "https://api.clickup.com/api/v2/team",
        token,
      });
      return (
        payload.teams?.flatMap((workspace): ClickUpWorkspaceSummary[] => {
          const id = workspace.id == null ? null : String(workspace.id).trim();
          const name = workspace.name?.trim() ?? "";
          return id && name ? [{ id, name }] : [];
        }) ?? []
      );
    });

  // ClickUp pages at 100 tasks; the hard cap bounds a single sync so a huge
  // workspace cannot stall it indefinitely. 50 pages = 5000 tasks.
  const TASK_SYNC_MAX_PAGES = 50;

  const fetchClickUpTasks = (input: {
    readonly token: string;
    readonly syncConfig: TaskSyncConfig;
  }) =>
    Effect.gen(function* () {
      const tasks: ClickUpTaskResponse[] = [];
      for (let page = 0; page < TASK_SYNC_MAX_PAGES; page += 1) {
        const url = new URL(
          `https://api.clickup.com/api/v2/team/${encodeURIComponent(input.syncConfig.workspaceId)}/task`,
        );
        url.searchParams.set("page", String(page));
        url.searchParams.set("include_closed", "true");
        url.searchParams.set("subtasks", "true");
        url.searchParams.set("include_markdown_description", "true");
        for (const listId of input.syncConfig.listIds) {
          url.searchParams.append("list_ids[]", listId);
        }
        const payload = yield* fetchJson<ClickUpTaskListResponse>({
          url: url.toString(),
          token: input.token,
        });
        const pageTasks = payload.tasks ?? [];
        tasks.push(...pageTasks);
        if (payload.last_page === true || pageTasks.length < 100) {
          break;
        }
      }
      return tasks;
    });

  const loadSyncConfigRow = () =>
    sql<TaskSyncConfigRow>`
      SELECT
        workspace_id AS "workspaceId",
        workspace_name AS "workspaceName",
        list_ids_json AS "listIdsJson",
        last_sync_at AS "lastSyncAt",
        last_sync_error AS "lastSyncError"
      FROM task_sync_config
      WHERE id = 1
    `.pipe(Effect.map((rows) => rows[0] ?? null));

  const mapSyncConfig = (row: TaskSyncConfigRow | null): TaskSyncConfig | null =>
    row
      ? {
          workspaceId: row.workspaceId,
          ...(row.workspaceName ? { workspaceName: row.workspaceName } : {}),
          listIds: [...parseJsonArray(row.listIdsJson)],
        }
      : null;

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
      page: Math.max(1, Math.floor(filter?.page ?? 1)),
      pageSize: Math.min(
        TASK_PAGE_SIZE_MAX,
        Math.max(1, Math.floor(filter?.pageSize ?? TASK_PAGE_SIZE_DEFAULT)),
      ),
    };
  };

  const taskFilterFragment = (filter: NormalizedTaskQueryFilter) => {
    const clauses: Array<string | Fragment> = [];
    // A selection can name lists directly, folders (denormalized onto each
    // synced task), both, or specific tasks — any of the named scopes match.
    const listScope: Array<Fragment> = [];
    if (filter.listIds.length > 0) {
      listScope.push(sql.in("external_list_id", filter.listIds));
    }
    if (filter.folderIds.length > 0) {
      listScope.push(sql.in("external_folder_id", filter.folderIds));
    }
    if (filter.taskIds.length > 0) {
      listScope.push(sql.in("task_id", filter.taskIds));
    }
    const listScopeClause =
      listScope.length === 0 ? null : listScope.length === 1 ? listScope[0] : sql.or(listScope);
    if (listScopeClause) {
      clauses.push(listScopeClause);
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
    return sql.and(clauses);
  };

  const countFilteredTasks = (where: Fragment) =>
    sql<{ readonly count: number }>`
      SELECT COUNT(*) AS "count"
      FROM tasks
      WHERE ${where}
    `.pipe(Effect.map((rows) => rows[0]?.count ?? 0));

  const listFilteredTasks = (where: Fragment, page: number, pageSize: number) =>
    sql<TaskRow>`
      SELECT
        task_id AS "id",
        source,
        title,
        description,
        status_label AS "statusLabel",
        status_category AS "statusCategory",
        status_color AS "statusColor",
        linked_thread_id AS "linkedThreadId",
        external_task_id AS "externalTaskId",
        external_custom_id AS "externalCustomId",
        external_url AS "externalUrl",
        external_list_id AS "externalListId",
        external_list_name AS "externalListName",
        external_folder_id AS "externalFolderId",
        external_folder_name AS "externalFolderName",
        assignees_json AS "assigneesJson",
        synced_at AS "syncedAt",
        external_updated_at AS "externalUpdatedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM tasks
      WHERE ${where}
      ORDER BY
        CASE status_category
          WHEN 'done' THEN 1
          ELSE 0
        END ASC,
        updated_at DESC,
        created_at DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `;

  const listCommentsByTaskIds = (taskIds: ReadonlyArray<string>) =>
    taskIds.length === 0
      ? Effect.succeed([] as TaskCommentRow[])
      : sql<TaskCommentRow>`
          SELECT
            comment_id AS "id",
            task_id AS "taskId",
            body,
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM task_comments
          WHERE ${sql.in("task_id", taskIds)}
          ORDER BY created_at ASC, comment_id ASC
        `;

  const loadTaskFacets = () =>
    Effect.gen(function* () {
      const [listRows, statusRows, assigneeRows] = yield* Effect.all([
        sql<{
          readonly id: string;
          readonly name: string | null;
          readonly folderId: string | null;
          readonly folderName: string | null;
          readonly count: number;
        }>`
          SELECT
            external_list_id AS "id",
            MAX(external_list_name) AS "name",
            MAX(external_folder_id) AS "folderId",
            MAX(external_folder_name) AS "folderName",
            COUNT(*) AS "count"
          FROM tasks
          WHERE source = ${"clickup"}
            AND external_list_id IS NOT NULL
          GROUP BY external_list_id
          ORDER BY "name" ASC
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
        lists: listRows.flatMap((row) => {
          const name = row.name?.trim() ?? "";
          if (name.length === 0) return [];
          const folderId = row.folderId?.trim() ?? "";
          const folderName = row.folderName?.trim() ?? "";
          const hasFolder = folderId.length > 0 && folderName.length > 0;
          return [
            {
              id: row.id,
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
        SELECT
          task_id AS "id",
          source,
          title,
          description,
          status_label AS "statusLabel",
          status_category AS "statusCategory",
          status_color AS "statusColor",
          linked_thread_id AS "linkedThreadId",
          external_task_id AS "externalTaskId",
          external_custom_id AS "externalCustomId",
          external_url AS "externalUrl",
          external_list_id AS "externalListId",
          external_list_name AS "externalListName",
          external_folder_id AS "externalFolderId",
          external_folder_name AS "externalFolderName",
          assignees_json AS "assigneesJson",
          synced_at AS "syncedAt",
          external_updated_at AS "externalUpdatedAt",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM tasks
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
      const commentRows = yield* listCommentsByTaskIds([taskId]);
      const comments = commentRows.map(mapCommentRow);
      return mapTaskRow(row, comments);
    });

  const upsertTaskRow = (row: TaskRow) =>
    sql`
      INSERT INTO tasks (
        task_id,
        source,
        title,
        description,
        status_label,
        status_category,
        status_color,
        linked_thread_id,
        external_task_id,
        external_custom_id,
        external_url,
        external_list_id,
        external_list_name,
        external_folder_id,
        external_folder_name,
        assignees_json,
        synced_at,
        external_updated_at,
        created_at,
        updated_at
      )
      VALUES (
        ${row.id},
        ${row.source},
        ${row.title},
        ${row.description},
        ${row.statusLabel},
        ${row.statusCategory},
        ${row.statusColor},
        ${row.linkedThreadId},
        ${row.externalTaskId},
        ${row.externalCustomId},
        ${row.externalUrl},
        ${row.externalListId},
        ${row.externalListName},
        ${row.externalFolderId},
        ${row.externalFolderName},
        ${row.assigneesJson},
        ${row.syncedAt},
        ${row.externalUpdatedAt},
        ${row.createdAt},
        ${row.updatedAt}
      )
      ON CONFLICT (task_id)
      DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        status_label = excluded.status_label,
        status_category = excluded.status_category,
        status_color = excluded.status_color,
        linked_thread_id = excluded.linked_thread_id,
        external_task_id = excluded.external_task_id,
        external_custom_id = excluded.external_custom_id,
        external_url = excluded.external_url,
        external_list_id = excluded.external_list_id,
        external_list_name = excluded.external_list_name,
        external_folder_id = excluded.external_folder_id,
        external_folder_name = excluded.external_folder_name,
        assignees_json = excluded.assignees_json,
        synced_at = excluded.synced_at,
        external_updated_at = excluded.external_updated_at,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `.pipe(Effect.asVoid);

  const upsertSyncConfigRow = (input: {
    readonly syncConfig: TaskSyncConfig;
    readonly lastSyncAt?: string | null;
    readonly lastSyncError?: string | null;
  }) =>
    sql`
      INSERT INTO task_sync_config (
        id,
        provider,
        workspace_id,
        workspace_name,
        list_ids_json,
        last_sync_at,
        last_sync_error
      )
      VALUES (
        1,
        ${CLICKUP_SYNC_PROVIDER},
        ${input.syncConfig.workspaceId},
        ${input.syncConfig.workspaceName ?? null},
        ${JSON.stringify(input.syncConfig.listIds)},
        ${input.lastSyncAt ?? null},
        ${input.lastSyncError ?? null}
      )
      ON CONFLICT (id)
      DO UPDATE SET
        provider = excluded.provider,
        workspace_id = excluded.workspace_id,
        workspace_name = excluded.workspace_name,
        list_ids_json = excluded.list_ids_json,
        last_sync_at = excluded.last_sync_at,
        last_sync_error = excluded.last_sync_error
    `.pipe(Effect.asVoid);

  const getPanel: TaskService["Service"]["getPanel"] = () =>
    Effect.gen(function* () {
      // Fully local reads: clients poll the panel, so no ClickUp network calls
      // live here. Workspace discovery only happens in sync and status paths.
      const [facets, syncRow, token] = yield* Effect.all([
        loadTaskFacets(),
        loadSyncConfigRow(),
        getClickUpToken,
      ]);
      return {
        clickup: {
          tokenConfigured: token !== null,
          syncConfig: mapSyncConfig(syncRow),
          lastSyncAt: syncRow?.lastSyncAt ?? null,
          lastSyncError: syncRow?.lastSyncError ?? null,
        },
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
      const commentRows = yield* listCommentsByTaskIds(taskRows.map((task) => task.id));
      const commentsByTaskId = new Map<string, TaskComment[]>();
      for (const comment of commentRows) {
        const entry = commentsByTaskId.get(comment.taskId) ?? [];
        entry.push(mapCommentRow(comment));
        commentsByTaskId.set(comment.taskId, entry);
      }
      return {
        tasks: taskRows.map((task) => mapTaskRow(task, commentsByTaskId.get(task.id) ?? [])),
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
        readonly source: "manual" | "clickup";
      }>`
        SELECT
          task_id AS "taskId",
          linked_thread_id AS "threadId",
          title,
          status_category AS "statusCategory",
          source
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
          source: row.source,
        })),
      } satisfies TaskLinksResult;
    }).pipe(
      Effect.mapError((cause) =>
        taskServiceError("tasks.listLinks", "Failed to load task links", cause),
      ),
    );

  const createManualTask: TaskService["Service"]["createManualTask"] = (input) =>
    Effect.gen(function* () {
      const createdAt = yield* nowIso();
      const id = yield* crypto.randomUUIDv4;
      const row: TaskRow = {
        id,
        source: "manual",
        title: input.title,
        description: input.description?.trim() ?? "",
        statusLabel: "To do",
        statusCategory: "open",
        statusColor: null,
        linkedThreadId: null,
        externalTaskId: null,
        externalCustomId: null,
        externalUrl: null,
        externalListId: null,
        externalListName: null,
        externalFolderId: null,
        externalFolderName: null,
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

  const updateTask: TaskService["Service"]["updateTask"] = (input) =>
    Effect.gen(function* () {
      const current = yield* loadTaskRowById(input.taskId);
      const updatedAt = yield* nowIso();
      yield* upsertTaskRow({
        id: current.id,
        source: current.source,
        title: input.title ?? current.title,
        description: input.description ?? current.description,
        statusLabel: input.statusLabel ?? current.statusLabel,
        statusCategory: input.statusCategory ?? current.statusCategory,
        statusColor: current.statusColor,
        linkedThreadId:
          input.linkedThreadId !== undefined ? input.linkedThreadId : current.linkedThreadId,
        externalTaskId: current.externalTaskId,
        externalCustomId: current.externalCustomId,
        externalUrl: current.externalUrl,
        externalListId: current.externalListId,
        externalListName: current.externalListName,
        externalFolderId: current.externalFolderId,
        externalFolderName: current.externalFolderName,
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
      if (current.source !== "manual") {
        return yield* taskServiceError("tasks.deleteTask", "Only manual tasks can be deleted.");
      }
      yield* sql`
        DELETE FROM task_comments
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

  const addComment: TaskService["Service"]["addComment"] = (input) =>
    Effect.gen(function* () {
      const task = yield* loadTaskById(input.taskId);
      const timestamp = yield* nowIso();
      const commentId = yield* crypto.randomUUIDv4;
      yield* sql`
        INSERT INTO task_comments (
          comment_id,
          task_id,
          body,
          created_at,
          updated_at
        )
        VALUES (
          ${commentId},
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
        taskServiceError("tasks.addComment", "Failed to add task comment", cause),
      ),
    );

  const setClickUpToken: TaskService["Service"]["setClickUpToken"] = (token) => {
    const normalized = normalizeClickUpToken(token);
    if (normalized.length === 0) {
      return Effect.fail(
        taskServiceError(
          "tasks.setClickUpToken",
          "Paste a ClickUp personal API token (pk_…), without a Bearer prefix.",
        ),
      );
    }
    return secretStore
      .set(CLICKUP_TOKEN_SECRET, stringToBytes(normalized))
      .pipe(
        Effect.mapError((cause: SecretStoreError) =>
          taskServiceError("tasks.setClickUpToken", "Failed to store ClickUp token", cause),
        ),
      );
  };

  const clearClickUpToken: TaskService["Service"]["clearClickUpToken"] = () =>
    secretStore.get(CLICKUP_TOKEN_SECRET).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.void,
          onSome: () => secretStore.remove(CLICKUP_TOKEN_SECRET),
        }),
      ),
      Effect.mapError((cause: SecretStoreError) =>
        taskServiceError("tasks.clearClickUpToken", "Failed to clear ClickUp token", cause),
      ),
    );

  const getClickUpStatus: TaskService["Service"]["getClickUpStatus"] = () =>
    Effect.gen(function* () {
      const [token, syncRow] = yield* Effect.all([getClickUpToken, loadSyncConfigRow()]);
      let workspaceName = syncRow?.workspaceName?.trim() || null;
      if (token && !workspaceName) {
        // Before the first sync persists a workspace, name the account from
        // the token's workspaces. Best effort: status still renders without it.
        const workspaces = yield* fetchClickUpWorkspaces(token).pipe(
          Effect.orElseSucceed(() => []),
        );
        workspaceName = workspaces[0]?.name ?? null;
      }
      return {
        tokenConfigured: token !== null,
        workspaceName,
        lastSyncAt: syncRow?.lastSyncAt ?? null,
        lastSyncError: syncRow?.lastSyncError ?? null,
      } satisfies ClickUpConnectionStatus;
    }).pipe(
      Effect.mapError((cause) =>
        taskServiceError("tasks.getClickUpStatus", "Failed to read ClickUp status", cause),
      ),
    );

  const runClickUpSync = (input: {
    readonly token: string;
    readonly syncConfig: TaskSyncConfig;
    readonly syncRow: TaskSyncConfigRow | null;
  }) =>
    Effect.gen(function* () {
      const syncedAt = yield* nowIso();
      const result = yield* Effect.result(
        fetchClickUpTasks({ token: input.token, syncConfig: input.syncConfig }),
      );
      if (result._tag === "Failure") {
        const failure = result.failure;
        yield* upsertSyncConfigRow({
          syncConfig: input.syncConfig,
          lastSyncAt: input.syncRow?.lastSyncAt ?? null,
          lastSyncError: failure instanceof Error ? failure.message : String(failure),
        });
        yield* Effect.logWarning("ClickUp sync failed", {
          cause: failure,
        });
        return;
      }

      for (const task of result.success) {
        const externalTaskId = task.id == null ? null : String(task.id).trim();
        const title = task.name?.trim() ?? "";
        if (!externalTaskId || title.length === 0) {
          continue;
        }
        const listRef = clickUpListRef(task);
        const folderRef = clickUpFolderRef(task);
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
          WHERE source = ${"clickup"}
            AND external_task_id = ${externalTaskId}
          LIMIT 1
        `;
        const existing = existingRows[0] ?? null;
        const taskId = existing?.id ?? TaskId.make(yield* crypto.randomUUIDv4);
        yield* upsertTaskRow({
          id: taskId,
          source: "clickup",
          title,
          description: pickClickUpDescription(task),
          statusLabel: task.status?.status?.trim() || "Open",
          statusCategory: taskStatusCategory({
            statusType: task.status?.type ?? null,
            statusLabel: task.status?.status ?? null,
          }),
          statusColor: normalizeStatusColor(task.status?.color) ?? existing?.statusColor ?? null,
          linkedThreadId: existing?.linkedThreadId ?? null,
          externalTaskId,
          externalCustomId: task.custom_id?.trim() || existing?.existingCustomId || null,
          externalUrl: task.url?.trim() ?? null,
          externalListId: listRef.externalListId,
          externalListName: listRef.externalListName,
          externalFolderId: folderRef.externalFolderId,
          externalFolderName: folderRef.externalFolderName,
          assigneesJson: stringifyJsonArray(clickUpAssignees(task)),
          syncedAt,
          externalUpdatedAt: parseClickUpTimestamp(task.date_updated),
          // The ClickUp creation timestamp is the task's real age; the sync
          // time is only a fallback for payloads that omit it.
          createdAt: parseClickUpTimestamp(task.date_created) ?? existing?.createdAt ?? syncedAt,
          updatedAt: syncedAt,
        });
      }

      yield* upsertSyncConfigRow({
        syncConfig: input.syncConfig,
        lastSyncAt: syncedAt,
        lastSyncError: null,
      });
      yield* Effect.logInfo("ClickUp sync completed", {
        tasks: result.success.length,
      });
    });

  const syncClickUpTasks: TaskService["Service"]["syncClickUpTasks"] = () =>
    Effect.gen(function* () {
      const token = yield* getClickUpToken;
      if (!token) {
        return yield* taskServiceError(
          "tasks.syncClickUpTasks",
          "Configure a ClickUp token before syncing tasks.",
        );
      }
      let syncRow = yield* loadSyncConfigRow();
      let syncConfig = mapSyncConfig(syncRow);
      if (!syncConfig) {
        // Whole-workspace default: an environment that never configured
        // ClickUp syncs every task of the token's first workspace.
        const workspaces = yield* fetchClickUpWorkspaces(token).pipe(
          Effect.orElseSucceed(() => []),
        );
        const workspace = workspaces[0];
        if (!workspace) {
          return yield* taskServiceError(
            "tasks.syncClickUpTasks",
            "No ClickUp workspaces are available for this token.",
          );
        }
        syncConfig = { workspaceId: workspace.id, workspaceName: workspace.name, listIds: [] };
        yield* upsertSyncConfigRow({
          syncConfig,
          lastSyncAt: null,
          lastSyncError: null,
        });
        syncRow = yield* loadSyncConfigRow();
      }

      // Sync runs in a detached fiber: ClickUp paging plus row writes take
      // minutes, and holding the HTTP response open exposes it to every hop's
      // timeout. Clients poll the panel for lastSyncAt/lastSyncError instead.
      yield* Effect.forkDetach(
        runClickUpSync({
          token,
          syncConfig,
          syncRow,
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("ClickUp sync crashed", {
              cause,
            }),
          ),
        ),
      );
      return yield* getPanel();
    }).pipe(
      Effect.mapError((cause) =>
        taskServiceError(
          "tasks.syncClickUpTasks",
          isTaskServiceError(cause) ? cause.message : "Failed to start ClickUp sync",
          cause,
        ),
      ),
    );

  return TaskService.of({
    getPanel,
    queryTasks,
    listLinks,
    createManualTask,
    updateTask,
    deleteTask,
    addComment,
    setClickUpToken,
    clearClickUpToken,
    getClickUpStatus,
    syncClickUpTasks,
  });
});

export const TaskServiceLive = Layer.effect(TaskService, make);
