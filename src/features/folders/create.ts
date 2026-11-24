// A new folder, from the sidebar or an MCP client. Kept out of server.ts so
// the MCP endpoint can share it.

import { randomUUID } from "node:crypto"
import { and, eq, isNull, sql } from "drizzle-orm"
import type { Db } from "@/db"
import { folders, type Space } from "@/db/schema"
import { folderColumns } from "@/features/drawings/list-columns"
import { accessibleTo } from "@/features/spaces/access"

/** Inside a parent the folder takes the parent's space, and `space` is ignored. */
export async function insertFolder(
  db: Db,
  userId: string,
  input: { name: string; parentId: string | null; space: Space },
) {
  const now = new Date()
  const id = randomUUID()

  if (!input.parentId) {
    const [folder] = await db
      .insert(folders)
      .values({
        id,
        name: input.name,
        space: input.space,
        createdBy: userId,
        parentId: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning(folderColumns)
    return folder
  }

  const folderLive = and(
    eq(folders.id, input.parentId),
    accessibleTo(folders, userId),
    isNull(folders.deletedAt),
  )
  const [parent] = await db
    .select({ id: folders.id })
    .from(folders)
    .where(folderLive)
  if (!parent) throw new Error("Folder not found")

  // `space` is a subquery over the parent row, read by the insert itself: a
  // parent trashed or moved in the gap cannot leave the child in a space its
  // parent does not have. D1 has no transaction to hold that across statements.
  try {
    const [folder] = await db
      .insert(folders)
      .values({
        id,
        name: input.name,
        space: sql<Space>`(select ${folders.space} from ${folders} where ${folderLive})`,
        createdBy: userId,
        parentId: input.parentId,
        createdAt: now,
        updatedAt: now,
      })
      .returning(folderColumns)
    return folder
  } catch (error) {
    // The subquery came back empty, so the parent left between the check and
    // the write. Report that as missing rather than as a constraint failure;
    // any other error is a real one and keeps its message.
    const [stillThere] = await db
      .select({ id: folders.id })
      .from(folders)
      .where(folderLive)
    if (!stillThere) throw new Error("Folder not found")
    throw error
  }
}
