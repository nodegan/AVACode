import type {
  EnvironmentId,
  Task,
  TaskAttachment,
  TaskClickUpComment,
  TaskStatusCategory,
  ThreadId,
} from "@t3tools/contracts";
import {
  ArrowUpRightIcon,
  CalendarIcon,
  CheckIcon,
  ChevronRightIcon,
  CloudIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  HistoryIcon,
  Link2Icon,
  ListIcon,
  ListTodoIcon,
  MessageSquarePlusIcon,
  PanelRightIcon,
  PaperclipIcon,
  SquareCheckBigIcon,
  Trash2Icon,
  UnlinkIcon,
  UserIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
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
import { useComposerHandleContext } from "~/composerHandleContext";
import { usePreparedConnection } from "~/state/session";
import { cn } from "~/lib/utils";

import { ExpandedImageDialog } from "../chat/ExpandedImageDialog";
import type { ExpandedImagePreview } from "../chat/ExpandedImagePreview";
import { CreateTaskBranchButton } from "./CreateTaskBranchButton";
import { fetchTaskAttachments, fetchTaskComments } from "./taskApi";
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
 * Files added to the task in ClickUp, fetched on demand when the detail view
 * opens (sync skips them to avoid a request per task). Manual tasks render
 * nothing.
 */
function TaskAttachmentsSection(props: TaskDetailsBodyProps) {
  const { task } = props;
  const prepared = usePreparedConnection(props.environmentId ?? null);
  const isClickUpTask = task.source === "clickup" && task.externalTaskId !== null;
  const [state, setState] = useState<AttachmentsState>({ status: "loading" });
  const [expandedImage, setExpandedImage] = useState<ExpandedImagePreview | null>(null);

  useEffect(() => {
    if (!isClickUpTask || prepared._tag === "None") return;
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
  }, [isClickUpTask, prepared, task.id]);

  if (!isClickUpTask || prepared._tag === "None") return null;

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
}

interface ClickUpCommentThread {
  readonly comment: TaskClickUpComment;
  readonly replies: Array<TaskClickUpComment>;
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
function groupClickUpCommentThreads(
  comments: ReadonlyArray<TaskClickUpComment>,
): Array<ClickUpCommentThread> {
  const threadsById = new Map<string, ClickUpCommentThread>();
  const threads: Array<ClickUpCommentThread> = [];
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
function ClickUpCommentAvatar(props: {
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

function ClickUpCommentRow({ comment }: { comment: TaskClickUpComment }) {
  return (
    <div className="flex min-w-0 gap-2">
      <ClickUpCommentAvatar
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

function ClickUpCommentThreadRow({ thread }: { thread: ClickUpCommentThread }) {
  // Threads stay collapsed until asked for, like ClickUp's "N replies" toggle.
  const [expanded, setExpanded] = useState(false);
  const replyLabel = thread.replies.length === 1 ? "1 reply" : `${thread.replies.length} replies`;
  return (
    <div className="space-y-2">
      <ClickUpCommentRow comment={thread.comment} />
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
                <ClickUpCommentRow key={reply.id} comment={reply} />
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

type ClickUpCommentsState =
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | { readonly status: "ready"; readonly comments: ReadonlyArray<TaskClickUpComment> };

/**
 * Comments left on the task in ClickUp, fetched on demand when the detail view
 * opens (read-only for now; local comments live in the composer below).
 * Manual tasks render nothing.
 */
function TaskClickUpCommentsSection(props: TaskDetailsBodyProps) {
  const { task } = props;
  const prepared = usePreparedConnection(props.environmentId ?? null);
  const isClickUpTask = task.source === "clickup" && task.externalTaskId !== null;
  const [state, setState] = useState<ClickUpCommentsState>({ status: "loading" });

  useEffect(() => {
    if (!isClickUpTask || prepared._tag === "None") return;
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
  }, [isClickUpTask, prepared, task.id]);

  const threads = useMemo(
    () => (state.status === "ready" ? groupClickUpCommentThreads(state.comments) : []),
    [state],
  );

  if (!isClickUpTask || prepared._tag === "None") return null;

  return (
    <div className="space-y-2">
      <h5 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        ClickUp comments
      </h5>
      {state.status === "loading" ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : state.status === "error" ? (
        <p className="text-xs text-destructive">Failed to load ClickUp comments.</p>
      ) : threads.length === 0 ? (
        <p className="text-xs text-muted-foreground">No comments on ClickUp.</p>
      ) : (
        <div className="space-y-3">
          {threads.map((thread) => (
            <ClickUpCommentThreadRow key={thread.comment.id} thread={thread} />
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
          value={task.source === "manual" ? "Manual" : "ClickUp"}
        />
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
        {task.externalListName ? (
          <TaskDetailField icon={<ListIcon />} label="List" value={task.externalListName} />
        ) : null}
        {task.assignees.length > 0 ? (
          <TaskDetailField
            icon={<UserIcon />}
            label="Assignees"
            value={task.assignees.join(", ")}
          />
        ) : null}
      </section>
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
      <TaskClickUpCommentsSection task={task} environmentId={props.environmentId} />
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
  const environmentId = props.environmentId;
  const showCreateThread = linkedThreadId === null && props.onCreateThread !== undefined;
  const showOpenThread = linkedThreadId !== null && props.onNavigateThread !== undefined;
  const showLinkCurrent = onLink !== undefined && !isLinkedToCurrentThread;
  const showBranch = environmentId !== undefined && props.activeThreadId !== null;
  const showUnlink = linkedThreadId !== null && props.onUnlink !== undefined;
  const showDelete = props.onDelete !== undefined && task.source === "manual";
  const showOpenExternal = task.externalUrl !== null;
  const showOverflow = showUnlink || showDelete || showOpenExternal;

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
      {showBranch ? (
        <CreateTaskBranchButton
          task={task}
          environmentId={environmentId}
          threadId={props.activeThreadId}
        />
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
                  Unlink from thread
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
  onLink?: (() => void) | undefined;
  onUnlink?: (() => void) | undefined;
  onCreateThread?: (() => void) | undefined;
  onNavigateThread?: (() => void) | undefined;
  onOpenChange: (open: boolean) => void;
}

export function TaskDetailsDialog(props: TaskDetailsDialogProps) {
  const { task } = props;
  const hasThreadActions =
    props.onNavigateThread !== undefined ||
    props.onLink !== undefined ||
    props.onUnlink !== undefined ||
    props.onCreateThread !== undefined ||
    props.onDelete !== undefined ||
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
          <TaskDetailsBody task={task} environmentId={props.environmentId} />
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
