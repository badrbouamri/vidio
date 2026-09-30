"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { formatTimestamp } from "@/lib/format";
import { MAX_TRIM_DELTA_S } from "@/lib/trim";
import type { TranscriptWord } from "@/db/schema";

// Must match worker/subtitles.py's STYLE_PRESETS keys (FR-22).
const SUBTITLE_STYLES = ["classic", "bold-yellow", "neon", "minimal"] as const;

type ClipData = {
  id: string;
  startS: number;
  endS: number;
  originalStartS: number;
  originalEndS: number;
  title: string;
  hashtags: string[];
  status: string;
  subtitleStyle: string | null;
  subtitleWords: TranscriptWord[] | null;
};

type Version = {
  id: string;
  createdAt: string;
  subtitleStyle: string;
  audio: string;
};

// UI screen 7 (PRD §10) / M5.1-M5.3/M5.6: preview, trim, subtitle text
// editing, style presets, title editing, copy-to-clipboard.
export function ClipEditor({
  clip,
  words,
  sourceDurationS,
}: {
  clip: ClipData;
  words: TranscriptWord[];
  sourceDurationS: number | null;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(clip.title);
  const [hashtagsText, setHashtagsText] = useState(clip.hashtags.join(" "));
  const [startS, setStartS] = useState(clip.startS);
  const [endS, setEndS] = useState(clip.endS);
  const [subtitleStyle, setSubtitleStyle] = useState(clip.subtitleStyle ?? "classic");
  const [subtitleWords, setSubtitleWords] = useState<TranscriptWord[]>(
    clip.subtitleWords ?? words.filter((w) => w.start >= clip.startS && w.start < clip.endS),
  );
  const [versions, setVersions] = useState<Version[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const trimBounds = useMemo(
    () => ({
      min: Math.max(0, clip.originalStartS - MAX_TRIM_DELTA_S),
      max: sourceDurationS ?? clip.originalEndS + MAX_TRIM_DELTA_S,
    }),
    [clip.originalStartS, clip.originalEndS, sourceDurationS],
  );

  useEffect(() => {
    fetch(`/api/clips/${clip.id}/versions`)
      .then((res) => res.json())
      .then((body) => setVersions(body.versions ?? []))
      .catch(() => {});
  }, [clip.id]);

  // FR-29: preview player — "inline" disposition so the browser plays it
  // instead of downloading it (see download-tokens.ts).
  useEffect(() => {
    if (clip.status !== "ready") return;
    fetch(`/api/clips/${clip.id}/download?type=video&disposition=inline`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => setPreviewUrl(body?.url ?? null))
      .catch(() => {});
  }, [clip.id, clip.status]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/clips/${clip.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          hashtags: hashtagsText.split(/\s+/).filter(Boolean),
          startS,
          endS,
          subtitleStyle,
          subtitleWords,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to save.");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRender() {
    setRendering(true);
    setError(null);
    try {
      await handleSave();
      const res = await fetch(`/api/clips/${clip.id}/render`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to start render.");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setRendering(false);
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(`${title}\n\n${hashtagsText}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function updateWordText(index: number, text: string) {
    setSubtitleWords((prev) => prev.map((w, i) => (i === index ? { ...w, word: text } : w)));
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Edit clip</h1>
        <p className="text-sm text-muted-foreground">
          {formatTimestamp(startS)}–{formatTimestamp(endS)} · {clip.status}
        </p>
      </div>

      {previewUrl ? (
        <video
          src={previewUrl}
          controls
          className="aspect-[9/16] w-full max-w-[280px] rounded-md bg-black"
        />
      ) : (
        <div className="flex aspect-[9/16] w-full max-w-[280px] items-center justify-center rounded-md bg-muted text-sm text-muted-foreground">
          {clip.status === "ready" ? "Loading preview…" : "No rendered version yet"}
        </div>
      )}

      <label className="flex flex-col gap-1 text-sm">
        Title
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="rounded-md border p-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Hashtags (space-separated)
        <input
          value={hashtagsText}
          onChange={(e) => setHashtagsText(e.target.value)}
          className="rounded-md border p-2"
        />
      </label>

      <Button size="sm" variant="outline" className="w-fit" onClick={handleCopy}>
        {copied ? "Copied!" : "Copy title + hashtags"}
      </Button>

      <fieldset className="flex flex-col gap-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">
          Trim (±{MAX_TRIM_DELTA_S}s of the original)
        </legend>
        <label className="flex flex-col gap-1 text-sm">
          Start — {formatTimestamp(startS)}
          <input
            type="range"
            min={trimBounds.min}
            max={endS}
            step={0.1}
            value={startS}
            onChange={(e) => setStartS(Number(e.target.value))}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          End — {formatTimestamp(endS)}
          <input
            type="range"
            min={startS}
            max={trimBounds.max}
            step={0.1}
            value={endS}
            onChange={(e) => setEndS(Number(e.target.value))}
          />
        </label>
      </fieldset>

      <label className="flex flex-col gap-1 text-sm">
        Subtitle style
        <select
          value={subtitleStyle}
          onChange={(e) => setSubtitleStyle(e.target.value)}
          className="rounded-md border p-2"
        >
          {SUBTITLE_STYLES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="flex flex-col gap-2 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">Subtitle text (timing kept)</legend>
        <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {subtitleWords.map((w, i) => (
            <input
              key={i}
              value={w.word}
              onChange={(e) => updateWordText(i, e.target.value)}
              className="rounded-md border p-1 text-sm"
            />
          ))}
        </div>
      </fieldset>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button variant="outline" disabled={saving} onClick={handleSave}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button disabled={rendering} onClick={handleRender}>
          {rendering ? "Rendering…" : "Save & Re-render"}
        </Button>
      </div>

      {versions.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium">Version history</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {versions.map((v) => (
              <li key={v.id} className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  {new Date(v.createdAt).toLocaleString()} · {v.subtitleStyle} · {v.audio}
                </span>
                <a
                  href={`/api/clips/${clip.id}/download?type=video&versionId=${v.id}`}
                  className="text-primary underline"
                  onClick={async (e) => {
                    e.preventDefault();
                    const res = await fetch(
                      `/api/clips/${clip.id}/download?type=video&versionId=${v.id}`,
                    );
                    const { url } = await res.json();
                    window.location.href = url;
                  }}
                >
                  Download
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
