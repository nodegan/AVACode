import type { Task, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  appendTaskContextsToPrompt,
  buildTaskBranchName,
  buildTaskContextBlock,
  extractTrailingTaskContexts,
  formatTaskAsThreadContext,
  type TaskContextDraft,
} from "./taskContext";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    provider: "clickup",
    title: "Fix login redirect",
    description: "",
    statusLabel: "In Progress",
    statusCategory: "in_progress",
    statusColor: null,
    linkedThreadId: null,
    listId: "list-1",
    listName: "Sprint 42",
    externalTaskId: "abc123",
    externalCustomId: null,
    externalUrl: "https://app.clickup.com/t/abc123",
    assignees: [],
    syncedAt: null,
    externalUpdatedAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
    notes: [],
    ...overrides,
  } as Task;
}

describe("formatTaskAsThreadContext", () => {
  it("renders title, status, list, and source link", () => {
    const markdown = formatTaskAsThreadContext(makeTask());
    expect(markdown).toBe(
      [
        "## Task: Fix login redirect",
        "",
        "Status: In progress",
        "List: Sprint 42",
        "",
        "Source: https://app.clickup.com/t/abc123",
      ].join("\n"),
    );
  });

  it("includes description and assignees when present", () => {
    const markdown = formatTaskAsThreadContext(
      makeTask({
        description: "The redirect loop breaks on Safari.",
        assignees: ["Ada", "Grace"],
      }),
    );
    expect(markdown).toBe(
      [
        "## Task: Fix login redirect",
        "",
        "Status: In progress",
        "List: Sprint 42",
        "Assignees: Ada, Grace",
        "",
        "The redirect loop breaks on Safari.",
        "",
        "Source: https://app.clickup.com/t/abc123",
      ].join("\n"),
    );
  });

  it("falls back to the raw status label for unknown categories and omits empty sections", () => {
    const markdown = formatTaskAsThreadContext(
      makeTask({
        provider: "manual",
        statusCategory: "unknown",
        statusLabel: "Awaiting review",
        listName: null,
        externalUrl: null,
      }),
    );
    expect(markdown).toBe(
      ["## Task: Fix login redirect", "", "Status: Awaiting review"].join("\n"),
    );
  });
});

describe("task context block", () => {
  const draft = (markdown: string): TaskContextDraft => ({
    id: "ctx-1",
    taskId: "task-1",
    title: "Fix login redirect",
    markdown,
    threadId: "thread-1" as ThreadId,
    addedAt: "2026-09-03T00:00:00.000Z",
  });

  it("wraps task markdown in a trailing block and appends it to the prompt", () => {
    const block = buildTaskContextBlock([draft(formatTaskAsThreadContext(makeTask()))]);
    expect(block.startsWith("<task_context>\n## Task: Fix login redirect")).toBe(true);
    expect(block.endsWith("</task_context>")).toBe(true);

    const prompt = appendTaskContextsToPrompt("please fix", [draft("## Task: X")]);
    expect(prompt).toBe("please fix\n\n<task_context>\n## Task: X\n</task_context>");
  });

  it("extracts the trailing block back into task titles", () => {
    const prompt = appendTaskContextsToPrompt("please fix", [
      draft(formatTaskAsThreadContext(makeTask())),
    ]);
    const extracted = extractTrailingTaskContexts(prompt);
    expect(extracted.promptText).toBe("please fix");
    expect(extracted.contextCount).toBe(1);
    expect(extracted.tasks).toEqual([{ title: "Fix login redirect" }]);
  });

  it("leaves prompts without a trailing task block untouched", () => {
    const extracted = extractTrailingTaskContexts("just a message");
    expect(extracted).toEqual({ promptText: "just a message", contextCount: 0, tasks: [] });
  });
});

describe("buildTaskBranchName", () => {
  it("builds prefix/clickup-id/slug branch names", () => {
    expect(buildTaskBranchName(makeTask(), "feature")).toBe("feature/abc123/fix-login-redirect");
    expect(buildTaskBranchName(makeTask(), "bugfix")).toBe("bugfix/abc123/fix-login-redirect");
  });

  it("prefers the custom task id and preserves its casing", () => {
    expect(buildTaskBranchName(makeTask({ externalCustomId: "PR-1685" }), "feature")).toBe(
      "feature/PR-1685/fix-login-redirect",
    );
  });

  it("falls back to the task id when no ClickUp id exists and drops empty slugs", () => {
    const manual = makeTask({ provider: "manual", externalTaskId: null, externalCustomId: null });
    expect(buildTaskBranchName(manual, "hotfix")).toBe("hotfix/task-1/fix-login-redirect");
    expect(buildTaskBranchName(makeTask({ title: "???", externalCustomId: null }), "chore")).toBe(
      "chore/abc123",
    );
  });

  it("keeps git-unfriendly characters out of the branch name", () => {
    expect(
      buildTaskBranchName(makeTask({ title: "Fix: login/redirect?? ~50% done" }), "feature"),
    ).toBe("feature/abc123/fix-login-redirect-50-done");
  });
});
