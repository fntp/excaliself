import { expect, test } from "vitest"
import {
  MAX_SIGNED_LINK_TTL_MS,
  mintSignature,
  SIGNED_LINK_TTL_MS,
  signedSceneUrl,
  verifySignature,
} from "./signed-link"

const SECRET = "test-secret-at-least-32-characters-long"
const ID = "b1a2c3d4e5f60718"

test("a freshly minted signature opens its own drawing", async () => {
  const value = await mintSignature({ secret: SECRET, drawingId: ID })
  expect(
    await verifySignature({ secret: SECRET, drawingId: ID, value }),
  ).toEqual({ status: "ok" })
})

test("a signature names one drawing and no other", async () => {
  const value = await mintSignature({ secret: SECRET, drawingId: ID })
  expect(
    await verifySignature({
      secret: SECRET,
      drawingId: "ffffffffffffffff",
      value,
    }),
  ).toEqual({ status: "invalid" })
})

test("another instance's secret cannot mint one that this one honors", async () => {
  const value = await mintSignature({
    secret: "a-different-secret-at-least-32-characters",
    drawingId: ID,
  })
  expect(
    await verifySignature({ secret: SECRET, drawingId: ID, value }),
  ).toEqual({ status: "invalid" })
})

test("an expired link says expired, not forged", async () => {
  const mintedAt = Date.now()
  const value = await mintSignature({
    secret: SECRET,
    drawingId: ID,
    ttlMs: 1000,
    now: mintedAt,
  })
  expect(
    await verifySignature({
      secret: SECRET,
      drawingId: ID,
      value,
      now: mintedAt + 2000,
    }),
  ).toEqual({ status: "expired" })
})

test("a tampered expiry is refused, so a link cannot be extended", async () => {
  const value = await mintSignature({
    secret: SECRET,
    drawingId: ID,
    ttlMs: 1000,
  })
  const [, signature] = value.split(".")
  const farFuture = Date.now() + MAX_SIGNED_LINK_TTL_MS
  expect(
    await verifySignature({
      secret: SECRET,
      drawingId: ID,
      value: `${farFuture}.${signature}`,
    }),
  ).toEqual({ status: "invalid" })
})

test("malformed values are invalid, never a throw", async () => {
  for (const value of ["", ".", "abc", "abc.def", "1.2.3", "NaN.abc"]) {
    expect(
      await verifySignature({ secret: SECRET, drawingId: ID, value }),
    ).toEqual({ status: "invalid" })
  }
})

test("the ttl is clamped, so a caller cannot mint a permanent link", async () => {
  const value = await mintSignature({
    secret: SECRET,
    drawingId: ID,
    ttlMs: MAX_SIGNED_LINK_TTL_MS * 100,
  })
  const expiry = Number(value.split(".")[0])
  expect(expiry - Date.now()).toBeLessThanOrEqual(MAX_SIGNED_LINK_TTL_MS + 1000)
  expect(SIGNED_LINK_TTL_MS).toBeLessThan(MAX_SIGNED_LINK_TTL_MS)
})

test("the scene url carries the signature url-encoded", () => {
  expect(
    signedSceneUrl({
      origin: "https://draw.example.com",
      drawingId: ID,
      signature: "123.abc+/=",
    }),
  ).toBe(
    `https://draw.example.com/api/drawings/${ID}/scene?t=${encodeURIComponent("123.abc+/=")}`,
  )
})
