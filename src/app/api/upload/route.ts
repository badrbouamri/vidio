import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { projects } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { getOwnedProject } from "@/lib/projects";
import { ALLOWED_VIDEO_TYPES, MAX_UPLOAD_BYTES } from "@/lib/video-validation";

// FR-4: browser uploads directly to Blob storage via a short-lived client
// token — the video bytes never pass through this function (resumable
// multipart is handled by @vercel/blob/client on the browser side).
//
// This route handles TWO distinct request types, not one:
//   1. Token generation — a real browser request, with a Clerk session.
//   2. The upload-completed callback — a server-to-server webhook POST
//      from Vercel's own Blob infrastructure once the upload finishes, with
//      NO Clerk session (it's verified internally via signature instead).
// `requireUserId()` must only run for (1) — calling it unconditionally
// before `handleUpload()` throws on every (2) request in production,
// silently breaking `onUploadCompleted` so `storageKey` is never set and
// /start forever reports "Upload has not completed yet", regardless of
// file size. See docs/DECISIONS.md.
//
// This is NOT an open endpoint: `handleUpload` itself verifies every (2)
// request's `x-vercel-signature` header — an HMAC-SHA256 over the request
// body keyed with BLOB_READ_WRITE_TOKEN (a server secret the browser never
// sees), timing-safe compared — and throws before `onUploadCompleted` ever
// runs if it's missing or wrong (verified directly in
// node_modules/@vercel/blob/dist/client.js). A caller without that token
// cannot forge this callback. The `tokenPayload` it trusts (userId,
// projectId) was itself only mintable by an authenticated, project-owning
// user back in onBeforeGenerateToken below.
export async function POST(req: Request) {
  const body = (await req.json()) as HandleUploadBody;

  const jsonResponse = await handleUpload({
    body,
    request: req,
    onBeforeGenerateToken: async (pathname, clientPayload) => {
      const userId = await requireUserId();
      const projectId = clientPayload ? JSON.parse(clientPayload).projectId : null;
      if (!projectId) throw new Error("projectId is required");

      const project = await getOwnedProject(userId, projectId);
      if (!project) throw new Error("Project not found");

      return {
        allowedContentTypes: [...ALLOWED_VIDEO_TYPES],
        maximumSizeInBytes: MAX_UPLOAD_BYTES,
        addRandomSuffix: true,
        tokenPayload: JSON.stringify({ userId, projectId }),
      };
    },
    onUploadCompleted: async ({ blob, tokenPayload }) => {
      const { projectId } = JSON.parse(tokenPayload!);
      const db = getDb();
      await db
        .update(projects)
        .set({ storageKey: blob.url })
        .where(eq(projects.id, projectId));
    },
  });

  return NextResponse.json(jsonResponse);
}
