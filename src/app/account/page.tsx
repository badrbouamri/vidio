import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { usageEvents, users } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { PLAN_LIMITS, remainingMinutes } from "@/lib/plans";
import { Button } from "@/components/ui/button";

// UI screen 8 (PRD §10) / M7.6: plan, remaining minutes, usage history.
// FR-43 (Stripe) isn't wired up yet (see docs/DECISIONS.md — Marketplace
// terms-acceptance is blocked), so "Upgrade" is informational rather than
// a real checkout flow — no mocked payment UI.
export default async function AccountPage() {
  const userId = await requireUserId();
  const db = getDb();

  await db.insert(users).values({ id: userId, email: "" }).onConflictDoNothing();
  const [user] = await db.select().from(users).where(eq(users.id, userId));

  const events = await db
    .select()
    .from(usageEvents)
    .where(eq(usageEvents.userId, userId))
    .orderBy(desc(usageEvents.createdAt))
    .limit(50);

  const plan = user.plan;
  const limits = PLAN_LIMITS[plan];
  const remaining = remainingMinutes(plan, user.minutesUsedPeriod);
  const usedPct = Math.min(
    100,
    Math.round((user.minutesUsedPeriod / limits.minutesPerMonth) * 100),
  );

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 p-8">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Account & billing</h1>
        <Button asChild variant="outline">
          <Link href="/dashboard">Back to projects</Link>
        </Button>
      </header>

      <section className="mb-8 rounded-lg border p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium capitalize">{plan} plan</h2>
          {plan === "free" && (
            <Button disabled title="Payments aren't connected yet">
              Upgrade
            </Button>
          )}
        </div>

        <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${usedPct}%` }}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          {Math.round(user.minutesUsedPeriod)} / {limits.minutesPerMonth} minutes used this
          period · {Math.round(remaining)} remaining
        </p>

        <ul className="mt-4 flex flex-col gap-1 text-sm text-muted-foreground">
          <li>{limits.watermark ? "Watermarked exports" : "No watermark"}</li>
          <li>Up to {limits.maxHeight}p exports</li>
          <li>Dubbing {limits.dubbingAllowed ? "enabled" : "not available on this plan"}</li>
        </ul>

        {plan === "free" && (
          <p className="mt-4 text-xs text-muted-foreground">
            Payments aren&apos;t connected yet — upgrading isn&apos;t available right now.
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">Usage history</h2>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No usage yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex items-center justify-between px-4 py-2">
                <span className="capitalize">{e.type.replace("_", " ")}</span>
                <span className="text-muted-foreground">
                  {e.minutes > 0 && `${e.minutes.toFixed(1)} min`}
                  {e.credits > 0 && `${e.credits.toFixed(1)} credits`}
                </span>
                <span className="text-muted-foreground">
                  {new Date(e.createdAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* FR-3/UI screen 8: "invoices" would list Stripe invoices — no real
          billing provider is connected yet, so there's nothing genuine to
          show here (see docs/DECISIONS.md). Intentionally omitted rather
          than faked. */}
    </div>
  );
}
