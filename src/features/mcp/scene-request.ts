// Which requests want a drawing's scene rather than its page. Pure, so both
// the middleware and its test can use it without a database or an env.

import { parseDrawingTarget } from "./target"

/** Excalidraw's media type for a scene file, and the app's own short alias. */
const SCENE_TYPE = "application/vnd.excalidraw+json"

/**
 * True when the caller asked for the scene rather than a page. `application/json`
 * counts only when it is the whole Accept value: a browser's
 * "text/html,application/xhtml+xml,...,*\/*" must not be read as a request for
 * JSON, and an explicit "*\/*" alone is a curl, which gets the page.
 */
export function wantsScene(accept: string | null): boolean {
  if (!accept) return false
  const types = accept
    .split(",")
    .map((part) => part.split(";")[0]?.trim().toLowerCase())
    .filter(Boolean)
  return types.some(
    (type) =>
      type === SCENE_TYPE ||
      (type === "application/json" && types.length === 1),
  )
}

/** The drawing id in a /draw/<id> path, or null for anything else. */
export function drawingIdInPath(pathname: string): string | null {
  if (!pathname.startsWith("/draw/")) return null
  const target = parseDrawingTarget(pathname)
  return target?.kind === "drawing" ? target.id : null
}
