import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Tasks were project-scoped; they are app-wide now. One ClickUp sync feeds
 * every project, so the store loses its project_id and the sync config
 * becomes a singleton row. Every statement is a no-op on rerun because a
 * failed attempt can leave earlier renames applied.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE project_tasks RENAME TO tasks
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    ALTER TABLE project_task_comments RENAME TO task_comments
  `.pipe(Effect.catch(() => Effect.void));

  // Indexes referencing project_id must go before the column can.
  yield* sql`DROP INDEX IF EXISTS idx_project_tasks_external_identity`;
  yield* sql`DROP INDEX IF EXISTS idx_project_tasks_project_updated`;
  yield* sql`DROP INDEX IF EXISTS idx_project_task_comments_task_created`;

  yield* sql`
    ALTER TABLE tasks DROP COLUMN project_id
  `.pipe(Effect.catch(() => Effect.void));

  // The same external task could be synced into several projects before
  // tasks went app-wide; the unique identity below would reject them. Keep
  // one row per (source, external identity) — preferring a linked thread,
  // then the newest — and fold the duplicates' local comments into it.
  yield* sql`DROP TABLE IF EXISTS temp.task_survivors`;
  yield* sql`
    CREATE TEMP TABLE task_survivors AS
    SELECT task_id FROM (
      SELECT
        task_id,
        ROW_NUMBER() OVER (
          PARTITION BY source, external_task_id
          ORDER BY (linked_thread_id IS NOT NULL) DESC, updated_at DESC, rowid DESC
        ) AS rn
      FROM tasks
      WHERE external_task_id IS NOT NULL
    )
    WHERE rn = 1
  `;

  yield* sql`
    UPDATE task_comments
    SET task_id = (
      SELECT survivor.task_id
      FROM tasks duplicate, tasks survivor
      WHERE duplicate.task_id = task_comments.task_id
        AND survivor.source = duplicate.source
        AND survivor.external_task_id = duplicate.external_task_id
        AND survivor.task_id IN (SELECT task_id FROM task_survivors)
      LIMIT 1
    )
    WHERE task_id IN (
      SELECT task_id FROM tasks
      WHERE external_task_id IS NOT NULL
        AND task_id NOT IN (SELECT task_id FROM task_survivors)
    )
  `;

  yield* sql`
    DELETE FROM tasks
    WHERE external_task_id IS NOT NULL
      AND task_id NOT IN (SELECT task_id FROM task_survivors)
  `;

  yield* sql`DROP TABLE IF EXISTS temp.task_survivors`;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_external_identity
    ON tasks(source, external_task_id)
    WHERE external_task_id IS NOT NULL
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_tasks_updated
    ON tasks(updated_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_task_comments_task_created
    ON task_comments(task_id, created_at ASC)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS task_sync_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      provider TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      workspace_name TEXT,
      list_ids_json TEXT NOT NULL DEFAULT '[]',
      last_sync_at TEXT,
      last_sync_error TEXT
    )
  `;

  // Carry over the first project's sync config; tasks are shared now.
  yield* sql`
    INSERT INTO task_sync_config (id, provider, workspace_id, workspace_name, list_ids_json, last_sync_at, last_sync_error)
    SELECT 1, provider, workspace_id, workspace_name, list_ids_json, last_sync_at, last_sync_error
    FROM project_task_sync_configs
    LIMIT 1
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    DROP TABLE IF EXISTS project_task_sync_configs
  `;
});
