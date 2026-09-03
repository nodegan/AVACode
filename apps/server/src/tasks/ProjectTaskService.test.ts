import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProjectId, ProjectTaskId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { FetchHttpClient } from "effect/unstable/http";

import * as ServerSecretStoreModule from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { ProjectTaskService } from "./ProjectTaskService.ts";
import { ProjectTaskServiceLive } from "./ProjectTaskService.ts";

const projectId = ProjectId.make("11111111-1111-4111-8111-111111111111");

const ConfigLayer = Layer.fresh(
  ServerConfig.layerTest(process.cwd(), { prefix: "t3code-tasks-test-" }),
);

const TestLayers = ProjectTaskServiceLive.pipe(
  Layer.provide(ServerSecretStoreModule.layer.pipe(Layer.provide(ConfigLayer))),
  Layer.provide(FetchHttpClient.layer),
  Layer.provideMerge(SqlitePersistenceMemory),
);

const seedClickUpTasks = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const count = 1000;
  for (let i = 0; i < count; i++) {
    const taskId = ProjectTaskId.make(`aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`);
    yield* sql`
      INSERT INTO project_tasks (
        task_id,
        project_id,
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
        synced_at,
        external_updated_at,
        created_at,
        updated_at
      )
      VALUES (
        ${taskId},
        ${projectId},
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
        ${null},
        ${null},
        ${"2026-09-03T00:00:00.000Z"},
        ${"2026-09-03T00:00:00.000Z"}
      )
    `;
  }
  return count;
});

it.layer(NodeServices.layer)("ProjectTaskService", (it) => {
  it.effect("getPanel returns every ClickUp task including large syncs", () =>
    Effect.gen(function* () {
      const tasks = yield* seedClickUpTasks;
      assert.strictEqual(tasks, 1000);

      const service = yield* ProjectTaskService;
      const panel = yield* service.getPanel(projectId);
      assert.strictEqual(panel.tasks.length, 1000);
      assert.ok(panel.tasks.some((task) => task.title === "Task 0"));
      assert.ok(panel.tasks.every((task) => task.externalListName === "Sprint Backlog"));
      assert.strictEqual(panel.clickup.syncConfig, null);
    }).pipe(Effect.provide(TestLayers)),
  );
});
