import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { get, put } from "@vercel/blob";
import { eq, inArray } from "drizzle-orm";
import JSZip from "jszip";
import { getDb } from "@/db";
import { clips, clipVersions, projects } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { DOWNLOAD_TOKEN_TTL_MS, signDownloadToken } from "@/lib/download-tokens";
import { uniqueZipFilename } from "@/lib/export";

// §9/FR-33: ZIP of selected clips, signed URL (FR-34).
//
// Implemented synchronously in this Function rather than as a worker job:
// FR-36's "never process video in a request handler" is about
// encoding/transcoding, and this is pure I/O (fetch already-rendered MP4s,
// zip them) — well within a Vercel Function's 300s/100MB limits for a
// selection of short social clips. Revisit if exports of many/long clips
// become common. See docs/DECISIONS.md.
export async function POST(req: Request) {
  const userId = await requireUserId();
  const body = (await req.json()) as { clipIds?: unknown };
  const clipIds = body.clipIds;
  if (!Array.isArray(clipIds) || clipIds.length === 0 || !clipIds.every((id) => typeof id === "string")) {
    return NextResponse.json({ error: "clipIds must be a non-empty array of strings" }, { status: 400 });
  }

  const db = getDb();
  const rows = await db
    .select({ clip: clips, ownerId: projects.userId })
    .from(clips)
    .innerJoin(projects, eq(clips.projectId, projects.id))
    .where(inArray(clips.id, clipIds));

  if (rows.length !== clipIds.length || rows.some((r) => r.ownerId !== userId)) {
    return NextResponse.json({ error: "One or more clips not found" }, { status: 404 });
  }
  const selected = rows.map((r) => r.clip);

  const versionIds = selected
    .map((c) => c.currentVersionId)
    .filter((v): v is string => Boolean(v));
  if (versionIds.length === 0) {
    return NextResponse.json(
      { error: "None of the selected clips have a rendered version yet." },
      { status: 400 },
    );
  }
  const versions = await db
    .select()
    .from(clipVersions)
    .where(inArray(clipVersions.id, versionIds));

  const zip = new JSZip();
  const usedNames = new Set<string>();
  for (const clip of selected) {
    const version = versions.find((v) => v.id === clip.currentVersionId);
    if (!version?.videoKey) continue;

    const blob = await get(version.videoKey, { access: "private" });
    if (!blob || blob.statusCode !== 200) continue;
    const bytes = await new Response(blob.stream).arrayBuffer();

    const name = uniqueZipFilename(clip.title, clip.id, usedNames);
    zip.file(`${name}.mp4`, bytes);
  }

  if (Object.keys(zip.files).length === 0) {
    return NextResponse.json(
      { error: "Couldn't fetch any rendered files for the selected clips." },
      { status: 404 },
    );
  }

  const zipBytes = await zip.generateAsync({ type: "nodebuffer" });
  const blobKey = `exports/${randomUUID()}/clips.zip`;
  await put(blobKey, zipBytes, {
    access: "private",
    addRandomSuffix: false,
    contentType: "application/zip",
  });

  const exp = Date.now() + DOWNLOAD_TOKEN_TTL_MS;
  const token = signDownloadToken({ type: "export", blobKey, exp });

  return NextResponse.json({ url: `/api/download/${token}`, expiresAt: exp });
}
