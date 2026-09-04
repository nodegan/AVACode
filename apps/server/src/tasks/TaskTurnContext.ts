import type { Task } from "@t3tools/contracts";

function taskStatusLabel(task: Task): string {
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
 * Markdown body describing the task, shaped like the web client's
 * `formatTaskAsThreadContext` so the model sees the same block whether the
 * user attached it in the composer or the server injected it for a linked
 * thread.
 */
export function formatTaskAsTurnContext(task: Task): string {
  const lines: string[] = [`## Task: ${task.title}`, ""];

  const meta: string[] = [`Status: ${taskStatusLabel(task)}`];
  if (task.externalListName) meta.push(`List: ${task.externalListName}`);
  if (task.assignees.length > 0) meta.push(`Assignees: ${task.assignees.join(", ")}`);
  lines.push(...meta, "");

  if (task.description) lines.push(task.description.trim(), "");
  if (task.externalUrl) lines.push(`Source: ${task.externalUrl}`, "");

  return lines.join("\n").trim();
}

/**
 * Block appended to the outgoing provider input for a thread's first turn on
 * a fresh provider session: the model must know what the linked task is
 * without the user attaching anything to the chat. Same `<task_context>`
 * wrapper as the composer-attached blocks.
 */
export function buildLinkedTaskContextBlock(task: Task): string {
  return `<task_context>\nThis thread is linked to the following task:\n\n${formatTaskAsTurnContext(task)}\n</task_context>`;
}
