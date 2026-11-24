// A database for tests: in-memory SQLite, the same dialect D1 runs.
//
// Three things matter here, and each is a trap the previous version fell into:
//
// 1. The tables come from `drizzle/0000_init.sql` — the same file
//    `wrangler d1 migrations apply` runs — not from a hand-written copy of
//    schema.ts. A hand-written copy drifts, and a test that passes against
//    drifted DDL proves nothing about production.
//
// 2. `begin` is refused, because D1 refuses it. drizzle's driver issues
//    `begin`/`commit` for `db.transaction`, so without this a leftover
//    transaction would pass every test and fail on the first real request.
//
// 3. `batch` is wired to a real callback and applied in one transaction on the
//    raw handle, which is the atomicity D1 gives a batch. Without the second
//    argument to `drizzle()`, every `db.batch(...)` throws.

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { drizzle } from "drizzle-orm/sqlite-proxy"
import type { Db } from "./index.ts"
import * as schema from "./schema.ts"

// Resolved from the working directory, not `import.meta.url`: under jsdom
// that URL is not a `file:` URL, so `fileURLToPath` throws before the first
// test runs. vitest runs from the project root, where the migration lives.
const INIT_SQL = readFileSync(
  resolve(process.cwd(), "drizzle/0000_init.sql"),
  "utf8",
)

type Method = "run" | "all" | "get" | "values"

/** The migration as statements, the way wrangler splits them. */
function statements(migration: string): string[] {
  return migration
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
}

/** The dialect refuses what D1 refuses, and says so plainly. */
function refuseBegin(sql: string): void {
  const verb = sql.trimStart().slice(0, 12).toLowerCase()
  if (verb.startsWith("begin")) {
    throw new Error(
      "D1 has no interactive transaction; `begin` is not available. " +
        "Use `db.batch([...])` for a multi-statement write.",
    )
  }
}

export function createTestDb(): Db {
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec("PRAGMA foreign_keys = ON")
  for (const statement of statements(INIT_SQL)) sqlite.exec(statement)

  const run = (sql: string, params: unknown[], method: Method) => {
    refuseBegin(sql)
    const prepared = sqlite.prepare(sql)
    if (method === "run") {
      const result = prepared.run(...(params as never[]))
      return {
        rows: [] as Record<string, unknown>[],
        meta: { changes: Number(result.changes), duration: 0 },
      }
    }
    const rows = prepared.all(...(params as never[])) as Record<
      string,
      unknown
    >[]
    return { rows }
  }

  const db = drizzle(
    async (sql, params, method) => {
      refuseBegin(sql)
      const prepared = sqlite.prepare(sql)
      if (method === "run") {
        const result = prepared.run(...(params as never[]))
        // `db.run()` callers read `meta.changes` to tell "wrote a row" from
        // "matched nothing", which is how D1 reports it too.
        return {
          rows: [],
          meta: { changes: Number(result.changes), duration: 0 },
        } as never
      }
      const rows = prepared.all(...(params as never[])) as Record<
        string,
        unknown
      >[]
      if (method === "get") {
        // A get returns one row as bare values, not a row object.
        return { rows: rows[0] ? Object.values(rows[0]) : [] }
      }
      return { rows: rows.map((row) => Object.values(row)) }
    },
    // A batch is one atomic round-trip in D1, so it is one transaction here.
    async (batch) => {
      sqlite.exec("BEGIN")
      try {
        const results = batch.map((item) => run(item.sql, item.params, item.method))
        sqlite.exec("COMMIT")
        return results
      } catch (error) {
        sqlite.exec("ROLLBACK")
        throw error
      }
    },
    { schema },
  )

  return db as unknown as Db
}
