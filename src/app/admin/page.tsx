import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { jobs, projects, users } from "@/db/schema";
import { requireAdmin } from "@/lib/admin";
import { DisableButton } from "./disable-button";
import { RefundForm } from "./refund-form";

// UI screen 9 (PRD §10) / FR-44: users, jobs, failures, cost per job,
// refund minutes. Restricted to users.is_admin (src/lib/admin.ts).
export default async function AdminPage() {
  await requireAdmin();
  const db = getDb();

  const userRows = await db.select().from(users).orderBy(desc(users.createdAt)).limit(200);

  const jobRows = await db
    .select({
      id: jobs.id,
      stage: jobs.stage,
      status: jobs.status,
      error: jobs.error,
      costUsd: jobs.costUsd,
      createdAt: jobs.createdAt,
      projectName: projects.name,
      userEmail: users.email,
    })
    .from(jobs)
    .innerJoin(projects, eq(jobs.projectId, projects.id))
    .innerJoin(users, eq(projects.userId, users.id))
    .orderBy(desc(jobs.createdAt))
    .limit(100);

  const totalCost = jobRows.reduce((sum, j) => sum + j.costUsd, 0);
  const failures = jobRows.filter((j) => j.status === "failed");

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 p-8">
      <h1 className="mb-8 text-2xl font-semibold">Admin</h1>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-medium">
          Users <span className="text-sm text-muted-foreground">({userRows.length})</span>
        </h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr>
                <th className="p-2">Email</th>
                <th className="p-2">Plan</th>
                <th className="p-2">Status</th>
                <th className="p-2">Minutes used</th>
                <th className="p-2">Refund</th>
                <th className="p-2">Account</th>
              </tr>
            </thead>
            <tbody>
              {userRows.map((u) => (
                <tr key={u.id} className="border-t">
                  <td className="p-2">{u.email || u.id}</td>
                  <td className="p-2 capitalize">{u.plan}</td>
                  <td className="p-2">
                    {u.isDisabled ? (
                      <span className="text-destructive">Disabled</span>
                    ) : (
                      "Active"
                    )}
                  </td>
                  <td className="p-2">{u.minutesUsedPeriod.toFixed(1)}</td>
                  <td className="p-2">
                    <RefundForm userId={u.id} />
                  </td>
                  <td className="p-2">
                    <DisableButton userId={u.id} isDisabled={u.isDisabled} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">
          Jobs{" "}
          <span className="text-sm text-muted-foreground">
            (last {jobRows.length} · {failures.length} failed · ${totalCost.toFixed(4)} total cost)
          </span>
        </h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr>
                <th className="p-2">User</th>
                <th className="p-2">Project</th>
                <th className="p-2">Stage</th>
                <th className="p-2">Status</th>
                <th className="p-2">Cost</th>
                <th className="p-2">Error</th>
                <th className="p-2">When</th>
              </tr>
            </thead>
            <tbody>
              {jobRows.map((j) => (
                <tr key={j.id} className="border-t">
                  <td className="p-2">{j.userEmail}</td>
                  <td className="p-2">{j.projectName}</td>
                  <td className="p-2 capitalize">{j.stage}</td>
                  <td
                    className={`p-2 capitalize ${j.status === "failed" ? "text-destructive" : ""}`}
                  >
                    {j.status}
                  </td>
                  <td className="p-2">${j.costUsd.toFixed(4)}</td>
                  <td className="max-w-xs truncate p-2 text-muted-foreground">{j.error}</td>
                  <td className="p-2 text-muted-foreground">
                    {new Date(j.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
