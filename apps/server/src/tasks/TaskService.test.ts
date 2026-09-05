import * as NodeServices from "@effect/platform-node/NodeServices";
import { TaskId, TaskPanel, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";

import * as ServerSecretStoreModule from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { mapClickUpAttachments, mapClickUpComments } from "./providers/clickup.ts";
import { TaskService } from "./TaskService.ts";
import { TaskServiceLive } from "./TaskService.ts";

const ConfigLayer = Layer.fresh(
  ServerConfig.layerTest(process.cwd(), { prefix: "t3code-tasks-test-" }),
);

/** Page 0 fills all 100 slots so pagination continues; page 1 ends with last_page. */
const clickUpPages = [
  {
    tasks: Array.from({ length: 100 }, (_, i) => ({
      id: `filler-${i}`,
      name: `Filler task ${i}`,
      status: { status: "to do", type: "open" },
      list: { id: "901501926053", name: "Sprint Backlog" },
      folder: { id: "folder-mobile-squad", name: "Mobile Squad", hidden: false },
    })),
    last_page: false,
  },
  {
    tasks: [
      {
        id: "9hz",
        name: "Fix login bug",
        markdown_description: "**bug**",
        url: "https://app.clickup.com/t/9hz",
        date_created: "1567700000000",
        date_updated: "1567780450202",
        status: { status: "in progress", type: "custom" },
        assignees: [{ id: 1, username: "Ana" }],
        list: { id: "901501926053", name: "Sprint Backlog" },
        folder: { id: "folder-mobile-squad", name: "Mobile Squad", hidden: false },
        space: { id: "7002367" },
      },
    ],
    last_page: true,
  },
];

/** Attachment payload served by Get Task for any single-task /task/:id request. */
const clickUpAttachments = [
  {
    id: "att-1",
    title: "screenshot.png",
    extension: "png",
    size: 2048,
    url: "https://attachments.clickup.com/screenshot.png",
    thumbnail_small: "https://attachments.clickup.com/screenshot-small.png",
    thumbnail_large: "https://attachments.clickup.com/screenshot-large.png",
    date: "1567780450202",
  },
  {
    id: "att-2",
    title: null,
    extension: "pdf",
    size: 102400,
    url: "https://attachments.clickup.com/spec.pdf",
    date: null,
  },
  { id: "  ", url: null, title: "orphan.png" },
];

/**
 * Comment payloads for the task-comments endpoint, keyed by the start_id page
 * cursor. ClickUp only lists top-level comments here; threads carry a
 * reply_count and serve their replies from a separate per-comment endpoint.
 */
const clickUpCommentPages: Record<string, unknown> = {
  "": {
    comments: [
      {
        id: "c-1",
        reply_count: 2,
        text_content: "Root comment",
        resolved: false,
        date: "1567700000000",
        user: {
          id: 7,
          username: "Ana",
          color: "#7b68ee",
          profilePicture: "https://avatars.clickup.com/ana.png",
        },
      },
      {
        id: "c-2",
        comment_text: "Second top-level comment",
        date: "1567780450202",
        user: { id: 8, username: null },
      },
    ],
    has_more: true,
  },
  "c-2": {
    comments: [
      {
        id: "c-3",
        text_content: "Third comment",
        date: "1567866850202",
        user: { username: "Bo" },
      },
      { id: "  ", text_content: "orphan" },
      { id: "c-4", text_content: null },
    ],
  },
};

/** Thread replies keyed by the parent comment id served by /comment/:id/reply. */
const clickUpCommentReplies: Record<string, unknown> = {
  "c-1": {
    comments: [
      {
        id: "r-1",
        text_content: "First reply",
        date: "1567740000000",
        user: { username: "Bo" },
      },
      {
        id: "r-2",
        text_content: "Second reply",
        resolved: true,
        date: "1567760000000",
        user: { username: "Ana" },
      },
    ],
  },
};

const ClickUpStubLayer = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) => {
    const urlOption = HttpClientRequest.toUrl(request);
    const url = urlOption._tag === "Some" ? urlOption.value.toString() : "";
    // The single-task URL ("…/task/<id>") is distinct from the list endpoint
    // ("…/team/<id>/task?page=…") by the trailing slash; comment replies ride
    // their own /comment/<id>/reply route.
    const pathname = new URL(url).pathname;
    const replyMatch = /\/comment\/([^/]+)\/reply$/.exec(pathname);
    const body: unknown = url.endsWith("/team")
      ? { teams: [{ id: "4679239", name: "Test Workspace" }] }
      : replyMatch
        ? (clickUpCommentReplies[replyMatch[1] ?? ""] ?? { comments: [] })
        : pathname.endsWith("/comment")
          ? (clickUpCommentPages[new URL(url).searchParams.get("start_id") ?? ""] ?? {
              comments: [],
            })
          : /\/task\/[^/?]+/.test(url)
            ? {
                id: "900000",
                name: "With files",
                status: { status: "to do", type: "open" },
                attachments: clickUpAttachments,
              }
            : (clickUpPages[pageForUrl(url)] ?? { tasks: [], last_page: true });
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json(body, { headers: { "content-type": "application/json" } }),
      ),
    );
  }),
);

function pageForUrl(url: string): number {
  if (!url.includes("/task")) return -1;
  return Number(new URL(url).searchParams.get("page") ?? "0");
}

const TestLayers = TaskServiceLive.pipe(
  Layer.provide(ServerSecretStoreModule.layer.pipe(Layer.provide(ConfigLayer))),
  Layer.provide(FetchHttpClient.layer),
  Layer.provideMerge(SqlitePersistenceMemory),
);

// Same stack with the real ClickUp HTTP client swapped for a stub.
const SyncTestLayers = TaskServiceLive.pipe(
  Layer.provide(ServerSecretStoreModule.layer.pipe(Layer.provide(ConfigLayer))),
  Layer.provide(ClickUpStubLayer),
  Layer.provideMerge(SqlitePersistenceMemory),
);

const CLICKUP = "clickup";

const describePanel = (panel: TaskPanel): string => JSON.stringify(panel);

interface SeedTask {
  readonly title: string;
  readonly listId?: string;
  readonly listName?: string;
  readonly folderId?: string;
  readonly folderName?: string;
  readonly statusCategory?: string;
  readonly assignees?: ReadonlyArray<string>;
  readonly customId?: string;
}

const assigneesJson = (assignees: ReadonlyArray<string>): string => JSON.stringify(assignees);

/**
 * Seeds a synced task plus the first-class list/folder rows it belongs to.
 * Registry row ids are the deterministic "provider:external" ids the sync
 * writes, so filter assertions can reference them directly.
 */
const seedTasks = Effect.fn("seedTasks")(function* (tasks: ReadonlyArray<SeedTask>) {
  const sql = yield* SqlClient.SqlClient;
  const seededListIds = new Set<string>();
  for (const [index, task] of tasks.entries()) {
    let listId: string | null = null;
    if (task.listId !== undefined) {
      listId = `${CLICKUP}:${task.listId}`;
      if (!seededListIds.has(listId)) {
        seededListIds.add(listId);
        const folderId = task.folderId ? `${CLICKUP}:${task.folderId}` : null;
        if (folderId && task.folderName) {
          yield* sql`
            INSERT INTO task_folders (folder_id, provider, external_folder_id, name, created_at, updated_at)
            VALUES (${folderId}, ${CLICKUP}, ${task.folderId}, ${task.folderName}, ${"2026-09-03T00:00:00.000Z"}, ${"2026-09-03T00:00:00.000Z"})
            ON CONFLICT (folder_id) DO NOTHING
          `;
        }
        yield* sql`
          INSERT INTO task_lists (list_id, provider, external_list_id, folder_id, name, created_at, updated_at)
          VALUES (${listId}, ${CLICKUP}, ${task.listId}, ${folderId}, ${task.listName ?? task.listId}, ${"2026-09-03T00:00:00.000Z"}, ${"2026-09-03T00:00:00.000Z"})
          ON CONFLICT (list_id) DO NOTHING
        `;
      }
    }
    const taskId = TaskId.make(`aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}`);
    yield* sql`
      INSERT INTO tasks (
        task_id,
        provider,
        title,
        description,
        status_label,
        status_category,
        linked_thread_id,
        list_id,
        external_task_id,
        external_custom_id,
        external_url,
        assignees_json,
        synced_at,
        external_updated_at,
        created_at,
        updated_at
      )
      VALUES (
        ${taskId},
        ${listId === null ? "manual" : CLICKUP},
        ${task.title},
        ${""},
        ${"To do"},
        ${task.statusCategory ?? "open"},
        ${null},
        ${listId},
        ${listId === null ? null : String(900000 + index)},
        ${task.customId ?? null},
        ${listId === null ? null : `https://app.clickup.com/t/${900000 + index}`},
        ${assigneesJson(task.assignees ?? [])},
        ${null},
        ${null},
        ${"2026-09-03T00:00:00.000Z"},
        ${"2026-09-03T00:00:00.000Z"}
      )
    `;
  }
  return tasks.length;
});

const seedManyClickUpTasks = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO task_lists (list_id, provider, external_list_id, folder_id, name, created_at, updated_at)
    VALUES (${`${CLICKUP}:901501926053`}, ${CLICKUP}, '901501926053', null, 'Sprint Backlog', ${"2026-09-03T00:00:00.000Z"}, ${"2026-09-03T00:00:00.000Z"})
    ON CONFLICT (list_id) DO NOTHING
  `;
  const count = 1000;
  for (let i = 0; i < count; i++) {
    const taskId = TaskId.make(`aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`);
    yield* sql`
      INSERT INTO tasks (
        task_id,
        provider,
        title,
        description,
        status_label,
        status_category,
        linked_thread_id,
        list_id,
        external_task_id,
        external_url,
        assignees_json,
        synced_at,
        external_updated_at,
        created_at,
        updated_at
      )
      VALUES (
        ${taskId},
        ${CLICKUP},
        ${`Task ${i}`},
        ${""},
        ${"To do"},
        ${"open"},
        ${null},
        ${`${CLICKUP}:901501926053`},
        ${String(900000 + i)},
        ${`https://app.clickup.com/t/${900000 + i}`},
        ${"[]"},
        ${null},
        ${null},
        ${"2026-09-03T00:00:00.000Z"},
        ${"2026-09-03T00:00:00.000Z"}
      )
    `;
  }
  return count;
});

it.layer(NodeServices.layer)("TaskService", (it) => {
  it.effect("getPanel returns providers and facets instead of the full task list", () =>
    Effect.gen(function* () {
      yield* seedTasks([
        {
          title: "A",
          listId: "list-a",
          listName: "Alpha",
          folderId: "folder-ava",
          folderName: "AVA",
          assignees: ["Ana"],
        },
        {
          title: "B",
          listId: "list-a",
          listName: "Alpha",
          folderId: "folder-ava",
          folderName: "AVA",
          statusCategory: "done",
        },
        {
          title: "C",
          listId: "list-b",
          listName: "Beta",
          folderId: "folder-ame",
          folderName: "AME",
          assignees: ["Bo"],
        },
        { title: "D" },
      ]);

      const service = yield* TaskService;
      const panel = yield* service.getPanel();
      assert.deepStrictEqual(
        panel.facets.lists.map(
          (list) =>
            `${list.id}:${list.provider}:${list.name}:${list.count}:${list.folderName ?? ""}`,
        ),
        ["clickup:list-a:clickup:Alpha:2:AVA", "clickup:list-b:clickup:Beta:1:AME"],
      );
      assert.deepStrictEqual(
        panel.facets.statuses.map((status) => `${status.value}:${status.count}`),
        ["open:3", "done:1"],
      );
      assert.deepStrictEqual(
        panel.facets.assignees.map((assignee) => `${assignee.value}:${assignee.count}`),
        ["Ana:1", "Bo:1"],
      );
      assert.deepStrictEqual(
        panel.providers.map(
          (provider) => `${provider.providerId}:${provider.credentialConfigured}`,
        ),
        ["clickup:false"],
      );
    }).pipe(Effect.provide(TestLayers)),
  );

  it.effect("queryTasks paginates large syncs", () =>
    Effect.gen(function* () {
      const seeded = yield* seedManyClickUpTasks;
      assert.strictEqual(seeded, 1000);

      const service = yield* TaskService;
      const result = yield* service.queryTasks({});
      assert.strictEqual(result.total, 1000);
      assert.strictEqual(result.tasks.length, 10);
      assert.strictEqual(result.page, 1);
      assert.ok(result.tasks.some((task) => task.title === "Task 0"));
      assert.ok(result.tasks.every((task) => task.listName === "Sprint Backlog"));
      assert.deepStrictEqual(result.tasks[0]?.assignees, []);

      const lastPage = yield* service.queryTasks({
        filter: { page: 20, pageSize: 50 },
      });
      assert.strictEqual(lastPage.total, 1000);
      assert.strictEqual(lastPage.tasks.length, 50);
      assert.strictEqual(lastPage.page, 20);

      const clamped = yield* service.queryTasks({
        filter: { page: 99, pageSize: 50 },
      });
      assert.strictEqual(clamped.page, 20);
      assert.strictEqual(clamped.tasks.length, 50);
    }).pipe(Effect.provide(TestLayers)),
  );

  it.effect("queryTasks filters by list, status, and assignee", () =>
    Effect.gen(function* () {
      yield* seedTasks([
        { title: "A", listId: "list-a", listName: "Alpha", assignees: ["Ana"] },
        { title: "B", listId: "list-a", listName: "Alpha", statusCategory: "done" },
        { title: "C", listId: "list-b", listName: "Beta", assignees: ["Bo"] },
        { title: "D" },
      ]);

      const service = yield* TaskService;

      const byList = yield* service.queryTasks({
        filter: { listIds: ["clickup:list-a"] },
      });
      assert.strictEqual(byList.total, 2);
      assert.ok(byList.tasks.every((task) => task.listId === "clickup:list-a"));

      const byStatus = yield* service.queryTasks({
        filter: { statuses: ["open"] },
      });
      assert.strictEqual(byStatus.total, 3);

      const byAssignee = yield* service.queryTasks({
        filter: { assignees: ["Ana"] },
      });
      assert.strictEqual(byAssignee.total, 1);
      assert.ok(byAssignee.tasks.every((task) => task.assignees.includes("Ana")));

      const combined = yield* service.queryTasks({
        filter: { listIds: ["clickup:list-a"], statuses: ["done"] },
      });
      assert.strictEqual(combined.total, 1);
      assert.ok(combined.tasks.every((task) => task.title === "B"));
    }).pipe(Effect.provide(TestLayers)),
  );

  it.effect("queryTasks searches by title and provider ids", () =>
    Effect.gen(function* () {
      yield* seedTasks([
        { title: "Fix login flake", listId: "list-a", listName: "Alpha" },
        { title: "Unrelated", listId: "list-a", listName: "Alpha", customId: "PR-1685" },
        { title: "Polish onboarding", listId: "list-b", listName: "Beta" },
        { title: "Manual chore for 900001" },
      ]);

      const service = yield* TaskService;

      const byTitle = yield* service.queryTasks({ filter: { query: "onboarding" } });
      assert.deepStrictEqual(
        byTitle.tasks.map((task) => task.title),
        ["Polish onboarding"],
      );

      // The human-facing ClickUp custom id matches case-insensitively.
      const byCustomId = yield* service.queryTasks({ filter: { query: "pr-1685" } });
      assert.strictEqual(byCustomId.total, 1);
      assert.ok(byCustomId.tasks.every((task) => task.externalCustomId === "PR-1685"));

      // A raw external id matches its synced task, and the same digits inside
      // a manual task's title still surface — the match is a union.
      const byExternalId = yield* service.queryTasks({ filter: { query: "900001" } });
      assert.deepStrictEqual(byExternalId.tasks.map((task) => task.title).sort(), [
        "Manual chore for 900001",
        "Unrelated",
      ]);

      // Blank or whitespace queries are not filters at all.
      const blank = yield* service.queryTasks({ filter: { query: "   " } });
      assert.strictEqual(blank.total, 4);

      // Search composes with the other filters.
      const scoped = yield* service.queryTasks({
        filter: { listIds: ["clickup:list-a"], query: "unrelated" },
      });
      assert.strictEqual(scoped.total, 1);
      assert.ok(scoped.tasks.every((task) => task.title === "Unrelated"));
    }).pipe(Effect.provide(TestLayers)),
  );

  it.effect("queryTasks filters by folder resolved through its lists", () =>
    Effect.gen(function* () {
      yield* seedTasks([
        {
          title: "A",
          listId: "list-a1",
          listName: "AVA Sprint",
          folderId: "folder-ava",
          folderName: "AVA",
        },
        {
          title: "B",
          listId: "list-a2",
          listName: "AVA Bugs",
          folderId: "folder-ava",
          folderName: "AVA",
        },
        {
          title: "C",
          listId: "list-b",
          listName: "AME",
          folderId: "folder-ame",
          folderName: "AME",
        },
        { title: "D" },
      ]);

      const service = yield* TaskService;

      const byFolder = yield* service.queryTasks({
        filter: { folderIds: ["clickup:folder-ava"] },
      });
      assert.strictEqual(byFolder.total, 2);
      assert.ok(byFolder.tasks.every((task) => task.listId !== "clickup:list-b"));

      const byBothFolders = yield* service.queryTasks({
        filter: { folderIds: ["clickup:folder-ava", "clickup:folder-ame"] },
      });
      assert.strictEqual(byBothFolders.total, 3);

      const folderOrList = yield* service.queryTasks({
        filter: { listIds: ["clickup:list-b"], folderIds: ["clickup:folder-ava"] },
      });
      assert.strictEqual(folderOrList.total, 3);
    }).pipe(Effect.provide(TestLayers)),
  );

  it.effect("queryTasks filters by linked thread and listLinks returns links", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const count = yield* seedTasks([{ title: "A" }, { title: "B" }, { title: "C" }]);
      const firstId = TaskId.make(`aaaaaaaa-aaaa-4aaa-8aaa-${"0".padStart(12, "0")}`);
      const secondId = TaskId.make(`aaaaaaaa-aaaa-4aaa-8aaa-${"1".padStart(12, "0")}`);
      const threadA = ThreadId.make("thread-a");
      const threadB = ThreadId.make("thread-b");
      yield* sql`UPDATE tasks SET linked_thread_id = ${threadA} WHERE task_id = ${firstId}`;
      yield* sql`UPDATE tasks SET linked_thread_id = ${threadA} WHERE task_id = ${secondId}`;
      assert.strictEqual(count, 3);

      const service = yield* TaskService;

      const byThread = yield* service.queryTasks({
        filter: { linkedThreadId: threadA },
      });
      assert.strictEqual(byThread.total, 2);
      assert.ok(byThread.tasks.every((task) => task.linkedThreadId === threadA));

      const byOtherThread = yield* service.queryTasks({
        filter: { linkedThreadId: threadB },
      });
      assert.strictEqual(byOtherThread.total, 0);

      const links = yield* service.listLinks();
      assert.strictEqual(links.links.length, 2);
      assert.ok(links.links.every((link) => link.threadId === threadA));
      assert.ok(links.links.every((link) => link.provider === "manual"));
    }).pipe(Effect.provide(TestLayers)),
  );

  it.effect("queryTasks filters by task ids regardless of list scope", () =>
    Effect.gen(function* () {
      yield* seedTasks([
        { title: "A", listId: "list-a", listName: "Alpha" },
        { title: "B", listId: "list-a", listName: "Alpha" },
        { title: "C", listId: "list-b", listName: "Beta" },
        { title: "D" },
      ]);

      const service = yield* TaskService;
      const secondId = TaskId.make(`aaaaaaaa-aaaa-4aaa-8aaa-${"1".padStart(12, "0")}`);
      const fourthId = TaskId.make(`aaaaaaaa-aaaa-4aaa-8aaa-${"3".padStart(12, "0")}`);

      const byIds = yield* service.queryTasks({
        filter: { taskIds: [secondId, fourthId] },
      });
      assert.strictEqual(byIds.total, 2);
      assert.deepStrictEqual(byIds.tasks.map((task) => task.title).sort(), ["B", "D"]);

      const unknownOnly = yield* service.queryTasks({
        filter: { taskIds: [TaskId.make("does-not-exist")] },
      });
      assert.strictEqual(unknownOnly.total, 0);
    }).pipe(Effect.provide(TestLayers)),
  );

  it.effect("manual tasks can join any list and unknown lists are rejected", () =>
    Effect.gen(function* () {
      yield* seedTasks([{ title: "Synced", listId: "list-a", listName: "Alpha" }]);

      const service = yield* TaskService;
      const created = yield* service.createManualTask({
        title: "Local follow-up",
        listId: "clickup:list-a",
      });
      assert.strictEqual(created.provider, "manual");
      assert.strictEqual(created.listId, "clickup:list-a");
      assert.strictEqual(created.listName, "Alpha");

      const unknown = yield* Effect.result(
        service.createManualTask({ title: "Lost", listId: "clickup:missing" }),
      );
      assert.strictEqual(unknown._tag, "Failure");
    }).pipe(Effect.provide(TestLayers)),
  );

  it.effect("createList registers a local list visible in facets", () =>
    Effect.gen(function* () {
      const service = yield* TaskService;
      const list = yield* service.createList({ name: "Personal" });
      assert.strictEqual(list.provider, "manual");
      assert.strictEqual(list.name, "Personal");

      const created = yield* service.createManualTask({
        title: "Just mine",
        listId: list.id,
      });
      assert.strictEqual(created.listId, list.id);
      assert.strictEqual(created.listName, "Personal");

      const panel = yield* service.getPanel();
      assert.deepStrictEqual(
        panel.facets.lists.map((facet) => `${facet.provider}:${facet.name}:${facet.count}`),
        [`manual:Personal:1`],
      );
    }).pipe(Effect.provide(TestLayers)),
  );

  it.effect("manual folders nest lists and surface in facets", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const service = yield* TaskService;

      const folder = yield* service.createFolder({ name: "Project X" });
      assert.strictEqual(folder.provider, "manual");
      assert.strictEqual(folder.externalFolderId, null);

      const nested = yield* service.createList({ name: "Sprint", folderId: folder.id });
      assert.strictEqual(nested.folderId, folder.id);

      const created = yield* service.createManualTask({
        title: "Nested task",
        listId: nested.id,
      });
      assert.strictEqual(created.listId, nested.id);
      assert.strictEqual(created.listName, "Sprint");

      const panel = yield* service.getPanel();
      assert.deepStrictEqual(
        panel.facets.folders.map((facet) => `${facet.provider}:${facet.name}:${facet.count}`),
        [`manual:Project X:1`],
      );
      assert.deepStrictEqual(
        panel.facets.lists.map((facet) => `${facet.name}:${facet.folderId}`),
        [`Sprint:${folder.id}`],
      );

      const unknownFolder = yield* Effect.result(
        service.createList({ name: "Lost", folderId: "nope" }),
      );
      assert.strictEqual(unknownFolder._tag, "Failure");

      // A manual list cannot nest under a provider's folder; those belong to
      // the provider's own sync.
      yield* sql`
        INSERT INTO task_folders (folder_id, provider, external_folder_id, name, created_at, updated_at)
        VALUES ('clickup:ext-folder', 'clickup', 'ext-folder', 'Provider Folder', '2026-01-01', '2026-01-01')
      `;
      const providerFolder = yield* Effect.result(
        service.createList({ name: "Mismatched", folderId: "clickup:ext-folder" }),
      );
      assert.strictEqual(providerFolder._tag, "Failure");
    }).pipe(Effect.provide(TestLayers)),
  );

  it.effect("deleteList takes the list's tasks and notes with it", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const service = yield* TaskService;
      const doomed = yield* service.createList({ name: "Doomed" });
      const keeper = yield* service.createList({ name: "Keeper" });
      const doomedTask = yield* service.createManualTask({ title: "Inside", listId: doomed.id });
      yield* service.addNote({ taskId: doomedTask.id, body: "note" });
      yield* service.createManualTask({ title: "Elsewhere", listId: keeper.id });

      yield* service.deleteList({ listId: doomed.id });

      const left = yield* service.queryTasks({});
      assert.deepStrictEqual(
        left.tasks.map((task) => task.title),
        ["Elsewhere"],
      );
      const notes =
        yield* sql`SELECT COUNT(*) AS "c" FROM task_notes WHERE task_id = ${doomedTask.id}`;
      assert.strictEqual(notes[0]?.c, 0);
      const listRows =
        yield* sql`SELECT COUNT(*) AS "c" FROM task_lists WHERE list_id = ${doomed.id}`;
      assert.strictEqual(listRows[0]?.c, 0);
    }).pipe(Effect.provide(TestLayers)),
  );

  it.effect("deleteFolder recursively removes nested lists, tasks, and notes", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const service = yield* TaskService;
      const folder = yield* service.createFolder({ name: "Project X" });
      const doomedList = yield* service.createList({ name: "Doomed", folderId: folder.id });
      const survivingList = yield* service.createList({ name: "Survivor" });
      const doomedTask = yield* service.createManualTask({
        title: "Doomed task",
        listId: doomedList.id,
      });
      yield* service.addNote({ taskId: doomedTask.id, body: "bye" });
      yield* service.createManualTask({ title: "Survivor task", listId: survivingList.id });

      yield* service.deleteFolder({ folderId: folder.id });

      const panel = yield* service.getPanel();
      assert.deepStrictEqual(panel.facets.folders, []);
      assert.deepStrictEqual(
        panel.facets.lists.map((facet) => facet.name),
        ["Survivor"],
      );
      const left = yield* service.queryTasks({});
      assert.deepStrictEqual(
        left.tasks.map((task) => task.title),
        ["Survivor task"],
      );
      const notes =
        yield* sql`SELECT COUNT(*) AS "c" FROM task_notes WHERE task_id = ${doomedTask.id}`;
      assert.strictEqual(notes[0]?.c, 0);
      const folderRows =
        yield* sql`SELECT COUNT(*) AS "c" FROM task_folders WHERE folder_id = ${folder.id}`;
      assert.strictEqual(folderRows[0]?.c, 0);
    }).pipe(Effect.provide(TestLayers)),
  );

  it.effect("provider-backed lists and folders refuse deletion", () =>
    Effect.gen(function* () {
      const service = yield* TaskService;
      yield* seedTasks([
        {
          title: "Synced",
          listId: "list-a",
          listName: "Alpha",
          folderId: "folder-a",
          folderName: "Folder A",
        },
      ]);

      const listDelete = yield* Effect.result(service.deleteList({ listId: `${CLICKUP}:list-a` }));
      assert.strictEqual(listDelete._tag, "Failure");
      const folderDelete = yield* Effect.result(
        service.deleteFolder({ folderId: `${CLICKUP}:folder-a` }),
      );
      assert.strictEqual(folderDelete._tag, "Failure");

      const panel = yield* service.getPanel();
      assert.deepStrictEqual(
        panel.facets.lists.map((facet) => facet.name),
        ["Alpha"],
      );
    }).pipe(Effect.provide(TestLayers)),
  );
});

it.live("getProviderStatus reports account, last sync, and last error", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const service = yield* TaskService;

    const bareStatus = yield* service.getProviderStatus({ providerId: CLICKUP });
    assert.deepStrictEqual(bareStatus, {
      credentialConfigured: false,
      accountLabel: null,
      lastSyncAt: null,
      lastSyncError: null,
    });

    yield* service.setProviderCredential({ providerId: CLICKUP, token: "pk_test_token" });
    // No config row yet: the account name falls back to the token's first workspace.
    const tokenOnlyStatus = yield* service.getProviderStatus({ providerId: CLICKUP });
    assert.strictEqual(tokenOnlyStatus.credentialConfigured, true);
    assert.strictEqual(tokenOnlyStatus.accountLabel, "Test Workspace");
    assert.strictEqual(tokenOnlyStatus.lastSyncAt, null);
    assert.strictEqual(tokenOnlyStatus.lastSyncError, null);

    const syncedAt = DateTime.formatIso(DateTime.makeUnsafe(1567700000000));
    yield* sql`
      INSERT INTO task_provider_configs (provider, config_json, last_sync_at, last_sync_error)
      VALUES ('clickup', '{"workspaceId":"4679239","workspaceName":"Persisted Workspace","listIds":[]}', ${syncedAt}, 'ClickUp exploded')
    `;
    const persistedStatus = yield* service.getProviderStatus({ providerId: CLICKUP });
    assert.strictEqual(persistedStatus.credentialConfigured, true);
    assert.strictEqual(persistedStatus.accountLabel, "Persisted Workspace");
    assert.strictEqual(persistedStatus.lastSyncAt, syncedAt);
    assert.strictEqual(persistedStatus.lastSyncError, "ClickUp exploded");
  }).pipe(Effect.provide(Layer.provideMerge(SyncTestLayers, NodeServices.layer))),
);

it.live("syncProviderTasks auto-bootstraps the config and syncs in the background", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const service = yield* TaskService;
    yield* service.setProviderCredential({ providerId: CLICKUP, token: "pk_test_token" });

    const panel: TaskPanel = yield* service.syncProviderTasks({ providerId: CLICKUP });
    assert.deepStrictEqual(
      panel.providers.map((provider) => provider.credentialConfigured),
      [true],
    );

    // The sync runs in a detached fiber; wait for its rows to land.
    let synced = false;
    for (let attempt = 0; attempt < 200 && !synced; attempt++) {
      const rows = yield* sql<{ readonly c: number }>`
          SELECT COUNT(*) AS "c"
          FROM tasks
          WHERE list_id = ${`${CLICKUP}:901501926053`}
        `;
      if ((rows[0]?.c ?? 0) >= 101) {
        synced = true;
        break;
      }
      yield* Effect.sleep({ milliseconds: 25 });
    }
    const panelForDebug = yield* service.getPanel();
    assert.ok(synced, `detached sync did not write rows in time: ${describePanel(panelForDebug)}`);

    const syncedPanel = yield* service.getPanel();
    const clickupState = syncedPanel.providers.find((provider) => provider.providerId === CLICKUP);
    assert.ok(clickupState?.lastSyncAt);
    assert.strictEqual(clickupState.lastSyncError, null);
    assert.strictEqual(clickupState.accountLabel, "Test Workspace");

    const byFolder = yield* service.queryTasks({
      filter: { folderIds: [`${CLICKUP}:folder-mobile-squad`], pageSize: 200 },
    });
    assert.strictEqual(byFolder.total, 101);
    assert.ok(byFolder.tasks.some((task) => task.title === "Fix login bug"));
    assert.ok(byFolder.tasks.some((task) => task.assignees.includes("Ana")));

    // The stored creation date is ClickUp's, not the sync time.
    const loginBug = byFolder.tasks.find((task) => task.title === "Fix login bug");
    assert.ok(loginBug);
    assert.strictEqual(loginBug.createdAt, DateTime.formatIso(DateTime.makeUnsafe(1567700000000)));
  }).pipe(Effect.provide(Layer.provideMerge(SyncTestLayers, NodeServices.layer))),
);

it.effect("mapClickUpAttachments normalizes the ClickUp attachment payload", () =>
  Effect.sync(() => {
    const attachments = mapClickUpAttachments([
      {
        id: "att-1",
        title: "screenshot.png",
        extension: "png",
        size: "2048",
        url: "https://attachments.clickup.com/screenshot.png",
        thumbnail_small: "https://attachments.clickup.com/screenshot-small.png",
        date: "1567780450202",
      },
      {
        id: "att-2",
        title: null,
        extension: null,
        size: null,
        url: "https://attachments.clickup.com/spec.pdf",
      },
      { id: " ", url: "https://attachments.clickup.com/orphan.png", title: "orphan.png" },
    ]);
    assert.strictEqual(attachments.length, 2);
    assert.deepStrictEqual(attachments[0], {
      id: "att-1",
      title: "screenshot.png",
      extension: "png",
      size: 2048,
      url: "https://attachments.clickup.com/screenshot.png",
      thumbnailUrl: "https://attachments.clickup.com/screenshot-small.png",
      createdAt: DateTime.formatIso(DateTime.makeUnsafe(1567780450202)),
    });
    // A missing title falls back to the URL's file name.
    assert.strictEqual(attachments[1]?.title, "spec.pdf");
    assert.strictEqual(attachments[1]?.thumbnailUrl, null);
    assert.strictEqual(attachments[1]?.size, null);
  }),
);

it.live("getTaskAttachments maps ClickUp attachments for a synced task", () =>
  Effect.gen(function* () {
    yield* seedTasks([
      { title: "With files", listId: "list-a", listName: "Alpha" },
      { title: "Manual" },
    ]);
    const service = yield* TaskService;
    const clickupId = TaskId.make("aaaaaaaa-aaaa-4aaa-8aaa-000000000000");
    const manualId = TaskId.make("aaaaaaaa-aaaa-4aaa-8aaa-000000000001");

    // Manual tasks never touch the network and answer empty.
    const manualEmpty = yield* service.getTaskAttachments(manualId);
    assert.deepStrictEqual(manualEmpty, { attachments: [] });

    // Without a credential there is nothing to ask either.
    const tokenless = yield* service.getTaskAttachments(clickupId);
    assert.deepStrictEqual(tokenless, { attachments: [] });

    yield* service.setProviderCredential({ providerId: CLICKUP, token: "pk_test_token" });
    const result = yield* service.getTaskAttachments(clickupId);
    assert.strictEqual(result.attachments.length, 2);
    const [image, file] = result.attachments;
    assert.strictEqual(image?.title, "screenshot.png");
    assert.strictEqual(image?.thumbnailUrl, "https://attachments.clickup.com/screenshot-large.png");
    assert.strictEqual(image?.size, 2048);
    assert.strictEqual(file?.title, "spec.pdf");
    assert.strictEqual(file?.thumbnailUrl, null);
    assert.strictEqual(file?.size, 102400);
  }).pipe(Effect.provide(Layer.provideMerge(SyncTestLayers, NodeServices.layer))),
);

it.effect("mapClickUpComments normalizes the ClickUp comment payload", () =>
  Effect.sync(() => {
    const comments = mapClickUpComments([
      {
        id: "c-9",
        parent: "0",
        comment_text: "Markup fallback",
        date: "1567780450202",
        user: { username: "  ", color: "not-a-color" },
      },
      {
        id: "c-10",
        parent: "c-9",
        text_content: "Reply",
        resolved: true,
        date: "1567866850202",
      },
      { id: " ", text_content: "orphan" },
      { id: "c-11", text_content: null },
    ]);
    assert.strictEqual(comments.length, 2);
    // A "0" parent means top-level; blank usernames and bad colors fall back.
    assert.strictEqual(comments[0]?.parentId, null);
    assert.strictEqual(comments[0]?.authorName, "ClickUp user");
    assert.strictEqual(comments[0]?.authorColor, null);
    assert.strictEqual(comments[0]?.body, "Markup fallback");
    assert.strictEqual(
      comments[0]?.createdAt,
      DateTime.formatIso(DateTime.makeUnsafe(1567780450202)),
    );
    // Replies keep their parent's comment id for threading.
    assert.strictEqual(comments[1]?.parentId, "c-9");
    assert.strictEqual(comments[1]?.resolved, true);
  }),
);

it.live("getTaskComments threads ClickUp comments for a synced task", () =>
  Effect.gen(function* () {
    yield* seedTasks([
      { title: "With discussion", listId: "list-a", listName: "Alpha" },
      { title: "Manual" },
    ]);
    const service = yield* TaskService;
    const clickupId = TaskId.make("aaaaaaaa-aaaa-4aaa-8aaa-000000000000");
    const manualId = TaskId.make("aaaaaaaa-aaaa-4aaa-8aaa-000000000001");

    // Manual tasks never touch the network and answer empty.
    const manualEmpty = yield* service.getTaskComments(manualId);
    assert.deepStrictEqual(manualEmpty, { comments: [] });

    // Without a credential there is nothing to ask either.
    const tokenless = yield* service.getTaskComments(clickupId);
    assert.deepStrictEqual(tokenless, { comments: [] });

    yield* service.setProviderCredential({ providerId: CLICKUP, token: "pk_test_token" });
    const result = yield* service.getTaskComments(clickupId);
    // Pages join (the cursor chains on start_id), the thread replies hang off
    // their parent's endpoint, and empty entries drop out.
    assert.deepStrictEqual(
      result.comments.map((comment) => `${comment.id}:${comment.parentId ?? "root"}`),
      ["c-1:root", "r-1:c-1", "r-2:c-1", "c-2:root", "c-3:root"],
    );
    const [root, firstReply, secondReply, secondTop, third] = result.comments;
    assert.ok(root && firstReply && secondReply && secondTop && third);
    assert.strictEqual(root.authorName, "Ana");
    assert.strictEqual(root?.authorColor, "#7B68EE");
    assert.strictEqual(root?.authorAvatarUrl, "https://avatars.clickup.com/ana.png");
    assert.strictEqual(firstReply.body, "First reply");
    assert.strictEqual(secondReply.resolved, true);
    // Replies sort between their parent and the later top-level comments.
    assert.ok(
      root.createdAt !== null &&
        firstReply.createdAt !== null &&
        secondReply.createdAt !== null &&
        secondTop.createdAt !== null &&
        third.createdAt !== null &&
        root.createdAt < firstReply.createdAt &&
        firstReply.createdAt < secondReply.createdAt &&
        secondReply.createdAt < secondTop.createdAt &&
        secondTop.createdAt < third.createdAt,
    );
  }).pipe(Effect.provide(Layer.provideMerge(SyncTestLayers, NodeServices.layer))),
);
