"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { Button } from "@/components/ui/button";
import {
  ALLOWED_VIDEO_TYPES,
  isYoutubeUrl,
  validateDuration,
  validateFileMeta,
} from "@/lib/video-validation";
import { SUPPORTED_TARGET_LANGUAGES } from "@/lib/dubbing";
import type { ProjectOptions } from "@/db/schema";

// Edge case §11: "Very long source → reject before upload finishes (check
// metadata client-side where possible)." Reads only the <video> element's
// metadata (duration), not the full file — fast, no full decode/download.
// A hard timeout guards against browsers that never fire loadedmetadata/error
// for an off-DOM <video> element (observed in practice) — without it, the
// whole submit flow hangs forever with no feedback to the user.
const VIDEO_METADATA_TIMEOUT_MS = 5000;

function readVideoDurationS(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    const url = URL.createObjectURL(file);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      reject(new Error("Timed out reading video metadata."));
    }, VIDEO_METADATA_TIMEOUT_MS);
    video.src = url;
    video.onloadedmetadata = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(video.duration);
    };
    video.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      reject(new Error("Could not read video metadata."));
    };
  });
}

// The client's upload() call resolves as soon as the PUT to Blob storage
// finishes — but `projects.storageKey` is only set afterwards, by Vercel's
// separate `onUploadCompleted` webhook. Calling /start immediately races
// that webhook (reproduced live: "Upload has not completed yet." even
// though the upload genuinely succeeded). Poll briefly for the webhook to
// land before giving up and calling /start anyway.
async function waitForStorageKey(
  projectId: string,
  { timeoutMs = 15000, intervalMs = 1000 } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`/api/projects/${projectId}`);
    if (res.ok) {
      const { project } = await res.json();
      if (project.storageKey) return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

// UI screen 4 (PRD §10) / §4 steps 2-3: upload or YouTube URL + options.
export default function NewProjectPage() {
  const router = useRouter();
  const [sourceType, setSourceType] = useState<"upload" | "youtube">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [sourceLanguage, setSourceLanguage] = useState("");
  const [clipLength, setClipLength] =
    useState<NonNullable<ProjectOptions["clipLength"]>>("medium");
  const [maxClips, setMaxClips] = useState(8);
  const [targetLanguage, setTargetLanguage] = useState("");
  const [dubbingEnabled, setDubbingEnabled] = useState(false);
  const [voiceCloningEnabled, setVoiceCloningEnabled] = useState(false);
  const [voiceCloningConsent, setVoiceCloningConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (sourceType === "upload" && !file) {
      setError("Choose a video file.");
      return;
    }
    if (sourceType === "upload" && file) {
      const check = validateFileMeta(file);
      if (!check.ok) {
        setError(check.reason);
        return;
      }
      try {
        const durationS = await readVideoDurationS(file);
        const durationCheck = validateDuration(durationS);
        if (!durationCheck.ok) {
          setError(durationCheck.reason);
          return;
        }
      } catch {
        // Metadata read failed (e.g. unsupported container in this
        // browser) — fall through and let the server-side check catch it.
      }
    }
    if (sourceType === "youtube" && !isYoutubeUrl(youtubeUrl)) {
      setError("Enter a valid YouTube URL.");
      return;
    }

    setBusy(true);
    try {
      const options: ProjectOptions = {
        sourceLanguage: sourceLanguage || undefined,
        clipLength,
        maxClips,
        targetLanguage: targetLanguage || undefined,
        dubbingEnabled,
        voiceCloningEnabled: dubbingEnabled ? voiceCloningEnabled : undefined,
        voiceCloningConsent: dubbingEnabled ? voiceCloningConsent : undefined,
      };

      const createRes = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:
            sourceType === "upload" && file
              ? file.name
              : `YouTube import ${new Date().toLocaleString()}`,
          sourceType,
          sourceUrl: sourceType === "youtube" ? youtubeUrl : undefined,
          options,
        }),
      });
      if (!createRes.ok) {
        const body = await createRes.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to create project.");
      }
      const { project } = await createRes.json();

      if (sourceType === "upload" && file) {
        // FR-4/edge case §11: chunked, retried multipart upload — resilient
        // to transient drops mid-upload (a full page reload still requires
        // re-selecting the file; see docs/DECISIONS.md).
        await upload(file.name, file, {
          access: "public",
          handleUploadUrl: "/api/upload",
          clientPayload: JSON.stringify({ projectId: project.id }),
          multipart: true,
          onUploadProgress: ({ percentage }) => setProgress(percentage),
        });
        await waitForStorageKey(project.id);
      }

      const startRes = await fetch(`/api/projects/${project.id}/start`, {
        method: "POST",
      });
      if (!startRes.ok) {
        const body = await startRes.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to start processing.");
      }

      router.push(`/dashboard/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl flex-1 p-8">
      <h1 className="mb-6 text-2xl font-semibold">New project</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <div className="flex gap-2">
          <Button
            type="button"
            variant={sourceType === "upload" ? "default" : "outline"}
            onClick={() => setSourceType("upload")}
          >
            Upload video
          </Button>
          <Button
            type="button"
            variant={sourceType === "youtube" ? "default" : "outline"}
            onClick={() => setSourceType("youtube")}
          >
            YouTube URL
          </Button>
        </div>

        {sourceType === "upload" ? (
          <input
            type="file"
            accept={ALLOWED_VIDEO_TYPES.join(",")}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="rounded-md border p-2"
          />
        ) : (
          <input
            type="url"
            placeholder="https://www.youtube.com/watch?v=..."
            value={youtubeUrl}
            onChange={(e) => setYoutubeUrl(e.target.value)}
            className="rounded-md border p-2"
          />
        )}

        <fieldset className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Source language
            <select
              value={sourceLanguage}
              onChange={(e) => setSourceLanguage(e.target.value)}
              className="rounded-md border p-2"
            >
              <option value="">Auto-detect</option>
              <option value="en">English</option>
              <option value="fr">French</option>
              <option value="ar">Arabic</option>
              <option value="de">German</option>
              <option value="es">Spanish</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Clip length
            <select
              value={clipLength}
              onChange={(e) =>
                setClipLength(e.target.value as typeof clipLength)
              }
              className="rounded-md border p-2"
            >
              <option value="short">Short (15–30s)</option>
              <option value="medium">Medium (30–60s)</option>
              <option value="long">Long (60–90s)</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Max clips
            <input
              type="number"
              min={1}
              max={15}
              value={maxClips}
              onChange={(e) => setMaxClips(Number(e.target.value))}
              className="rounded-md border p-2"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Target language (optional — enables translation/dubbing)
            <select
              value={targetLanguage}
              onChange={(e) => setTargetLanguage(e.target.value)}
              className="rounded-md border p-2"
            >
              <option value="">None</option>
              {SUPPORTED_TARGET_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>
          </label>

          {targetLanguage && (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={dubbingEnabled}
                  onChange={(e) => setDubbingEnabled(e.target.checked)}
                />
                Dub audio
              </label>

              {dubbingEnabled && (
                <div className="ml-6 flex flex-col gap-2 border-l pl-3 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={voiceCloningEnabled}
                      onChange={(e) => setVoiceCloningEnabled(e.target.checked)}
                    />
                    Clone the original voice (off by default — uses a stock voice otherwise)
                  </label>
                  {voiceCloningEnabled && (
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={voiceCloningConsent}
                        onChange={(e) => setVoiceCloningConsent(e.target.checked)}
                      />
                      I confirm I have the right to clone this voice
                    </label>
                  )}
                </div>
              )}
            </>
          )}
        </fieldset>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {progress !== null && progress < 100 && (
          <p className="text-sm text-muted-foreground">
            Uploading… {Math.round(progress)}%
          </p>
        )}

        <Button type="submit" disabled={busy}>
          {busy ? "Starting…" : "Create clips"}
        </Button>
      </form>
    </div>
  );
}
