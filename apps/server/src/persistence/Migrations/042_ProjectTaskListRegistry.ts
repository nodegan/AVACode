import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS project_task_lists (
      project_id TEXT NOT NULL,
      external_list_id TEXT NOT NULL,
      external_list_name TEXT NOT NULL,
      external_space_name TEXT,
      external_folder_id TEXT,
      external_folder_name TEXT,
      PRIMARY KEY (project_id, external_list_id)
    )
  `;
});
