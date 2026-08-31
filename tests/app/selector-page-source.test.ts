import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const PAGE = resolve(ROOT, "src/pages/index.astro");

describe("selector landing page source contract", () => {
  it("keeps the orientation static and exposes one compact hydrated boundary", async () => {
    const source = await readFile(PAGE, "utf8");

    expect(source).toContain('loadPublicAtlas()');
    expect(source).toContain('buildSelectorPageModel(atlas, base, PUBLIC_ROUTE_REGISTRY)');
    expect(source).toContain('<SelectorIsland pageModel={pageModel} client:load />');
    expect(source.match(/client:load/gu)).toHaveLength(1);
    expect(source.match(/<h1\b/gu)).toHaveLength(1);
    expect(source).toContain("Choose a material that fits your process");
    expect(source).toContain("Alignment scores reflect only the criteria you selected");
    expect(source).toContain("<noscript>");

    expect(source).not.toMatch(/client:(?:only|idle|visible|media)/u);
    expect(source).not.toMatch(/fetch\s*\(/u);
    expect(source).not.toMatch(/<SelectorIsland[^>]*(?:\batlas=|\{\.\.\.atlas\}|pageModel=\{atlas\})/u);
    expect(source).not.toMatch(/source-contract|source-adapter|private|spreadsheet/iu);
    expect(source.indexOf("Choose a material that fits your process"))
      .toBeLessThan(source.indexOf("<SelectorIsland"));
  });
});
