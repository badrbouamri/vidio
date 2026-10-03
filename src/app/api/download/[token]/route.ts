import { NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { clipVersions } from "@/db/schema";
import { PRIVATE_BLOB_TOKEN } from "@/lib/blob";
import { verifyDownloadToken, type Disposition, type DownloadKind } from "@/lib/download-tokens";

const CONTENT_TYPES: Record<DownloadKind, string> = {
  video: "video/mp4",
  srt: "application/x-subrip",
  vtt: "text/vtt",
};
const EXTENSIONS: Record<DownloadKind, string> = { video: "mp4", srt: "srt", vtt: "vtt" };

async function streamBlob(
  key: string,
  contentType: string,
  filename: string,
  disposition: Disposition = "attachment",
) {
  const blob = await get(key, { access: "private", token: PRIVATE_BLOB_TOKEN });
  if (!blob || blob.statusCode !== 200) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return new NextResponse(blob.stream, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `${disposition}; filename="${filename}"`,
      "Content-Length": String(blob.blob.size),
    },
  });
}

// FR-33/FR-34: the actual signed, expiring download link — no Clerk session
// required (deliberately outside proxy.ts's matcher), just a valid,
// unexpired token minted by /api/clips/:id/download or /api/clips/export.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const payload = verifyDownloadToken(token);
  if (!payload) {
    return NextResponse.json({ error: "This link has expired." }, { status: 410 });
  }

  if (payload.type === "export") {
    return streamBlob(payload.blobKey, "application/zip", "clips.zip");
  }

  const db = getDb();
  const [version] = await db
    .select()
    .from(clipVersions)
    .where(eq(clipVersions.id, payload.clipVersionId));
  if (!version) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const key =
    payload.kind === "video"
      ? version.videoKey
      : payload.kind === "srt"
        ? version.srtKey
        : version.vttKey;
  if (!key) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return streamBlob(
    key,
    CONTENT_TYPES[payload.kind],
    `clip.${EXTENSIONS[payload.kind]}`,
    payload.disposition,
  );
}
