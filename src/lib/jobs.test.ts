import { describe, expect, it } from "vitest";
import { resumeStageFor } from "./jobs";

describe("resumeStageFor", () => {
  it("starts at ingest for a brand-new project", () => {
    expect(resumeStageFor("created", undefined)).toBe("ingest");
  });

  it("resumes from the failed stage on retry (FR-38 — no re-upload)", () => {
    expect(resumeStageFor("failed", "render")).toBe("render");
  });

  it("falls back to ingest if a failed project somehow has no prior job", () => {
    expect(resumeStageFor("failed", undefined)).toBe("ingest");
  });
});
