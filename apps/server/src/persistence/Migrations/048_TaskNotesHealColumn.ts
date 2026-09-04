import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * 047 was amended after it had already run somewhere: databases that recorded
 * it kept the old `comment_id` column while the code started selecting
 * `note_id`, breaking every task query. Heal the half-applied rename (no-op on
 * databases where 047 completed), and fail loudly rather than let the task
 * panel degrade silently again.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const columns = yield* sql<{ readonly name: string }>`
    SELECT name FROM pragma_table_info('task_notes')
  `;
  const names = new Set(columns.map((column) => column.name));

  if (names.has("note_id")) {
    return;
  }
  if (!names.has("comment_id")) {
    return yield* Effect.die(
      "task_notes has neither note_id nor comment_id; cannot heal migration 047",
    );
  }

  yield* sql`
    ALTER TABLE task_notes RENAME COLUMN comment_id TO note_id
  `;

  const healed = yield* sql<{ readonly name: string }>`
    SELECT name FROM pragma_table_info('task_notes')
  `;
  if (!healed.some((column) => column.name === "note_id")) {
    return yield* Effect.die(
      "task_notes.note_id is still missing after the heal rename; investigate manually",
    );
  }
});
