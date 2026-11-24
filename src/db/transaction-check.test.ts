// @vitest-environment node
import { sql } from "drizzle-orm"
import { expect, test } from "vitest"
import { createTestDb } from "./test-db"

// D1 has no interactive transaction: `begin` is rejected, and drizzle's D1
// driver issues one for `db.transaction`. This test pins the fact so a future
// edit can't quietly reintroduce the pattern.
test("an interactive transaction is not available on this database", async () => {
  const db = createTestDb()
  await expect(
    db.transaction(async (tx) => {
      await tx.run(sql`select 1`)
    }),
  ).rejects.toThrow()
})

test("a batch is atomic and is what multi-statement writes use", async () => {
  const db = createTestDb()
  await db.run(sql`create table t (id integer)`)
  await db.batch([
    db.run(sql`insert into t values (1)`),
    db.run(sql`insert into t values (2)`),
  ] as const)
  const rows = await db.all<{ id: number }>(sql`select id from t order by id`)
  expect(rows.map((row) => row.id)).toEqual([1, 2])
})
