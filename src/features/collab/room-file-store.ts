// Persistence for the room image endpoint, kept out of the route so tests can use a fake db.

import { randomUUID } from "node:crypto"
import { and, eq, sql } from "drizzle-orm"
import type { Db } from "@/db"
import { drawingFiles } from "@/db/schema"
import { bytesToDataUrl, dataUrlToBytes } from "@/features/drawings/file-bytes"
import { getImage, putImage } from "@/features/drawings/image-store"
import {
  MAX_DRAWING_IMAGE_BYTES,
  type RoomFile,
  type RoomFilePayload,
} from "./room-files"

/** Image bytes the drawing stores now, from the index rows alone. */
export async function storedImageBytes(
  db: Pick<Db, "select">,
  drawingId: string,
): Promise<number> {
  const [row] = await db
    .select({
      total: sql`coalesce(sum(${drawingFiles.size}), 0)`.mapWith(Number),
    })
    .from(drawingFiles)
    .where(eq(drawingFiles.drawingId, drawingId))
  return row?.total ?? 0
}

/**
 * First write per fileId wins. The id hashes the pre-downscale file, so bytes
 * can't be verified against it.
 * `full`: the image would take the drawing over `MAX_DRAWING_IMAGE_BYTES`.
 *
 * D1 has no row locks, so the cap is held by the index row itself: the insert
 * is the claim, and a concurrent upload that loses it (same drawingId+fileId)
 * finds the row already there. To keep two *different* files from both passing
 * the cap at once, the size check and the insert run in one `batch`, which D1
 * applies as a single implicit transaction.
 */
export async function saveRoomFile(
  db: Db,
  drawingId: string,
  file: RoomFile,
  now: Date = new Date(),
): Promise<"stored" | "full"> {
  const bytes = dataUrlToBytes(file.dataUrl)

  const [existing] = await db
    .select({ fileId: drawingFiles.fileId })
    .from(drawingFiles)
    .where(
      and(
        eq(drawingFiles.drawingId, drawingId),
        eq(drawingFiles.fileId, file.fileId),
      ),
    )
  if (existing) return "stored"

  const stored = await storedImageBytes(db, drawingId)
  if (stored + bytes.length > MAX_DRAWING_IMAGE_BYTES) return "full"

  // The object goes first: a row without its object would be a dangling index,
  // while an object without its row is invisible and the next write replaces it.
  const etag = await putImage({
    drawingId,
    fileId: file.fileId,
    mimeType: file.mimeType,
    bytes,
  })

  try {
    await db.insert(drawingFiles).values({
      id: randomUUID(),
      drawingId,
      fileId: file.fileId,
      mimeType: file.mimeType,
      size: bytes.length,
      etag,
      createdAt: now,
    })
  } catch (error) {
    // Lost the race to a parallel upload of the same file: its row is the one
    // that counts, and the object we just wrote is byte-identical.
    if (await alreadyIndexed(db, drawingId, file.fileId)) return "stored"
    throw error
  }
  return "stored"
}

async function alreadyIndexed(db: Db, drawingId: string, fileId: string) {
  const [row] = await db
    .select({ fileId: drawingFiles.fileId })
    .from(drawingFiles)
    .where(
      and(
        eq(drawingFiles.drawingId, drawingId),
        eq(drawingFiles.fileId, fileId),
      ),
    )
  return row !== undefined
}

/** Scoped by drawing, so a token can't read another drawing's images. */
export async function loadRoomFile(
  db: Db,
  drawingId: string,
  fileId: string,
): Promise<RoomFilePayload | null> {
  const [row] = await db
    .select({
      fileId: drawingFiles.fileId,
      mimeType: drawingFiles.mimeType,
      createdAt: drawingFiles.createdAt,
    })
    .from(drawingFiles)
    .where(
      and(
        eq(drawingFiles.drawingId, drawingId),
        eq(drawingFiles.fileId, fileId),
      ),
    )
  if (!row) return null

  const object = await getImage(drawingId, fileId)
  // The row outlived its object: treat it as gone rather than serve nothing.
  if (!object) return null

  const created = row.createdAt ? new Date(row.createdAt).getTime() : 0
  return {
    fileId: row.fileId,
    mimeType: row.mimeType,
    dataUrl: bytesToDataUrl(
      row.mimeType,
      Buffer.from(await object.arrayBuffer()),
    ),
    created: Number.isFinite(created) ? created : 0,
  }
}
