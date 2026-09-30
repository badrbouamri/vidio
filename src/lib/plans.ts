export type Plan = "free" | "pro";

export type PlanLimits = {
  minutesPerMonth: number;
  watermark: boolean;
  // Names the plan's "720p"/"1080p" figure — for our 9:16 portrait output
  // that's actually the WIDTH (1080x1920 is what everyone calls "1080p"
  // vertical video); worker/main.py does the width->height conversion.
  maxHeight: number;
  dubbingAllowed: boolean;
};

// FR-40/FR-41. Paid-tier minutes figure is an [ASSUMPTION] — PRD doesn't
// name one ("more minutes"), see docs/DECISIONS.md.
export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: { minutesPerMonth: 60, watermark: true, maxHeight: 720, dubbingAllowed: false },
  pro: { minutesPerMonth: 300, watermark: false, maxHeight: 1080, dubbingAllowed: true },
};

export function remainingMinutes(plan: Plan, minutesUsedPeriod: number): number {
  return Math.max(0, PLAN_LIMITS[plan].minutesPerMonth - minutesUsedPeriod);
}

// Edge case §11: "User runs out of minutes mid-job → job finishes current
// project; new projects blocked with upgrade prompt." This is the "new
// projects blocked" half — a binary out-of-minutes gate at start time, not
// a precise per-project check (a fresh upload's exact duration isn't known
// until the ingest stage probes it).
export function canStartNewProject(plan: Plan, minutesUsedPeriod: number): boolean {
  return remainingMinutes(plan, minutesUsedPeriod) > 0;
}

const MS_PER_MONTH = 30 * 24 * 60 * 60 * 1000; // calendar-month approximation

export function isPeriodExpired(periodResetAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - periodResetAt.getTime() >= MS_PER_MONTH;
}
