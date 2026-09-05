import { TaskAttachment, TaskComment, type TaskStatusCategory } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import type { ProviderTaskSnapshot, TaskProviderAdapter } from "./types.ts";
import { taskProviderError } from "./types.ts";

export const CLICKUP_TOKEN_SECRET = "clickup-api-token";
const CLICKUP_PROVIDER_ID = "clickup";

export interface ClickUpSyncConfig {
  readonly workspaceId: string;
  readonly workspaceName?: string;
  readonly listIds: ReadonlyArray<string>;
}

const ClickUpSyncConfigSchema = Schema.Struct({
  workspaceId: Schema.String,
  workspaceName: Schema.optional(Schema.String),
  listIds: Schema.optional(Schema.Array(Schema.String)),
});

const ClickUpSyncConfigFromJsonString = Schema.fromJsonString(ClickUpSyncConfigSchema);

const decodeClickUpSyncConfigJson = Schema.decodeUnknownSync(ClickUpSyncConfigFromJsonString);

/** Config JSON is stored opaquely; the adapter is the only one who parses it. */
export function parseClickUpSyncConfig(configJson: string | null): ClickUpSyncConfig | null {
  if (!configJson) return null;
  try {
    const decoded = decodeClickUpSyncConfigJson(configJson);
    return {
      workspaceId: decoded.workspaceId,
      ...(decoded.workspaceName === undefined ? {} : { workspaceName: decoded.workspaceName }),
      listIds: decoded.listIds ?? [],
    };
  } catch {
    return null;
  }
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
  // Get Task returns attachments when present; the task list endpoint omits
  // them, which is why the detail view fetches them per task.
  readonly attachments?: ReadonlyArray<ClickUpAttachmentResponse>;
}

interface ClickUpTaskListResponse {
  readonly tasks?: ReadonlyArray<ClickUpTaskResponse>;
  readonly last_page?: boolean;
}

interface ClickUpAttachmentResponse {
  readonly id?: string | number | null;
  readonly title?: string | null;
  readonly extension?: string | null;
  readonly size?: number | string | null;
  readonly url?: string | null;
  readonly thumbnail_small?: string | null;
  readonly thumbnail_large?: string | null;
  readonly date?: string | number | null;
}

interface ClickUpCommentUserResponse {
  readonly id?: string | number | null;
  readonly username?: string | null;
  readonly color?: string | null;
  readonly profilePicture?: string | null;
}

interface ClickUpCommentResponse {
  readonly id?: string | number | null;
  readonly parent?: string | number | null;
  readonly reply_count?: string | number | null;
  readonly text_content?: string | null;
  readonly comment_text?: string | null;
  readonly resolved?: boolean | null;
  readonly date?: string | number | null;
  readonly user?: ClickUpCommentUserResponse | null;
}

interface ClickUpCommentsResponse {
  readonly comments?: ReadonlyArray<ClickUpCommentResponse>;
  readonly has_more?: boolean;
  readonly last_page?: boolean;
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

const decodeAttachment = Schema.decodeSync(TaskAttachment);
const decodeComment = Schema.decodeSync(TaskComment);

/**
 * Normalize ClickUp's attachment payload for the detail view. Entries without
 * an id or download URL are dropped; a missing title falls back to the URL's
 * file name so files always render something meaningful.
 */
export function mapClickUpAttachments(
  attachments: ReadonlyArray<ClickUpAttachmentResponse>,
): Array<TaskAttachment> {
  const mapped: Array<TaskAttachment> = [];
  for (const attachment of attachments) {
    const id = attachment.id == null ? "" : String(attachment.id).trim();
    const url = attachment.url?.trim() ?? "";
    if (id.length === 0 || url.length === 0) continue;
    const size = attachment.size == null ? null : Number(attachment.size);
    mapped.push(
      decodeAttachment({
        id,
        title: attachment.title?.trim() || url.split("/").pop()?.trim() || "Attachment",
        extension: attachment.extension?.trim() || null,
        size: size !== null && Number.isFinite(size) ? size : null,
        url,
        thumbnailUrl:
          attachment.thumbnail_large?.trim() || attachment.thumbnail_small?.trim() || null,
        createdAt: parseClickUpTimestamp(attachment.date),
      }),
    );
  }
  return mapped;
}

/**
 * Normalize ClickUp's comment payload for the detail view. Comments without an
 * id or body are dropped; the plain-text body wins over the markup variant so
 * tags never render raw. Replies keep their parent's comment id for threading.
 */
export function mapClickUpComments(
  comments: ReadonlyArray<ClickUpCommentResponse>,
): Array<TaskComment> {
  const mapped: Array<TaskComment> = [];
  for (const comment of comments) {
    const id = comment.id == null ? "" : String(comment.id).trim();
    const body = comment.text_content?.trim() || comment.comment_text?.trim() || "";
    if (id.length === 0 || body.length === 0) continue;
    const parent = comment.parent == null ? "" : String(comment.parent).trim();
    mapped.push(
      decodeComment({
        id,
        parentId: parent.length === 0 || parent === "0" ? null : parent,
        body,
        authorName: comment.user?.username?.trim() || "ClickUp user",
        authorAvatarUrl: comment.user?.profilePicture?.trim() || null,
        authorColor: normalizeStatusColor(comment.user?.color),
        createdAt: parseClickUpTimestamp(comment.date),
        resolved: comment.resolved === true,
      }),
    );
  }
  // ClickUp serves comments oldest-first already; keep that stable even when a
  // page boundary or clock skew shuffles the order.
  return mapped.toSorted((left, right) =>
    (left.createdAt ?? "9999").localeCompare(right.createdAt ?? "9999"),
  );
}

/** Map a raw ClickUp task payload onto the provider-neutral snapshot. */
export function mapClickUpTaskSnapshot(task: ClickUpTaskResponse): ProviderTaskSnapshot | null {
  const externalTaskId = task.id == null ? null : String(task.id).trim();
  const title = task.name?.trim() ?? "";
  if (!externalTaskId || title.length === 0) return null;
  const listRef = clickUpListRef(task);
  const folderRef = clickUpFolderRef(task);
  return {
    externalTaskId,
    externalCustomId: task.custom_id?.trim() || null,
    title,
    description: pickClickUpDescription(task),
    statusLabel: task.status?.status?.trim() || "Open",
    statusCategory: taskStatusCategory({
      statusType: task.status?.type ?? null,
      statusLabel: task.status?.status ?? null,
    }),
    statusColor: normalizeStatusColor(task.status?.color),
    externalUrl: task.url?.trim() ?? null,
    externalListId: listRef.externalListId,
    externalListName: listRef.externalListName,
    externalFolderId: folderRef.externalFolderId,
    externalFolderName: folderRef.externalFolderName,
    assignees: clickUpAssignees(task),
    externalCreatedAt: parseClickUpTimestamp(task.date_created),
    externalUpdatedAt: parseClickUpTimestamp(task.date_updated),
  };
}

// ClickUp pages at 100 tasks; the hard cap bounds a single sync so a huge
// workspace cannot stall it indefinitely. 50 pages = 5000 tasks.
const TASK_SYNC_MAX_PAGES = 50;

// Comment threads are far smaller than task lists, but the cap still bounds
// a runaway pagination chain to the same end.
const TASK_COMMENTS_MAX_PAGES = 10;

// Get Task Comments serves 25 comments per page with no has_more flag.
const CLICKUP_COMMENTS_PAGE_SIZE = 25;

/** Plain function keeps serialization outside Effect generators (schema-aware lint). */
function serializeClickUpSyncConfig(config: ClickUpSyncConfig): string {
  return JSON.stringify(config);
}

export function makeClickUpAdapter(httpClient: HttpClient.HttpClient): TaskProviderAdapter {
  const cachedAccountLabel = (configJson: string | null): string | null => {
    const workspaceName = parseClickUpSyncConfig(configJson)?.workspaceName?.trim() ?? "";
    return workspaceName.length > 0 ? workspaceName : null;
  };

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
          taskProviderError(CLICKUP_PROVIDER_ID, "fetch", `Request failed for ${input.url}`, cause),
        ),
        Effect.flatMap(
          HttpClientResponse.matchStatus({
            "2xx": (response) =>
              response.json.pipe(
                Effect.map((body) => body as T),
                Effect.mapError((cause) =>
                  taskProviderError(
                    CLICKUP_PROVIDER_ID,
                    "fetch",
                    "ClickUp returned invalid JSON",
                    cause,
                  ),
                ),
              ),
            orElse: (response) =>
              response.text.pipe(
                Effect.mapError((cause) =>
                  taskProviderError(
                    CLICKUP_PROVIDER_ID,
                    "fetch",
                    "Failed to read ClickUp error response",
                    cause,
                  ),
                ),
                Effect.flatMap((body) =>
                  taskProviderError(
                    CLICKUP_PROVIDER_ID,
                    "fetch",
                    response.status === 401
                      ? "ClickUp rejected this token (401). Save a personal API token (pk_…), without a Bearer prefix."
                      : `Request failed (${response.status}): ${body || "unexpected response"}`,
                  ),
                ),
              ),
          }),
        ),
      );

  const fetchWorkspaces = (token: string) =>
    Effect.gen(function* () {
      const payload = yield* fetchJson<ClickUpWorkspaceResponse>({
        url: "https://api.clickup.com/api/v2/team",
        token,
      });
      return (
        payload.teams?.flatMap((workspace) => {
          const id = workspace.id == null ? null : String(workspace.id).trim();
          const name = workspace.name?.trim() ?? "";
          return id && name ? [{ id, name }] : [];
        }) ?? []
      );
    });

  const fetchTasks = (input: { readonly token: string; readonly config: ClickUpSyncConfig }) =>
    Effect.gen(function* () {
      const tasks: ClickUpTaskResponse[] = [];
      for (let page = 0; page < TASK_SYNC_MAX_PAGES; page += 1) {
        const url = new URL(
          `https://api.clickup.com/api/v2/team/${encodeURIComponent(input.config.workspaceId)}/task`,
        );
        url.searchParams.set("page", String(page));
        url.searchParams.set("include_closed", "true");
        url.searchParams.set("subtasks", "true");
        url.searchParams.set("include_markdown_description", "true");
        for (const listId of input.config.listIds) {
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

  /**
   * ClickUp keeps thread replies off the task comment list: a threaded comment
   * carries a reply_count and serves its replies from a per-comment endpoint.
   * Fetch those and tag them with the parent comment id so the detail view can
   * group threads. Pages follow `start` + `start_id`, both required together.
   * Reply fetches run after all pages with bounded concurrency — each is a
   * full ClickUp round trip, and ClickUp latency spikes make sequential
   * fetching exceed the client's request timeout.
   */
  const fetchComments = (input: { readonly externalTaskId: string; readonly token: string }) =>
    Effect.gen(function* () {
      const topLevel: ClickUpCommentResponse[] = [];
      let startId: string | null = null;
      let start: string | null = null;
      for (let page = 0; page < TASK_COMMENTS_MAX_PAGES; page += 1) {
        const url = new URL(
          `https://api.clickup.com/api/v2/task/${encodeURIComponent(input.externalTaskId)}/comment`,
        );
        if (startId && start) {
          url.searchParams.set("start_id", startId);
          url.searchParams.set("start", start);
        }
        const payload = yield* fetchJson<ClickUpCommentsResponse>({
          url: url.toString(),
          token: input.token,
        });
        const pageComments = [...(payload.comments ?? [])];
        topLevel.push(...pageComments);
        const last = pageComments[pageComments.length - 1];
        const lastId = last?.id == null ? null : String(last.id).trim();
        const lastDate = last?.date == null ? null : String(last.date).trim();
        const canPage = lastId !== null && lastDate !== null && lastId !== startId;
        const more = payload.has_more === true || pageComments.length >= CLICKUP_COMMENTS_PAGE_SIZE;
        if (!more || !canPage) {
          break;
        }
        startId = lastId;
        start = lastDate;
      }

      const comments = [...topLevel];
      const threadedIds = topLevel
        .filter((comment) => Number(comment.reply_count ?? 0) > 0)
        .map((comment) => String(comment.id));
      const replyPages = yield* Effect.forEach(
        threadedIds,
        (parentId) =>
          fetchJson<ClickUpCommentsResponse>({
            url: `https://api.clickup.com/api/v2/comment/${encodeURIComponent(parentId)}/reply`,
            token: input.token,
          }).pipe(Effect.map((payload) => payload.comments ?? [])),
        { concurrency: 4 },
      );
      threadedIds.forEach((parentId, index) => {
        for (const reply of replyPages[index] ?? []) {
          // Replies carry no parent; the thread parent is the fetch source.
          comments.push({ ...reply, parent: parentId });
        }
      });
      return comments;
    });

  return {
    id: CLICKUP_PROVIDER_ID,
    label: "ClickUp",
    credentialSecretKey: CLICKUP_TOKEN_SECRET,
    normalizeCredential: normalizeClickUpToken,
    bootstrapConfig: (credential) =>
      Effect.gen(function* () {
        // Whole-workspace default: an environment that never configured
        // ClickUp syncs every task of the token's first workspace.
        const workspaces = yield* fetchWorkspaces(credential).pipe(
          Effect.mapError((cause) =>
            taskProviderError(
              CLICKUP_PROVIDER_ID,
              "bootstrapConfig",
              "Failed to list ClickUp workspaces",
              cause,
            ),
          ),
        );
        const workspace = workspaces[0];
        if (!workspace) {
          return yield* taskProviderError(
            CLICKUP_PROVIDER_ID,
            "bootstrapConfig",
            "No ClickUp workspaces are available for this token.",
          );
        }
        const config: ClickUpSyncConfig = {
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          listIds: [],
        };
        return serializeClickUpSyncConfig(config);
      }),
    accountLabel: ({ credential, configJson }) =>
      Effect.gen(function* () {
        const cached = cachedAccountLabel(configJson);
        if (cached || !credential) return cached;
        // Before the first sync persists a workspace, name the account from
        // the token's workspaces. Best effort: status still renders without it.
        const workspaces = yield* fetchWorkspaces(credential).pipe(Effect.orElseSucceed(() => []));
        return workspaces[0]?.name ?? null;
      }),
    cachedAccountLabel: cachedAccountLabel,
    fetchSyncTasks: ({ credential, configJson }) =>
      Effect.gen(function* () {
        const config = parseClickUpSyncConfig(configJson);
        if (!config) {
          return yield* taskProviderError(
            CLICKUP_PROVIDER_ID,
            "fetchSyncTasks",
            "ClickUp sync has no stored workspace config.",
          );
        }
        const rawTasks = yield* fetchTasks({ token: credential, config });
        return rawTasks
          .map(mapClickUpTaskSnapshot)
          .filter((task): task is ProviderTaskSnapshot => task !== null);
      }),
    fetchTaskAttachments: ({ credential, externalTaskId }) =>
      Effect.gen(function* () {
        // ClickUp has no "list attachments" route; Get Task returns them when
        // present, so the detail view fetches the task itself.
        const payload = yield* fetchJson<ClickUpTaskResponse>({
          url: `https://api.clickup.com/api/v2/task/${encodeURIComponent(externalTaskId)}`,
          token: credential,
        });
        return mapClickUpAttachments(payload.attachments ?? []);
      }),
    fetchTaskComments: ({ credential, externalTaskId }) =>
      Effect.gen(function* () {
        const comments = yield* fetchComments({ externalTaskId, token: credential });
        return mapClickUpComments(comments);
      }),
  };
}
