import { expect, test } from "vitest"
import { drawingLink, parseDrawingTarget } from "./target"

const ID = "b1a2c3d4e5f60718"
const TOKEN = "a".repeat(64)

test("a bare id is a drawing", () => {
  expect(parseDrawingTarget(ID)).toEqual({ kind: "drawing", id: ID })
})

test("the app's own link is a drawing", () => {
  for (const input of [
    `https://draw.example.com/draw/${ID}`,
    `/draw/${ID}`,
    `http://localhost:3000/draw/${ID}`,
    `https://draw.example.com/draw/${ID}?from=paste`,
    `https://draw.example.com/draw/${ID}#element-1`,
  ]) {
    expect(parseDrawingTarget(input)).toEqual({ kind: "drawing", id: ID })
  }
})

test("a share link is a token to resolve", () => {
  for (const input of [
    `https://draw.example.com/share/${TOKEN}`,
    `/share/${TOKEN}`,
  ]) {
    expect(parseDrawingTarget(input)).toEqual({ kind: "share", token: TOKEN })
  }
})

test("a bare token reads as an id, since both are random hex", () => {
  expect(parseDrawingTarget(TOKEN)).toEqual({ kind: "drawing", id: TOKEN })
})

test("a signed scene link keeps its signature", () => {
  expect(
    parseDrawingTarget(
      `https://draw.example.com/api/drawings/${ID}/scene?t=abc123.sig`,
    ),
  ).toEqual({ kind: "signed", id: ID, signature: "abc123.sig" })
})

test("a signed scene link without a signature is not one", () => {
  expect(
    parseDrawingTarget(`https://draw.example.com/api/drawings/${ID}/scene`),
  ).toBeNull()
})

test("surrounding whitespace is ignored, as a paste brings it", () => {
  expect(parseDrawingTarget(`  /draw/${ID}\n`)).toEqual({
    kind: "drawing",
    id: ID,
  })
})

test("anything else is null, never a query", () => {
  for (const input of [
    "",
    "   ",
    "hello",
    "excalidraw",
    "https://draw.example.com/",
    "https://draw.example.com/draw/",
    "https://draw.example.com/draw/short",
    "https://draw.example.com/draw/not an id",
    "https://example.com/somewhere/else",
    "drawing/id with spaces",
  ]) {
    expect(parseDrawingTarget(input)).toBeNull()
  }
})

test("the drawing link is the form a member copies", () => {
  expect(drawingLink("https://draw.example.com", ID)).toBe(
    `https://draw.example.com/draw/${ID}`,
  )
})
