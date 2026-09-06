import type { Task, TaskComment, TaskNote } from "@t3tools/contracts";

/**
 * Shared shape of the `<task_context>` block, rendered identically whether
 * the user attached the task in the composer (web) or the server injected it
 * for a linked thread.
 */

/** Most recent comments/notes kept in the context; older ones drop off. */
const TASK_CONTEXT_MAX_ENTRIES = 20;
const TASK_CONTEXT_MAX_BODY_CHARS = 500;

export function taskStatusLabel(task: Task): string {
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

interface CommentThread {
  readonly comment: TaskComment;
  readonly replies: Array<TaskComment>;
}

/** Groups the flat comment list into threads; orphaned replies render top-level. */
function groupCommentThreads(comments: ReadonlyArray<TaskComment>): Array<CommentThread> {
  const threadsById = new Map<string, CommentThread>();
  const threads: Array<CommentThread> = [];
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

function truncateBody(body: string): string {
  const trimmed = body.trim();
  return trimmed.length <= TASK_CONTEXT_MAX_BODY_CHARS
    ? trimmed
    : `${trimmed.slice(0, TASK_CONTEXT_MAX_BODY_CHARS).trimEnd()}…`;
}

function contextDate(iso: string | null): string {
  return iso === null ? "" : ` (${iso.slice(0, 10)})`;
}

function pushBody(lines: Array<string>, body: string, firstLine: string, indent: string): void {
  const bodyLines = truncateBody(body).split("\n");
  lines.push(`${firstLine}${bodyLines[0] ?? ""}`);
  for (const part of bodyLines.slice(1)) {
    lines.push(`${indent}${part}`);
  }
}

function formatCommentLines(comments: ReadonlyArray<TaskComment>, heading: string): Array<string> {
  if (comments.length === 0) return [];
  const lines: Array<string> = [`### ${heading} comments`];
  for (const thread of groupCommentThreads(comments)) {
    pushBody(
      lines,
      thread.comment.body,
      `- **${thread.comment.authorName}**${contextDate(thread.comment.createdAt)}: `,
      "  ",
    );
    for (const reply of thread.replies) {
      pushBody(
        lines,
        reply.body,
        `  - **${reply.authorName}**${contextDate(reply.createdAt)}: `,
        "    ",
      );
    }
  }
  return lines;
}

function formatNoteLines(notes: ReadonlyArray<TaskNote>): Array<string> {
  if (notes.length === 0) return [];
  const lines: Array<string> = ["### Notes"];
  for (const note of notes) {
    if (note.createdAt === null) {
      pushBody(lines, note.body, "- ", "  ");
    } else {
      pushBody(lines, note.body, `- (${note.createdAt.slice(0, 10)}): `, "  ");
    }
  }
  return lines;
}

export interface TaskContextExtras {
  /** Threaded provider comments, oldest first, as served by the tasks API. */
  readonly comments?: ReadonlyArray<TaskComment>;
}

/**
 * Markdown body describing the task for the model. Notes always render (they
 * ride the task payload); provider comments render when the caller has them.
 * Long histories cap to the most recent entries so a chatty task cannot
 * drown the turn.
 */
export function formatTaskContext(task: Task, extras?: TaskContextExtras): string {
  const lines: Array<string> = [`## Task: ${task.title}`, ""];

  const meta: Array<string> = [`Status: ${taskStatusLabel(task)}`];
  if (task.listName) meta.push(`List: ${task.listName}`);
  if (task.assignees.length > 0) meta.push(`Assignees: ${task.assignees.join(", ")}`);
  lines.push(...meta, "");

  if (task.description) lines.push(task.description.trim(), "");
  if (task.externalUrl) lines.push(`Source: ${task.externalUrl}`, "");

  const visibleComments = (extras?.comments ?? []).slice(-TASK_CONTEXT_MAX_ENTRIES);
  lines.push(...formatCommentLines(visibleComments, "Provider"));
  lines.push(...formatNoteLines(task.notes.slice(-TASK_CONTEXT_MAX_ENTRIES)));

  return lines.join("\n").trim();
}
