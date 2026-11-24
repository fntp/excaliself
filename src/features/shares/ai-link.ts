"use server"

import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { z } from "zod"
import { db } from "@/db"
import { env } from "@/env"
import { resolveTargetForMember } from "@/features/mcp/target-resolve"
import { originOf } from "@/features/oauth/endpoints"
import { auth } from "@/lib/auth"
import { mintSignature, signedSceneUrl } from "./signed-link"

/**
 * Mints the link a member hands their AI client: a signed scene URL that reads
 * one drawing and nothing else.
 *
 * Only a member who can see the drawing may ask, and the answer is theirs: the
 * signature names this drawing alone, so a link pasted into a chat cannot open
 * a neighbouring one. A trashed drawing mints nothing, matching the 404 the
 * scene route would answer for it.
 */
export const mintAiLink = createServerFn({ method: "POST" })
  .validator(
    z.object({
      drawingId: z.string().min(1),
      ttlHours: z
        .number()
        .int()
        .min(1)
        .max(24 * 7)
        .default(1),
    }),
  )
  .handler(async ({ data }) => {
    const request = getRequest()
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session) throw new Error("Sign in first.")

    // The same resolver the MCP tools use, so a link the member was given and a
    // link they minted agree on what "can see it" means.
    const resolved = await resolveTargetForMember(
      db,
      { kind: "drawing", id: data.drawingId },
      session.user.id,
    )
    if (resolved.status !== "ok")
      throw new Error("No drawing has that id, or you cannot see it.")

    const ttlMs = data.ttlHours * 60 * 60 * 1000
    const signature = await mintSignature({
      secret: env.BETTER_AUTH_SECRET,
      drawingId: resolved.drawingId,
      ttlMs,
    })
    return {
      url: signedSceneUrl({
        origin: originOf(request),
        drawingId: resolved.drawingId,
        signature,
      }),
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    }
  })
