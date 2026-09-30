import type { VercelConfig } from "@vercel/config/v1";

// M8.4/NFR Privacy: auto-delete source files after 30 days.
export const config: VercelConfig = {
  crons: [{ path: "/api/cron/retention", schedule: "0 3 * * *" }],
};
