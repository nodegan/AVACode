import {
  AddProjectTaskCommentInput,
  ClickUpListSummary,
  CreateManualProjectTaskInput,
  type ClickUpWorkspaceSummary,
  DeleteProjectTaskInput,
  GetProjectTaskClickUpListsInput,
  type ProjectId,
  type ProjectTask,
  type ProjectTaskComment,
  ProjectTaskComment as ProjectTaskCommentSchema,
  ProjectTaskId,
  ProjectTask as ProjectTaskSchema,
  type ProjectTaskPanel,
  type ProjectTaskStatusCategory,
  type ProjectTaskSyncConfig,
  SetProjectTaskClickUpSyncConfigInput,
  SyncProjectClickUpTasksInput,
  type ThreadId,
  UpdateProjectTaskInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import { type SecretStoreError, ServerSecretStore } from "../auth/ServerSecretStore.ts";

const CLICKUP_TOKEN_SECRET = "clickup-api-token";
const CLICKUP_SYNC_PROVIDER = "clickup";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

interface ProjectTaskRow {
  readonly id: string;
  readonly projectId: string;
  readonly source: ProjectTask["source"];
  readonly title: string;
  readonly description: string;
  readonly statusLabel: string;
  readonly statusCategory: ProjectTaskStatusCategory;
  readonly linkedThreadId: string | null;
  readonly externalTaskId: string | null;
  readonly externalUrl: string | null;
  readonly externalListId: string | null;
  readonly externalListName: string | null;
  readonly syncedAt: string | null;
  readonly externalUpdatedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface ProjectTaskCommentRow {
  readonly id: string;
  readonly taskId: string;
  readonly body: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface ProjectTaskSyncConfigRow {
  readonly projectId: string;
  readonly workspaceId: string;
  readonly workspaceName: string | null;
  readonly listIdsJson: string;
  readonly lastSyncAt: string | null;
  readonly lastSyncError: string | null;
}

interface ClickUpWorkspaceResponse {
  readonly teams?: ReadonlyArray<{
    readonly id?: string | number;
    readonly name?: string;
  }>;
}

interface ClickUpTaskResponse {
  readonly id?: string | number;
  readonly name?: string;
  readonly description?: string | null;
  readonly markdown_description?: string | null;
  readonly url?: string | null;
  readonly date_updated?: string | null;
  readonly status?: {
    readonly status?: string;
    readonly type?: string;
  } | null;
  readonly list?: {
    readonly id?: string | number | null;
    readonly name?: string | null;
  } | null;
}

interface ClickUpTaskListResponse {
  readonly tasks?: ReadonlyArray<ClickUpTaskResponse>;
}

interface ClickUpSpaceResponse {
  readonly spaces?: ReadonlyArray<{
    readonly id?: string | number;
    readonly name?: string;
  }>;
}

interface ClickUpFolderResponse {
  readonly folders?: ReadonlyArray<{
    readonly id?: string | number;
    readonly name?: string;
  }>;
}

interface ClickUpListCollectionResponse {
  readonly lists?: ReadonlyArray<{
    readonly id?: string | number;
    readonly name?: string;
  }>;
}

export class ProjectTaskServiceError extends Schema.TaggedErrorClass<ProjectTaskServiceError>()(
  "ProjectTaskServiceError",
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
const isProjectTaskServiceError = Schema.is(ProjectTaskServiceError);

const taskServiceError = (operation: string, detail: string, cause?: unknown) =>
  new ProjectTaskServiceError({
    operation,
    detail,
    ...(cause === undefined ? {} : { cause }),
  });

type ProjectTaskServiceFailure = ProjectTaskServiceError;

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

export function taskStatusCategory(input: {
  statusType?: string | null;
  statusLabel?: string | null;
}): ProjectTaskStatusCategory {
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

const decodeCommentRow = Schema.decodeSync(ProjectTaskCommentSchema);
const decodeTaskRow = Schema.decodeSync(ProjectTaskSchema);

function mapCommentRow(row: ProjectTaskCommentRow): ProjectTaskComment {
  return decodeCommentRow({
    id: row.id,
    taskId: row.taskId,
    body: row.body,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function mapTaskRow(row: ProjectTaskRow, comments: ReadonlyArray<ProjectTaskComment>): ProjectTask {
  return decodeTaskRow({
    id: row.id,
    projectId: row.projectId,
    source: row.source,
    title: row.title,
    description: row.description,
    statusLabel: row.statusLabel,
    statusCategory: row.statusCategory,
    linkedThreadId: row.linkedThreadId,
    externalTaskId: row.externalTaskId,
    externalUrl: row.externalUrl,
    externalListId: row.externalListId,
    externalListName: row.externalListName,
    syncedAt: row.syncedAt,
    externalUpdatedAt: row.externalUpdatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    comments,
  });
}

export class ProjectTaskService extends Context.Service<
  ProjectTaskService,
  {
    readonly getPanel: (
      projectId: ProjectId,
    ) => Effect.Effect<ProjectTaskPanel, ProjectTaskServiceFailure>;
    readonly createManualTask: (
      input: CreateManualProjectTaskInput,
    ) => Effect.Effect<ProjectTask, ProjectTaskServiceFailure>;
    readonly updateTask: (
      input: UpdateProjectTaskInput,
    ) => Effect.Effect<ProjectTask, ProjectTaskServiceFailure>;
    readonly deleteTask: (
      input: DeleteProjectTaskInput,
    ) => Effect.Effect<void, ProjectTaskServiceFailure>;
    readonly addComment: (
      input: AddProjectTaskCommentInput,
    ) => Effect.Effect<ProjectTask, ProjectTaskServiceFailure>;
    readonly setClickUpToken: (token: string) => Effect.Effect<void, ProjectTaskServiceFailure>;
    readonly clearClickUpToken: () => Effect.Effect<void, ProjectTaskServiceFailure>;
    readonly getClickUpLists: (
      input: GetProjectTaskClickUpListsInput,
    ) => Effect.Effect<ReadonlyArray<ClickUpListSummary>, ProjectTaskServiceFailure>;
    readonly setClickUpSyncConfig: (
      input: SetProjectTaskClickUpSyncConfigInput,
    ) => Effect.Effect<ProjectTaskPanel, ProjectTaskServiceFailure>;
    readonly syncClickUpTasks: (
      input: SyncProjectClickUpTasksInput,
    ) => Effect.Effect<ProjectTaskPanel, ProjectTaskServiceFailure>;
  }
>()("t3/tasks/ProjectTaskService") {}

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
      onSome: (value) => bytesToString(value).trim() || null,
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
                    `Request failed (${response.status}): ${body || "unexpected response"}`,
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

  const fetchClickUpTasks = (input: {
    readonly token: string;
    readonly syncConfig: ProjectTaskSyncConfig;
  }) =>
    Effect.gen(function* () {
      const tasks: ClickUpTaskResponse[] = [];
      for (let page = 0; page < 10; page += 1) {
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
        if (pageTasks.length < 100) {
          break;
        }
      }
      return tasks;
    });

  const fetchClickUpLists = (input: { readonly token: string; readonly workspaceId: string }) =>
    Effect.gen(function* () {
      const spacesPayload = yield* fetchJson<ClickUpSpaceResponse>({
        url: `https://api.clickup.com/api/v2/team/${encodeURIComponent(input.workspaceId)}/space`,
        token: input.token,
      });
      const spaces = spacesPayload.spaces ?? [];
      const allLists: ClickUpListSummary[] = [];

      for (const space of spaces) {
        const spaceId = space.id == null ? null : String(space.id).trim();
        const spaceName = space.name?.trim() ?? "";
        if (!spaceId || !spaceName) continue;

        const folderlessPayload = yield* fetchJson<ClickUpListCollectionResponse>({
          url: `https://api.clickup.com/api/v2/space/${encodeURIComponent(spaceId)}/list`,
          token: input.token,
        });
        for (const list of folderlessPayload.lists ?? []) {
          const listId = list.id == null ? null : String(list.id).trim();
          const listName = list.name?.trim() ?? "";
          if (!listId || !listName) continue;
          allLists.push({
            id: listId,
            name: listName,
            spaceId,
            spaceName,
            folderId: null,
            folderName: null,
          });
        }

        const foldersPayload = yield* fetchJson<ClickUpFolderResponse>({
          url: `https://api.clickup.com/api/v2/space/${encodeURIComponent(spaceId)}/folder`,
          token: input.token,
        });
        for (const folder of foldersPayload.folders ?? []) {
          const folderId = folder.id == null ? null : String(folder.id).trim();
          const folderName = folder.name?.trim() ?? "";
          if (!folderId || !folderName) continue;

          const folderListsPayload = yield* fetchJson<ClickUpListCollectionResponse>({
            url: `https://api.clickup.com/api/v2/folder/${encodeURIComponent(folderId)}/list`,
            token: input.token,
          });
          for (const list of folderListsPayload.lists ?? []) {
            const listId = list.id == null ? null : String(list.id).trim();
            const listName = list.name?.trim() ?? "";
            if (!listId || !listName) continue;
            allLists.push({
              id: listId,
              name: listName,
              spaceId,
              spaceName,
              folderId,
              folderName,
            });
          }
        }
      }

      return allLists.toSorted((left, right) =>
        `${left.spaceName}/${left.folderName ?? ""}/${left.name}`.localeCompare(
          `${right.spaceName}/${right.folderName ?? ""}/${right.name}`,
        ),
      );
    });

  const loadSyncConfigRow = (projectId: ProjectId) =>
    sql<ProjectTaskSyncConfigRow>`
      SELECT
        project_id AS "projectId",
        workspace_id AS "workspaceId",
        workspace_name AS "workspaceName",
        list_ids_json AS "listIdsJson",
        last_sync_at AS "lastSyncAt",
        last_sync_error AS "lastSyncError"
      FROM project_task_sync_configs
      WHERE project_id = ${projectId}
    `.pipe(Effect.map((rows) => rows[0] ?? null));

  const mapSyncConfig = (row: ProjectTaskSyncConfigRow | null): ProjectTaskSyncConfig | null =>
    row
      ? {
          workspaceId: row.workspaceId,
          ...(row.workspaceName ? { workspaceName: row.workspaceName } : {}),
          listIds: [...parseJsonArray(row.listIdsJson)],
        }
      : null;

  const listTasksByProject = (projectId: ProjectId) =>
    sql<ProjectTaskRow>`
      SELECT
        task_id AS "id",
        project_id AS "projectId",
        source,
        title,
        description,
        status_label AS "statusLabel",
        status_category AS "statusCategory",
        linked_thread_id AS "linkedThreadId",
        external_task_id AS "externalTaskId",
        external_url AS "externalUrl",
        external_list_id AS "externalListId",
        external_list_name AS "externalListName",
        synced_at AS "syncedAt",
        external_updated_at AS "externalUpdatedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM project_tasks
      WHERE project_id = ${projectId}
      ORDER BY
        CASE status_category
          WHEN 'done' THEN 1
          ELSE 0
        END ASC,
        updated_at DESC,
        created_at DESC
    `;

  const listCommentsByTaskIds = (taskIds: ReadonlyArray<string>) =>
    taskIds.length === 0
      ? Effect.succeed([] as ProjectTaskCommentRow[])
      : sql<ProjectTaskCommentRow>`
          SELECT
            comment_id AS "id",
            task_id AS "taskId",
            body,
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM project_task_comments
          WHERE ${sql.in("task_id", taskIds)}
          ORDER BY created_at ASC, comment_id ASC
        `;

  const loadTaskById = (taskId: ProjectTaskId) =>
    Effect.gen(function* () {
      const rows = yield* sql<ProjectTaskRow>`
        SELECT
          task_id AS "id",
          project_id AS "projectId",
          source,
          title,
          description,
          status_label AS "statusLabel",
          status_category AS "statusCategory",
          linked_thread_id AS "linkedThreadId",
          external_task_id AS "externalTaskId",
          external_url AS "externalUrl",
          external_list_id AS "externalListId",
          external_list_name AS "externalListName",
          synced_at AS "syncedAt",
          external_updated_at AS "externalUpdatedAt",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM project_tasks
        WHERE task_id = ${taskId}
      `;
      const row = rows[0];
      if (!row) {
        return yield* taskServiceError("tasks.loadTask", `Unknown task: ${taskId}`);
      }
      const commentRows = yield* listCommentsByTaskIds([taskId]);
      const comments = commentRows.map(mapCommentRow);
      return mapTaskRow(row, comments);
    });

  const upsertTaskRow = (row: ProjectTaskRow) =>
    sql`
      INSERT INTO project_tasks (
        task_id,
        project_id,
        source,
        title,
        description,
        status_label,
        status_category,
        linked_thread_id,
        external_task_id,
        external_url,
        external_list_id,
        external_list_name,
        synced_at,
        external_updated_at,
        created_at,
        updated_at
      )
      VALUES (
        ${row.id},
        ${row.projectId},
        ${row.source},
        ${row.title},
        ${row.description},
        ${row.statusLabel},
        ${row.statusCategory},
        ${row.linkedThreadId},
        ${row.externalTaskId},
        ${row.externalUrl},
        ${row.externalListId},
        ${row.externalListName},
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
        linked_thread_id = excluded.linked_thread_id,
        external_task_id = excluded.external_task_id,
        external_url = excluded.external_url,
        external_list_id = excluded.external_list_id,
        external_list_name = excluded.external_list_name,
        synced_at = excluded.synced_at,
        external_updated_at = excluded.external_updated_at,
        updated_at = excluded.updated_at
    `.pipe(Effect.asVoid);

  const upsertSyncConfigRow = (input: {
    readonly projectId: string;
    readonly syncConfig: ProjectTaskSyncConfig;
    readonly lastSyncAt?: string | null;
    readonly lastSyncError?: string | null;
  }) =>
    sql`
      INSERT INTO project_task_sync_configs (
        project_id,
        provider,
        workspace_id,
        workspace_name,
        list_ids_json,
        last_sync_at,
        last_sync_error
      )
      VALUES (
        ${input.projectId},
        ${CLICKUP_SYNC_PROVIDER},
        ${input.syncConfig.workspaceId},
        ${input.syncConfig.workspaceName ?? null},
        ${JSON.stringify(input.syncConfig.listIds)},
        ${input.lastSyncAt ?? null},
        ${input.lastSyncError ?? null}
      )
      ON CONFLICT (project_id)
      DO UPDATE SET
        provider = excluded.provider,
        workspace_id = excluded.workspace_id,
        workspace_name = excluded.workspace_name,
        list_ids_json = excluded.list_ids_json,
        last_sync_at = excluded.last_sync_at,
        last_sync_error = excluded.last_sync_error
    `.pipe(Effect.asVoid);

  const getPanel: ProjectTaskService["Service"]["getPanel"] = (projectId) =>
    Effect.gen(function* () {
      const [taskRows, syncRow, token] = yield* Effect.all([
        listTasksByProject(projectId),
        loadSyncConfigRow(projectId),
        getClickUpToken,
      ]);
      const commentRows = yield* listCommentsByTaskIds(taskRows.map((task) => task.id));
      const commentsByTaskId = new Map<string, ProjectTaskComment[]>();
      for (const comment of commentRows) {
        const entry = commentsByTaskId.get(comment.taskId) ?? [];
        entry.push(mapCommentRow(comment));
        commentsByTaskId.set(comment.taskId, entry);
      }
      const workspaces = token
        ? yield* fetchClickUpWorkspaces(token).pipe(Effect.orElseSucceed(() => []))
        : [];
      return {
        projectId,
        clickup: {
          tokenConfigured: token !== null,
          availableWorkspaces: workspaces,
          syncConfig: mapSyncConfig(syncRow),
          lastSyncAt: syncRow?.lastSyncAt ?? null,
          lastSyncError: syncRow?.lastSyncError ?? null,
        },
        tasks: taskRows.map((task) => mapTaskRow(task, commentsByTaskId.get(task.id) ?? [])),
      } satisfies ProjectTaskPanel;
    }).pipe(
      Effect.mapError((cause) =>
        taskServiceError("tasks.getPanel", "Failed to load task panel", cause),
      ),
    );

  const createManualTask: ProjectTaskService["Service"]["createManualTask"] = (input) =>
    Effect.gen(function* () {
      const createdAt = yield* nowIso();
      const id = yield* crypto.randomUUIDv4;
      const row: ProjectTaskRow = {
        id,
        projectId: input.projectId,
        source: "manual",
        title: input.title,
        description: input.description?.trim() ?? "",
        statusLabel: "To do",
        statusCategory: "open",
        linkedThreadId: null,
        externalTaskId: null,
        externalUrl: null,
        externalListId: null,
        externalListName: null,
        syncedAt: null,
        externalUpdatedAt: null,
        createdAt,
        updatedAt: createdAt,
      };
      yield* upsertTaskRow(row);
      return yield* loadTaskById(ProjectTaskId.make(id));
    }).pipe(
      Effect.mapError((cause) =>
        taskServiceError("tasks.createManualTask", "Failed to create manual task", cause),
      ),
    );

  const updateTask: ProjectTaskService["Service"]["updateTask"] = (input) =>
    Effect.gen(function* () {
      const current = yield* loadTaskById(input.taskId);
      const updatedAt = yield* nowIso();
      yield* upsertTaskRow({
        id: current.id,
        projectId: current.projectId,
        source: current.source,
        title: input.title ?? current.title,
        description: input.description ?? current.description,
        statusLabel: input.statusLabel ?? current.statusLabel,
        statusCategory: input.statusCategory ?? current.statusCategory,
        linkedThreadId:
          input.linkedThreadId !== undefined ? input.linkedThreadId : current.linkedThreadId,
        externalTaskId: current.externalTaskId,
        externalUrl: current.externalUrl,
        externalListId: current.externalListId,
        externalListName: current.externalListName,
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

  const deleteTask: ProjectTaskService["Service"]["deleteTask"] = (input) =>
    Effect.gen(function* () {
      const current = yield* loadTaskById(input.taskId);
      if (current.source !== "manual") {
        return yield* taskServiceError("tasks.deleteTask", "Only manual tasks can be deleted.");
      }
      yield* sql`
        DELETE FROM project_task_comments
        WHERE task_id = ${input.taskId}
      `;
      yield* sql`
        DELETE FROM project_tasks
        WHERE task_id = ${input.taskId}
      `;
    }).pipe(
      Effect.mapError((cause) =>
        taskServiceError("tasks.deleteTask", "Failed to delete task", cause),
      ),
    );

  const addComment: ProjectTaskService["Service"]["addComment"] = (input) =>
    Effect.gen(function* () {
      const task = yield* loadTaskById(input.taskId);
      const timestamp = yield* nowIso();
      const commentId = yield* crypto.randomUUIDv4;
      yield* sql`
        INSERT INTO project_task_comments (
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
        UPDATE project_tasks
        SET updated_at = ${timestamp}
        WHERE task_id = ${task.id}
      `;
      return yield* loadTaskById(input.taskId);
    }).pipe(
      Effect.mapError((cause) =>
        taskServiceError("tasks.addComment", "Failed to add task comment", cause),
      ),
    );

  const setClickUpToken: ProjectTaskService["Service"]["setClickUpToken"] = (token) =>
    secretStore
      .set(CLICKUP_TOKEN_SECRET, stringToBytes(token))
      .pipe(
        Effect.mapError((cause: SecretStoreError) =>
          taskServiceError("tasks.setClickUpToken", "Failed to store ClickUp token", cause),
        ),
      );

  const clearClickUpToken: ProjectTaskService["Service"]["clearClickUpToken"] = () =>
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

  const getClickUpLists: ProjectTaskService["Service"]["getClickUpLists"] = (input) =>
    Effect.gen(function* () {
      const token = yield* getClickUpToken;
      if (!token) {
        return yield* taskServiceError(
          "tasks.getClickUpLists",
          "Configure a ClickUp token before loading lists.",
        );
      }
      return yield* fetchClickUpLists({ token, workspaceId: input.workspaceId });
    }).pipe(
      Effect.mapError((cause) =>
        taskServiceError("tasks.getClickUpLists", "Failed to load ClickUp lists", cause),
      ),
    );

  const setClickUpSyncConfig: ProjectTaskService["Service"]["setClickUpSyncConfig"] = (input) =>
    Effect.gen(function* () {
      if (input.syncConfig === null) {
        yield* sql`
          DELETE FROM project_task_sync_configs
          WHERE project_id = ${input.projectId}
        `;
      } else {
        const current = yield* loadSyncConfigRow(input.projectId);
        yield* upsertSyncConfigRow({
          projectId: input.projectId,
          syncConfig: input.syncConfig,
          lastSyncAt: current?.lastSyncAt ?? null,
          lastSyncError: current?.lastSyncError ?? null,
        });
      }
      return yield* getPanel(input.projectId);
    }).pipe(
      Effect.mapError((cause) =>
        taskServiceError("tasks.setClickUpSyncConfig", "Failed to save ClickUp sync config", cause),
      ),
    );

  const syncClickUpTasks: ProjectTaskService["Service"]["syncClickUpTasks"] = (input) =>
    Effect.gen(function* () {
      const token = yield* getClickUpToken;
      if (!token) {
        return yield* taskServiceError(
          "tasks.syncClickUpTasks",
          "Configure a ClickUp token before syncing tasks.",
        );
      }
      const syncRow = yield* loadSyncConfigRow(input.projectId);
      const syncConfig = mapSyncConfig(syncRow);
      if (!syncConfig) {
        return yield* taskServiceError(
          "tasks.syncClickUpTasks",
          "Configure a ClickUp workspace before syncing tasks.",
        );
      }
      const syncedAt = yield* nowIso();
      const result = yield* Effect.result(fetchClickUpTasks({ token, syncConfig }));
      if (result._tag === "Failure") {
        const failure = result.failure;
        yield* upsertSyncConfigRow({
          projectId: input.projectId,
          syncConfig,
          lastSyncAt: syncRow?.lastSyncAt ?? null,
          lastSyncError: failure instanceof Error ? failure.message : String(failure),
        });
        return yield* taskServiceError("tasks.syncClickUpTasks", "ClickUp sync failed", failure);
      }

      for (const task of result.success) {
        const externalTaskId = task.id == null ? null : String(task.id).trim();
        const title = task.name?.trim() ?? "";
        if (!externalTaskId || title.length === 0) {
          continue;
        }
        const listRef = clickUpListRef(task);
        const existingRows = yield* sql<{
          readonly id: string;
          readonly createdAt: string;
          readonly linkedThreadId: ThreadId | null;
        }>`
          SELECT
            task_id AS "id",
            created_at AS "createdAt",
            linked_thread_id AS "linkedThreadId"
          FROM project_tasks
          WHERE project_id = ${input.projectId}
            AND source = ${"clickup"}
            AND external_task_id = ${externalTaskId}
          LIMIT 1
        `;
        const existing = existingRows[0] ?? null;
        const taskId = existing?.id ?? ProjectTaskId.make(yield* crypto.randomUUIDv4);
        yield* upsertTaskRow({
          id: taskId,
          projectId: input.projectId,
          source: "clickup",
          title,
          description: pickClickUpDescription(task),
          statusLabel: task.status?.status?.trim() || "Open",
          statusCategory: taskStatusCategory({
            statusType: task.status?.type ?? null,
            statusLabel: task.status?.status ?? null,
          }),
          linkedThreadId: existing?.linkedThreadId ?? null,
          externalTaskId,
          externalUrl: task.url?.trim() ?? null,
          externalListId: listRef.externalListId,
          externalListName: listRef.externalListName,
          syncedAt,
          externalUpdatedAt: parseClickUpTimestamp(task.date_updated),
          createdAt: existing?.createdAt ?? syncedAt,
          updatedAt: syncedAt,
        });
      }

      yield* upsertSyncConfigRow({
        projectId: input.projectId,
        syncConfig,
        lastSyncAt: syncedAt,
        lastSyncError: null,
      });
      return yield* getPanel(input.projectId);
    }).pipe(
      Effect.mapError((cause) =>
        taskServiceError(
          "tasks.syncClickUpTasks",
          isProjectTaskServiceError(cause) ? cause.message : "Failed to sync ClickUp tasks",
          cause,
        ),
      ),
    );

  return ProjectTaskService.of({
    getPanel,
    createManualTask,
    updateTask,
    deleteTask,
    addComment,
    setClickUpToken,
    clearClickUpToken,
    getClickUpLists,
    setClickUpSyncConfig,
    syncClickUpTasks,
  });
});

export const ProjectTaskServiceLive = Layer.effect(ProjectTaskService, make);
