import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * ClickUp workspaces with custom task IDs report a human-friendly identifier
 * (e.g. `PR-1685`) alongside the internal task id. The column stores it
 * (nullable: manual tasks and workspaces without custom IDs have none) so
 * branch names and UI can reference the ID people actually see.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE tasks
    ADD COLUMN external_custom_id TEXT
  `.pipe(Effect.catch(() => Effect.void));
});
