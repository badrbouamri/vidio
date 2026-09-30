import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { UserButton } from "@clerk/nextjs";
import { getDb } from "@/db";
import { projects } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { Button } from "@/components/ui/button";

// UI screen 3 (PRD §10): projects list + "New project".
export default async function DashboardPage() {
  const userId = await requireUserId();
  const db = getDb();
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.createdAt));

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 p-8">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <div className="flex items-center gap-3">
          <Button asChild variant="outline">
            <Link href="/account">Account</Link>
          </Button>
          <Button asChild>
            <Link href="/dashboard/new">New project</Link>
          </Button>
          <UserButton />
        </div>
      </header>

      {rows.length === 0 ? (
        <p className="text-muted-foreground">
          No projects yet. Create one to get started.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border">
          {rows.map((p) => (
            <li key={p.id}>
              <Link
                href={`/dashboard/${p.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-muted"
              >
                <span className="font-medium">{p.name}</span>
                <span className="text-sm text-muted-foreground capitalize">
                  {p.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
