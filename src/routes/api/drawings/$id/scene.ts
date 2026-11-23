// A drawing's scene as a file, for an AI client that was handed a link. The
// work lives in features/mcp/scene-handler so the /draw/<id> middleware can
// answer the same request without going through this route.

import { createFileRoute } from "@tanstack/react-router"
import { serveScene } from "@/features/mcp/scene-handler"

export const Route = createFileRoute("/api/drawings/$id/scene")({
  server: {
    handlers: {
      GET: ({ request, params }) => serveScene(request, params.id),
      HEAD: ({ request, params }) => serveScene(request, params.id),
    },
  },
})
