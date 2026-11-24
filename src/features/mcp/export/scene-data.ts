// What an export needs besides the elements: the drawing's image files and
// the appState saved with its scene.

import { and, eq, inArray } from "drizzle-orm"
import type { Db } from "@/db"
import { drawingFiles } from "@/db/schema"
import { bytesToDataUrl } from "@/features/drawings/file-bytes"
import { readDrawingImages } from "@/features/drawings/image-store"

/** An image file, as Excalidraw's BinaryFiles hold it. */
export type SceneFile = {
  id: string
  mimeType: string
  dataURL: string
  created: number
}

/** The stored files of the scene's live image elements, by fileId. */
export async function loadImageFiles(
  db: Db,
  drawingId: string,
  elements: readonly Record<string, unknown>[],
): Promise<Map<string, SceneFile>> {
  const fileIds = [
    ...new Set(
      elements.flatMap((element) =>
        element.type === "image" &&
        !element.isDeleted &&
        typeof element.fileId === "string"
          ? [element.fileId]
          : [],
      ),
    ),
  ]
  if (fileIds.length === 0) return new Map()
  const rows = await db
    .select({
      fileId: drawingFiles.fileId,
      mimeType: drawingFiles.mimeType,
      createdAt: drawingFiles.createdAt,
    })
    .from(drawingFiles)
    .where(
      and(
        eq(drawingFiles.drawingId, drawingId),
        inArray(drawingFiles.fileId, fileIds),
      ),
    )
  if (rows.length === 0) return new Map()

  // Bytes come from R2; the rows only index them.
  const images = await readDrawingImages(
    drawingId,
    rows.map((row) => row.fileId),
  )
  return new Map(
    rows.flatMap(({ fileId, mimeType, createdAt }) => {
      const bytes = images.get(fileId)
      if (!bytes) return []
      return [
        [
          fileId,
          {
            id: fileId,
            mimeType,
            dataURL: bytesToDataUrl(mimeType, Buffer.from(bytes)),
            created: createdAt.getTime(),
          },
        ] as const,
      ]
    }),
  )
}

/** The appState saved with the scene; empty when there is none. */
export function storedAppState(data: string | null): Record<string, unknown> {
  try {
    const appState = JSON.parse(data ?? "")?.appState
    return typeof appState === "object" && appState !== null ? appState : {}
  } catch {
    return {}
  }
}

/** The canvas color saved with the scene; white when there is none. */
export function sceneBackgroundColor(data: string | null) {
  const color = storedAppState(data).viewBackgroundColor
  return typeof color === "string" && color ? color : "#ffffff"
}
