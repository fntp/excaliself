// A drawing as a file, for an AI client that was handed a link.
//
// A person pastes "look at this and keep drawing" into their AI, and the AI
// fetches this. It answers with the same .excalidraw JSON that "Save to file"
// writes, images included, so the model sees what the drawing is rather than a
// screenshot it would have to guess at.
//
// Three ways in, one rule: the caller must be able to see this drawing.
//   - a signed link (`?t=`), which proves one drawing and nothing else;
//   - an access token or OAuth token (`Authorization: Bearer`), as MCP uses;
//   - a session cookie, so the app's own link works while signed in.
// A trashed drawing answers 404 on every path, as its Share link dies with it.

import { eq } from "drizzle-orm"
import { db } from "@/db"
import { drawings } from "@/db/schema"
import { env } from "@/env"
import { memberForToken } from "@/features/access-tokens/tokens"
import { rooms } from "@/features/collab/room-registry"
import { roomElements } from "@/features/collab/room-session"
import { parseSceneElements } from "@/features/drawings/search"
import { originOf } from "@/features/oauth/endpoints"
import { memberForOAuthToken } from "@/features/oauth/grants"
import { canAccess } from "@/features/spaces/access"
import { auth } from "@/lib/auth"
import { loadImageFiles, storedAppState } from "./export/scene-data"
import { toExcalidrawFile } from "./export/scene-file"
import { resolveTargetBySignature } from "./target-resolve"

/** Excalidraw's own media type for a scene file. */
const SCENE_TYPE = "application/vnd.excalidraw+json"

/** A body larger than this helps no model, and would time the request out. */
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024

type Access =
  | { ok: true; via: "member" | "signature" }
  | { ok: false; status: 401 | 403 | 404; message: string }

const notFound = () =>
  Response.json(
    { error: "not_found", message: "No drawing at this link." },
    { status: 404 },
  )

const denied = (status: 401 | 403, message: string) =>
  Response.json({ error: "forbidden", message }, { status })

/** The drawing's access columns, or null when it is gone or trashed. */
async function liveDrawing(drawingId: string) {
  const [drawing] = await db
    .select({
      space: drawings.space,
      createdBy: drawings.createdBy,
      deletedAt: drawings.deletedAt,
    })
    .from(drawings)
    .where(eq(drawings.id, drawingId))
  return drawing && drawing.deletedAt === null ? drawing : null
}

/** Who is asking, and may they see this drawing. */
async function authorize(request: Request, drawingId: string): Promise<Access> {
  const url = new URL(request.url)
  const signature = url.searchParams.get("t")
  // A signed link needs no session and no token: it is its own grant.
  if (signature) {
    const resolved = await resolveTargetBySignature(
      db,
      drawingId,
      signature,
      env.BETTER_AUTH_SECRET,
    )
    if (resolved.status === "ok") return { ok: true, via: "signature" }
    return resolved.status === "expired"
      ? {
          ok: false,
          status: 403,
          message: "This link has expired. Ask for a fresh one.",
        }
      : {
          ok: false,
          status: 403,
          message: "This link does not open that drawing.",
        }
  }

  // A bearer token, as an MCP client sends.
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (token) {
    const member =
      (await memberForToken(db, token)) ??
      (await memberForOAuthToken(db, token))
    if (!member)
      return { ok: false, status: 401, message: "That token is not valid." }
    const drawing = await liveDrawing(drawingId)
    if (!drawing)
      return { ok: false, status: 404, message: "No drawing at this link." }
    if (!canAccess(drawing, member.id))
      return {
        ok: false,
        status: 403,
        message: "This token's member cannot see that drawing.",
      }
    return { ok: true, via: "member" }
  }

  // A session cookie, so the app's own link works while signed in.
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session)
    return {
      ok: false,
      status: 401,
      message:
        "Sign in, open a signed link, or send a token as Authorization: Bearer.",
    }
  const drawing = await liveDrawing(drawingId)
  if (!drawing)
    return { ok: false, status: 404, message: "No drawing at this link." }
  if (!canAccess(drawing, session.user.id))
    return { ok: false, status: 403, message: "You cannot see that drawing." }
  return { ok: true, via: "member" }
}

/** The .excalidraw file of one drawing, if the caller may read it. */
export async function serveScene(
  request: Request,
  drawingId: string,
): Promise<Response> {
  const access = await authorize(request, drawingId)
  if (!access.ok)
    return access.status === 404
      ? notFound()
      : denied(access.status, access.message)

  const [drawing] = await db
    .select({ name: drawings.name, data: drawings.data })
    .from(drawings)
    .where(eq(drawings.id, drawingId))
  if (!drawing) return notFound()

  // A live Room holds newer edits than the stored scene; read those when the
  // caller is a member. A signed link may belong to a guest, who has no Room
  // seat, so it reads what was last written.
  const live =
    access.via === "member" ? await roomElements(rooms, drawingId) : null
  const elements = live ?? parseSceneElements(drawing.data)
  if (!elements)
    return Response.json(
      {
        error: "unreadable",
        message: "This drawing's data is damaged and cannot be read.",
      },
      { status: 422 },
    )

  const origin = originOf(request)
  const appState = storedAppState(drawing.data)
  const includeImages = new URL(request.url).searchParams.get("images") !== "0"
  const build = (files: Awaited<ReturnType<typeof loadImageFiles>>) =>
    toExcalidrawFile({ elements, appState, files, source: origin })

  let body = build(
    includeImages ? await loadImageFiles(db, drawingId, elements) : new Map(),
  )

  // Too large with images: retry without them, and say so, rather than fail.
  let imagesOmitted = false
  if (
    includeImages &&
    new TextEncoder().encode(body).length > MAX_RESPONSE_BYTES
  ) {
    imagesOmitted = true
    body = build(new Map())
  }

  const headers = new Headers({
    "Content-Type": `${SCENE_TYPE}; charset=utf-8`,
    // A signed link is a bearer secret in a URL: never let a proxy store it.
    "Cache-Control":
      access.via === "signature" ? "no-store" : "private, no-cache",
    "Content-Disposition": `inline; filename="${encodeURIComponent(
      drawing.name || "drawing",
    )}.excalidraw"`,
  })
  if (imagesOmitted) headers.set("X-Images-Omitted", "too-large")

  return new Response(request.method === "HEAD" ? null : body, {
    status: 200,
    headers,
  })
}
