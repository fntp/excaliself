// What an AI client may paste where a drawing id is expected. A member hands
// their AI client a link, not an id: "look at this and keep drawing". So every
// tool and endpoint that takes a drawing accepts the three shapes a person
// actually has at hand — the bare id, the app's /draw/<id>, and a Share link —
// and resolves them here, in one place, without a database.

/** A drawing, by id, however the caller named it. */
export type DrawingTarget =
  | { kind: "drawing"; id: string }
  /** A Share link: the token names the drawing, which only the db can resolve. */
  | { kind: "share"; token: string }
  /** A signed scene link: the id plus the proof that the sender shared it. */
  | { kind: "signed"; id: string; signature: string }

// An Excalidraw id or a UUID: random, so never a word a person typed by
// accident. The length floor keeps "excalidraw" from reading as an id.
const ID = /^[A-Za-z0-9_-]{12,64}$/
// A minted share token (256-bit hex) or an OAuth-looking opaque token.
const TOKEN = /^[A-Za-z0-9_-]{16,128}$/

const DRAW_PATH = /\/draw\/([^/?#]+)/
const SHARE_PATH = /\/share\/([^/?#]+)/

/**
 * Reads a drawing target out of whatever the member pasted. Accepts a bare id,
 * an absolute or relative `/draw/<id>`, a `/share/<token>`, and a signed scene
 * link (`/api/drawings/<id>/scene?t=<sig>`). Returns null for anything else, so
 * a caller can say "that is not a link to a drawing" instead of querying with
 * garbage.
 */
export function parseDrawingTarget(input: string): DrawingTarget | null {
  const raw = input.trim()
  if (!raw) return null

  // A path or an absolute URL: read the shape out of it, ignoring our own host.
  if (raw.includes("/")) {
    const signed = signedTarget(raw)
    if (signed) return signed

    const draw = DRAW_PATH.exec(raw)
    if (draw?.[1]) {
      const id = decode(draw[1])
      return id && ID.test(id) ? { kind: "drawing", id } : null
    }

    const share = SHARE_PATH.exec(raw)
    if (share?.[1]) {
      const token = decode(share[1])
      return token && TOKEN.test(token) ? { kind: "share", token } : null
    }
    return null
  }

  // No slash: a bare id. A bare Share token is indistinguishable from an id
  // (both are random hex), so a token is only honored inside a /share/ link —
  // which is the form a person copies anyway.
  if (ID.test(raw)) return { kind: "drawing", id: raw }
  return null
}

/**
 * A signed scene link carries the signature in `t`. Kept apart from the plain
 * id case so a caller can tell "the member proved access" from "the member
 * named a drawing and the request carries a session".
 */
function signedTarget(raw: string): DrawingTarget | null {
  const path = pathAndQuery(raw)
  if (!path) return null
  const match = /\/api\/drawings\/([^/?#]+)\/scene/.exec(path.pathname)
  if (!match?.[1]) return null
  const id = decode(match[1])
  const signature = path.searchParams.get("t")
  if (!id || !ID.test(id) || !signature) return null
  return { kind: "signed", id, signature }
}

function pathAndQuery(raw: string): URL | null {
  try {
    // A relative path needs a base; the host is throwaway.
    return new URL(raw, "http://localhost")
  } catch {
    return null
  }
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return ""
  }
}

/** The /draw/<id> link for a drawing, the form a member copies to an AI. */
export function drawingLink(origin: string, id: string): string {
  return `${origin}/draw/${id}`
}
