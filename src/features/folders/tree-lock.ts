import type { Db } from "@/db"

/**
 * A transaction handle. Kept as a name so callers that only pass a handle keep
 * reading clearly; D1 has no interactive transaction, so what is actually
 * passed is the plain database and every guard is a conditional write.
 */
export type Tx = Pick<Db, "select" | "insert" | "update" | "delete">

/**
 * Once serialized every folder-tree change so cycle checks and subtree
 * placements could not interleave. Postgres did that with an advisory lock, and
 * SQLite has no equivalent — but it also does not need one the same way: a
 * single statement is atomic, and the checks that guard a multi-row change run
 * as part of that statement's `where` rather than before it.
 *
 * So this is now a no-op that keeps the call sites honest about *when* a check
 * must hold. Callers still invoke it before the reads they depend on; the
 * ordering is what the code documents, and the conditional writes make it true.
 */
export function lockFolderTree(_tx: Tx, _mode: "change" | "place"): void {
  // Intentionally empty. See the note above.
}
