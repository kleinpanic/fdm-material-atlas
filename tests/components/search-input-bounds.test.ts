import { h } from "preact";
import render from "preact-render-to-string";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { AtlasIsland } from "../../src/features/atlas/AtlasIsland.tsx";
import { buildAtlasPageModel } from "../../src/features/atlas/model.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";

describe("search input bounds", () => {
  it("caps atlas search input at the filter limit so long input cannot crash the island", () => {
    const pageModel = buildAtlasPageModel(loadPublicAtlas(), "/");
    const html = render(h(AtlasIsland, { pageModel }));
    expect(html).toMatch(/<input[^>]*id="atlas-search"[^>]*maxlength="500"/u);
    const source = readFileSync("src/features/atlas/AtlasIsland.tsx", "utf8");
    expect(source).toContain("event.currentTarget.value.slice(0, ATLAS_SEARCH_MAX_LENGTH)");
  });

  it("caps both map search inputs at the map query limit", () => {
    for (const file of ["ThermalGuidance.tsx", "ImpactFlexMatrix.tsx"]) {
      const source = readFileSync(`src/components/map/${file}`, "utf8");
      expect(source).toMatch(/type="search"[\s\S]{0,120}maxLength=\{120\}/u);
    }
  });
});
