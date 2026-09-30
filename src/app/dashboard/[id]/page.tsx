import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { transcripts } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { formatTimestamp } from "@/lib/format";
import { getOwnedProject } from "@/lib/projects";
import { ProjectStatus } from "./project-status";

// UI screen 5 (PRD §10): stage progress. Clips gallery (screen 6) lands in M4.
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const userId = await requireUserId();
  const { id } = await params;
  const project = await getOwnedProject(userId, id);
  if (!project) notFound();

  const db = getDb();
  const [transcript] = await db
    .select()
    .from(transcripts)
    .where(eq(transcripts.projectId, id));

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 p-8">
      <h1 className="mb-6 text-2xl font-semibold">{project.name}</h1>
      <ProjectStatus projectId={id} initialStatus={project.status} />

      {transcript && (
        <section className="mt-8">
          <h2 className="mb-2 text-lg font-medium">
            Transcript{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ({transcript.language})
            </span>
          </h2>
          <div className="max-h-96 overflow-y-auto rounded-md border p-4 text-sm leading-relaxed">
            {transcript.segments.map((segment, i) => (
              <p
                key={i}
                className={
                  segment.lowConfidence
                    ? "text-muted-foreground italic"
                    : undefined
                }
              >
                <span className="mr-2 font-mono text-xs text-muted-foreground">
                  {formatTimestamp(segment.start)}
                </span>
                {segment.text}
              </p>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
