import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE project_tasks
    ADD COLUMN external_list_id TEXT
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    ALTER TABLE project_tasks
    ADD COLUMN external_list_name TEXT
  `.pipe(Effect.catch(() => Effect.void));
});
