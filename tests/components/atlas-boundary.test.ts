import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/features/atlas/AtlasIsland.tsx", "utf8");

describe("atlas island boundary", () => {
  it("accepts only the compact model and delegates classification once", () => {
    expect(source).toContain("pageModel: AtlasPageModel");
    expect(source).toContain("filterAtlas(pageModel, filterState)");
    expect(source.match(/filterAtlas\(/gu)).toHaveLength(1);
    for (const forbidden of [
      "public-atlas",
      "atlas.v1.json",
      "loadPublicAtlas",
      "fetch(",
      "localStorage",
      "sessionStorage",
      "startingProfile",
      "decisionLanes",
      "visualizationReferences",
      "dangerouslySetInnerHTML",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("uses one local filter owner, native controls, and accessible group semantics", () => {
    expect(source).toContain("useState<AtlasFilterState>");
    expect(source).toContain('aria-label="Filter material atlas"');
    expect(source).toContain("<input");
    expect(source).toContain("<select");
    expect(source).toContain("<fieldset");
    expect(source).toContain('role="status"');
    expect(source).toContain('aria-atomic="true"');
    expect(source).toContain("Needs verification for these filters");
    expect(source).toContain("Materials outside these filters");
    expect(source).toContain("<details");
    expect(source).toContain("Clear filters");
    expect(source).toContain("disabled={!hydrated}");
    expect(source).toContain("150");
  });
});
