// Turns a DrawingTarget into a drawing the caller may actually read. One place,
// so the MCP tools and the scene route agree on what a pasted link grants.

import { eq } from "drizzle-orm"
import type { Db } from "@/db"
import { drawings } from "@/db/schema"
import { verifySignature } from "@/features/shares/signed-link"
import { resolveShareByToken } from "@/features/shares/store"
import { canAccess } from "@/features/spaces/access"
import type { DrawingTarget } from "./target"

export type ResolvedTarget =
  | {
      status: "ok"
      drawingId: string
      /** How access was proven, which decides whether a Room's live edits count. */
      via: "member" | "share" | "signature"
    }
  /** No such drawing, or none the caller may see: one answer, so nothing leaks. */
  | { status: "denied" }
  | { status: "expired" }

/** The columns every resolution needs; the scene itself is the caller's job. */
const targetColumns = {
  id: drawings.id,
  space: drawings.space,
  createdBy: drawings.createdBy,
  deletedAt: drawings.deletedAt,
}

async function loadDrawing(db: Db, id: string) {
  const [row] = await db
    .select(targetColumns)
    .from(drawings)
    .where(eq(drawings.id, id))
  return row ?? null
}

/**
 * Resolves a target for a signed-in member: a bare id or /draw link must be a
 * drawing the member can access. A Share link opens what that link opens, under
 * the same audience rule the share page uses.
 */
export async function resolveTargetForMember(
  db: Db,
  target: DrawingTarget,
  userId: string,
): Promise<ResolvedTarget> {
  if (target.kind === "share") return resolveShareTarget(db, target.token)

  const drawing = await loadDrawing(db, target.id)
  if (!drawing || drawing.deletedAt !== null || !canAccess(drawing, userId))
    return { status: "denied" }
  return { status: "ok", drawingId: drawing.id, via: "member" }
}

/**
 * Resolves a target with no session: only a signed link proves access. Used by
 * the scene route when the request carries no cookie and no bearer token.
 */
export async function resolveTargetBySignature(
  db: Db,
  drawingId: string,
  signature: string,
  secret: string,
): Promise<ResolvedTarget> {
  const verdict = await verifySignature({ secret, drawingId, value: signature })
  if (verdict.status === "expired") return { status: "expired" }
  if (verdict.status !== "ok") return { status: "denied" }

  const drawing = await loadDrawing(db, drawingId)
  // A trashed drawing dies with its links, as a Share link does.
  if (!drawing || drawing.deletedAt !== null) return { status: "denied" }
  return { status: "ok", drawingId: drawing.id, via: "signature" }
}

/** A Share link, under the audience rule `resolveShareAccess` states. */
async function resolveShareTarget(
  db: Db,
  token: string,
): Promise<ResolvedTarget> {
  const share = await resolveShareByToken(db, token)
  if (!share || share.drawing.deletedAt !== null) return { status: "denied" }
  // An "anyone" link is a grant to a guest, so a member reading through it is
  // no wider than the guest they handed it to. A "members" link needs a session,
  // which an MCP caller proves by its token — the tool already checked access.
  return { status: "ok", drawingId: share.drawing.id, via: "share" }
}
