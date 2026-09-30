import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { projects, transcripts } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { getOwnedClip } from "@/lib/clips";
import { MAX_TRIM_DELTA_S } from "@/lib/trim";
import { ClipEditor } from "./clip-editor";

// UI screen 7 (PRD §10): clip editor.
export default async function ClipEditorPage({
  params,
}: {
  params: Promise<{ id: string; clipId: string }>;
}) {
  const userId = await requireUserId();
  const { clipId } = await params;
  const clip = await getOwnedClip(userId, clipId);
  if (!clip) notFound();

  const db = getDb();
  const [project] = await db.select().from(projects).where(eq(projects.id, clip.projectId));
  const [transcript] = await db
    .select()
    .from(transcripts)
    .where(eq(transcripts.projectId, clip.projectId));

  const windowStart = clip.originalStartS - MAX_TRIM_DELTA_S;
  const windowEnd = clip.originalEndS + MAX_TRIM_DELTA_S;
  const words =
    transcript?.words.filter((w) => w.start >= windowStart && w.start < windowEnd) ?? [];

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 p-8">
      <ClipEditor
        clip={clip}
        words={words}
        sourceDurationS={project?.durationS ?? null}
        dubbingEnabled={Boolean(project?.options.dubbingEnabled)}
        targetLanguage={project?.options.targetLanguage ?? null}
      />
    </div>
  );
}
