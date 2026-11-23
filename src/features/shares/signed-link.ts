// A link that proves its holder was given access to one drawing, without a
// session and without exposing an instance-wide credential. It is what makes
// "paste this into your AI" safe for a Private drawing: the signature names one
// drawing and expires, so a leaked link cannot read anything else and dies on
// its own.
//
// HMAC-SHA-256 over "<drawingId>.<expiresAt>" with the instance secret, so the
// verification needs no storage and works in any isolate.

/** How long a signed scene link lives by default. */
export const SIGNED_LINK_TTL_MS = 60 * 60 * 1000

/** Bounds a caller-supplied expiry, so a link can't be minted forever. */
export const MAX_SIGNED_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000

export type SignedLinkVerdict =
  | { status: "ok" }
  | { status: "expired" }
  | { status: "invalid" }

/** The text the signature covers; one place, so mint and verify can't drift. */
const payload = (drawingId: string, expiresAt: number) =>
  `${drawingId}.${expiresAt}`

const encoder = new TextEncoder()

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
}

function toBase64Url(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes)
  let binary = ""
  for (const byte of view) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
}

/** Length-independent compare, so a guess can't be timed against a real sig. */
function equalConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let index = 0; index < a.length; index += 1)
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index)
  return diff === 0
}

async function sign(
  secret: string,
  drawingId: string,
  expiresAt: number,
): Promise<string> {
  const key = await hmacKey(secret)
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload(drawingId, expiresAt)),
  )
  return toBase64Url(mac)
}

/**
 * Mints the `t` value for one drawing: "<expiresAt>.<signature>". The expiry
 * rides in the clear so verification costs one HMAC and no lookup.
 */
export async function mintSignature(input: {
  secret: string
  drawingId: string
  ttlMs?: number
  now?: number
}): Promise<string> {
  const now = input.now ?? Date.now()
  const ttl = Math.min(
    Math.max(input.ttlMs ?? SIGNED_LINK_TTL_MS, 1000),
    MAX_SIGNED_LINK_TTL_MS,
  )
  const expiresAt = now + ttl
  const signature = await sign(input.secret, input.drawingId, expiresAt)
  return `${expiresAt}.${signature}`
}

/**
 * Checks a `t` value against the drawing it claims to open. Expiry is reported
 * apart from forgery so the route can say "this link has expired" — the id is
 * already in the URL, so that leaks nothing.
 */
export async function verifySignature(input: {
  secret: string
  drawingId: string
  value: string
  now?: number
}): Promise<SignedLinkVerdict> {
  const [expiry, signature] = input.value.split(".")
  if (!expiry || !signature) return { status: "invalid" }
  const expiresAt = Number(expiry)
  if (!Number.isSafeInteger(expiresAt)) return { status: "invalid" }

  const expected = await sign(input.secret, input.drawingId, expiresAt)
  if (!equalConstantTime(signature, expected)) return { status: "invalid" }
  if (expiresAt < (input.now ?? Date.now())) return { status: "expired" }
  return { status: "ok" }
}

/** The scene URL an AI client can fetch: absolute, signed, one drawing. */
export function signedSceneUrl(input: {
  origin: string
  drawingId: string
  signature: string
}): string {
  return `${input.origin}/api/drawings/${input.drawingId}/scene?t=${encodeURIComponent(input.signature)}`
}
