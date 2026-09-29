"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const STAGE_LABELS: Record<string, string> = {
  ingest: "Uploading",
  transcribe: "Transcribing",
  detect: "Finding moments",
  render: "Rendering clips",
  translate: "Translating",
  dub: "Dubbing",
};

type Job = {
  id: string;
  stage: string;
  status: "queued" | "running" | "done" | "failed";
  progress: number;
  error: string | null;
};

type ProjectDetail = {
  project: { status: string };
  jobs: Job[];
};

const POLL_MS = 3000;

// FR-37: polling (see docs/DECISIONS.md — no realtime channel with Neon).
export function ProjectStatus({
  projectId,
  initialStatus,
}: {
  projectId: string;
  initialStatus: string;
}) {
  const [data, setData] = useState<ProjectDetail | null>(null);
  const [status, setStatus] = useState(initialStatus);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch(`/api/projects/${projectId}`);
        if (!res.ok) return;
        const body: ProjectDetail = await res.json();
        if (cancelled) return;
        setData(body);
        setStatus(body.project.status);
      } finally {
        if (!cancelled && status !== "done" && status !== "failed") {
          timer = setTimeout(poll, POLL_MS);
        }
      }
    }
    poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [projectId, status]);

  const failedJob = data?.jobs.find((j) => j.status === "failed");

  async function handleRetry() {
    setRetrying(true);
    try {
      await fetch(`/api/projects/${projectId}/start`, { method: "POST" });
      setStatus("queued");
    } finally {
      setRetrying(false);
    }
  }

  if (status === "done") {
    return <p className="text-muted-foreground">Done — clips are ready.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col gap-2">
        {Object.entries(STAGE_LABELS).map(([stage, label]) => {
          const job = data?.jobs.find((j) => j.stage === stage);
          return (
            <li key={stage} className="flex items-center justify-between">
              <span>{label}</span>
              <span className="text-sm text-muted-foreground capitalize">
                {job ? `${job.status} (${job.progress}%)` : "pending"}
              </span>
            </li>
          );
        })}
      </ol>

      {failedJob && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-sm text-destructive">
            Failed at &quot;{STAGE_LABELS[failedJob.stage]}&quot;:{" "}
            {failedJob.error ?? "Unknown error"}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={handleRetry}
            disabled={retrying}
          >
            {retrying ? "Retrying…" : "Retry"}
          </Button>
        </div>
      )}
    </div>
  );
}
