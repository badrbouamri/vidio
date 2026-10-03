import { NextResponse } from "next/server";
import { get, put } from "@vercel/blob";
import { PRIVATE_BLOB_TOKEN } from "@/lib/blob";

// Stateless-worker refactor (see docs/DECISIONS.md): the worker has no
// persistent disk between stages/container restarts (no Railway volume), so
// every stage downloads its inputs from Blob and uploads its outputs before
// marking itself done. This is the generic read/write proxy for worker-
// internal artifacts that aren't user-facing downloads — a YouTube-ingested
// source copy, a built dub-audio track — as opposed to
// /api/internal/clip-versions, which is specifically for user-downloadable
// clip outputs. Always the private store (no reason for these to be
// public); deliberately outside proxy.ts's Clerk-protected matcher, same
// machine-to-machine auth pattern as every other /api/internal/* route.
const WORKER_INTERNAL_SECRET = process.env.WORKER_INTERNAL_SECRET;

function isAuthorized(req: Request): boolean {
  return Boolean(
    WORKER_INTERNAL_SECRET && req.headers.get("x-worker-secret") === WORKER_INTERNAL_SECRET,
  );
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await req.formData();
  const file = form.get("file");
  const key = form.get("key");
  if (!(file instanceof File) || typeof key !== "string" || !key) {
    return NextResponse.json({ error: "file and key are required" }, { status: 400 });
  }

  const blob = await put(key, file, {
    access: "private",
    addRandomSuffix: false,
    token: PRIVATE_BLOB_TOKEN,
  });
  return NextResponse.json({ key: blob.pathname, url: blob.url });
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const key = new URL(req.url).searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "key is required" }, { status: 400 });
  }

  const blob = await get(key, { access: "private", token: PRIVATE_BLOB_TOKEN });
  if (!blob || blob.statusCode !== 200) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return new NextResponse(blob.stream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(blob.blob.size),
    },
  });
}
