import { createFileRoute } from "@tanstack/react-router"
import { sql } from "drizzle-orm"
import { db } from "@/db"

// Unauthenticated probe endpoint for uptime checks and container healthchecks.
// Healthy means the app is serving requests and D1 answers a round-trip.
export async function healthHandler(): Promise<Response> {
  try {
    await db.run(sql`SELECT 1`)
    return Response.json({ status: "ok" })
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 })
  }
}

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: healthHandler,
    },
  },
})
