// A drawing's image bytes live in R2, not in the database: D1 caps a row at
// 2 MB and a database at 10 GB, and one whiteboard's images can outgrow both.
// The `drawing_files` row stays behind as the index — size and ETag, so a quota
// check or a listing never reads an object, and a delete knows what to remove.
//
// Every read and write of image bytes goes through here, so the key layout is
// stated once and a caller can't invent its own.

import { env as cfEnv } from "cloudflare:workers"

/** The object key for one image of one drawing. */
export function imageKey(drawingId: string, fileId: string): string {
  return `drawings/${drawingId}/${fileId}`
}

function bucket(): R2Bucket {
  const images = (cfEnv as { IMAGES?: R2Bucket }).IMAGES
  if (!images)
    throw new Error(
      "The IMAGES binding is missing. Check wrangler.toml's r2_buckets entry.",
    )
  return images
}

/** Writes an image and returns the ETag R2 assigned, or null if it skipped. */
export async function putImage(input: {
  drawingId: string
  fileId: string
  mimeType: string
  bytes: Uint8Array
}): Promise<string | null> {
  const object = await bucket().put(
    imageKey(input.drawingId, input.fileId),
    input.bytes,
    {
      httpMetadata: { contentType: input.mimeType },
      // One image per (drawing, fileId) by construction: the fileId hashes the
      // file's contents, so a second write of the same key is a no-op.
      onlyIf: { etagDoesNotMatch: "*" },
    },
  )
  return object?.etag ?? null
}

/** The image, or null when the object is gone (a truncated upload, a purge). */
export async function getImage(
  drawingId: string,
  fileId: string,
): Promise<R2ObjectBody | null> {
  return bucket().get(imageKey(drawingId, fileId))
}

/**
 * Copies one image to another drawing, server-side. R2 has no copy call on the
 * binding, so this reads and rewrites; a drawing's images are small and a
 * duplicate is rare, so the simplicity wins over streaming tricks.
 */
export async function copyImage(input: {
  from: { drawingId: string; fileId: string }
  to: { drawingId: string; fileId: string }
}): Promise<boolean> {
  const object = await getImage(input.from.drawingId, input.from.fileId)
  if (!object) return false
  await bucket().put(
    imageKey(input.to.drawingId, input.to.fileId),
    await object.arrayBuffer(),
    { httpMetadata: object.httpMetadata },
  )
  return true
}

/** Every image of a drawing as bytes, for an export or a duplicate. */
export async function readDrawingImages(
  drawingId: string,
  fileIds: readonly string[],
): Promise<Map<string, Uint8Array>> {
  const entries = await Promise.all(
    fileIds.map(async (fileId): Promise<[string, Uint8Array] | null> => {
      const object = await getImage(drawingId, fileId)
      if (!object) return null
      return [fileId, new Uint8Array(await object.arrayBuffer())]
    }),
  )
  const present = entries.filter(
    (entry): entry is [string, Uint8Array] => entry !== null,
  )
  return new Map(present)
}

export async function deleteImage(
  drawingId: string,
  fileId: string,
): Promise<void> {
  await bucket().delete(imageKey(drawingId, fileId))
}

/** Deletes every image of a drawing, for a drawing's hard delete or a purge. */
export async function deleteDrawingImages(drawingId: string): Promise<void> {
  // R2 lists by prefix in pages of 1000; a drawing with more images than that
  // still drains, because each page is deleted before the next is asked for.
  let cursor: string | undefined
  do {
    const page = await bucket().list({
      prefix: `drawings/${drawingId}/`,
      cursor,
    })
    if (page.objects.length > 0)
      await bucket().delete(page.objects.map((object) => object.key))
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
}
