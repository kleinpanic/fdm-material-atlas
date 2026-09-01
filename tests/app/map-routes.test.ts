import { describe, expect, it } from "vitest";

import { decisionLaneIds } from "../../src/data/schema/decision-lane.ts";
import {
  internalMapFragmentHref,
  mapFragmentHref,
  mapLaneFragments,
  mapModeFragments,
  type MapFragment,
} from "../../src/lib/routes.ts";

const EXPECTED_MODES = [
  "decision-paths",
  "thermal-ranges",
  "process-gates",
  "impact-flex-space",
] as const;

describe("closed map route inventory", () => {
  it("exposes exactly four modes and the eight canonical lane fragments", () => {
    expect(mapModeFragments).toEqual(EXPECTED_MODES);
    expect(mapLaneFragments).toEqual(decisionLaneIds);
    expect(new Set([...mapModeFragments, ...mapLaneFragments]).size).toBe(12);
  });

  it.each([
    ["/", "/map/#"],
    ["/atlas-preview/", "/atlas-preview/map/#"],
  ])("composes every closed fragment under the map target once for %s", (base, prefix) => {
    const fragments: readonly MapFragment[] = [...mapModeFragments, ...mapLaneFragments];

    expect(fragments.map((fragment) => mapFragmentHref(fragment))).toEqual(
      fragments.map((fragment) => `#${fragment}`),
    );
    expect(fragments.map((fragment) => internalMapFragmentHref(base, fragment))).toEqual(
      fragments.map((fragment) => `${prefix}${fragment}`),
    );
  });

  it.each([
    "",
    "decision-paths#decision-paths",
    "unknown-mode",
    "lane-missing",
    "lane-easy-prototypes%23process-gates",
    "https://example.com/#decision-paths",
    "../decision-paths",
    "/map/#decision-paths",
    "/atlas-preview/map/#decision-paths",
  ])("rejects values outside the exact map fragment inventory: %s", (fragment) => {
    expect(() => mapFragmentHref(fragment as MapFragment)).toThrow("MAP_FRAGMENT_INVALID");
    expect(() => internalMapFragmentHref("/atlas-preview/", fragment as MapFragment)).toThrow(
      "MAP_FRAGMENT_INVALID",
    );
  });
});
