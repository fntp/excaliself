import { eq, type SQL } from "drizzle-orm"
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core"
import { expect, test, vi } from "vitest"
import { bind, fakeImages } from "@/db/cloudflare-workers-stub"
import { createTestDb } from "@/db/test-db"
import {
  drawingFiles,
  drawings,
  type Space,
  shareRedirects,
  shares,
  users,
} from "@/db/schema"
import { accessibleTo } from "@/features/spaces/access"
import { expectCondition } from "@/features/spaces/expect-condition"
import {
  createShareLink,
  getShareLink,
  mintShareToken,
  regenerateShareLink,
  resolveShareByToken,
  resolveShareForRoom,
  resolveShareVisit,
  setShareLinkAudience,
  stopSharingDrawing,
} from "./store"

const HEX_256_BIT = /^[0-9a-f]{64}$/

/** The caller in the behavioural tests below. */
const USER = { id: "user-1", email: "u1@example.com", name: "U1" }

/**
 * A real database for the tests that check what a write does rather than what
 * SQL it builds: an audience rule enforced inside an insert only shows up
 * against a real engine.
 */
const liveDb = async () => createTestDb()

type Op =
  | { kind: "select"; table: unknown; where: SQL; lock?: string }
  | { kind: "insert"; table: unknown; values: Record<string, unknown> }
  | {
      kind: "update"
      table: unknown
      set: Record<string, unknown>
      where: SQL
    }
  | { kind: "delete"; table: unknown; where: SQL }
type Call = Op & { inTransaction: boolean }

// Renders a captured drizzle condition so tests can assert what the SQL
// actually matches (the crux of the owner-only guarantee).
const toSql = (where: SQL) => new SQLiteSyncDialect().sqlToQuery(where).sql

const SHARE_ROW = {
  token: "existing-token",
  audience: "members" as const,
  createdAt: new Date("2026-07-20"),
}

function fakeDb(options: {
  /** Rows the ownership select (from drawings) resolves to. */
  ownedDrawingIds?: string[]
  /** The space of those drawings. */
  space?: Space
  /** Rows any share select (from shares, joined) resolves to. */
  shareRows?: unknown[]
  /** Rows the drawing_files select resolves to. */
  fileRows?: unknown[]
  /** Rows the share_redirects select resolves to. */
  redirectRows?: unknown[]
  /** When false, updates match zero rows. */
  updateHits?: boolean
  /** When true, the insert hits the unique index and returns nothing. */
  insertConflicts?: boolean
}) {
  const calls: Call[] = []
  let inTransaction = false
  const record = (op: Op) => {
    const recorded: Call = { ...op, inTransaction }
    calls.push(recorded)
    return recorded
  }
  const db = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      inTransaction = true
      try {
        return await fn(db)
      } finally {
        inTransaction = false
      }
    },
    select: () => ({
      from: (table: unknown) => {
        const chain = {
          innerJoin: () => chain,
          where: (where: SQL) => {
            const call = record({ kind: "select", table, where })
            const rows =
              table === drawings
                ? (options.ownedDrawingIds ?? []).map(() => ({
                    space: options.space ?? "private",
                  }))
                : table === drawingFiles
                  ? (options.fileRows ?? [])
                  : table === shareRedirects
                    ? (options.redirectRows ?? [])
                    : (options.shareRows ?? [])
            return Object.assign(Promise.resolve(rows), {
              for: (lock: string) => {
                Object.assign(call, { lock })
                return Promise.resolve(rows)
              },
            })
          },
        }
        return chain
      },
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoNothing: () => ({
          returning: () => {
            record({ kind: "insert", table, values })
            if (options.insertConflicts) return Promise.resolve([])
            return Promise.resolve([
              {
                token: values.token,
                audience: values.audience,
                createdAt: values.createdAt,
              },
            ])
          },
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => ({
        where: (where: SQL) => ({
          returning: () => {
            record({ kind: "update", table, set, where })
            return Promise.resolve(
              options.updateHits === false ? [] : [{ ...SHARE_ROW, ...set }],
            )
          },
        }),
      }),
    }),
    delete: (table: unknown) => ({
      where: (where: SQL) => {
        record({ kind: "delete", table, where })
        return Promise.resolve()
      },
    }),
  }
  return { db: db as unknown as Parameters<typeof getShareLink>[0], calls }
}

test("mintShareToken is 256-bit hex and never repeats", () => {
  const a = mintShareToken()
  const b = mintShareToken()
  expect(a).toMatch(HEX_256_BIT)
  expect(b).toMatch(HEX_256_BIT)
  expect(a).not.toBe(b)
})

test("createShareLink checks access to a live drawing before inserting", async () => {
  const db = await liveDb()
  await db.insert(users).values(USER)
  await db.insert(drawings).values({
    id: "d1",
    name: "Mine",
    space: "private",
    createdBy: USER.id,
  })

  const share = await createShareLink(db, USER.id, "d1", "anyone")

  expect(share?.token).toMatch(HEX_256_BIT)
  expect(share?.audience).toBe("anyone")
  // The link is in the table, tied to the drawing it was made for.
  const [row] = await db.select().from(shares).where(eq(shares.drawingId, "d1"))
  expect(row.audience).toBe("anyone")
})

test("createShareLink throws not-found for a drawing the caller can't access, without touching shares", async () => {
  const { db, calls } = fakeDb({ ownedDrawingIds: [] })

  await expect(createShareLink(db, "user-2", "d1", "members")).rejects.toThrow(
    "Drawing not found",
  )
  expect(calls.map((call) => call.kind)).toEqual(["select"])
})

// Regression: a stale dialog's create upserted the audience, so a link could
// tighten to members while its live guests stayed connected.
test("createShareLink on an already-shared drawing returns the live link unchanged", async () => {
  const db = await liveDb()
  await db.insert(users).values(USER)
  await db.insert(drawings).values({
    id: "d1",
    name: "Mine",
    space: "private",
    createdBy: USER.id,
  })
  // A members link already exists — the dialog that would ask for "anyone" is
  // stale, and must not tighten or replace what is already shared.
  const existing = await createShareLink(db, USER.id, "d1", "members")

  const again = await createShareLink(db, USER.id, "d1", "anyone")

  expect(again?.token).toBe(existing?.token)
  expect(again?.audience).toBe("members")
  const rows = await db.select().from(shares)
  expect(rows).toHaveLength(1)
})

// A move to Team between the check and the write would leave a Team drawing
// with a members link. There is no row lock to hold the check, so the audience
// rule is part of the insert itself: this asserts that a drawing which became
// Team no longer takes a members link, even though the check passed first.
test("createShareLink refuses a members link on a Team drawing, without inserting", async () => {
  const db = await liveDb()
  await db.insert(users).values(USER)
  await db.insert(drawings).values({
    id: "d1",
    name: "Team drawing",
    space: "team",
    createdBy: USER.id,
  })

  await expect(createShareLink(db, USER.id, "d1", "members")).rejects.toThrow(
    "Team drawings take only guest links",
  )
  const rows = await db.select().from(shares)
  expect(rows).toEqual([])
})

test("createShareLink gives a Team drawing a guest link", async () => {
  const db = await liveDb()
  await db.insert(users).values(USER)
  await db.insert(drawings).values({
    id: "d1",
    name: "Team drawing",
    space: "team",
    createdBy: USER.id,
  })

  const share = await createShareLink(db, USER.id, "d1", "anyone")

  expect(share?.audience).toBe("anyone")
})

test("getShareLink scopes the read by the access rule", async () => {
  const { db, calls } = fakeDb({ shareRows: [SHARE_ROW] })

  const share = await getShareLink(db, "user-1", "d1")

  expect(share).toEqual(SHARE_ROW)
  const read = calls[0] as Extract<Call, { kind: "select" }>
  expectCondition(read.where, accessibleTo(drawings, "user-1"))
})

test("getShareLink returns null for an unshared drawing", async () => {
  const { db } = fakeDb({ shareRows: [] })
  await expect(getShareLink(db, "user-1", "d1")).resolves.toBeNull()
})

test("stopSharingDrawing deletes the share only after the ownership gate", async () => {
  const { db, calls } = fakeDb({ ownedDrawingIds: ["d1"] })

  await stopSharingDrawing(db, "user-1", "d1")

  expect(calls.map((call) => call.kind)).toEqual(["select", "delete"])
  const del = calls[1] as Extract<Call, { kind: "delete" }>
  expect(del.table).toBe(shares)
  expect(toSql(del.where)).toContain(`"shares"."drawingId" =`)
})

test("stopSharingDrawing refuses a non-owner before any delete", async () => {
  const { db, calls } = fakeDb({ ownedDrawingIds: [] })

  await expect(stopSharingDrawing(db, "user-2", "d1")).rejects.toThrow(
    "Drawing not found",
  )
  expect(calls.map((call) => call.kind)).toEqual(["select"])
})

test("regenerateShareLink mints a fresh token and keeps the audience", async () => {
  const { db, calls } = fakeDb({ ownedDrawingIds: ["d1"] })

  const share = await regenerateShareLink(db, "user-1", "d1")

  const update = calls[1] as Extract<Call, { kind: "update" }>
  expect(update.table).toBe(shares)
  expect(Object.keys(update.set)).toEqual(["token"])
  expect(update.set.token).toMatch(HEX_256_BIT)
  expect(update.set.token).not.toBe(SHARE_ROW.token)
  expect(share.audience).toBe(SHARE_ROW.audience)
})

test("regenerateShareLink on an unshared drawing throws", async () => {
  const { db } = fakeDb({ ownedDrawingIds: ["d1"], updateHits: false })
  await expect(regenerateShareLink(db, "user-1", "d1")).rejects.toThrow(
    "Share not found",
  )
})

test("setShareLinkAudience updates only the audience", async () => {
  const { db, calls } = fakeDb({ ownedDrawingIds: ["d1"] })

  const share = await setShareLinkAudience(db, "user-1", "d1", "anyone")

  const update = calls[1] as Extract<Call, { kind: "update" }>
  expect(update.set).toEqual({ audience: "anyone" })
  expect(share.audience).toBe("anyone")
  expect(share.token).toBe(SHARE_ROW.token)
})

test("setShareLinkAudience refuses members on a Team drawing, without updating", async () => {
  const { db, calls } = fakeDb({ ownedDrawingIds: ["d1"], space: "team" })

  await expect(
    setShareLinkAudience(db, "user-2", "d1", "members"),
  ).rejects.toThrow("Team drawings take only guest links")
  expect(calls.map((call) => call.kind)).toEqual(["select"])
})

// A drawing that moved to Team between the check and the update must not end up
// with a members link: the rule is in the update's own `where`.
test("setShareLinkAudience will not tighten a link on a drawing that became Team", async () => {
  const db = await liveDb()
  await db.insert(users).values(USER)
  await db.insert(drawings).values({
    id: "d1",
    name: "Mine",
    space: "private",
    createdBy: USER.id,
  })
  await createShareLink(db, USER.id, "d1", "anyone")
  // It moves to Team after the guest link exists.
  await db.update(drawings).set({ space: "team" }).where(eq(drawings.id, "d1"))

  await expect(
    setShareLinkAudience(db, USER.id, "d1", "members"),
  ).rejects.toThrow("Team drawings take only guest links")
  const [row] = await db.select().from(shares)
  expect(row.audience).toBe("anyone")
})

test("setShareLinkAudience on an unshared drawing throws", async () => {
  const { db } = fakeDb({ ownedDrawingIds: ["d1"], updateHits: false })
  await expect(
    setShareLinkAudience(db, "user-1", "d1", "anyone"),
  ).rejects.toThrow("Share not found")
})

test("resolveShareByToken looks up by token and returns null for unknown tokens", async () => {
  const { db, calls } = fakeDb({ shareRows: [] })

  await expect(resolveShareByToken(db, "no-such-token")).resolves.toBeNull()
  const read = calls[0] as Extract<Call, { kind: "select" }>
  expect(read.table).toBe(shares)
  expect(toSql(read.where)).toContain(`"shares"."token" =`)
})

// --- resolveShareVisit: what the /share/$token loader actually serves ----

const RESOLVED = {
  audience: "members" as const,
  drawing: {
    id: "d1",
    name: "Wireframe",
    data: "{}",
    deletedAt: null as Date | null,
  },
}

test("visit with an unknown token serves the bare dead arm and nothing else", async () => {
  const { db } = fakeDb({ shareRows: [] })

  await expect(
    resolveShareVisit(db, "no-such-token", async () => true),
  ).resolves.toEqual({ status: "dead" })
})

test("visit with a members link a move to Team dropped sends a signed-in member to the drawing", async () => {
  const { db, calls } = fakeDb({ redirectRows: [{ drawingId: "d1" }] })

  await expect(
    resolveShareVisit(db, "moved-token", async () => true),
  ).resolves.toEqual({ status: "moved", drawingId: "d1" })
  const read = calls[1] as Extract<Call, { kind: "select" }>
  expect(read.table).toBe(shareRedirects)
  expect(toSql(read.where)).toContain(`"share_redirects"."token" =`)
})

test("visit with a dropped members link and no session serves the bare dead arm", async () => {
  const { db } = fakeDb({ redirectRows: [{ drawingId: "d1" }] })

  await expect(
    resolveShareVisit(db, "moved-token", async () => false),
  ).resolves.toEqual({ status: "dead" })
})

test("visit to a trashed drawing serves the identical dead arm, session or not", async () => {
  const trashed = {
    ...RESOLVED,
    drawing: { ...RESOLVED.drawing, deletedAt: new Date("2026-07-01") },
  }
  const { db } = fakeDb({ shareRows: [trashed] })

  await expect(
    resolveShareVisit(db, "live-token", async () => true),
  ).resolves.toEqual({ status: "dead" })
})

test("members link without a session serves the sign-in arm with the name only", async () => {
  const { db } = fakeDb({ shareRows: [RESOLVED] })

  await expect(
    resolveShareVisit(db, "live-token", async () => false),
  ).resolves.toEqual({ status: "signin", drawingName: "Wireframe" })
})

test("members link with a session opens with the drawing and its files", async () => {
  // The bytes come from R2, so the test fills a fake bucket rather than a
  // `drawing_files` row: the row is only the index now.
  const images = fakeImages()
  const release = bind("IMAGES", images)
  try {
    await images.put("drawings/d1/f1", Buffer.from("ABCD"))
    const { db } = fakeDb({
      shareRows: [RESOLVED],
      fileRows: [{ fileId: "f1", mimeType: "image/png" }],
    })

    await expect(
      resolveShareVisit(db, "live-token", async () => true),
    ).resolves.toEqual({
      status: "ok",
      audience: "members",
      drawing: { id: "d1", name: "Wireframe", data: "{}" },
      files: [
        {
          fileId: "f1",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,QUJDRA==",
        },
      ],
    })
  } finally {
    release()
  }
})

test("anyone link opens without ever consulting the session", async () => {
  const hasSession = vi.fn()
  const { db } = fakeDb({
    shareRows: [{ ...RESOLVED, audience: "anyone" }],
  })

  const result = await resolveShareVisit(db, "live-token", hasSession)

  expect(result.status).toBe("ok")
  expect(hasSession).not.toHaveBeenCalled()
})

test("resolveShareForRoom reads by token and leaves the scene JSON on the server", async () => {
  const row = {
    audience: "anyone" as const,
    drawing: { id: "d1", deletedAt: null },
  }
  const { db, calls } = fakeDb({ shareRows: [row] })

  await expect(resolveShareForRoom(db, "live-token")).resolves.toEqual(row)
  const read = calls[0] as Extract<Call, { kind: "select" }>
  expect(read.table).toBe(shares)
  expect(toSql(read.where)).toContain(`"shares"."token" =`)
})

test("resolveShareForRoom returns null for an unknown token", async () => {
  const { db } = fakeDb({ shareRows: [] })
  await expect(resolveShareForRoom(db, "no-such-token")).resolves.toBeNull()
})
