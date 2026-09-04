import type { Task, TaskClickUpComment } from "@t3tools/contracts";
import { formatTaskContext } from "@t3tools/shared/taskContext";

/**
 * Markdown body describing the task, shaped identically to the web client's
 * composer-attached blocks (both render through the shared task-context
 * formatter) so the model sees the same block either way. ClickUp comments
 * are passed in by the caller when they are available.
 */
export function formatTaskAsTurnContext(
  task: Task,
  clickUpComments?: ReadonlyArray<TaskClickUpComment>,
): string {
  return formatTaskContext(task, clickUpComments === undefined ? undefined : { clickUpComments });
}

/**
 * Block appended to the outgoing provider input for a thread's first turn on
 * a fresh provider session: the model must know what the linked task is
 * without the user attaching anything to the chat. Same `<task_context>`
 * wrapper as the composer-attached blocks.
 */
export function buildLinkedTaskContextBlock(
  task: Task,
  clickUpComments?: ReadonlyArray<TaskClickUpComment>,
): string {
  return `<task_context>\nThis thread is linked to the following task:\n\n${formatTaskAsTurnContext(task, clickUpComments)}\n</task_context>`;
}
