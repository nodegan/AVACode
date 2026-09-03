import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE project_task_sync_configs
    ADD COLUMN workspace_name TEXT
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    ALTER TABLE project_task_sync_configs
    ADD COLUMN last_sync_at TEXT
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    ALTER TABLE project_task_sync_configs
    ADD COLUMN last_sync_error TEXT
  `.pipe(Effect.catch(() => Effect.void));
});
