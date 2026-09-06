import type { Task, TaskComment } from "@t3tools/contracts";
import { formatTaskContext } from "@t3tools/shared/taskContext";

/**
 * Markdown body describing the task, shaped identically to the web client's
 * composer-attached blocks (both render through the shared task-context
 * formatter) so the model sees the same block either way. Provider comments
 * are passed in by the caller when they are available.
 */
export function formatTaskAsTurnContext(task: Task, comments?: ReadonlyArray<TaskComment>): string {
  return formatTaskContext(task, comments === undefined ? undefined : { comments });
}

/** One linked task plus whatever provider comments were fetched for it. */
export interface LinkedTaskContextEntry {
  readonly task: Task;
  readonly comments?: ReadonlyArray<TaskComment>;
}

/**
 * Block appended to the outgoing provider input for a thread's first turn on
 * a fresh provider session: the model must know which tasks the thread is
 * linked to without the user attaching anything to the chat. Same
 * `<task_context>` wrapper as the composer-attached blocks; a thread can
 * carry several linked tasks.
 */
export function buildLinkedTaskContextBlock(
  entries: ReadonlyArray<LinkedTaskContextEntry>,
): string {
  const [first] = entries;
  const formatEntry = (entry: LinkedTaskContextEntry) =>
    formatTaskAsTurnContext(entry.task, entry.comments);
  if (entries.length === 1 && first) {
    return `<task_context>\nThis thread is linked to the following task:\n\n${formatEntry(first)}\n</task_context>`;
  }
  const bodies = entries.map(formatEntry).join("\n\n");
  return `<task_context>\nThis thread is linked to the following tasks:\n\n${bodies}\n</task_context>`;
}
