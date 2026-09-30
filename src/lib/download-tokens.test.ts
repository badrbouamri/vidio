import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signDownloadToken, verifyDownloadToken } from "./download-tokens";

describe("download tokens", () => {
  const ORIGINAL_SECRET = process.env.DOWNLOAD_SIGNING_SECRET;

  beforeEach(() => {
    process.env.DOWNLOAD_SIGNING_SECRET = "test-secret";
  });

  afterEach(() => {
    process.env.DOWNLOAD_SIGNING_SECRET = ORIGINAL_SECRET;
  });

  it("round-trips a valid, unexpired token", () => {
    const payload = { clipVersionId: "abc-123", kind: "video" as const, exp: Date.now() + 1000 };
    const token = signDownloadToken(payload);
    expect(verifyDownloadToken(token)).toEqual(payload);
  });

  it("rejects an expired token", () => {
    const payload = { clipVersionId: "abc-123", kind: "video" as const, exp: Date.now() - 1000 };
    const token = signDownloadToken(payload);
    expect(verifyDownloadToken(token)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const token = signDownloadToken({
      clipVersionId: "abc-123",
      kind: "video",
      exp: Date.now() + 1000,
    });
    const [, sig] = token.split(".");
    const tamperedBody = Buffer.from(
      JSON.stringify({ clipVersionId: "other-id", kind: "video", exp: Date.now() + 1000 }),
    ).toString("base64url");
    expect(verifyDownloadToken(`${tamperedBody}.${sig}`)).toBeNull();
  });

  it("rejects garbage input", () => {
    expect(verifyDownloadToken("not-a-token")).toBeNull();
    expect(verifyDownloadToken("")).toBeNull();
  });

  it("respects an injected `now` for expiry checks (FR-34: ~24h)", () => {
    const payload = { clipVersionId: "abc-123", kind: "srt" as const, exp: 1000 };
    const token = signDownloadToken(payload);
    expect(verifyDownloadToken(token, 999)).toEqual(payload);
    expect(verifyDownloadToken(token, 1001)).toBeNull();
  });
});
