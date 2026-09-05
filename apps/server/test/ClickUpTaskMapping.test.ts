import { describe, expect, it } from "vite-plus/test";

import {
  clickUpAssignees,
  clickUpFolderRef,
  clickUpListRef,
  normalizeClickUpToken,
  parseClickUpTimestamp,
  pickClickUpDescription,
  taskStatusCategory,
  type ClickUpTaskResponse,
} from "../src/tasks/providers/clickup.ts";

describe("clickUpFolderRef", () => {
  it("extracts the folder id and name", () => {
    expect(
      clickUpFolderRef({ folder: { id: "6992470", name: "Mobile Squad", hidden: false } }),
    ).toEqual({ externalFolderId: "6992470", externalFolderName: "Mobile Squad" });
  });

  it("treats hidden folders (folderless lists) as having no folder", () => {
    expect(
      clickUpFolderRef({ folder: { id: "7002367", name: "Engineering", hidden: true } }),
    ).toEqual({ externalFolderId: null, externalFolderName: null });
  });

  it("tolerates missing, empty, and unnamed folders", () => {
    expect(clickUpFolderRef({})).toEqual({ externalFolderId: null, externalFolderName: null });
    expect(clickUpFolderRef({ folder: null })).toEqual({
      externalFolderId: null,
      externalFolderName: null,
    });
    expect(clickUpFolderRef({ folder: { id: null, name: "" } })).toEqual({
      externalFolderId: null,
      externalFolderName: null,
    });
    expect(clickUpFolderRef({ folder: { id: "1", name: null } })).toEqual({
      externalFolderId: null,
      externalFolderName: null,
    });
  });
});

describe("normalizeClickUpToken", () => {
  it("strips a pasted Bearer prefix and whitespace", () => {
    expect(normalizeClickUpToken("Bearer pk_123_abc")).toBe("pk_123_abc");
    expect(normalizeClickUpToken("bearer   pk_123_abc  ")).toBe("pk_123_abc");
    expect(normalizeClickUpToken("  BEARER pk_123_abc")).toBe("pk_123_abc");
  });

  it("keeps plain personal tokens untouched", () => {
    expect(normalizeClickUpToken("pk_123_abc")).toBe("pk_123_abc");
    expect(normalizeClickUpToken("  pk_123_abc ")).toBe("pk_123_abc");
  });

  it("collapses a Bearer-only value to empty", () => {
    expect(normalizeClickUpToken("Bearer")).toBe("");
    expect(normalizeClickUpToken("   ")).toBe("");
  });
});

describe("taskStatusCategory", () => {
  it("maps done and closed status types", () => {
    expect(taskStatusCategory({ statusType: "done", statusLabel: "Complete" })).toBe("done");
    expect(taskStatusCategory({ statusType: "closed", statusLabel: "Closed" })).toBe("done");
  });

  it("maps in-progress even for custom status types", () => {
    expect(taskStatusCategory({ statusType: "custom", statusLabel: "in progress" })).toBe(
      "in_progress",
    );
    expect(taskStatusCategory({ statusType: "in progress", statusLabel: null })).toBe(
      "in_progress",
    );
  });

  it("maps blocked labels", () => {
    expect(taskStatusCategory({ statusType: "custom", statusLabel: "Blocked" })).toBe("blocked");
  });

  it("maps open statuses including todo labels", () => {
    expect(taskStatusCategory({ statusType: "open", statusLabel: "Open" })).toBe("open");
    expect(taskStatusCategory({ statusType: "custom", statusLabel: "To do" })).toBe("open");
  });

  it("falls back to unknown for unrecognized combos", () => {
    expect(taskStatusCategory({ statusType: "custom", statusLabel: "Weird" })).toBe("unknown");
    expect(taskStatusCategory({})).toBe("unknown");
  });
});

describe("parseClickUpTimestamp", () => {
  it("parses millisecond epoch strings", () => {
    const parsed = parseClickUpTimestamp("1567780450202");
    expect(parsed).not.toBeNull();
    expect(parsed).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("accepts numeric input", () => {
    expect(parseClickUpTimestamp(1567780450202)).not.toBeNull();
  });

  it("rejects absent, empty, zero, and non-numeric values instead of decoding 1970", () => {
    expect(parseClickUpTimestamp(null)).toBeNull();
    expect(parseClickUpTimestamp(undefined)).toBeNull();
    expect(parseClickUpTimestamp("")).toBeNull();
    expect(parseClickUpTimestamp("   ")).toBeNull();
    expect(parseClickUpTimestamp("0")).toBeNull();
    expect(parseClickUpTimestamp("-5")).toBeNull();
    expect(parseClickUpTimestamp("soon")).toBeNull();
  });
});

describe("pickClickUpDescription", () => {
  it("prefers the markdown description", () => {
    expect(
      pickClickUpDescription({
        markdown_description: "**markdown**",
        description: "<strong>html</strong>",
      }),
    ).toBe("**markdown**");
  });

  it("falls back to the HTML description", () => {
    expect(pickClickUpDescription({ description: "<strong>html</strong>" })).toBe(
      "<strong>html</strong>",
    );
  });

  it("returns an empty string when neither exists", () => {
    expect(pickClickUpDescription({})).toBe("");
    expect(pickClickUpDescription({ markdown_description: "  ", description: null })).toBe("");
  });
});

describe("clickUpAssignees", () => {
  it("collects unique usernames in sorted order", () => {
    expect(
      clickUpAssignees({
        assignees: [
          { id: 2, username: "Bo" },
          { id: 1, username: "Ana" },
          { id: 3, username: "Ana" },
        ],
      }),
    ).toEqual(["Ana", "Bo"]);
  });

  it("skips missing, blank, and null assignees", () => {
    expect(
      clickUpAssignees({
        assignees: [
          { id: 1, username: "  " },
          { username: null },
          null,
          { id: 2, username: "Ana" },
        ],
      }),
    ).toEqual(["Ana"]);
    expect(clickUpAssignees({})).toEqual([]);
    expect(clickUpAssignees({ assignees: [] })).toEqual([]);
  });
});

describe("clickUpListRef", () => {
  it("extracts the list id and name", () => {
    expect(clickUpListRef({ list: { id: "15505202", name: "Sprint Backlog" } })).toEqual({
      externalListId: "15505202",
      externalListName: "Sprint Backlog",
    });
  });

  it("stringifies numeric list ids", () => {
    expect(clickUpListRef({ list: { id: 123, name: "List" } })).toEqual({
      externalListId: "123",
      externalListName: "List",
    });
  });

  it("tolerates missing or empty list data", () => {
    expect(clickUpListRef({})).toEqual({ externalListId: null, externalListName: null });
    expect(clickUpListRef({ list: null })).toEqual({
      externalListId: null,
      externalListName: null,
    });
    expect(clickUpListRef({ list: { id: null, name: "" } })).toEqual({
      externalListId: null,
      externalListName: null,
    });
  });

  it("keeps a list name even when the id is missing", () => {
    const partial: ClickUpTaskResponse = { list: { id: null, name: "Orphan" } };
    expect(clickUpListRef(partial)).toEqual({
      externalListId: null,
      externalListName: "Orphan",
    });
  });
});
