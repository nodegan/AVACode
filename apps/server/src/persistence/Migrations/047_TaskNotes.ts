import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Local task comments are "notes" now — "comments" means ClickUp's comments.
 * Pure rename of the table and its index; no data changes.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE task_comments RENAME TO task_notes
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    ALTER TABLE task_notes RENAME COLUMN comment_id TO note_id
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`DROP INDEX IF EXISTS idx_task_comments_task_created`;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_task_notes_task_created
    ON task_notes(task_id, created_at ASC)
  `;
});
