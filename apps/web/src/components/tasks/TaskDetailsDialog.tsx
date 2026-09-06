import type {
  EnvironmentId,
  Task,
  TaskAttachment,
  TaskComment,
  TaskStatusCategory,
  ThreadId,
} from "@t3tools/contracts";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  ArrowUpRightIcon,
  CalendarIcon,
  CheckIcon,
  ChevronRightIcon,
  CloudIcon,
  CopyIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  HashIcon,
  HistoryIcon,
  GitBranchIcon,
  Link2Icon,
  ListIcon,
  ListTodoIcon,
  Loader2Icon,
  MessageSquarePlusIcon,
  PanelRightIcon,
  PaperclipIcon,
  PencilIcon,
  PlusIcon,
  SquareCheckBigIcon,
  Trash2Icon,
  UnlinkIcon,
  UserIcon,
  XIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { memo, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useComposerHandleContext } from "~/composerHandleContext";
import { buildTaskBranchName } from "~/lib/taskContext";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { useProject, useThread, useThreadShell } from "~/state/entities";
import { vcsEnvironment } from "~/state/vcs";
import { usePreparedConnection } from "~/state/session";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";

import { ExpandedImageDialog } from "../chat/ExpandedImageDialog";
import type { ExpandedImagePreview } from "../chat/ExpandedImagePreview";
import { fetchTaskAttachments, fetchTaskComments, setTaskLinkedBranches } from "./taskApi";
export function statusTone(status: TaskStatusCategory): string {
  switch (status) {
    case "done":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "in_progress":
      return "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300";
    case "blocked":
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "open":
      return "border-zinc-500/20 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

export function formatTaskStatusLabel(task: Task): string {
  // Manual status labels come from the user's own registry, so show them as
  // picked; provider labels are normalized to the category's plain word.
  if (task.provider === "manual") return task.statusLabel;
  switch (task.statusCategory) {
    case "done":
      return "Done";
    case "in_progress":
      return "In progress";
    case "blocked":
      return "Blocked";
    case "open":
      return "Open";
    default:
      return task.statusLabel;
  }
}

/**
 * Copyable id cell for the details grid, carrying the provider's human-facing
 * task id (e.g. `PR-1685`).
 */
function TaskIdFieldValue(props: { taskId: string }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard<{ taskId: string }>({
    target: "task ID",
    onCopy: ({ taskId }) => {
      toastManager.add({ type: "success", title: "Task ID copied", description: taskId });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Failed to copy task ID",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    },
  });
  return (
    <span className="flex items-center gap-1">
      <span className="truncate font-mono text-sm">{props.taskId}</span>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={isCopied ? "Task ID copied" : `Copy task ID ${props.taskId}`}
              onClick={() => copyToClipboard(props.taskId, { taskId: props.taskId })}
              className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {isCopied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
            </button>
          }
        />
        <TooltipPopup side="bottom">{isCopied ? "Copied" : "Copy task ID"}</TooltipPopup>
      </Tooltip>
    </span>
  );
}

export function TaskStatusBadge({ task }: { task: Task }) {
  // Custom ClickUp statuses carry the color the user picked in ClickUp; tint
  // the badge with it directly and fall back to the category palette when the
  // sync has no color for the status.
  const statusColor = task.statusColor;
  if (statusColor) {
    return (
      <span
        className="rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase"
        style={{
          borderColor: `color-mix(in srgb, ${statusColor} 35%, transparent)`,
          backgroundColor: `color-mix(in srgb, ${statusColor} 12%, transparent)`,
          color: `color-mix(in srgb, ${statusColor} 80%, white)`,
        }}
      >
        {formatTaskStatusLabel(task)}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase",
        statusTone(task.statusCategory),
      )}
    >
      {formatTaskStatusLabel(task)}
    </span>
  );
}

function extractImageUrls(description: string): string[] {
  if (!description) return [];
  const urls = new Set<string>();
  // Markdown images render inline in the description; only collect bare image
  // URLs so the grid does not duplicate them.
  const markdownImage = /!\[[^\]]*\]\((\S+?)(?:\s+"[^"]*")?\)/g;
  const markdownImageUrls = new Set<string>();
  for (const match of description.matchAll(markdownImage)) {
    const url = match[1];
    if (url) markdownImageUrls.add(url);
  }
  const bareImage = /\bhttps?:\/\/\S+?\.(?:png|jpe?g|gif|webp|avif|svg)(?:\?\S*)?(?=[\s)]|$)/gi;
  for (const match of description.matchAll(bareImage)) {
    const url = match[0];
    if (url && !markdownImageUrls.has(url)) urls.add(url);
  }
  return [...urls];
}

const ATTACHMENT_IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "svg",
  "bmp",
  "heic",
]);

function isImageAttachment(attachment: TaskAttachment): boolean {
  const extension = attachment.extension?.toLowerCase().replace(/^\./, "") ?? "";
  if (ATTACHMENT_IMAGE_EXTENSIONS.has(extension)) return true;
  const filename = attachment.url.split(/[?#]/)[0] ?? "";
  const match = /\.([a-z0-9]+)$/i.exec(filename);
  return match !== null && ATTACHMENT_IMAGE_EXTENSIONS.has(match[1]?.toLowerCase() ?? "");
}

function formatAttachmentSize(size: number | null): string | null {
  if (size === null || !Number.isFinite(size) || size <= 0) return null;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let unitIndex = 0;
  let value = size;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = unitIndex === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
}

type AttachmentsState =
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | { readonly status: "ready"; readonly attachments: ReadonlyArray<TaskAttachment> };

/**
 * Files added to the task at the provider, fetched on demand when the detail view
 * opens (sync skips them to avoid a request per task). Manual tasks render
 * nothing.
 */
function TaskAttachmentsSection(props: TaskDetailsBodyProps) {
  const { task } = props;
  const prepared = usePreparedConnection(props.environmentId ?? null);
  const isProviderTask = task.provider !== "manual" && task.externalTaskId !== null;
  const [state, setState] = useState<AttachmentsState>({ status: "loading" });
  const [expandedImage, setExpandedImage] = useState<ExpandedImagePreview | null>(null);

  useEffect(() => {
    if (!isProviderTask || prepared._tag === "None") return;
    let cancelled = false;
    setState({ status: "loading" });
    fetchTaskAttachments(prepared.value, task.id)
      .then((result) => {
        if (!cancelled) setState({ status: "ready", attachments: result.attachments });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [isProviderTask, prepared, task.id]);

  if (!isProviderTask || prepared._tag === "None") return null;

  const imageAttachments: TaskAttachment[] = [];
  const fileAttachments: TaskAttachment[] = [];
  if (state.status === "ready") {
    for (const attachment of state.attachments) {
      (isImageAttachment(attachment) ? imageAttachments : fileAttachments).push(attachment);
    }
  }

  return (
    <>
      <div className="space-y-1">
        <h5 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Attachments
        </h5>
        {state.status === "loading" ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : state.status === "error" ? (
          <p className="text-xs text-destructive">Failed to load attachments.</p>
        ) : state.attachments.length === 0 ? (
          <p className="text-xs text-muted-foreground">No attachments.</p>
        ) : (
          <div className="space-y-2">
            {imageAttachments.length > 0 ? (
              <div className="grid grid-cols-3 gap-2">
                {imageAttachments.map((attachment, index) => (
                  <button
                    key={attachment.id}
                    type="button"
                    title={attachment.title}
                    onClick={() =>
                      setExpandedImage({
                        images: imageAttachments.map((image) => ({
                          src: image.url,
                          name: image.title,
                        })),
                        index,
                      })
                    }
                    className="block cursor-zoom-in overflow-hidden rounded-lg border border-border/70"
                  >
                    <img
                      src={attachment.thumbnailUrl ?? attachment.url}
                      alt={attachment.title}
                      loading="lazy"
                      className="h-24 w-full object-cover transition-transform hover:scale-105"
                    />
                  </button>
                ))}
              </div>
            ) : null}
            {fileAttachments.length > 0 ? (
              <ul className="space-y-1">
                {fileAttachments.map((attachment) => {
                  const size = formatAttachmentSize(attachment.size);
                  return (
                    <li key={attachment.id}>
                      <a
                        href={attachment.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex min-w-0 items-center gap-2 rounded-lg border border-border/70 px-2 py-1.5 text-sm hover:bg-accent/40"
                      >
                        <PaperclipIcon className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 truncate">{attachment.title}</span>
                        {size ? (
                          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                            {size}
                          </span>
                        ) : null}
                      </a>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        )}
      </div>
      {expandedImage
        ? createPortal(
            <ExpandedImageDialog
              key={`${expandedImage.images[expandedImage.index]?.src ?? "image"}:${expandedImage.index}`}
              preview={expandedImage}
              onClose={() => setExpandedImage(null)}
            />,
            document.body,
          )
        : null}
    </>
  );
}

export interface TaskDetailsBodyProps {
  task: Task;
  /** Environment context lets the detail body fetch ClickUp attachments. */
  environmentId?: EnvironmentId | undefined;
  /** Repository root for branch linking; omit to hide the branch section. */
  gitCwd?: string | undefined;
  /** Fires after a link/unlink so the owning view can refresh its copy. */
  onTaskChanged?: ((task: Task) => void) | undefined;
}

interface ProviderCommentThread {
  readonly comment: TaskComment;
  readonly replies: Array<TaskComment>;
}

/**
 * Comment and note bodies render as chat-style markdown bubbles; real line
 * breaks are kept so pasted ClickUp text stays readable.
 */
function TaskMarkdownBubble({ body }: { body: string }) {
  return (
    <div className="chat-markdown mt-1 w-fit max-w-full rounded-2xl bg-message px-3 py-2 text-sm text-message-foreground">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{body}</ReactMarkdown>
    </div>
  );
}

/**
 * Groups the flat ClickUp comment list into top-level comments with nested
 * replies. ClickUp replies name their parent comment id; a reply whose parent
 * was dropped (e.g. an empty comment) still renders, as a top-level comment.
 */
function groupProviderCommentThreads(
  comments: ReadonlyArray<TaskComment>,
): Array<ProviderCommentThread> {
  const threadsById = new Map<string, ProviderCommentThread>();
  const threads: Array<ProviderCommentThread> = [];
  for (const comment of comments) {
    const parent = comment.parentId === null ? undefined : threadsById.get(comment.parentId);
    if (parent) {
      parent.replies.push(comment);
      continue;
    }
    const thread = { comment, replies: [] };
    threadsById.set(comment.id, thread);
    threads.push(thread);
  }
  return threads;
}

/** Round author avatar like ClickUp's; falls back to a colored initial. */
function ProviderCommentAvatar(props: {
  name: string;
  avatarUrl: string | null;
  color: string | null;
}) {
  if (props.avatarUrl) {
    return (
      <img
        src={props.avatarUrl}
        alt=""
        loading="lazy"
        className="size-6 shrink-0 rounded-full border border-border/70 object-cover"
      />
    );
  }
  const initial = props.name.trim().charAt(0).toUpperCase();
  return (
    <span
      className="flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
      style={props.color ? { backgroundColor: props.color } : undefined}
    >
      {initial || "?"}
    </span>
  );
}

function ProviderCommentRow({ comment }: { comment: TaskComment }) {
  return (
    <div className="flex min-w-0 gap-2">
      <ProviderCommentAvatar
        name={comment.authorName}
        avatarUrl={comment.authorAvatarUrl}
        color={comment.authorColor}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-xs font-medium">{comment.authorName}</span>
          {comment.createdAt ? (
            <span
              className="text-[11px] text-muted-foreground"
              title={new Date(comment.createdAt).toLocaleString()}
            >
              {new Date(comment.createdAt).toLocaleString()}
            </span>
          ) : null}
          {comment.resolved ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
              <CheckIcon className="size-3" />
              Resolved
            </span>
          ) : null}
        </div>
        <TaskMarkdownBubble body={comment.body} />
      </div>
    </div>
  );
}

function ProviderCommentThreadRow({ thread }: { thread: ProviderCommentThread }) {
  // Threads stay collapsed until asked for, like ClickUp's "N replies" toggle.
  const [expanded, setExpanded] = useState(false);
  const replyLabel = thread.replies.length === 1 ? "1 reply" : `${thread.replies.length} replies`;
  return (
    <div className="space-y-2">
      <ProviderCommentRow comment={thread.comment} />
      {thread.replies.length > 0 ? (
        <>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="-ml-1 h-6 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-muted/55"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            <ChevronRightIcon
              className={cn("size-3.5 transition-transform", expanded && "rotate-90")}
            />
            {expanded ? "Hide replies" : replyLabel}
          </Button>
          {expanded ? (
            // Replies nest under their parent behind a thread rail, like ClickUp.
            <div className="ml-4 space-y-2 border-l border-border/70 pl-3">
              {thread.replies.map((reply) => (
                <ProviderCommentRow key={reply.id} comment={reply} />
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

type ProviderCommentsState =
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | { readonly status: "ready"; readonly comments: ReadonlyArray<TaskComment> };

/**
 * Comments left on the task in ClickUp, fetched on demand when the detail view
 * opens (read-only for now; local comments live in the composer below).
 * Manual tasks render nothing.
 */
function TaskCommentsSection(props: TaskDetailsBodyProps) {
  const { task } = props;
  const prepared = usePreparedConnection(props.environmentId ?? null);
  const isProviderTask = task.provider !== "manual" && task.externalTaskId !== null;
  const [state, setState] = useState<ProviderCommentsState>({ status: "loading" });

  useEffect(() => {
    if (!isProviderTask || prepared._tag === "None") return;
    let cancelled = false;
    setState({ status: "loading" });
    fetchTaskComments(prepared.value, task.id)
      .then((result) => {
        if (!cancelled) setState({ status: "ready", comments: result.comments });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [isProviderTask, prepared, task.id]);

  const threads = useMemo(
    () => (state.status === "ready" ? groupProviderCommentThreads(state.comments) : []),
    [state],
  );

  if (!isProviderTask || prepared._tag === "None") return null;

  return (
    <div className="space-y-2">
      <h5 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Provider comments
      </h5>
      {state.status === "loading" ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : state.status === "error" ? (
        <p className="text-xs text-destructive">Failed to load Provider comments.</p>
      ) : threads.length === 0 ? (
        <p className="text-xs text-muted-foreground">No comments on ClickUp.</p>
      ) : (
        <div className="space-y-3">
          {threads.map((thread) => (
            <ProviderCommentThreadRow key={thread.comment.id} thread={thread} />
          ))}
        </div>
      )}
    </div>
  );
}

function formatTaskDate(timestamp: string): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Linked local branches for the task: name-matched against the project's
 * repository, rendered as removable chips with a searchable picker for
 * existing branches.
 */
const TaskBranchesSection = memo(function TaskBranchesSection(props: TaskDetailsBodyProps) {
  const { task } = props;
  const environmentId = props.environmentId ?? null;
  const gitCwd = props.gitCwd ?? null;
  const prepared = usePreparedConnection(environmentId);
  const [busy, setBusy] = useState(false);
  const [branchQuery, setBranchQuery] = useState("");
  const [branchName, setBranchName] = useState("");
  const [pickerMode, setPickerMode] = useState<"link" | "create" | null>(null);

  const refsQuery = useEnvironmentQuery(
    environmentId !== null && gitCwd !== null
      ? vcsEnvironment.listRefs({
          environmentId,
          input: { cwd: gitCwd, refKind: "local", limit: 100 },
        })
      : null,
  );
  const createRef = useAtomCommand(vcsEnvironment.createRef, { reportFailure: false });

  const applyBranches = async (branchNames: ReadonlyArray<string>) => {
    if (prepared._tag === "None") return;
    setBusy(true);
    try {
      const updated = await setTaskLinkedBranches(prepared.value, task.id, branchNames);
      props.onTaskChanged?.(updated);
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Failed to update branch links",
        description: cause instanceof Error ? cause.message : "An error occurred.",
      });
    } finally {
      setBusy(false);
    }
  };

  const createAndLinkBranch = async () => {
    const name = branchName.trim();
    if (!name || prepared._tag === "None" || environmentId === null || gitCwd === null) return;
    setBusy(true);
    try {
      const result = await createRef({
        environmentId,
        input: { cwd: gitCwd, refName: name },
      });
      if (result._tag !== "Success") {
        if (!isAtomCommandInterrupted(result)) {
          const cause = squashAtomCommandFailure(result);
          toastManager.add({
            type: "error",
            title: "Failed to create branch",
            description: cause instanceof Error ? cause.message : "An error occurred.",
          });
        }
        return;
      }
      const updated = await setTaskLinkedBranches(prepared.value, task.id, [
        ...task.linkedBranches,
        name,
      ]);
      props.onTaskChanged?.(updated);
      setBranchName("");
      setPickerMode(null);
      toastManager.add({ type: "success", title: "Branch created", description: name });
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Failed to create branch",
        description: cause instanceof Error ? cause.message : "An error occurred.",
      });
    } finally {
      setBusy(false);
    }
  };

  const openPicker = (mode: "link" | "create") => {
    if (mode === "create") {
      // Prefill with the task's conventional branch name; the user edits it.
      setBranchName(buildTaskBranchName(task));
    }
    setPickerMode((current) => (current === mode ? null : mode));
  };

  const linkedBranches = task.linkedBranches;
  const query = branchQuery.trim().toLowerCase();
  const availableBranches = useMemo(
    () =>
      (refsQuery.data?.refs ?? [])
        .map((ref) => ref.name)
        .filter((name) => !linkedBranches.includes(name))
        .filter((name) => query.length === 0 || name.toLowerCase().includes(query)),
    [linkedBranches, query, refsQuery.data],
  );

  if (environmentId === null || gitCwd === null) return null;

  return (
    <section className="rounded-xl border border-border/70 bg-card/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <h5 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Branches
        </h5>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="xs"
            variant={pickerMode === "link" ? "secondary" : "ghost"}
            className="gap-1.5"
            aria-expanded={pickerMode === "link"}
            onClick={() => openPicker("link")}
          >
            <Link2Icon className="size-3.5" />
            Link
          </Button>
          <Button
            type="button"
            size="xs"
            variant={pickerMode === "create" ? "secondary" : "ghost"}
            className="gap-1.5"
            aria-expanded={pickerMode === "create"}
            onClick={() => openPicker("create")}
          >
            <PlusIcon className="size-3.5" />
            Create
          </Button>
        </div>
      </div>
      <div className="mt-2">
        {linkedBranches.length === 0 ? (
          <p className="text-xs text-muted-foreground">No branches linked yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {linkedBranches.map((branchName) => (
              <span
                key={branchName}
                className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background py-0.5 pr-1 pl-2 text-xs"
              >
                <GitBranchIcon className="size-3 shrink-0 text-muted-foreground" />
                <span className="max-w-48 truncate">{branchName}</span>
                <button
                  type="button"
                  aria-label={`Unlink ${branchName}`}
                  title={`Unlink ${branchName}`}
                  disabled={busy}
                  className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={() =>
                    void applyBranches(linkedBranches.filter((name) => name !== branchName))
                  }
                >
                  <XIcon className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
      {pickerMode === "link" ? (
        <div className="mt-2 overflow-hidden rounded-lg border border-border/70">
          <div className="border-b border-border/70 p-1.5">
            <Input
              value={branchQuery}
              onChange={(event) => setBranchQuery(event.target.value)}
              placeholder="Search branches…"
              aria-label="Search branches"
            />
          </div>
          <div className="max-h-48 overflow-y-auto p-1">
            {availableBranches.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">No matching branches.</p>
            ) : (
              availableBranches.map((branchName) => (
                <button
                  key={branchName}
                  type="button"
                  disabled={busy}
                  className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent/60 disabled:opacity-50"
                  onClick={() => {
                    setBranchQuery("");
                    void applyBranches([...linkedBranches, branchName]);
                  }}
                >
                  <GitBranchIcon className="size-3 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">{branchName}</span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
      {pickerMode === "create" ? (
        <form
          className="mt-2 rounded-lg border border-border/70 p-2"
          onSubmit={(event) => {
            event.preventDefault();
            void createAndLinkBranch();
          }}
        >
          <Input
            value={branchName}
            onChange={(event) => setBranchName(event.target.value)}
            placeholder="Branch name"
            aria-label="Branch name"
            spellCheck={false}
          />
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Creates the branch at the repository head and links it to this task.
          </p>
          <div className="mt-2 flex justify-end gap-1.5">
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={busy}
              onClick={() => setPickerMode(null)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="xs"
              className="gap-1.5"
              disabled={busy || branchName.trim().length === 0}
            >
              {busy ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <PlusIcon className="size-3.5" />
              )}
              Create branch
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
});

/** One labeled cell in the details card; string values truncate with the full text on hover. */
function TaskDetailField(props: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  title?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2" title={props.title}>
      <span className="shrink-0 text-muted-foreground [&_svg]:size-3.5">{props.icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] leading-tight text-muted-foreground">{props.label}</p>
        {typeof props.value === "string" ? (
          <p className="truncate text-sm leading-tight">{props.value}</p>
        ) : (
          props.value
        )}
      </div>
    </div>
  );
}

/** The scrollable task detail content shared by the dialog and the tasks panel view. */
export function TaskDetailsBody(props: TaskDetailsBodyProps) {
  const { task } = props;
  const imageUrls = useMemo(() => extractImageUrls(task.description), [task.description]);
  // The provider's human-facing id; manual tasks have none, and their
  // internal record id stays hidden.
  const displayTaskId = task.externalCustomId ?? task.externalTaskId;

  return (
    <>
      <section className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-xl border border-border/70 bg-card/60 p-3">
        <TaskDetailField
          icon={<ListTodoIcon />}
          label="Status"
          value={<TaskStatusBadge task={task} />}
        />
        <TaskDetailField
          icon={<CloudIcon />}
          label="Source"
          value={
            task.provider === "manual"
              ? "Manual"
              : task.externalUrl
                ? new URL(task.externalUrl).hostname
                : "Provider"
          }
        />
        {displayTaskId ? (
          <TaskDetailField
            icon={<HashIcon />}
            label="ID"
            value={<TaskIdFieldValue taskId={displayTaskId} />}
          />
        ) : null}
        <TaskDetailField
          icon={<CalendarIcon />}
          label="Created"
          value={formatTaskDate(task.createdAt)}
          title={new Date(task.createdAt).toLocaleString()}
        />
        <TaskDetailField
          icon={<HistoryIcon />}
          label="Updated"
          value={formatTaskDate(task.updatedAt)}
          title={new Date(task.updatedAt).toLocaleString()}
        />
        {task.listName ? (
          <TaskDetailField icon={<ListIcon />} label="List" value={task.listName} />
        ) : null}
        {task.assignees.length > 0 ? (
          <TaskDetailField
            icon={<UserIcon />}
            label="Assignees"
            value={task.assignees.join(", ")}
          />
        ) : null}
      </section>
      <TaskBranchesSection
        task={task}
        environmentId={props.environmentId}
        gitCwd={props.gitCwd}
        onTaskChanged={props.onTaskChanged}
      />
      <div className="space-y-1">
        <h5 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Description
        </h5>
        {task.description ? (
          <div className="chat-markdown w-full min-w-0 text-sm leading-relaxed text-foreground/80">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{task.description}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No description.</p>
        )}
        {imageUrls.length > 0 ? (
          <div className="grid grid-cols-3 gap-2 pt-1">
            {imageUrls.map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="block overflow-hidden rounded-lg border border-border/70"
              >
                <img
                  src={url}
                  alt=""
                  loading="lazy"
                  className="h-24 w-full object-cover transition-transform hover:scale-105"
                />
              </a>
            ))}
          </div>
        ) : null}
      </div>
      <TaskAttachmentsSection task={task} environmentId={props.environmentId} />
      <TaskCommentsSection task={task} environmentId={props.environmentId} />
      <div className="space-y-2">
        <h5 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Notes
        </h5>
        {task.notes.length === 0 ? (
          <p className="text-xs text-muted-foreground">No notes yet.</p>
        ) : (
          <div className="space-y-2">
            {task.notes.map((note) => (
              <div key={note.id} className="min-w-0">
                <TaskMarkdownBubble body={note.body} />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {new Date(note.createdAt).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export interface TaskNoteComposerProps {
  task: Task;
  busyKey: string | null;
  noteDraft: string;
  onNoteDraftChange: (value: string) => void;
  onAddNote: () => void;
}

/** Note composer pinned to the bottom of the detail view. */
export function TaskNoteComposer(props: TaskNoteComposerProps) {
  const { task } = props;
  return (
    <div className="flex items-center gap-2">
      <Input
        value={props.noteDraft}
        onChange={(event) => props.onNoteDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") props.onAddNote();
        }}
        placeholder="Add a note"
        className="h-9 sm:h-8"
      />
      <Button
        size="sm"
        onClick={props.onAddNote}
        disabled={props.busyKey === `note:${task.id}` || props.noteDraft.trim().length === 0}
      >
        Add
      </Button>
    </div>
  );
}

export interface TaskDetailsActionsProps {
  task: Task;
  activeThreadId: ThreadId | null;
  /** Environment + thread context enable the task-branch action. */
  environmentId?: EnvironmentId | undefined;
  busyKey: string | null;
  onDelete?: (() => void) | undefined;
  /** Only handed to manual tasks; synced tasks are edited at their provider. */
  onEdit?: (() => void) | undefined;
  onLink?: (() => void) | undefined;
  onUnlink?: (() => void) | undefined;
  onCreateThread?: (() => void) | undefined;
  onNavigateThread?: (() => void) | undefined;
}

/** Quiet icon control for the detail header toolbar; the label rides a tooltip. */
function HeaderIconButton(props: {
  label: string;
  onClick: () => void;
  disabled?: boolean | undefined;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={props.label}
            onClick={props.onClick}
            disabled={props.disabled}
          >
            {props.children}
          </Button>
        }
      />
      <TooltipPopup side="bottom">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

/** Thread wiring actions, rendered as a compact toolbar in the detail header. */
export function TaskDetailsActions(props: TaskDetailsActionsProps) {
  const { task } = props;
  const linkedThreadId = task.linkedThreadId;
  const isLinkedToCurrentThread =
    props.activeThreadId !== null && linkedThreadId === props.activeThreadId;
  const isLinkBusy = props.busyKey === `task-link:${task.id}`;
  const composerRef = useComposerHandleContext();
  // Unlinking detaches the task from its one linked thread, which may not be
  // the one the user is looking at; name it when the shell index knows it.
  const linkedThreadShell = useThreadShell(
    props.environmentId && linkedThreadId
      ? scopeThreadRef(props.environmentId, linkedThreadId)
      : null,
  );
  const unlinkLabel =
    linkedThreadId === null
      ? "Unlink from thread"
      : isLinkedToCurrentThread
        ? "Unlink from this thread"
        : linkedThreadShell?.title != null
          ? `Unlink from “${linkedThreadShell.title}”`
          : "Unlink from linked thread";

  const addToThread = () => {
    const handle = composerRef?.current;
    if (!handle) {
      toastManager.add({
        type: "error",
        title: "Unable to add to thread",
        description: "Open a chat for this project and try again.",
      });
      return;
    }
    // Attaches the task as a context chip; it rides the next message once.
    const attached = handle.addTaskContext(task);
    if (!attached) {
      toastManager.add({
        type: "error",
        title: "Unable to add to thread",
        description: "The chat isn't ready to accept input right now.",
      });
    }
  };

  // One primary action depends on the link state; everything else stays quiet.
  const onLink = props.onLink;
  const showCreateThread = linkedThreadId === null && props.onCreateThread !== undefined;
  const showOpenThread = linkedThreadId !== null && props.onNavigateThread !== undefined;
  const showLinkCurrent = onLink !== undefined && !isLinkedToCurrentThread;
  const showUnlink = linkedThreadId !== null && props.onUnlink !== undefined;
  const showDelete = props.onDelete !== undefined && task.provider === "manual";
  const showEdit = props.onEdit !== undefined && task.provider === "manual";
  const showOpenExternal = task.externalUrl !== null;
  const showOverflow = showUnlink || showDelete || showEdit || showOpenExternal;

  return (
    <div className="flex items-center gap-0.5">
      {showCreateThread ? (
        <Button size="sm" onClick={props.onCreateThread}>
          <SquareCheckBigIcon className="size-3.5" />
          Create thread
        </Button>
      ) : null}
      {showOpenThread ? (
        <Button size="sm" variant="ghost" onClick={props.onNavigateThread}>
          <ArrowUpRightIcon className="size-3.5" />
          Open thread
        </Button>
      ) : null}
      <HeaderIconButton label="Add to thread" onClick={addToThread}>
        <MessageSquarePlusIcon className="size-3.5" />
      </HeaderIconButton>
      {showLinkCurrent ? (
        <HeaderIconButton label="Link current thread" onClick={onLink} disabled={isLinkBusy}>
          <Link2Icon className="size-3.5" />
        </HeaderIconButton>
      ) : null}
      {showOverflow ? (
        <>
          <div role="presentation" className="mx-1 h-4 w-px bg-border" />
          <Menu>
            <MenuTrigger
              render={<Button size="icon-sm" variant="ghost" aria-label="More actions" />}
            >
              <EllipsisIcon className="size-4" />
            </MenuTrigger>
            <MenuPopup align="end">
              {showOpenExternal ? (
                <MenuItem render={<a href={task.externalUrl} target="_blank" rel="noreferrer" />}>
                  <ExternalLinkIcon />
                  Open in ClickUp
                </MenuItem>
              ) : null}
              {showUnlink ? (
                <MenuItem onClick={props.onUnlink} disabled={isLinkBusy}>
                  <UnlinkIcon />
                  {unlinkLabel}
                </MenuItem>
              ) : null}
              {showEdit ? (
                <MenuItem onClick={props.onEdit}>
                  <PencilIcon />
                  Edit task
                </MenuItem>
              ) : null}
              {showDelete ? (
                <MenuItem
                  variant="destructive"
                  onClick={props.onDelete}
                  disabled={props.busyKey === `task-delete:${task.id}`}
                >
                  <Trash2Icon />
                  Delete task
                </MenuItem>
              ) : null}
            </MenuPopup>
          </Menu>
        </>
      ) : null}
    </div>
  );
}

export interface TaskDetailsDialogProps {
  task: Task;
  activeThreadId: ThreadId | null;
  /** Environment + thread context enable the task-branch action. */
  environmentId?: EnvironmentId | undefined;
  busyKey: string | null;
  noteDraft: string;
  onNoteDraftChange: (value: string) => void;
  onAddNote: () => void;
  /** Moves the detail view into the tasks panel; the dialog closes. */
  onShowInPanel?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
  onEdit?: (() => void) | undefined;
  onLink?: (() => void) | undefined;
  onUnlink?: (() => void) | undefined;
  onCreateThread?: (() => void) | undefined;
  onNavigateThread?: (() => void) | undefined;
  onOpenChange: (open: boolean) => void;
}

export function TaskDetailsDialog(props: TaskDetailsDialogProps) {
  const { task: taskProp } = props;
  // Branch links update the task in place; the owner's copy may lag until its
  // own refresh lands, so the freshest edit wins while the ids match.
  const [taskOverride, setTaskOverride] = useState<Task | null>(null);
  const task = taskOverride !== null && taskOverride.id === taskProp.id ? taskOverride : taskProp;

  const threadRef =
    props.activeThreadId && props.environmentId
      ? scopeThreadRef(props.environmentId, props.activeThreadId)
      : null;
  const serverThread = useThread(threadRef);
  const projectRef =
    serverThread && props.environmentId
      ? scopeProjectRef(props.environmentId, serverThread.projectId)
      : null;
  const project = useProject(projectRef);
  const gitCwd = serverThread?.worktreePath ?? project?.workspaceRoot ?? undefined;

  const hasThreadActions =
    props.onNavigateThread !== undefined ||
    props.onLink !== undefined ||
    props.onUnlink !== undefined ||
    props.onCreateThread !== undefined ||
    props.onDelete !== undefined ||
    props.onEdit !== undefined ||
    task.externalUrl !== null;

  return (
    <Dialog open onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-3xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2 pr-9">
            <DialogTitle className="text-balance">{task.title}</DialogTitle>
            <div className="flex shrink-0 items-center gap-1">
              {hasThreadActions ? (
                <TaskDetailsActions
                  task={task}
                  activeThreadId={props.activeThreadId}
                  environmentId={props.environmentId}
                  busyKey={props.busyKey}
                  onDelete={props.onDelete}
                  onEdit={props.onEdit}
                  onLink={props.onLink}
                  onUnlink={props.onUnlink}
                  onCreateThread={props.onCreateThread}
                  onNavigateThread={props.onNavigateThread}
                />
              ) : null}
              {props.onShowInPanel ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="shrink-0"
                        aria-label="Show in panel"
                        onClick={props.onShowInPanel}
                      >
                        <PanelRightIcon className="size-3.5" />
                      </Button>
                    }
                  />
                  <TooltipPopup side="bottom">Show in panel</TooltipPopup>
                </Tooltip>
              ) : null}
            </div>
          </div>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <TaskDetailsBody
            task={task}
            environmentId={props.environmentId}
            gitCwd={gitCwd}
            onTaskChanged={setTaskOverride}
          />
        </DialogPanel>
        <DialogFooter>
          <TaskNoteComposer
            task={task}
            busyKey={props.busyKey}
            noteDraft={props.noteDraft}
            onNoteDraftChange={props.onNoteDraftChange}
            onAddNote={props.onAddNote}
          />
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
