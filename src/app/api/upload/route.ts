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
export async function POST(req: Request) {
  const userId = await requireUserId();
  const body = (await req.json()) as HandleUploadBody;

  const jsonResponse = await handleUpload({
    body,
    request: req,
    onBeforeGenerateToken: async (pathname, clientPayload) => {
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
