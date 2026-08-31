import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { deriveDecisionLaneMembership } from "../../src/domain/decision-lanes/membership.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";

describe("decision map page", () => {
  const atlas = loadPublicAtlas();
  const lanes = deriveDecisionLaneMembership(atlas);

  it("derives every board lane and material link from canonical data", () => {
    expect(lanes).toHaveLength(8);
    expect(lanes.every(({ candidateMaterialIds }) => candidateMaterialIds.length > 0)).toBe(true);

    const materialIds = new Set(atlas.materials.map(({ id }) => id));
    for (const lane of lanes) {
      expect(lane.candidateMaterialIds.every((id) => materialIds.has(id))).toBe(true);
    }
  });

  it("presents the complete four-stage decision flow without client-only logic", () => {
    const component = readFileSync("src/components/map/DecisionBoard.astro", "utf8");

    for (const stage of ["Need", "Property to check", "Live candidates", "Verify / process gates"]) {
      expect(component).toContain(stage);
    }
    expect(component).toContain("lane.candidateMaterialIds.map");
    expect(component).toContain("lane.processGates.map");
    expect(component).toContain("internalHref");
    expect(component).not.toContain("client:");
    expect(component).not.toContain("dangerouslySetInnerHTML");
  });

  it("retains keyboard targets, non-color labels, and reduced-motion styling", () => {
    const component = readFileSync("src/components/map/DecisionBoard.astro", "utf8");
    const styles = readFileSync("src/styles/map-board.css", "utf8");

    expect(component).toContain('tabindex="-1"');
    expect(component).toContain("Process gates");
    expect(styles).toContain("prefers-reduced-motion: reduce");
    expect(styles).toContain("forced-colors: active");
  });
});
