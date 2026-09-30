"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatTimestamp } from "@/lib/format";
import {
  filterClips,
  sortByScoreDesc,
  type GalleryClip,
  type LengthFilter,
} from "@/lib/gallery";

// UI screen 6 (PRD §10) / M4.8: cards sorted by score, filters (length,
// score), bulk select. Downloads (M4.9/FR-33/FR-34) and ZIP export (M5.7)
// land here too.
export function ClipsGallery({
  projectId,
  clips,
}: {
  projectId: string;
  clips: GalleryClip[];
}) {
  const [lengthFilter, setLengthFilter] = useState<LengthFilter>("all");
  const [minScore, setMinScore] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(
    () => sortByScoreDesc(filterClips(clips, { length: lengthFilter, minScore })),
    [clips, lengthFilter, minScore],
  );

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function download(clipId: string, kind: "video" | "srt") {
    setBusy(`${clipId}:${kind}`);
    try {
      const res = await fetch(`/api/clips/${clipId}/download?type=${kind}`);
      if (!res.ok) return;
      const { url } = await res.json();
      window.location.href = url;
    } finally {
      setBusy(null);
    }
  }

  async function exportSelected() {
    setExporting(true);
    setError(null);
    try {
      const res = await fetch("/api/clips/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clipIds: Array.from(selected) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Export failed.");
      }
      const { url } = await res.json();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setExporting(false);
    }
  }

  if (clips.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-lg font-medium">Clips</h2>

      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-1.5">
          Length
          <select
            value={lengthFilter}
            onChange={(e) => setLengthFilter(e.target.value as LengthFilter)}
            className="rounded-md border p-1"
          >
            <option value="all">All</option>
            <option value="short">Short (≤30s)</option>
            <option value="medium">Medium (≤60s)</option>
            <option value="long">Long (60s+)</option>
          </select>
        </label>

        <label className="flex items-center gap-1.5">
          Min score
          <input
            type="number"
            min={0}
            max={100}
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="w-16 rounded-md border p-1"
          />
        </label>

        {selected.size > 0 && (
          <Button size="sm" variant="outline" disabled={exporting} onClick={exportSelected}>
            {exporting ? "Exporting…" : `Export ${selected.size} selected as ZIP`}
          </Button>
        )}
      </div>

      {error && <p className="mb-2 text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {visible.map((clip) => (
          <div key={clip.id} className="rounded-md border p-3">
            <div className="mb-2 flex items-start gap-2">
              <input
                type="checkbox"
                checked={selected.has(clip.id)}
                onChange={() => toggleSelected(clip.id)}
                className="mt-1"
              />
              <div className="flex-1">
                {clip.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={clip.thumbnailUrl}
                    alt={clip.title}
                    className="mb-2 aspect-[9/16] w-full max-w-[160px] rounded-md object-cover"
                  />
                ) : (
                  <div className="mb-2 aspect-[9/16] w-full max-w-[160px] rounded-md bg-muted" />
                )}
                <p className="font-medium">{clip.title}</p>
                <p className="text-xs text-muted-foreground">
                  {formatTimestamp(clip.startS)}–{formatTimestamp(clip.endS)} · score{" "}
                  {clip.score} · {clip.status}
                </p>
                {clip.hashtags.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {clip.hashtags.join(" ")}
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link href={`/dashboard/${projectId}/clips/${clip.id}`}>
                <Button size="sm" variant="outline">
                  Edit
                </Button>
              </Link>
              {clip.status === "ready" && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === `${clip.id}:video`}
                    onClick={() => download(clip.id, "video")}
                  >
                    Download MP4
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === `${clip.id}:srt`}
                    onClick={() => download(clip.id, "srt")}
                  >
                    Download SRT
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
