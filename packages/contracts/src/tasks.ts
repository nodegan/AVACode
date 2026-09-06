import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { IsoDateTime, ThreadId, TrimmedNonEmptyString, TrimmedString } from "./baseSchemas.ts";

export const TaskId = TrimmedNonEmptyString.pipe(Schema.brand("TaskId"));
export type TaskId = typeof TaskId.Type;

export const TaskNoteId = TrimmedNonEmptyString.pipe(Schema.brand("TaskNoteId"));
export type TaskNoteId = typeof TaskNoteId.Type;

/**
 * Where a task row comes from: `"manual"` for locally created tasks, or a
 * task provider id (`"clickup"`, later `"linear"`, …) for synced copies.
 */
export const TaskProviderId = TrimmedNonEmptyString;
export type TaskProviderId = typeof TaskProviderId.Type;

export const MANUAL_TASK_PROVIDER = "manual";

export const TaskStatusCategory = Schema.Literals([
  "open",
  "in_progress",
  "done",
  "blocked",
  "unknown",
]);
export type TaskStatusCategory = typeof TaskStatusCategory.Type;

export const TaskStatusId = TrimmedNonEmptyString.pipe(Schema.brand("TaskStatusId"));
export type TaskStatusId = typeof TaskStatusId.Type;

/**
 * A user-managed task status from the settings registry. Manual tasks attach
 * to one of these by id and copy its label/category/color for display;
 * provider-synced tasks keep their provider's own status fields.
 */
export const TaskStatus = Schema.Struct({
  id: TaskStatusId,
  label: TrimmedNonEmptyString,
  category: TaskStatusCategory,
  color: Schema.NullOr(TrimmedString).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  /** Registry display order; lower sorts first. */
  sortOrder: Schema.Number,
  /** How many tasks currently use the status. */
  taskCount: Schema.Number,
});
export type TaskStatus = typeof TaskStatus.Type;

export const TaskStatusesResult = Schema.Struct({
  statuses: Schema.Array(TaskStatus).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type TaskStatusesResult = typeof TaskStatusesResult.Type;

/** A task provider registered on the server (`"clickup"` today, Linear next). */
export const TaskProviderInfo = Schema.Struct({
  id: TaskProviderId,
  label: TrimmedNonEmptyString,
});
export type TaskProviderInfo = typeof TaskProviderInfo.Type;

/** A locally stored note on a task, as opposed to the provider's own comments. */
export const TaskNote = Schema.Struct({
  id: TaskNoteId,
  taskId: TaskId,
  body: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type TaskNote = typeof TaskNote.Type;

export const TaskAttachment = Schema.Struct({
  id: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  extension: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  size: Schema.NullOr(Schema.Number).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  url: TrimmedNonEmptyString,
  thumbnailUrl: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  createdAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
});
export type TaskAttachment = typeof TaskAttachment.Type;

export const TaskAttachmentsResult = Schema.Struct({
  attachments: Schema.Array(TaskAttachment).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type TaskAttachmentsResult = typeof TaskAttachmentsResult.Type;

/** A comment left on the task at the provider, fetched read-only for the detail view. */
export const TaskComment = Schema.Struct({
  id: TrimmedNonEmptyString,
  /** Provider comment id this comment replies to; null for top-level comments. */
  parentId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  body: TrimmedNonEmptyString,
  authorName: TrimmedNonEmptyString,
  authorAvatarUrl: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  authorColor: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  createdAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  resolved: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type TaskComment = typeof TaskComment.Type;

export const TaskCommentsResult = Schema.Struct({
  comments: Schema.Array(TaskComment).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type TaskCommentsResult = typeof TaskCommentsResult.Type;

/**
 * A folder is the top grouping level (ClickUp workspace folders; local
 * folders later). Provider-backed folders carry the provider's external id;
 * local ones have none.
 */
export const TaskFolder = Schema.Struct({
  id: TrimmedNonEmptyString,
  provider: TaskProviderId,
  externalFolderId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  name: TrimmedNonEmptyString,
});
export type TaskFolder = typeof TaskFolder.Type;

/**
 * A list groups tasks and sits in a folder (or nowhere). Both manual and
 * provider-backed lists live in the same registry; synced tasks resolve to
 * their list by (provider, external id).
 */
export const TaskList = Schema.Struct({
  id: TrimmedNonEmptyString,
  provider: TaskProviderId,
  externalListId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  folderId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  name: TrimmedNonEmptyString,
});
export type TaskList = typeof TaskList.Type;

export const Task = Schema.Struct({
  id: TaskId,
  provider: TaskProviderId,
  title: TrimmedNonEmptyString,
  description: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  statusLabel: TrimmedNonEmptyString,
  statusCategory: TaskStatusCategory,
  statusColor: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  /** The registry status this task attaches to; null for provider-synced tasks. */
  statusId: Schema.NullOr(TaskStatusId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  linkedThreadId: Schema.NullOr(ThreadId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  /** Local branch names the user linked to this task; advisory, name-matched per repo. */
  linkedBranches: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  /** The list this task sits in; local ids because lists are first-class. */
  listId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  /** The list's name, resolved from the registry for display and context blocks. */
  listName: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  externalTaskId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  /** The provider's human-facing custom ID (e.g. `PR-1685`), when it uses them. */
  externalCustomId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  externalUrl: Schema.NullOr(TrimmedNonEmptyString).pipe(
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
  notes: Schema.Array(TaskNote).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type Task = typeof Task.Type;

/** A folder row in the browse tree, with the task count across its lists. */
export const TaskFolderFacet = Schema.Struct({
  id: TrimmedNonEmptyString,
  provider: TaskProviderId,
  name: TrimmedNonEmptyString,
  count: Schema.Number,
});
export type TaskFolderFacet = typeof TaskFolderFacet.Type;

export const TaskListFacet = Schema.Struct({
  id: TrimmedNonEmptyString,
  provider: TaskProviderId,
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
  provider: TaskProviderId,
});
export type TaskLinkSummary = typeof TaskLinkSummary.Type;

export const TaskLinksResult = Schema.Struct({
  links: Schema.Array(TaskLinkSummary).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type TaskLinksResult = typeof TaskLinksResult.Type;

export const TaskFacets = Schema.Struct({
  folders: Schema.Array(TaskFolderFacet).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  lists: Schema.Array(TaskListFacet).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  statuses: Schema.Array(TaskValueFacet).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  assignees: Schema.Array(TaskValueFacet).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type TaskFacets = typeof TaskFacets.Type;

/** Per-provider connection + sync state shown on the panel. */
export const TaskProviderState = Schema.Struct({
  providerId: TaskProviderId,
  label: TrimmedNonEmptyString,
  credentialConfigured: Schema.Boolean,
  /** Account-level label (ClickUp workspace name); null until known. */
  accountLabel: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  lastSyncAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  lastSyncError: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
});
export type TaskProviderState = typeof TaskProviderState.Type;

export const TaskPanel = Schema.Struct({
  providers: Schema.Array(TaskProviderState).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  facets: TaskFacets,
});
export type TaskPanel = typeof TaskPanel.Type;

export const TaskQueryFilter = Schema.Struct({
  // List and folder ids are local registry ids (task_lists / task_folders).
  listIds: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  folderIds: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  taskIds: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  statuses: Schema.optional(Schema.Array(TaskStatusCategory)),
  assignees: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  linkedThreadId: Schema.optional(ThreadId),
  /** Tasks carrying this branch name in their linked-branch set. */
  linkedBranchName: Schema.optional(TrimmedNonEmptyString),
  /** Free-text search over title and provider ids (ClickUp custom id, external id). */
  query: Schema.optional(TrimmedString),
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
  listId: Schema.optional(TrimmedNonEmptyString),
  /** A status from the settings registry; defaults to the first status. */
  statusId: Schema.optional(TaskStatusId),
});
export type CreateManualTaskInput = typeof CreateManualTaskInput.Type;

export const CreateTaskStatusInput = Schema.Struct({
  label: TrimmedNonEmptyString,
  category: TaskStatusCategory,
  color: Schema.optional(TrimmedNonEmptyString),
});
export type CreateTaskStatusInput = typeof CreateTaskStatusInput.Type;

export const UpdateTaskStatusInput = Schema.Struct({
  statusId: TaskStatusId,
  label: Schema.optional(TrimmedNonEmptyString),
  category: Schema.optional(TaskStatusCategory),
  /** Null clears the status color; omit to leave it unchanged. */
  color: Schema.optional(Schema.NullOr(TrimmedString)),
});
export type UpdateTaskStatusInput = typeof UpdateTaskStatusInput.Type;

export const DeleteTaskStatusInput = Schema.Struct({
  statusId: TaskStatusId,
  /**
   * Where attached tasks go. Required when tasks still use the status: the
   * caller picks a surviving status instead of the server guessing.
   */
  reassignToStatusId: Schema.optional(TaskStatusId),
});
export type DeleteTaskStatusInput = typeof DeleteTaskStatusInput.Type;

export const CreateTaskListInput = Schema.Struct({
  name: TrimmedNonEmptyString,
  /** Manual lists can nest under a manual folder; omit for a top-level list. */
  folderId: Schema.optional(TrimmedNonEmptyString),
});
export type CreateTaskListInput = typeof CreateTaskListInput.Type;

export const CreateTaskFolderInput = Schema.Struct({
  name: TrimmedNonEmptyString,
});
export type CreateTaskFolderInput = typeof CreateTaskFolderInput.Type;

export const UpdateTaskInput = Schema.Struct({
  taskId: TaskId,
  title: Schema.optional(TrimmedNonEmptyString),
  description: Schema.optional(TrimmedString),
  /** A status from the settings registry; edits the attached task's status. */
  statusId: Schema.optional(TaskStatusId),
  linkedThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  /** Replaces the linked-branch set; an empty array unlinks everything. */
  linkedBranches: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
});
export type UpdateTaskInput = typeof UpdateTaskInput.Type;

export const DeleteTaskInput = Schema.Struct({
  taskId: TaskId,
});
export type DeleteTaskInput = typeof DeleteTaskInput.Type;

export const DeleteTaskListInput = Schema.Struct({
  listId: TrimmedNonEmptyString,
});
export type DeleteTaskListInput = typeof DeleteTaskListInput.Type;

export const DeleteTaskFolderInput = Schema.Struct({
  folderId: TrimmedNonEmptyString,
});
export type DeleteTaskFolderInput = typeof DeleteTaskFolderInput.Type;

export const AddTaskNoteInput = Schema.Struct({
  taskId: TaskId,
  body: TrimmedNonEmptyString,
});
export type AddTaskNoteInput = typeof AddTaskNoteInput.Type;

export const ProviderIdParams = Schema.Struct({
  providerId: TaskProviderId,
});
export type ProviderIdParams = typeof ProviderIdParams.Type;

export const SetProviderCredentialInput = Schema.Struct({
  token: TrimmedNonEmptyString,
});
export type SetProviderCredentialInput = typeof SetProviderCredentialInput.Type;

export const TaskProviderConnectionStatus = Schema.Struct({
  credentialConfigured: Schema.Boolean,
  /** Account the sync is bound to, or the credential's account before the first sync. */
  accountLabel: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  lastSyncAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  lastSyncError: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
});
export type TaskProviderConnectionStatus = typeof TaskProviderConnectionStatus.Type;
