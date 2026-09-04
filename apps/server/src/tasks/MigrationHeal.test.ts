import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../persistence/Migrations.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";

it.layer(NodeServices.layer)("048 TaskNotesHealColumn", (it) => {
  it.effect("heals a database where 047's column rename was skipped", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      // Reproduce the half-applied state: 047 recorded, but its column rename
      // never landed, so notes are still keyed by comment_id.
      yield* sql`ALTER TABLE task_notes RENAME COLUMN note_id TO comment_id`;
      yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id = 48`;
      yield* sql`
        INSERT INTO task_notes (comment_id, task_id, body, created_at, updated_at)
        VALUES ('n1', 't1', 'survives the heal', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
      `;

      yield* runMigrations();

      const columns = yield* sql<{ readonly name: string }>`
        SELECT name FROM pragma_table_info('task_notes')
      `;
      assert.deepStrictEqual(
        columns.map((column) => column.name),
        ["note_id", "task_id", "body", "created_at", "updated_at"],
      );
      const rows = yield* sql<{ readonly id: string; readonly body: string }>`
        SELECT note_id AS "id", body FROM task_notes
      `;
      assert.deepStrictEqual(rows, [{ id: "n1", body: "survives the heal" }]);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );
});
