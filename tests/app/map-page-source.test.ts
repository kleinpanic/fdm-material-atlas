import { existsSync, readFileSync } from "node:fs";

import { h } from "preact";
import render from "preact-render-to-string";
import { describe, expect, it } from "vitest";

import { MapExplorerIsland } from "../../src/components/map/MapExplorerIsland.tsx";
import { MAP_MODES } from "../../src/features/map/contracts.ts";
import { compileMapProjection } from "../../src/features/map/projection.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";

const pagePath = "src/pages/map/index.astro";
const legacyBoardPath = "src/components/map/DecisionBoard.astro";
const page = readFileSync(pagePath, "utf8");
const styles = readFileSync("src/styles/map-board.css", "utf8");
const projection = compileMapProjection(loadPublicAtlas(), "/repo/");
const renderedIsland = render(h(MapExplorerIsland, { projection }));

function occurrences(source: string, value: string | RegExp): number {
  if (typeof value === "string") return source.split(value).length - 1;
  return source.match(value)?.length ?? 0;
}

describe("static-first map page source", () => {
  it("compiles one compact build-only projection into one visible enhancement boundary", () => {
    expect(page).toContain('import { compileMapProjection } from "../../features/map/projection.ts"');
    expect(page).toContain("const projection = compileMapProjection(atlas, base)");
    expect(occurrences(page, /<MapExplorerIsland\b/g)).toBe(1);
    expect(page).toContain('client:visible={{ rootMargin: "200px" }}');
    expect(page).not.toMatch(/client:(?:load|only)|fetch\s*\(|dangerouslySetInnerHTML|set:html/);
    expect(page).not.toMatch(/deriveDecisionLaneMembership|materialById|DecisionBoard/);
  });

  it("renders compact orientation, caution, mode directory, and no-script meaning before the island", () => {
    for (const copy of [
      "Material decision maps",
      "Trace material choices through properties and process gates",
      "Follow a use need to the properties, live material candidates, and process checks that require verification. Then inspect selected scientific relationships without combining unlike measurements.",
      "Read paths and plots as guidance",
      "Candidate status means that a material satisfies the published lane rule. It is not a universal recommendation, safety approval, or engineering certification.",
      "Explore visualization modes",
      "Interactive map controls are preparing",
      "Interactive highlighting is unavailable. All decision paths and structured visualization data remain readable below.",
    ]) expect(page).toContain(copy);

    expect(page.indexOf("Explore visualization modes")).toBeLessThan(page.indexOf("<MapExplorerIsland"));
    expect(page.indexOf("Interactive map controls are preparing")).toBeLessThan(page.indexOf("<MapExplorerIsland"));
    expect(page).toContain('breadcrumbs={[{ label: "Home", href: homeHref }, { label: "Decision maps", current: true }]}');
    expect(page).toContain('title="Decision maps | FDM Material Atlas"');
  });

  it("uses all exact projection-owned mode and lane fragment hrefs with complete SSR analyses", () => {
    expect(projection.lanes).toHaveLength(8);
    for (const mode of MAP_MODES) {
      expect(page).toContain(`projection.modeFragments["${mode}"]`);
      expect(renderedIsland).toContain(`map-mode--${mode === "thermal-ranges" ? "thermal" : mode === "process-gates" ? "process-gates" : mode === "impact-flex-space" ? "impact-flex" : "decision-paths"}`);
    }
    for (const lane of projection.lanes) {
      expect(page).toContain("projection.lanes.map");
      expect(renderedIsland).toContain(`id=\"${lane.id}\"`);
      expect(renderedIsland).toContain(lane.need);
      for (const candidate of lane.candidates) expect(renderedIsland).toContain(candidate.href);
      for (const gate of lane.processGates) {
        expect(renderedIsland).toContain(gate.requirement);
        expect(renderedIsland).toContain(gate.verification);
      }
    }
    expect(renderedIsland).toContain("Practical service guidance");
    expect(renderedIsland).toContain("Compare only matching metric and method groups.");
    expect(renderedIsland).toContain("Process-gate relationships by decision lane");
    expect(renderedIsland).toContain("All materials in categorical order");
    expect(renderedIsland).toContain(projection.methodHref);
    expect(renderedIsland).not.toContain("Selected record");
  });

  it("removes the obsolete board and keeps source links projection-owned", () => {
    expect(existsSync(legacyBoardPath)).toBe(false);
    expect(page).not.toMatch(/DecisionBoard|internalMapFragmentHref|`\/?map|\+\s*["']#|href=\{?\s*["']#/);
    expect(page).not.toMatch(/https?:\/\//);
  });

  it("records the audited responsive geometry and state contracts", () => {
    for (const contract of [
      "--map-header-max: 25vh",
      "--map-hero-max: 52vh",
      "--map-title-max: 28vh",
      "min-block-size: var(--size-target-min)",
      "overflow-wrap: anywhere",
      "prefers-reduced-motion: reduce",
      "prefers-reduced-motion: no-preference",
      "forced-colors: active",
    ]) expect(styles).toContain(contract);
    expect(styles).not.toMatch(/linear-gradient|radial-gradient|backdrop-filter|text-overflow:\s*ellipsis|overflow:\s*hidden/);
  });
});
