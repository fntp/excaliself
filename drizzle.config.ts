import { defineConfig } from "drizzle-kit"

// D1 is SQLite, so migrations are generated for SQLite. No credentials are
// needed here: `drizzle-kit generate` reads schema.ts and writes SQL, and
// `wrangler d1 migrations apply` is what runs it against a real database.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
})
