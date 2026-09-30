import { afterEach, describe, expect, it, vi } from "vitest";
import { log } from "./log";

describe("log", () => {
  let spy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    spy.mockRestore();
  });

  it("writes one parseable JSON line with the event and fields", () => {
    spy = vi.spyOn(console, "log").mockImplementation(() => {});
    log.info("test.event", { foo: "bar" });
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.level).toBe("info");
    expect(parsed.event).toBe("test.event");
    expect(parsed.foo).toBe("bar");
    expect(typeof parsed.time).toBe("string");
  });

  it("includes the error message and stack for Error instances", () => {
    spy = vi.spyOn(console, "error").mockImplementation(() => {});
    log.error("test.failure", new Error("boom"), { jobId: "j1" });
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.level).toBe("error");
    expect(parsed.error).toBe("boom");
    expect(parsed.jobId).toBe("j1");
    expect(typeof parsed.stack).toBe("string");
  });

  it("stringifies non-Error values passed to error()", () => {
    spy = vi.spyOn(console, "error").mockImplementation(() => {});
    log.error("test.failure", "not an error object");
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.error).toBe("not an error object");
    expect(parsed.stack).toBeUndefined();
  });
});
