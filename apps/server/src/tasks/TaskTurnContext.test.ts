import { describe, expect, it } from "vite-plus/test";

import {
  TaskId,
  TaskNoteId,
  ThreadId,
  type Task,
  type TaskComment,
  type TaskNote,
} from "@t3tools/contracts";

import { buildLinkedTaskContextBlock, formatTaskAsTurnContext } from "./TaskTurnContext.ts";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: TaskId.make("task-1"),
    provider: "manual",
    title: "Fix login redirect",
    description: "Users land on the home screen after SSO.",
    statusLabel: "In Progress",
    statusCategory: "in_progress",
    statusColor: null,
    statusId: null,
    linkedThreadId: ThreadId.make("thread-1"),
    linkedBranches: [],
    listId: null,
    listName: null,
    parentTaskId: null,
    parentTaskTitle: null,
    externalTaskId: null,
    externalCustomId: null,
    externalUrl: null,
    assignees: [],
    syncedAt: null,
    externalUpdatedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    notes: [],
    ...overrides,
  };
}

const makeComment = (overrides: Partial<TaskComment>): TaskComment => ({
  id: "c-1",
  parentId: null,
  body: "Root comment",
  authorName: "Ana",
  authorAvatarUrl: null,
  authorColor: null,
  createdAt: "2026-09-01T10:00:00.000Z",
  resolved: false,
  ...overrides,
});

const makeNote = (overrides: Partial<TaskNote>): TaskNote => ({
  id: TaskNoteId.make("n-1"),
  taskId: TaskId.make("task-1"),
  body: "Repro is on staging.",
  createdAt: "2026-09-02T00:00:00.000Z",
  updatedAt: "2026-09-02T00:00:00.000Z",
  ...overrides,
});

describe("TaskTurnContext", () => {
  it("formats title, status, and description", () => {
    const markdown = formatTaskAsTurnContext(makeTask());
    expect(markdown).toBe(
      [
        "## Task: Fix login redirect",
        "",
        // Manual tasks carry the registry label the user picked.
        "Status: In Progress",
        "",
        "Users land on the home screen after SSO.",
      ].join("\n"),
    );
  });

  it("includes list, assignees, and source url when present", () => {
    const markdown = formatTaskAsTurnContext(
      makeTask({
        listName: "Sprint Backlog",
        assignees: ["Ana"],
        externalUrl: "https://app.clickup.com/t/9hz",
      }),
    );
    expect(markdown).toContain("List: Sprint Backlog");
    expect(markdown).toContain("Assignees: Ana");
    expect(markdown).toContain("Source: https://app.clickup.com/t/9hz");
  });

  it("wraps the markdown in a labeled task_context block", () => {
    const block = buildLinkedTaskContextBlock([{ task: makeTask() }]);
    expect(block.startsWith("<task_context>\nThis thread is linked to the following task:")).toBe(
      true,
    );
    expect(block).toContain("## Task: Fix login redirect");
    expect(block.endsWith("</task_context>")).toBe(true);
  });

  it("wraps several linked tasks with a plural label", () => {
    const block = buildLinkedTaskContextBlock([
      { task: makeTask() },
      { task: makeTask({ id: TaskId.make("task-2"), title: "Rotate staging tokens" }) },
    ]);
    expect(block.startsWith("<task_context>\nThis thread is linked to the following tasks:")).toBe(
      true,
    );
    expect(block).toContain("## Task: Fix login redirect");
    expect(block).toContain("## Task: Rotate staging tokens");
    expect(block.endsWith("</task_context>")).toBe(true);
  });

  it("appends threaded ClickUp comments when provided", () => {
    const markdown = formatTaskAsTurnContext(makeTask(), {
      comments: [
        makeComment({ id: "c-1", body: "Root comment" }),
        makeComment({ id: "c-2", parentId: "c-1", body: "A reply", authorName: "Bo" }),
      ],
    });
    expect(markdown).toContain(
      [
        "### Provider comments",
        "- **Ana** (2026-09-01): Root comment",
        "  - **Bo** (2026-09-01): A reply",
      ].join("\n"),
    );
  });

  it("renders the parent task and subtasks handed in as extras", () => {
    const markdown = formatTaskAsTurnContext(
      makeTask({ parentTaskId: TaskId.make("task-9"), parentTaskTitle: "Fix login bug" }),
      { subtasks: [makeTask({ id: TaskId.make("task-2"), title: "Repro on staging" })] },
    );
    expect(markdown).toContain("Parent task: Fix login bug");
    expect(markdown).toContain("### Subtasks\n- [In Progress] Repro on staging");
  });

  it("appends notes and omits the comments section without them", () => {
    const markdown = formatTaskAsTurnContext(makeTask({ notes: [makeNote({})] }));
    expect(markdown).toContain("### Notes\n- (2026-09-02): Repro is on staging.");
    expect(markdown).not.toContain("### Provider comments");
  });
});
