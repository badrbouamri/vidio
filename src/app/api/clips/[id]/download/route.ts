import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { clips, clipVersions, projects } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import {
  DOWNLOAD_TOKEN_TTL_MS,
  signDownloadToken,
  type DownloadKind,
} from "@/lib/download-tokens";

// FR-33/FR-34: mints a signed, ~24h-expiring download link for the clip's
// current version. Protected by Clerk (proxy.ts's `/api/clips(.*)` matcher)
// since only the owner may mint one; the link itself
// (/api/download/[token]) needs no session, so it can be shared/opened later.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requireUserId();
  const { id } = await params;
  const kind = new URL(req.url).searchParams.get("type") as DownloadKind | null;
  if (kind !== "video" && kind !== "srt" && kind !== "vtt") {
    return NextResponse.json(
      { error: "type must be one of video, srt, vtt" },
      { status: 400 },
    );
  }

  const db = getDb();
  const [row] = await db
    .select({ clip: clips, ownerId: projects.userId })
    .from(clips)
    .innerJoin(projects, eq(clips.projectId, projects.id))
    .where(eq(clips.id, id));

  if (!row || row.ownerId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!row.clip.currentVersionId) {
    return NextResponse.json(
      { error: "This clip has no rendered version yet." },
      { status: 400 },
    );
  }

  const [version] = await db
    .select()
    .from(clipVersions)
    .where(eq(clipVersions.id, row.clip.currentVersionId));
  if (!version) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const key =
    kind === "video" ? version.videoKey : kind === "srt" ? version.srtKey : version.vttKey;
  if (!key) {
    return NextResponse.json({ error: `No ${kind} file for this clip.` }, { status: 404 });
  }

  const exp = Date.now() + DOWNLOAD_TOKEN_TTL_MS;
  const token = signDownloadToken({ clipVersionId: version.id, kind, exp });

  return NextResponse.json({ url: `/api/download/${token}`, expiresAt: exp });
}
