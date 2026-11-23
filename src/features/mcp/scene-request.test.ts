import { expect, test } from "vitest"
import { drawingIdInPath, wantsScene } from "./scene-request"

test("an AI asking for the scene type gets it", () => {
  expect(wantsScene("application/vnd.excalidraw+json")).toBe(true)
  expect(wantsScene("application/vnd.excalidraw+json; charset=utf-8")).toBe(
    true,
  )
})

test("a bare application/json is a request for the scene", () => {
  expect(wantsScene("application/json")).toBe(true)
})

test("a browser's Accept is not a request for the scene", () => {
  for (const accept of [
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "text/html",
    "text/html,application/json",
    "*/*",
    "",
  ]) {
    expect(wantsScene(accept)).toBe(false)
  }
})

test("a missing Accept falls through to the page", () => {
  expect(wantsScene(null)).toBe(false)
})

test("only /draw/<id> is negotiated, not other paths", () => {
  const id = "b1a2c3d4e5f60718"
  expect(drawingIdInPath(`/draw/${id}`)).toBe(id)
  expect(drawingIdInPath("/draw")).toBeNull()
  expect(drawingIdInPath(`/share/${id}`)).toBeNull()
  expect(drawingIdInPath(`/api/drawings/${id}/scene`)).toBeNull()
  expect(drawingIdInPath("/")).toBeNull()
  expect(drawingIdInPath("/draw/not an id")).toBeNull()
})
