import { describe, expect, it } from "vitest";
import { extractJsonText } from "./llm-json";

describe("extractJsonText", () => {
  it("returns raw JSON text unchanged", () => {
    expect(extractJsonText('{"a":1}')).toBe('{"a":1}');
  });

  it("strips a ```json fenced block", () => {
    const text = '```json\n{"a":1}\n```';
    expect(extractJsonText(text)).toBe('{"a":1}');
  });

  it("strips a plain ``` fenced block (no language tag)", () => {
    const text = '```\n{"a":1}\n```';
    expect(extractJsonText(text)).toBe('{"a":1}');
  });

  it("trims surrounding whitespace/prose outside a fence", () => {
    const text = '  \n{"a":1}\n  ';
    expect(extractJsonText(text)).toBe('{"a":1}');
  });

  it("takes the first fenced block when there are multiple", () => {
    const text = '```json\n{"a":1}\n```\nSome trailing note.';
    expect(extractJsonText(text)).toBe('{"a":1}');
  });
});
