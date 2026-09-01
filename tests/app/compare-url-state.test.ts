import { describe, expect, it } from "vitest";

import type { MaterialId } from "../../src/data/schema/ids.ts";
import {
  decodeCompareUrlState,
  encodeCompareUrlState,
} from "../../src/features/comparison/url-state.ts";

const id = (value: string) => value as MaterialId;
const A = id("material-synthetic-alpha");
const B = id("material-synthetic-beta");
const C = id("material-synthetic-gamma");
const D = id("material-synthetic-delta");
const E = id("material-synthetic-epsilon");
const KNOWN = Object.freeze([A, B, C, D, E]);

describe("compare URL state", () => {
  it("round-trips two through four known IDs in insertion order", () => {
    for (const [base, expectedPrefix] of [
      ["/", "/compare/"],
      ["/atlas-preview/", "/atlas-preview/compare/"],
    ] as const) {
      for (const selected of [[B, A], [C, A, B], [D, B, A, C]] as const) {
        const encoded = encodeCompareUrlState(selected, KNOWN, base, "https://atlas.example/current/?old=1#old");
        expect(encoded).toEqual({
          kind: "valid",
          materialIds: selected,
          href: `${expectedPrefix}${selected.map((value) => `material=${value}`).join("&")}`.replace("/material=", "/?material="),
        });
        if (encoded.kind !== "valid") continue;
        expect(decodeCompareUrlState(encoded.href.slice(encoded.href.indexOf("?")), KNOWN)).toEqual({
          kind: "valid",
          materialIds: selected,
        });
      }
    }
  });

  it.each(["", "?"])('treats empty search %j as the documented empty state', (search) => {
    expect(decodeCompareUrlState(search, KNOWN)).toEqual({ kind: "empty" });
  });

  it.each([
    ["unknown ID", `?material=${A}&material=material-unknown`],
    ["duplicate ID", `?material=${A}&material=${A}`],
    ["one ID", `?material=${A}`],
    ["five IDs", `?material=${A}&material=${B}&material=${C}&material=${D}&material=${E}`],
    ["empty value", `?material=${A}&material=`],
    ["extra key", `?material=${A}&material=${B}&mode=unsafe`],
    ["object-like value", `?material=${A}&material=%5Bobject%20Object%5D`],
  ])("rejects the complete set for %s", (_label, search) => {
    const result = decodeCompareUrlState(search, KNOWN);
    expect(result.kind).toBe("invalid");
    expect(result).not.toHaveProperty("materialIds");
  });

  it("rejects non-string and oversized decoder inputs before interpretation", () => {
    for (const input of [null, undefined, [], {}, new URLSearchParams(`material=${A}&material=${B}`)]) {
      expect(decodeCompareUrlState(input, KNOWN)).toMatchObject({ kind: "invalid" });
    }
    expect(decodeCompareUrlState(`?${"x".repeat(4_097)}`, KNOWN)).toEqual({
      kind: "invalid",
      code: "COMPARE_URL_TOO_LONG",
    });
  });

  it("rejects invalid encoder arrays without serializing an accepted subset", () => {
    for (const input of [
      [A],
      [A, A],
      [A, "material-unknown"],
      [A, B, C, D, E],
      [A, B, {}],
      "material-synthetic-alpha",
      null,
    ]) {
      const result = encodeCompareUrlState(input, KNOWN, "/", "https://atlas.example/current/");
      expect(result.kind).toBe("invalid");
      expect(result).not.toHaveProperty("href");
    }
  });

  it("fails closed for unsafe base and document origins", () => {
    expect(encodeCompareUrlState([A, B], KNOWN, "https://evil.example/", "https://atlas.example/current/"))
      .toEqual({ kind: "invalid", code: "COMPARE_URL_CONTEXT_INVALID" });
    for (const documentUrl of [
      "https://user:secret@atlas.example/current/",
      "data:text/html,unsafe",
      "not a URL",
      { origin: "https://atlas.example" },
    ]) {
      expect(encodeCompareUrlState([A, B], KNOWN, "/", documentUrl)).toEqual({
        kind: "invalid",
        code: "COMPARE_URL_CONTEXT_INVALID",
      });
    }
  });
});
