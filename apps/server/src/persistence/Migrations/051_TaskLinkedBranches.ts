import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Task-to-branch links: a JSON array of local branch names the user attached
 * to the task. Names match against any repository the task's project opens —
 * links are advisory context, not repo-scoped foreign keys.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE tasks
    ADD COLUMN linked_branches TEXT
  `.pipe(Effect.catch(() => Effect.void));
});
