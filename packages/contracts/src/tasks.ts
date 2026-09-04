import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { IsoDateTime, ThreadId, TrimmedNonEmptyString, TrimmedString } from "./baseSchemas.ts";

export const TaskId = TrimmedNonEmptyString.pipe(Schema.brand("TaskId"));
export type TaskId = typeof TaskId.Type;

export const TaskCommentId = TrimmedNonEmptyString.pipe(Schema.brand("TaskCommentId"));
export type TaskCommentId = typeof TaskCommentId.Type;

export const TaskSource = Schema.Literals(["manual", "clickup"]);
export type TaskSource = typeof TaskSource.Type;

export const TaskStatusCategory = Schema.Literals([
  "open",
  "in_progress",
  "done",
  "blocked",
  "unknown",
]);
export type TaskStatusCategory = typeof TaskStatusCategory.Type;

export const ClickUpWorkspaceSummary = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
});
export type ClickUpWorkspaceSummary = typeof ClickUpWorkspaceSummary.Type;

export const TaskComment = Schema.Struct({
  id: TaskCommentId,
  taskId: TaskId,
  body: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type TaskComment = typeof TaskComment.Type;

export const Task = Schema.Struct({
  id: TaskId,
  source: TaskSource,
  title: TrimmedNonEmptyString,
  description: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  statusLabel: TrimmedNonEmptyString,
  statusCategory: TaskStatusCategory,
  statusColor: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  linkedThreadId: Schema.NullOr(ThreadId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  externalTaskId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  /** ClickUp's human-facing custom ID (e.g. `PR-1685`), when the workspace uses them. */
  externalCustomId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  externalUrl: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  externalListId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  externalListName: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  assignees: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  syncedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  externalUpdatedAt: Schema.NullOr(IsoDateTime).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  comments: Schema.Array(TaskComment).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type Task = typeof Task.Type;

export const TaskSyncConfig = Schema.Struct({
  workspaceId: TrimmedNonEmptyString,
  workspaceName: Schema.optional(TrimmedNonEmptyString),
  listIds: Schema.Array(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type TaskSyncConfig = typeof TaskSyncConfig.Type;

export const TaskClickUpState = Schema.Struct({
  tokenConfigured: Schema.Boolean,
  syncConfig: Schema.NullOr(TaskSyncConfig).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  lastSyncAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  lastSyncError: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
});
export type TaskClickUpState = typeof TaskClickUpState.Type;

export const TaskListFacet = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  count: Schema.Number,
  folderId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  folderName: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
});
export type TaskListFacet = typeof TaskListFacet.Type;

export const TaskValueFacet = Schema.Struct({
  value: TrimmedNonEmptyString,
  count: Schema.Number,
});
export type TaskValueFacet = typeof TaskValueFacet.Type;

export const TaskLinkSummary = Schema.Struct({
  taskId: TaskId,
  threadId: ThreadId,
  title: TrimmedNonEmptyString,
  statusCategory: TaskStatusCategory,
  source: TaskSource,
});
export type TaskLinkSummary = typeof TaskLinkSummary.Type;

export const TaskLinksResult = Schema.Struct({
  links: Schema.Array(TaskLinkSummary).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type TaskLinksResult = typeof TaskLinksResult.Type;

export const TaskFacets = Schema.Struct({
  lists: Schema.Array(TaskListFacet).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  statuses: Schema.Array(TaskValueFacet).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  assignees: Schema.Array(TaskValueFacet).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type TaskFacets = typeof TaskFacets.Type;

export const TaskPanel = Schema.Struct({
  clickup: TaskClickUpState,
  facets: TaskFacets,
});
export type TaskPanel = typeof TaskPanel.Type;

export const TaskQueryFilter = Schema.Struct({
  listIds: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  folderIds: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  taskIds: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  statuses: Schema.optional(Schema.Array(TaskStatusCategory)),
  assignees: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  linkedThreadId: Schema.optional(ThreadId),
  page: Schema.optional(Schema.Number),
  pageSize: Schema.optional(Schema.Number),
});
export type TaskQueryFilter = typeof TaskQueryFilter.Type;

export const QueryTasksInput = Schema.Struct({
  filter: Schema.optional(TaskQueryFilter),
});
export type QueryTasksInput = typeof QueryTasksInput.Type;

export const TaskQueryResult = Schema.Struct({
  tasks: Schema.Array(Task),
  total: Schema.Number,
  page: Schema.Number,
  pageSize: Schema.Number,
});
export type TaskQueryResult = typeof TaskQueryResult.Type;

export const CreateManualTaskInput = Schema.Struct({
  title: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedString),
});
export type CreateManualTaskInput = typeof CreateManualTaskInput.Type;

export const UpdateTaskInput = Schema.Struct({
  taskId: TaskId,
  title: Schema.optional(TrimmedNonEmptyString),
  description: Schema.optional(TrimmedString),
  statusLabel: Schema.optional(TrimmedNonEmptyString),
  statusCategory: Schema.optional(TaskStatusCategory),
  linkedThreadId: Schema.optional(Schema.NullOr(ThreadId)),
});
export type UpdateTaskInput = typeof UpdateTaskInput.Type;

export const DeleteTaskInput = Schema.Struct({
  taskId: TaskId,
});
export type DeleteTaskInput = typeof DeleteTaskInput.Type;

export const AddTaskCommentInput = Schema.Struct({
  taskId: TaskId,
  body: TrimmedNonEmptyString,
});
export type AddTaskCommentInput = typeof AddTaskCommentInput.Type;

export const SetClickUpTokenInput = Schema.Struct({
  token: TrimmedNonEmptyString,
});
export type SetClickUpTokenInput = typeof SetClickUpTokenInput.Type;

export const ClickUpConnectionStatus = Schema.Struct({
  tokenConfigured: Schema.Boolean,
  /** Workspace the sync is bound to, or the token's first workspace before the first sync. */
  workspaceName: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  lastSyncAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  lastSyncError: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
});
export type ClickUpConnectionStatus = typeof ClickUpConnectionStatus.Type;
