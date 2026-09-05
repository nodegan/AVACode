import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Tasks go provider-agnostic: folders and lists become first-class entities
 * (task_folders, task_lists) instead of columns denormalized onto each task,
 * tasks point at their list, and the ClickUp-only sync singleton becomes one
 * row per provider with the provider's own config in JSON. Every statement is
 * a no-op on rerun because a failed attempt can leave earlier steps applied.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE tasks RENAME COLUMN source TO provider
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    CREATE TABLE IF NOT EXISTS task_folders (
      folder_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      external_folder_id TEXT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_task_folders_external
    ON task_folders(provider, external_folder_id)
    WHERE external_folder_id IS NOT NULL
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS task_lists (
      list_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      external_list_id TEXT,
      folder_id TEXT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_task_lists_external
    ON task_lists(provider, external_list_id)
    WHERE external_list_id IS NOT NULL
  `;

  // Provider-backed folders/lists get deterministic ids ("provider:external")
  // so the backfill and later syncs land on the same rows idempotently.
  yield* sql`
    INSERT INTO task_folders (folder_id, provider, external_folder_id, name, created_at, updated_at)
    SELECT
      provider || ':' || external_folder_id,
      provider,
      external_folder_id,
      MAX(external_folder_name),
      MIN(created_at),
      MAX(updated_at)
    FROM tasks
    WHERE external_folder_id IS NOT NULL
      AND external_folder_name IS NOT NULL
    GROUP BY provider, external_folder_id
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    INSERT INTO task_lists (list_id, provider, external_list_id, folder_id, name, created_at, updated_at)
    SELECT
      provider || ':' || external_list_id,
      provider,
      external_list_id,
      CASE
        WHEN MAX(external_folder_id) IS NOT NULL THEN provider || ':' || MAX(external_folder_id)
        ELSE NULL
      END,
      MAX(external_list_name),
      MIN(created_at),
      MAX(updated_at)
    FROM tasks
    WHERE external_list_id IS NOT NULL
    GROUP BY provider, external_list_id
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    ALTER TABLE tasks ADD COLUMN list_id TEXT
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    UPDATE tasks
    SET list_id = provider || ':' || external_list_id
    WHERE external_list_id IS NOT NULL
      AND list_id IS NULL
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_tasks_list
    ON tasks(list_id)
  `;

  // The denormalized list/folder columns are replaced by the registry tables.
  yield* sql`ALTER TABLE tasks DROP COLUMN external_list_id`.pipe(Effect.catch(() => Effect.void));
  yield* sql`ALTER TABLE tasks DROP COLUMN external_list_name`.pipe(
    Effect.catch(() => Effect.void),
  );
  yield* sql`ALTER TABLE tasks DROP COLUMN external_folder_id`.pipe(
    Effect.catch(() => Effect.void),
  );
  yield* sql`ALTER TABLE tasks DROP COLUMN external_folder_name`.pipe(
    Effect.catch(() => Effect.void),
  );

  yield* sql`
    CREATE TABLE IF NOT EXISTS task_provider_configs (
      provider TEXT PRIMARY KEY,
      config_json TEXT NOT NULL DEFAULT '{}',
      last_sync_at TEXT,
      last_sync_error TEXT
    )
  `;

  // Carry the ClickUp singleton over as the clickup provider's config.
  yield* sql`
    INSERT INTO task_provider_configs (provider, config_json, last_sync_at, last_sync_error)
    SELECT
      provider,
      json_object(
        'workspaceId', workspace_id,
        'workspaceName', workspace_name,
        'listIds', json(list_ids_json)
      ),
      last_sync_at,
      last_sync_error
    FROM task_sync_config
    LIMIT 1
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`DROP TABLE IF EXISTS task_sync_config`;
});
