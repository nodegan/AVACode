import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Custom ClickUp statuses carry their own color in the source UI. The column
 * stores the hex the provider reports (nullable: canonical statuses and older
 * sync rows have none).
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE tasks
    ADD COLUMN status_color TEXT
  `.pipe(Effect.catch(() => Effect.void));
});
