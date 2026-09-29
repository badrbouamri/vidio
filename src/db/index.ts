import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// Lazy init: `neon()` throws if DATABASE_URL is unset, and Next.js evaluates
// top-level module code at build time — a plain module-level client would
// crash `next build` before the Marketplace integration provisions env vars.
// Do NOT wrap this in a Proxy (breaks libraries that introspect the client).
function createDb() {
  const sql = neon(process.env.DATABASE_URL!);
  return drizzle(sql, { schema });
}

let _db: ReturnType<typeof createDb> | null = null;

export function getDb() {
  if (!_db) _db = createDb();
  return _db;
}
