import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { jobs, projects, users } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { resumeStageFor } from "@/lib/jobs";
import { canStartNewProject, isPeriodExpired, PLAN_LIMITS } from "@/lib/plans";
import { getOwnedProject } from "@/lib/projects";

// §9 POST /api/projects/:id/start — validate + enqueue pipeline.
// FR-36: the web app never processes video itself; this only writes a
// queued Job row. The worker (worker/) polls for queued jobs and does the
// actual work (M3+).
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requireUserId();
  const { id } = await params;
  const project = await getOwnedProject(userId, id);
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (project.sourceType === "upload" && !project.storageKey) {
    return NextResponse.json(
      { error: "Upload has not completed yet." },
      { status: 400 },
    );
  }
  if (project.status !== "created" && project.status !== "failed") {
    return NextResponse.json(
      { error: `Project is already ${project.status}.` },
      { status: 409 },
    );
  }

  const db = getDb();

  const [user] = await db.select().from(users).where(eq(users.id, userId));

  // Edge case §11: "admin can disable accounts" — blocks all processing,
  // not just new projects (unlike the out-of-minutes gate below).
  if (user?.isDisabled) {
    return NextResponse.json(
      { error: "This account has been disabled. Contact support." },
      { status: 403 },
    );
  }

  // M7.4/edge case §11: block new projects once the user is out of
  // minutes — retrying a failed project doesn't count as "new".
  if (user && project.status === "created") {
    let minutesUsedPeriod = user.minutesUsedPeriod;
    if (isPeriodExpired(user.periodResetAt)) {
      minutesUsedPeriod = 0;
      await db
        .update(users)
        .set({ minutesUsedPeriod: 0, periodResetAt: new Date() })
        .where(eq(users.id, userId));
    }
    if (!canStartNewProject(user.plan, minutesUsedPeriod)) {
      return NextResponse.json(
        {
          error:
            "You're out of processing minutes for this billing period. Upgrade to start new projects.",
          upgradeRequired: true,
        },
        { status: 402 },
      );
    }
    if (project.options.dubbingEnabled && !PLAN_LIMITS[user.plan].dubbingAllowed) {
      return NextResponse.json(
        { error: "Dubbing is a paid-plan feature. Upgrade to enable it.", upgradeRequired: true },
        { status: 402 },
      );
    }
  }

  const [lastJob] = await db
    .select()
    .from(jobs)
    .where(eq(jobs.projectId, id))
    .orderBy(desc(jobs.createdAt))
    .limit(1);
  const stage = resumeStageFor(project.status, lastJob?.stage);

  const [job] = await db
    .insert(jobs)
    .values({ projectId: id, stage, status: "queued" })
    .returning();

  await db
    .update(projects)
    .set({ status: "queued" })
    .where(eq(projects.id, id));

  return NextResponse.json({ job }, { status: 201 });
}
