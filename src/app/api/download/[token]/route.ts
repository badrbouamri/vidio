import { NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { clipVersions } from "@/db/schema";
import { verifyDownloadToken, type DownloadKind } from "@/lib/download-tokens";

const CONTENT_TYPES: Record<DownloadKind, string> = {
  video: "video/mp4",
  srt: "application/x-subrip",
  vtt: "text/vtt",
};
const EXTENSIONS: Record<DownloadKind, string> = { video: "mp4", srt: "srt", vtt: "vtt" };

// FR-33/FR-34: the actual signed, expiring download link — no Clerk session
// required (deliberately outside proxy.ts's matcher), just a valid,
// unexpired token minted by /api/clips/:id/download.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const payload = verifyDownloadToken(token);
  if (!payload) {
    return NextResponse.json({ error: "This link has expired." }, { status: 410 });
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

  const blob = await get(key, { access: "private" });
  if (!blob || blob.statusCode !== 200) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(blob.stream, {
    headers: {
      "Content-Type": CONTENT_TYPES[payload.kind],
      "Content-Disposition": `attachment; filename="clip.${EXTENSIONS[payload.kind]}"`,
      "Content-Length": String(blob.blob.size),
    },
  });
}
