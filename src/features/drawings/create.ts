// A new drawing, from the Create dialog or an MCP client. Kept out of
// server.ts so the MCP endpoint can share it.

import { randomUUID } from "node:crypto"
import { and, eq, isNull, sql } from "drizzle-orm"
import type { Db } from "@/db"
import { drawings, folders, type Space } from "@/db/schema"
import { accessibleTo } from "@/features/spaces/access"
import { sceneText } from "./search"

/**
 * Inside a folder the drawing takes the folder's space, and `space` is
 * ignored. A new drawing has no Room yet, so its first scene is written here
 * whatever its space.
 */
export async function insertDrawing(
  db: Db,
  userId: string,
  input: {
    name: string
    folderId: string | null
    space: Space
    elements: readonly Record<string, unknown>[]
  },
): Promise<{ id: string; space: Space }> {
  const id = randomUUID()
  const now = new Date()
  const scene = JSON.stringify({ elements: input.elements, appState: {} })
  const searchText = sceneText(input.elements)

  if (!input.folderId) {
    await db.insert(drawings).values({
      id,
      name: input.name,
      data: scene,
      searchText,
      folderId: null,
      space: input.space,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    })
    return { id, space: input.space }
  }

  const folderLive = and(
    eq(folders.id, input.folderId),
    accessibleTo(folders, userId),
    isNull(folders.deletedAt),
  )
  const [folder] = await db
    .select({ id: folders.id })
    .from(folders)
    .where(folderLive)
  if (!folder) throw new Error("Folder not found")

  // Like insertFolder: the space comes from the folder row inside the insert,
  // so a folder that leaves in the gap cannot strand the drawing in a space its
  // folder does not have.
  try {
    const inserted = await db
      .insert(drawings)
      .values({
        id,
        name: input.name,
        data: scene,
        searchText,
        folderId: input.folderId,
        space: sql<Space>`(select ${folders.space} from ${folders} where ${folderLive})`,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ space: drawings.space })
    return { id, space: inserted[0].space }
  } catch (error) {
    const [stillThere] = await db
      .select({ id: folders.id })
      .from(folders)
      .where(folderLive)
    if (!stillThere) throw new Error("Folder not found")
    throw error
  }
}
