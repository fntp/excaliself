// @vitest-environment node
import { eq, sql } from "drizzle-orm"
import { expect, test } from "vitest"
import { users } from "./schema"
import { createTestDb } from "./test-db"

// D1 has no interactive transaction: `begin` is rejected, and drizzle's D1
// driver issues one for `db.transaction`. This pins the fact so a future edit
// can't quietly reintroduce a pattern that works in tests and fails in prod.
test("an interactive transaction is not available on this database", async () => {
  const db = createTestDb()
  await expect(
    db.transaction(async (tx) => {
      await tx.run(sql`select 1`)
    }),
  ).rejects.toThrow()
})

const row = (id: string) => ({
  id,
  email: `${id}@example.com`,
  name: id,
  createdAt: new Date(0),
  updatedAt: new Date(0),
})

test("a batch commits every statement", async () => {
  const db = createTestDb()
  await db.batch([
    db.insert(users).values(row("u1")),
    db.insert(users).values(row("u2")),
  ] as const)

  const found = await db
    .select({ id: users.id })
    .from(users)
    .orderBy(users.id)
  expect(found.map((user) => user.id)).toEqual(["u1", "u2"])
})

// The property every multi-statement write in the app relies on: if one
// statement in a batch fails, none of them land.
test("a batch rolls back as a whole when one statement fails", async () => {
  const db = createTestDb()
  await db.insert(users).values(row("u1"))

  await expect(
    db.batch([
      db.insert(users).values(row("u2")),
      // Same primary key: the batch has to fail here.
      db.insert(users).values(row("u1")),
    ] as const),
  ).rejects.toThrow()

  const found = await db.select({ id: users.id }).from(users).where(eq(users.id, "u2"))
  expect(found).toEqual([])
})
