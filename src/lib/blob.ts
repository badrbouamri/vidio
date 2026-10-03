// The project's default Blob store (BLOB_READ_WRITE_TOKEN) is provisioned
// public-only (needed for client-side upload in dashboard/new/page.tsx) and
// rejects `access: "private"` outright — reproduced live in production
// ("Vercel Blob: Cannot use private access on a public store"). Everything
// that needs private, signed-download access (FR-33/34: rendered clip
// video/SRT/VTT, export ZIPs) goes through this second, private-access
// store instead. See docs/DECISIONS.md.
export const PRIVATE_BLOB_TOKEN = process.env.PRIVATE_BLOB_READ_WRITE_TOKEN;
