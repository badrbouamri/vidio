import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { clips, clipVersions } from "@/db/schema";

// Machine-to-machine route — the worker uploads a rendered clip's outputs
// here once per clip (M4). This is the only place that touches Vercel Blob
// for clip outputs (see docs/DECISIONS.md — no official Python Blob
// client). Deliberately outside proxy.ts's Clerk-protected matcher.
const WORKER_INTERNAL_SECRET = process.env.WORKER_INTERNAL_SECRET;

function requireFile(form: FormData, key: string): File {
  const value = form.get(key);
  if (!(value instanceof File)) throw new Error(`Missing file field: ${key}`);
  return value;
}

function requireString(form: FormData, key: string): string {
  const value = form.get(key);
  if (typeof value !== "string" || !value) throw new Error(`Missing field: ${key}`);
  return value;
}

export async function POST(req: Request) {
  if (
    !WORKER_INTERNAL_SECRET ||
    req.headers.get("x-worker-secret") !== WORKER_INTERNAL_SECRET
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await req.formData();
  let clipId: string,
    subtitleStyle: string,
    subtitleLang: string,
    trimStart: string,
    trimEnd: string,
    audio: "original" | "dubbed";
  let video: File, thumbnail: File, srt: File, vtt: File;
  try {
    clipId = requireString(form, "clipId");
    subtitleStyle = requireString(form, "subtitleStyle");
    subtitleLang = requireString(form, "subtitleLang");
    trimStart = requireString(form, "trimStart");
    trimEnd = requireString(form, "trimEnd");
    const audioValue = form.get("audio");
    audio = audioValue === "dubbed" ? "dubbed" : "original";
    video = requireFile(form, "video");
    thumbnail = requireFile(form, "thumbnail");
    srt = requireFile(form, "srt");
    vtt = requireFile(form, "vtt");
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid form data" },
      { status: 400 },
    );
  }

  const db = getDb();
  const [clip] = await db.select().from(clips).where(eq(clips.id, clipId));
  if (!clip) {
    return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  }

  // Unique per version (not per clip) — a re-render (M5) must not overwrite
  // a still-downloadable prior version's files (FR-32).
  const versionKey = randomUUID();
  const prefix = `clips/${clipId}/${versionKey}`;

  const [videoBlob, srtBlob, vttBlob, thumbnailBlob] = await Promise.all([
    put(`${prefix}/video.mp4`, video, { access: "private", addRandomSuffix: false }),
    put(`${prefix}/subtitles.srt`, srt, { access: "private", addRandomSuffix: false }),
    put(`${prefix}/subtitles.vtt`, vtt, { access: "private", addRandomSuffix: false }),
    // Thumbnails are just previews, not a download-with-audit-trail
    // requirement, so they stay public — simpler (no signed URL needed to
    // render the gallery) and lower-value to protect.
    put(`${prefix}/thumbnail.jpg`, thumbnail, { access: "public", addRandomSuffix: false }),
  ]);

  const [version] = await db
    .insert(clipVersions)
    .values({
      clipId,
      subtitleStyle,
      subtitleLang,
      audio,
      trim: { startS: Number(trimStart), endS: Number(trimEnd) },
      videoKey: videoBlob.pathname,
      srtKey: srtBlob.pathname,
      vttKey: vttBlob.pathname,
      thumbnailKey: thumbnailBlob.url,
    })
    .returning();

  await db
    .update(clips)
    .set({ status: "ready", currentVersionId: version.id })
    .where(eq(clips.id, clipId));

  return NextResponse.json({ ok: true, clipVersionId: version.id });
}
