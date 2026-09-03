import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "./baseSchemas.ts";

export const ProjectTaskId = TrimmedNonEmptyString.pipe(Schema.brand("ProjectTaskId"));
export type ProjectTaskId = typeof ProjectTaskId.Type;

export const ProjectTaskCommentId = TrimmedNonEmptyString.pipe(
  Schema.brand("ProjectTaskCommentId"),
);
export type ProjectTaskCommentId = typeof ProjectTaskCommentId.Type;

export const ProjectTaskSource = Schema.Literals(["manual", "clickup"]);
export type ProjectTaskSource = typeof ProjectTaskSource.Type;

export const ProjectTaskStatusCategory = Schema.Literals([
  "open",
  "in_progress",
  "done",
  "blocked",
  "unknown",
]);
export type ProjectTaskStatusCategory = typeof ProjectTaskStatusCategory.Type;

export const ClickUpWorkspaceSummary = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
});
export type ClickUpWorkspaceSummary = typeof ClickUpWorkspaceSummary.Type;

export const ProjectTaskComment = Schema.Struct({
  id: ProjectTaskCommentId,
  taskId: ProjectTaskId,
  body: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProjectTaskComment = typeof ProjectTaskComment.Type;

export const ProjectTask = Schema.Struct({
  id: ProjectTaskId,
  projectId: ProjectId,
  source: ProjectTaskSource,
  title: TrimmedNonEmptyString,
  description: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  statusLabel: TrimmedNonEmptyString,
  statusCategory: ProjectTaskStatusCategory,
  linkedThreadId: Schema.NullOr(ThreadId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  externalTaskId: Schema.NullOr(TrimmedNonEmptyString).pipe(
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
  comments: Schema.Array(ProjectTaskComment).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type ProjectTask = typeof ProjectTask.Type;

export const ProjectTaskSyncConfig = Schema.Struct({
  workspaceId: TrimmedNonEmptyString,
  workspaceName: Schema.optional(TrimmedNonEmptyString),
  listIds: Schema.Array(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type ProjectTaskSyncConfig = typeof ProjectTaskSyncConfig.Type;

export const ProjectTaskClickUpState = Schema.Struct({
  tokenConfigured: Schema.Boolean,
  availableWorkspaces: Schema.Array(ClickUpWorkspaceSummary).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  syncConfig: Schema.NullOr(ProjectTaskSyncConfig).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  lastSyncAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  lastSyncError: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
});
export type ProjectTaskClickUpState = typeof ProjectTaskClickUpState.Type;

export const ProjectTaskListFacet = Schema.Struct({
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
export type ProjectTaskListFacet = typeof ProjectTaskListFacet.Type;

export const ProjectTaskValueFacet = Schema.Struct({
  value: TrimmedNonEmptyString,
  count: Schema.Number,
});
export type ProjectTaskValueFacet = typeof ProjectTaskValueFacet.Type;

export const ProjectTaskFacets = Schema.Struct({
  lists: Schema.Array(ProjectTaskListFacet).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  statuses: Schema.Array(ProjectTaskValueFacet).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  assignees: Schema.Array(ProjectTaskValueFacet).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type ProjectTaskFacets = typeof ProjectTaskFacets.Type;

export const ProjectTaskPanel = Schema.Struct({
  projectId: ProjectId,
  clickup: ProjectTaskClickUpState,
  facets: ProjectTaskFacets,
});
export type ProjectTaskPanel = typeof ProjectTaskPanel.Type;

export const ProjectTaskQueryFilter = Schema.Struct({
  listIds: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  folderIds: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  statuses: Schema.optional(Schema.Array(ProjectTaskStatusCategory)),
  assignees: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  page: Schema.optional(Schema.Number),
  pageSize: Schema.optional(Schema.Number),
});
export type ProjectTaskQueryFilter = typeof ProjectTaskQueryFilter.Type;

export const QueryProjectTasksInput = Schema.Struct({
  projectId: ProjectId,
  filter: Schema.optional(ProjectTaskQueryFilter),
});
export type QueryProjectTasksInput = typeof QueryProjectTasksInput.Type;

export const ProjectTaskQueryResult = Schema.Struct({
  tasks: Schema.Array(ProjectTask),
  total: Schema.Number,
  page: Schema.Number,
  pageSize: Schema.Number,
});
export type ProjectTaskQueryResult = typeof ProjectTaskQueryResult.Type;

export const GetProjectTaskPanelInput = Schema.Struct({
  projectId: ProjectId,
});
export type GetProjectTaskPanelInput = typeof GetProjectTaskPanelInput.Type;

export const CreateManualProjectTaskInput = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedString),
});
export type CreateManualProjectTaskInput = typeof CreateManualProjectTaskInput.Type;

export const UpdateProjectTaskInput = Schema.Struct({
  taskId: ProjectTaskId,
  title: Schema.optional(TrimmedNonEmptyString),
  description: Schema.optional(TrimmedString),
  statusLabel: Schema.optional(TrimmedNonEmptyString),
  statusCategory: Schema.optional(ProjectTaskStatusCategory),
  linkedThreadId: Schema.optional(Schema.NullOr(ThreadId)),
});
export type UpdateProjectTaskInput = typeof UpdateProjectTaskInput.Type;

export const DeleteProjectTaskInput = Schema.Struct({
  taskId: ProjectTaskId,
});
export type DeleteProjectTaskInput = typeof DeleteProjectTaskInput.Type;

export const AddProjectTaskCommentInput = Schema.Struct({
  taskId: ProjectTaskId,
  body: TrimmedNonEmptyString,
});
export type AddProjectTaskCommentInput = typeof AddProjectTaskCommentInput.Type;

export const SetProjectTaskClickUpTokenInput = Schema.Struct({
  token: TrimmedNonEmptyString,
});
export type SetProjectTaskClickUpTokenInput = typeof SetProjectTaskClickUpTokenInput.Type;

export const ClickUpConnectionStatus = Schema.Struct({
  tokenConfigured: Schema.Boolean,
});
export type ClickUpConnectionStatus = typeof ClickUpConnectionStatus.Type;

export const SyncProjectClickUpTasksInput = Schema.Struct({
  projectId: ProjectId,
});
export type SyncProjectClickUpTasksInput = typeof SyncProjectClickUpTasksInput.Type;
