import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS project_task_sync_configs (
      project_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      workspace_name TEXT,
      list_ids_json TEXT NOT NULL,
      last_sync_at TEXT,
      last_sync_error TEXT
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS project_tasks (
      task_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status_label TEXT NOT NULL,
      status_category TEXT NOT NULL,
      linked_thread_id TEXT,
      external_task_id TEXT,
      external_url TEXT,
      synced_at TEXT,
      external_updated_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_project_tasks_external_identity
    ON project_tasks(project_id, source, external_task_id)
    WHERE external_task_id IS NOT NULL
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_project_tasks_project_updated
    ON project_tasks(project_id, updated_at DESC)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS project_task_comments (
      comment_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_project_task_comments_task_created
    ON project_task_comments(task_id, created_at ASC)
  `;
});
