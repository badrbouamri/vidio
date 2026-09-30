import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { clips, clipVersions, projects } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import {
  DOWNLOAD_TOKEN_TTL_MS,
  signDownloadToken,
  type Disposition,
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
  const url = new URL(req.url);
  const kind = url.searchParams.get("type") as DownloadKind | null;
  // FR-32: a prior version stays downloadable until replaced — pass its id
  // explicitly, else this defaults to the clip's current version.
  const requestedVersionId = url.searchParams.get("versionId");
  const disposition: Disposition =
    url.searchParams.get("disposition") === "inline" ? "inline" : "attachment";
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

  const versionId = requestedVersionId ?? row.clip.currentVersionId;
  if (!versionId) {
    return NextResponse.json(
      { error: "This clip has no rendered version yet." },
      { status: 400 },
    );
  }

  const [version] = await db
    .select()
    .from(clipVersions)
    .where(eq(clipVersions.id, versionId));
  if (!version || version.clipId !== id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const key =
    kind === "video" ? version.videoKey : kind === "srt" ? version.srtKey : version.vttKey;
  if (!key) {
    return NextResponse.json({ error: `No ${kind} file for this clip.` }, { status: 404 });
  }

  const exp = Date.now() + DOWNLOAD_TOKEN_TTL_MS;
  const token = signDownloadToken({
    type: "clip-version",
    clipVersionId: version.id,
    kind,
    exp,
    disposition,
  });

  return NextResponse.json({ url: `/api/download/${token}`, expiresAt: exp });
}
