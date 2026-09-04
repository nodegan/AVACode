import type { EnvironmentId, Task, TaskStatusCategory, ThreadId } from "@t3tools/contracts";
import {
  ExternalLinkIcon,
  Link2Icon,
  LinkIcon,
  MessageSquarePlusIcon,
  PanelRightIcon,
  SquareCheckBigIcon,
} from "lucide-react";
import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
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
import { toastManager } from "~/components/ui/toast";
import { useComposerHandleContext } from "~/composerHandleContext";
import { cn } from "~/lib/utils";

import { CreateTaskBranchButton } from "./CreateTaskBranchButton";
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

export interface TaskDetailsBodyProps {
  task: Task;
}

/** The scrollable task detail content shared by the dialog and the tasks panel view. */
export function TaskDetailsBody(props: TaskDetailsBodyProps) {
  const { task } = props;
  const imageUrls = useMemo(() => extractImageUrls(task.description), [task.description]);
  const metadata: Array<{ label: string; value: string }> = [
    { label: "Created", value: new Date(task.createdAt).toLocaleString() },
    { label: "Updated", value: new Date(task.updatedAt).toLocaleString() },
  ];
  if (task.externalListName) {
    metadata.push({ label: "List", value: task.externalListName });
  }
  if (task.assignees.length > 0) {
    metadata.push({ label: "Assignees", value: task.assignees.join(", ") });
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <TaskStatusBadge task={task} />
        {task.source === "manual" ? (
          <span className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground">
            Manual
          </span>
        ) : null}
        {task.externalUrl ? (
          <a
            href={task.externalUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLinkIcon className="size-3" />
            Open in ClickUp
          </a>
        ) : null}
      </div>
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
      <div className="space-y-1">
        <h5 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Details
        </h5>
        <div className="space-y-1 text-sm">
          {metadata.map((entry) => (
            <div key={entry.label} className="flex gap-3">
              <span className="w-20 shrink-0 text-muted-foreground">{entry.label}</span>
              <span className="min-w-0 break-words">{entry.value}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <h5 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Comments
        </h5>
        {task.comments.length === 0 ? (
          <p className="text-xs text-muted-foreground">No comments yet.</p>
        ) : (
          <div className="space-y-2">
            {task.comments.map((comment) => (
              <div key={comment.id} className="rounded-lg bg-muted/50 p-2.5">
                <p className="whitespace-pre-wrap text-sm">{comment.body}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {new Date(comment.createdAt).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export interface TaskCommentComposerProps {
  task: Task;
  busyKey: string | null;
  commentDraft: string;
  onCommentDraftChange: (value: string) => void;
  onAddComment: () => void;
}

/** Comment composer pinned to the bottom of the detail view. */
export function TaskCommentComposer(props: TaskCommentComposerProps) {
  const { task } = props;
  return (
    <div className="flex gap-2">
      <Input
        value={props.commentDraft}
        onChange={(event) => props.onCommentDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") props.onAddComment();
        }}
        placeholder="Add a local comment"
        className="h-8 sm:h-7"
      />
      <Button
        size="sm"
        onClick={props.onAddComment}
        disabled={props.busyKey === `comment:${task.id}` || props.commentDraft.trim().length === 0}
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

/** Thread wiring actions, rendered by the dialog footer and the panel view. */
export function TaskDetailsActions(props: TaskDetailsActionsProps) {
  const { task } = props;
  const linkedThreadId = task.linkedThreadId;
  const isLinkedToCurrentThread =
    props.activeThreadId !== null && linkedThreadId === props.activeThreadId;
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

  return (
    <>
      {props.onDelete !== undefined && task.source === "manual" ? (
        <Button
          variant="destructive-outline"
          className="mr-auto"
          onClick={props.onDelete}
          disabled={props.busyKey === `task-delete:${task.id}`}
        >
          Delete
        </Button>
      ) : null}
      {linkedThreadId ? (
        <>
          {props.onNavigateThread !== undefined ? (
            <Button variant="outline" onClick={props.onNavigateThread}>
              <Link2Icon className="size-3.5" />
              Open thread
            </Button>
          ) : null}
          {props.onUnlink !== undefined ? (
            <Button
              variant="outline"
              onClick={props.onUnlink}
              disabled={props.busyKey === `task-link:${task.id}`}
            >
              <LinkIcon className="size-3.5" />
              Unlink
            </Button>
          ) : null}
          {props.onLink !== undefined && !isLinkedToCurrentThread ? (
            <Button
              variant="outline"
              onClick={props.onLink}
              disabled={props.busyKey === `task-link:${task.id}`}
            >
              Link current
            </Button>
          ) : null}
        </>
      ) : props.onCreateThread !== undefined || props.onLink !== undefined ? (
        <>
          {props.onCreateThread !== undefined ? (
            <Button variant="outline" onClick={props.onCreateThread}>
              <SquareCheckBigIcon className="size-3.5" />
              Create thread
            </Button>
          ) : null}
          {props.onLink !== undefined ? (
            <Button
              variant="outline"
              onClick={props.onLink}
              disabled={props.busyKey === `task-link:${task.id}`}
            >
              Link current
            </Button>
          ) : null}
        </>
      ) : null}
      {props.environmentId && props.activeThreadId ? (
        <CreateTaskBranchButton
          task={task}
          environmentId={props.environmentId}
          threadId={props.activeThreadId}
        />
      ) : null}
      <Button variant="outline" onClick={addToThread}>
        <MessageSquarePlusIcon className="size-3.5" />
        Add to thread
      </Button>
    </>
  );
}

export interface TaskDetailsDialogProps {
  task: Task;
  activeThreadId: ThreadId | null;
  /** Environment + thread context enable the task-branch action. */
  environmentId?: EnvironmentId | undefined;
  busyKey: string | null;
  commentDraft: string;
  onCommentDraftChange: (value: string) => void;
  onAddComment: () => void;
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
    props.onDelete !== undefined;

  return (
    <Dialog open onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-3xl">
        <DialogHeader>
          <div className="flex items-start justify-between gap-2 pr-9">
            <DialogTitle className="text-balance">{task.title}</DialogTitle>
            {props.onShowInPanel ? (
              <Button size="sm" variant="ghost" className="shrink-0" onClick={props.onShowInPanel}>
                <PanelRightIcon className="size-3.5" />
                Show in panel
              </Button>
            ) : null}
          </div>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <TaskDetailsBody task={task} />
        </DialogPanel>
        <DialogFooter className="flex-col gap-3 sm:flex-col">
          <TaskCommentComposer
            task={task}
            busyKey={props.busyKey}
            commentDraft={props.commentDraft}
            onCommentDraftChange={props.onCommentDraftChange}
            onAddComment={props.onAddComment}
          />
          {hasThreadActions ? (
            <div className="flex flex-wrap items-center gap-2">
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
            </div>
          ) : null}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
