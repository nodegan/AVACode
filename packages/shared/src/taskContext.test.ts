import { TaskId, TaskNoteId, type Task, type TaskComment, type TaskNote } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { formatTaskContext } from "./taskContext.ts";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    provider: "clickup",
    title: "Fix login redirect",
    description: "Users land on the home screen after SSO.",
    statusLabel: "In Progress",
    statusCategory: "in_progress",
    statusColor: null,
    linkedThreadId: null,
    listId: null,
    listName: null,
    parentTaskId: null,
    parentTaskTitle: null,
    externalTaskId: "abc123",
    externalCustomId: null,
    externalUrl: null,
    assignees: [],
    syncedAt: null,
    externalUpdatedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    notes: [],
    ...overrides,
  } as Task;
}

const makeComment = (overrides: Partial<TaskComment>): TaskComment => ({
  id: "c-1",
  parentId: null,
  body: "Root",
  authorName: "Ana",
  authorAvatarUrl: null,
  authorColor: null,
  createdAt: "2026-09-01T10:00:00.000Z",
  resolved: false,
  ...overrides,
});

const makeNote = (body: string, id = "n-1"): TaskNote => ({
  id: TaskNoteId.make(id),
  taskId: TaskId.make("task-1"),
  body,
  createdAt: "2026-09-02T00:00:00.000Z",
  updatedAt: "2026-09-02T00:00:00.000Z",
});

describe("formatTaskContext", () => {
  it("renders the base block without comment or note sections when empty", () => {
    const markdown = formatTaskContext(makeTask());
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

  it("nests replies under their parent comment", () => {
    const markdown = formatTaskContext(makeTask(), {
      comments: [
        makeComment({ id: "c-1", body: "Root" }),
        makeComment({ id: "c-2", parentId: "c-1", body: "Reply", authorName: "Bo" }),
      ],
    });
    expect(markdown).toContain(
      [
        "### Provider comments",
        "- **Ana** (2026-09-01): Root",
        "  - **Bo** (2026-09-01): Reply",
      ].join("\n"),
    );
  });

  it("promotes replies whose parent was capped away and truncates long bodies", () => {
    const longBody = `${"x".repeat(600)}`;
    const markdown = formatTaskContext(makeTask(), {
      comments: [makeComment({ id: "c-1", body: longBody })],
    });
    expect(markdown).toContain("…");
    expect(markdown).not.toContain(longBody);

    const orphan = formatTaskContext(makeTask(), {
      comments: [makeComment({ id: "r-1", parentId: "missing", body: "Orphan" })],
    });
    expect(orphan).toContain("- **Ana** (2026-09-01): Orphan");
  });

  it("caps the history to the most recent entries", () => {
    const comments = Array.from({ length: 25 }, (_, index) =>
      makeComment({ id: `c-${index}`, body: `Comment ${index}` }),
    );
    const markdown = formatTaskContext(makeTask(), { comments: comments });
    expect(markdown).toContain("Comment 24");
    expect(markdown).not.toContain("Comment 4\n");
    expect(markdown.match(/^- \*\*/gm)?.length).toBe(20);
  });

  it("renders notes after comments", () => {
    const withNotes = formatTaskContext(
      makeTask({ notes: [makeNote("Repro is on staging."), makeNote("Second", "n-2")] }),
    );
    expect(withNotes).toContain("### Notes");
    expect(withNotes).toContain("- (2026-09-02): Repro is on staging.");
    expect(withNotes.match(/^- \(/gm)?.length).toBe(2);
  });

  it("names the parent task in the meta block", () => {
    const markdown = formatTaskContext(makeTask({ parentTaskTitle: "Release 1.0" }));
    expect(markdown).toContain("Parent task: Release 1.0");
  });

  it("renders subtasks with their statuses and caps the list", () => {
    const markdown = formatTaskContext(makeTask(), {
      subtasks: [
        makeTask({ id: TaskId.make("task-2"), title: "Repro on staging", statusCategory: "done" }),
        makeTask({ id: TaskId.make("task-3"), title: "Patch the redirect" }),
      ],
    });
    expect(markdown).toContain(
      ["### Subtasks", "- [Done] Repro on staging", "- [In progress] Patch the redirect"].join(
        "\n",
      ),
    );

    const many = Array.from({ length: 25 }, (_, index) =>
      makeTask({ id: TaskId.make(`task-${index}`), title: `Subtask ${index}` }),
    );
    const capped = formatTaskContext(makeTask(), { subtasks: many });
    expect(capped).toContain("Subtask 24");
    expect(capped).not.toContain("Subtask 4\n");
  });
});
