import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Provider secondary tasks: the provider's external id for a task's parent
 * (ClickUp subtasks; Linear sub-issues later). The local parent task is
 * resolved by matching (provider, external id) at read time, so children
 * whose parents have not synced yet simply resolve later.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE tasks
    ADD COLUMN external_parent_task_id TEXT
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_tasks_external_parent
    ON tasks(provider, external_parent_task_id)
    WHERE external_parent_task_id IS NOT NULL
  `;
});
