import { describe, expect, it } from "vitest";
import { formatTimestamp } from "./format";

describe("formatTimestamp", () => {
  it("formats under a minute", () => {
    expect(formatTimestamp(5)).toBe("0:05");
  });

  it("formats minutes and seconds", () => {
    expect(formatTimestamp(125)).toBe("2:05");
  });

  it("formats past an hour with zero-padded minutes", () => {
    expect(formatTimestamp(3725)).toBe("1:02:05");
  });

  it("clamps negative input to zero", () => {
    expect(formatTimestamp(-5)).toBe("0:00");
  });
});
