import { createHmac, timingSafeEqual } from "crypto";

// FR-34: "download links are signed and expire (~24h)". Vercel Blob's own
// presign/delegation API (issueSignedToken + presignUrl) is built for a
// different scenario (handing a third party standing authority to mint its
// own URLs); we just want a short-lived link for the current user, so this
// signs the {clipVersionId, kind, exp} payload ourselves with a server
// secret and verifies it on the way back in — see docs/DECISIONS.md.
export const DOWNLOAD_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export type DownloadKind = "video" | "srt" | "vtt";

export type Disposition = "attachment" | "inline";

export type DownloadPayload =
  | {
      type: "clip-version";
      clipVersionId: string;
      kind: DownloadKind;
      exp: number;
      // FR-29: the clip editor's <video> preview needs "inline" so the
      // browser plays it instead of downloading it; every other caller
      // wants "attachment" (FR-33's actual downloads).
      disposition?: Disposition;
    }
  // M5.7: a ZIP of selected clips — points at a private Blob pathname
  // directly rather than a DB row, since it has no row of its own.
  | { type: "export"; blobKey: string; exp: number };

function secret(): string {
  const value = process.env.DOWNLOAD_SIGNING_SECRET || process.env.WORKER_INTERNAL_SECRET;
  if (!value) throw new Error("DOWNLOAD_SIGNING_SECRET is not configured");
  return value;
}

function sign(body: string): string {
  return createHmac("sha256", secret()).update(body).digest("base64url");
}

export function signDownloadToken(payload: DownloadPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyDownloadToken(token: string, now = Date.now()): DownloadPayload | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = sign(body);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: DownloadPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp < now) return null;
  return payload;
}
