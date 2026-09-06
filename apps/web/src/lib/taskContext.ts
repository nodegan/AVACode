import type { Task, ThreadId } from "@t3tools/contracts";
import { formatTaskContext } from "@t3tools/shared/taskContext";

/**
 * Markdown body for the task, shared with the server's linked-task injection
 * (both render through the shared task-context formatter) so the model sees
 * the same block either way. Composer drafts snapshot the task payload, which
 * carries local notes but not ClickUp comments.
 */
export function formatTaskAsThreadContext(task: Task): string {
  return formatTaskContext(task);
}

/**
 * Task attached to a composer draft. The markdown is a snapshot taken at
 * attach time so the outgoing block is stable, mirroring how element
 * contexts snapshot their payload.
 */
export interface TaskContextDraft {
  /** Stable composer-side id used for keyed rendering. */
  id: string;
  taskId: string;
  title: string;
  markdown: string;
  threadId: ThreadId;
  addedAt: string;
}

export function taskContextDedupKey(taskId: string): string {
  return taskId.trim().toLowerCase();
}

/**
 * Serialize task drafts into the `<task_context>` block appended to the
 * outgoing message. Mirrors the `<element_context>` block format so the
 * transcript can strip and chip it separately.
 */
export function buildTaskContextBlock(drafts: ReadonlyArray<TaskContextDraft>): string {
  if (drafts.length === 0) return "";
  const bodies = drafts.map((draft) => draft.markdown.trim()).filter((body) => body.length > 0);
  if (bodies.length === 0) return "";
  return `<task_context>\n${bodies.join("\n\n")}\n</task_context>`;
}

export function appendTaskContextsToPrompt(
  prompt: string,
  drafts: ReadonlyArray<TaskContextDraft>,
): string {
  const block = buildTaskContextBlock(drafts);
  if (block.length === 0) return prompt;
  const trimmed = prompt.trim();
  return trimmed.length > 0 ? `${trimmed}\n\n${block}` : block;
}

export interface ParsedTaskContextEntry {
  title: string;
}

export interface ExtractedTaskContexts {
  promptText: string;
  contextCount: number;
  tasks: ParsedTaskContextEntry[];
}

const TRAILING_TASK_CONTEXT_BLOCK_PATTERN = /\n*<task_context>\n([\s\S]*?)\n<\/task_context>\s*$/;

const TASK_CONTEXT_TITLE_PATTERN = /^## Task: (.+)$/;

function slugifyBranchPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
}

/**
 * Conventional-commit-style branch name used to prefill the create-branch
 * dialog: `<prefix>/<CLICKUP_ID>/<description>`, e.g.
 * `feature/PR-1685/fix-login-redirect`. The ID keeps its original casing
 * (`PR-1685`); only the description slugs. Tasks without a tracker id
 * (manual tasks) skip the id segment instead of leaking the long internal
 * record id. The prefix defaults to `feature` and the whole name is
 * editable before the branch is created.
 */
export function buildTaskBranchName(task: Task, prefix = "feature"): string {
  const externalId = task.externalCustomId ?? task.externalTaskId;
  const id = externalId === null ? "" : sanitizeBranchId(externalId);
  const description = slugifyBranchPart(task.title);
  return [prefix, id, description].filter((part) => part.length > 0).join("/");
}

/** Git-ref-safe version of the provider's task ID, preserving its casing. */
function sanitizeBranchId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Mirror image of `appendTaskContextsToPrompt` for transcript display:
 * detects (and strips) a trailing `<task_context>` block so the message
 * bubble can render task chips instead of the raw block.
 */
export function extractTrailingTaskContexts(prompt: string): ExtractedTaskContexts {
  const match = TRAILING_TASK_CONTEXT_BLOCK_PATTERN.exec(prompt);
  if (!match) {
    return { promptText: prompt, contextCount: 0, tasks: [] };
  }
  const promptText = prompt.slice(0, match.index).replace(/\n+$/, "");
  const tasks: ParsedTaskContextEntry[] = [];
  for (const line of (match[1] ?? "").split("\n")) {
    const titleMatch = TASK_CONTEXT_TITLE_PATTERN.exec(line);
    if (titleMatch?.[1]) tasks.push({ title: titleMatch[1] });
  }
  return { promptText, contextCount: tasks.length, tasks };
}
