import { describe, expect, it } from "vite-plus/test";

import type { Task } from "@t3tools/contracts";
import { TaskId, ThreadId } from "@t3tools/contracts";

import { buildLinkedTaskContextBlock, formatTaskAsTurnContext } from "./TaskTurnContext.ts";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: TaskId.make("task-1"),
    source: "manual",
    title: "Fix login redirect",
    description: "Users land on the home screen after SSO.",
    statusLabel: "In Progress",
    statusCategory: "in_progress",
    statusColor: null,
    linkedThreadId: ThreadId.make("thread-1"),
    externalTaskId: null,
    externalCustomId: null,
    externalUrl: null,
    externalListId: null,
    externalListName: null,
    assignees: [],
    syncedAt: null,
    externalUpdatedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    comments: [],
    ...overrides,
  };
}

describe("TaskTurnContext", () => {
  it("formats title, status, and description", () => {
    const markdown = formatTaskAsTurnContext(makeTask());
    expect(markdown).toBe(
      [
        "## Task: Fix login redirect",
        "",
        "Status: In progress",
        "",
        "Users land on the home screen after SSO.",
      ].join("\n"),
    );
  });

  it("includes list, assignees, and source url when present", () => {
    const markdown = formatTaskAsTurnContext(
      makeTask({
        externalListName: "Sprint Backlog",
        assignees: ["Ana"],
        externalUrl: "https://app.clickup.com/t/9hz",
      }),
    );
    expect(markdown).toContain("List: Sprint Backlog");
    expect(markdown).toContain("Assignees: Ana");
    expect(markdown).toContain("Source: https://app.clickup.com/t/9hz");
  });

  it("wraps the markdown in a labeled task_context block", () => {
    const block = buildLinkedTaskContextBlock(makeTask());
    expect(block.startsWith("<task_context>\nThis thread is linked to the following task:")).toBe(
      true,
    );
    expect(block).toContain("## Task: Fix login redirect");
    expect(block.endsWith("</task_context>")).toBe(true);
  });
});
