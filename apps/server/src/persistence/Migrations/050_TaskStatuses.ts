import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Task statuses become a first-class registry the settings section manages
 * (add, edit, delete). Manual tasks attach to a status by id and copy its
 * label/category/color for display. The built-in statuses get deterministic
 * ids so reruns after a partial attempt land on the same rows, and existing
 * manual tasks backfill onto the status their label/category matches.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS task_statuses (
      status_id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      category TEXT NOT NULL,
      color TEXT,
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    INSERT INTO task_statuses (status_id, label, category, color, sort_order, created_at, updated_at)
    SELECT 'status:todo', 'To do', 'open', NULL, 0, ts, ts
    FROM (SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS ts)
    WHERE NOT EXISTS (SELECT 1 FROM task_statuses WHERE status_id = 'status:todo')
  `;

  yield* sql`
    INSERT INTO task_statuses (status_id, label, category, color, sort_order, created_at, updated_at)
    SELECT 'status:in-progress', 'In progress', 'in_progress', NULL, 1, ts, ts
    FROM (SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS ts)
    WHERE NOT EXISTS (SELECT 1 FROM task_statuses WHERE status_id = 'status:in-progress')
  `;

  yield* sql`
    INSERT INTO task_statuses (status_id, label, category, color, sort_order, created_at, updated_at)
    SELECT 'status:blocked', 'Blocked', 'blocked', NULL, 2, ts, ts
    FROM (SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS ts)
    WHERE NOT EXISTS (SELECT 1 FROM task_statuses WHERE status_id = 'status:blocked')
  `;

  yield* sql`
    INSERT INTO task_statuses (status_id, label, category, color, sort_order, created_at, updated_at)
    SELECT 'status:done', 'Done', 'done', NULL, 3, ts, ts
    FROM (SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS ts)
    WHERE NOT EXISTS (SELECT 1 FROM task_statuses WHERE status_id = 'status:done')
  `;

  yield* sql`
    ALTER TABLE tasks ADD COLUMN status_id TEXT
  `.pipe(Effect.catch(() => Effect.void));

  // Manual tasks whose status fields match a registry row attach to it;
  // provider-synced tasks keep their provider-managed status fields.
  yield* sql`
    UPDATE tasks
    SET status_id = (
      SELECT task_statuses.status_id
      FROM task_statuses
      WHERE task_statuses.label = tasks.status_label
        AND task_statuses.category = tasks.status_category
      LIMIT 1
    )
    WHERE provider = 'manual'
      AND status_id IS NULL
      AND EXISTS (
        SELECT 1 FROM task_statuses
        WHERE task_statuses.label = tasks.status_label
          AND task_statuses.category = tasks.status_category
      )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status_id)
  `;
});
