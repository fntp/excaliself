import { env as cfEnv } from "cloudflare:workers"
import { drizzle } from "drizzle-orm/d1"
import * as schema from "./schema.ts"

// D1 is the only database now: no pool to keep, no migration to run at boot
// (wrangler applies migrations before the Worker ships), and one handle per
// isolate. `Db` stays the name every caller imports, so the driver change did
// not touch the 60 files that use it. `batch` is part of the type because D1
// has no interactive transaction: a multi-statement write goes through it.
export type Db = ReturnType<typeof createDb>

function binding(): D1Database {
  const d1 = (cfEnv as { DB?: D1Database }).DB
  if (!d1)
    throw new Error(
      "The DB binding is missing. Check wrangler.toml's d1_databases entry.",
    )
  return d1
}

function createDb() {
  return drizzle(binding(), { schema })
}

export const db: Db = createDb()
