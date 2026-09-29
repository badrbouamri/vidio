import { notFound } from "next/navigation";
import { requireUserId } from "@/lib/auth";
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

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 p-8">
      <h1 className="mb-6 text-2xl font-semibold">{project.name}</h1>
      <ProjectStatus projectId={id} initialStatus={project.status} />
    </div>
  );
}
