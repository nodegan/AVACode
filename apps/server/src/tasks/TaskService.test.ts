import * as NodeServices from "@effect/platform-node/NodeServices";
import { TaskId, TaskPanel } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
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

const ClickUpStubLayer = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) => {
    const urlOption = HttpClientRequest.toUrl(request);
    const url = urlOption._tag === "Some" ? urlOption.value.toString() : "";
    const body: unknown = url.endsWith("/team")
      ? { teams: [{ id: "4679239", name: "Test Workspace" }] }
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

interface SeedTask {
  readonly title: string;
  readonly listId?: string;
  readonly listName?: string;
  readonly folderId?: string;
  readonly folderName?: string;
  readonly statusCategory?: string;
  readonly assignees?: ReadonlyArray<string>;
}

const assigneesJson = (assignees: ReadonlyArray<string>): string => JSON.stringify(assignees);

const describePanel = (panel: TaskPanel): string => JSON.stringify(panel);

const seedTasks = Effect.fn("seedTasks")(function* (tasks: ReadonlyArray<SeedTask>) {
  const sql = yield* SqlClient.SqlClient;
  for (const [index, task] of tasks.entries()) {
    const taskId = TaskId.make(`aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}`);
    yield* sql`
      INSERT INTO tasks (
        task_id,
        source,
        title,
        description,
        status_label,
        status_category,
        linked_thread_id,
        external_task_id,
        external_url,
        external_list_id,
        external_list_name,
        external_folder_id,
        external_folder_name,
        assignees_json,
        synced_at,
        external_updated_at,
        created_at,
        updated_at
      )
      VALUES (
        ${taskId},
        ${task.listId === undefined ? "manual" : "clickup"},
        ${task.title},
        ${""},
        ${"To do"},
        ${task.statusCategory ?? "open"},
        ${null},
        ${task.listId === undefined ? null : String(900000 + index)},
        ${task.listId === undefined ? null : `https://app.clickup.com/t/${900000 + index}`},
        ${task.listId ?? null},
        ${task.listName ?? null},
        ${task.folderId ?? null},
        ${task.folderName ?? null},
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
  const count = 1000;
  for (let i = 0; i < count; i++) {
    const taskId = TaskId.make(`aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`);
    yield* sql`
      INSERT INTO tasks (
        task_id,
        source,
        title,
        description,
        status_label,
        status_category,
        linked_thread_id,
        external_task_id,
        external_url,
        external_list_id,
        external_list_name,
        assignees_json,
        synced_at,
        external_updated_at,
        created_at,
        updated_at
      )
      VALUES (
        ${taskId},
        ${"clickup"},
        ${`Task ${i}`},
        ${""},
        ${"To do"},
        ${"open"},
        ${null},
        ${String(900000 + i)},
        ${`https://app.clickup.com/t/${900000 + i}`},
        ${"901501926053"},
        ${"Sprint Backlog"},
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
  it.effect("getPanel returns facets instead of the full task list", () =>
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
          (list) => `${list.id}:${list.name}:${list.count}:${list.folderName ?? ""}`,
        ),
        ["list-a:Alpha:2:AVA", "list-b:Beta:1:AME"],
      );
      assert.deepStrictEqual(
        panel.facets.statuses.map((status) => `${status.value}:${status.count}`),
        ["open:3", "done:1"],
      );
      assert.deepStrictEqual(
        panel.facets.assignees.map((assignee) => `${assignee.value}:${assignee.count}`),
        ["Ana:1", "Bo:1"],
      );
      assert.strictEqual(panel.clickup.syncConfig, null);
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
      assert.ok(result.tasks.every((task) => task.externalListName === "Sprint Backlog"));
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
        filter: { listIds: ["list-a"] },
      });
      assert.strictEqual(byList.total, 2);
      assert.ok(byList.tasks.every((task) => task.externalListId === "list-a"));

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
        filter: { listIds: ["list-a"], statuses: ["done"] },
      });
      assert.strictEqual(combined.total, 1);
      assert.ok(combined.tasks.every((task) => task.title === "B"));
    }).pipe(Effect.provide(TestLayers)),
  );

  it.effect("queryTasks filters by folder denormalized on tasks", () =>
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
        filter: { folderIds: ["folder-ava"] },
      });
      assert.strictEqual(byFolder.total, 2);
      assert.ok(byFolder.tasks.every((task) => task.externalListId !== "list-b"));

      const byBothFolders = yield* service.queryTasks({
        filter: { folderIds: ["folder-ava", "folder-ame"] },
      });
      assert.strictEqual(byBothFolders.total, 3);

      const folderOrList = yield* service.queryTasks({
        filter: { listIds: ["list-b"], folderIds: ["folder-ava"] },
      });
      assert.strictEqual(folderOrList.total, 3);
    }).pipe(Effect.provide(TestLayers)),
  );
});

it.live("syncClickUpTasks auto-bootstraps the workspace and syncs in the background", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const service = yield* TaskService;
    yield* service.setClickUpToken("pk_test_token");

    const panel = yield* service.syncClickUpTasks();
    assert.strictEqual(panel.clickup.tokenConfigured, true);

    // The sync runs in a detached fiber; wait for its rows to land.
    let synced = false;
    for (let attempt = 0; attempt < 200 && !synced; attempt++) {
      const rows = yield* sql<{ readonly c: number }>`
          SELECT COUNT(*) AS "c"
          FROM tasks
          WHERE external_folder_name = ${"Mobile Squad"}
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
    assert.ok(syncedPanel.clickup.lastSyncAt !== null);
    assert.strictEqual(syncedPanel.clickup.lastSyncError, null);
    assert.strictEqual(syncedPanel.clickup.syncConfig?.workspaceId, "4679239");
    assert.deepStrictEqual(syncedPanel.clickup.syncConfig?.listIds, []);
    const byFolder = yield* service.queryTasks({
      filter: { folderIds: ["folder-mobile-squad"], pageSize: 200 },
    });
    assert.strictEqual(byFolder.total, 101);
    assert.ok(byFolder.tasks.some((task) => task.title === "Fix login bug"));
    assert.ok(byFolder.tasks.some((task) => task.assignees.includes("Ana")));
  }).pipe(Effect.provide(Layer.provideMerge(SyncTestLayers, NodeServices.layer))),
);
