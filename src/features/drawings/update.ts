// Renames a drawing or moves it to a folder, for the app and the MCP tools.
// Kept out of server.ts so the MCP endpoint can share it.

import { and, eq, isNull, sql } from "drizzle-orm"
import type { Db } from "@/db"
import { drawings, folders } from "@/db/schema"
import { accessibleTo } from "@/features/spaces/access"

/** `folderId: null` moves the drawing to the top of its space. */
export async function updateDrawingFields(
  db: Db,
  userId: string,
  id: string,
  fields: { name?: string; folderId?: string | null },
): Promise<void> {
  const moving = fields.folderId !== undefined && fields.folderId !== null
  const targetFolderId = fields.folderId ?? null

  // A move needs a folder that is live and the caller's. This is a separate
  // read so an illegal folder and a missing drawing stay distinct — the caller
  // learns "Folder not found", not "Drawing not found".
  let folderSpace = null
  if (moving && targetFolderId) {
    const [folder] = await db
      .select({ space: folders.space })
      .from(folders)
      .where(
        and(
          eq(folders.id, targetFolderId),
          accessibleTo(folders, userId),
          isNull(folders.deletedAt),
        ),
      )
    if (!folder) throw new Error("Folder not found")
    folderSpace = folder.space
  }

  // The move into `folderSpace` is re-checked in the write: the folder's space
  // is compared inside the `where`, so a drawing may only land in a folder of
  // its own space. Only the move-to-Team engine crosses spaces.
  //
  // Access to the drawing is enforced here too; zero rows means "not found" so
  // others can't tell a private drawing exists, and a trashed drawing takes no
  // edits.
  const updated = await db
    .update(drawings)
    .set({ ...fields, updatedAt: new Date() })
    .where(
      and(
        eq(drawings.id, id),
        accessibleTo(drawings, userId),
        isNull(drawings.deletedAt),
        folderSpace === null ? undefined : eq(drawings.space, folderSpace),
        // A move only completes if the folder is still live and still the
        // caller's, so a folder trashed in the gap cannot take the drawing.
        moving && targetFolderId
          ? sql`exists (select 1 from ${folders} where ${folders.id} = ${targetFolderId} and ${folders.deletedAt} is null and ${accessibleTo(folders, userId)})`
          : undefined,
      ),
    )
    .returning({ id: drawings.id })

  if (updated.length === 0) throw new Error("Drawing not found")
}
