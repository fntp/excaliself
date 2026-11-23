// Lets an AI client read a drawing from the link a person already has.
//
// The member copies /draw/<id> out of their address bar and pastes it into
// their AI with "look at this and keep drawing". A browser opening that URL
// wants the app; a model fetching it wants the scene. So the same URL answers
// both, chosen by Accept: a request that names Excalidraw's scene type gets the
// file, and everything else falls through to the page, unchanged.
//
// The scene route itself (`/api/drawings/<id>/scene`) stays the explicit,
// signable entry; this only saves the member from having to find it.

import { createMiddleware } from "@tanstack/react-start"
import { serveScene } from "@/features/mcp/scene-handler"
import { drawingIdInPath, wantsScene } from "@/features/mcp/scene-request"

export const sceneNegotiation = createMiddleware().server(
  async ({ request, next }) => {
    if (request.method !== "GET" && request.method !== "HEAD") return next()
    const url = new URL(request.url)
    const drawingId = drawingIdInPath(url.pathname)
    if (!drawingId || !wantsScene(request.headers.get("accept"))) return next()

    // The scene route decides who may read it; this only picks the shape.
    return serveScene(request, drawingId)
  },
)
