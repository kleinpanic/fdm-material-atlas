import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../../src/pages/data/index.astro", import.meta.url), "utf8");

describe("data page source contract", () => {
  it("compiles one compact model and passes it to exactly one server-rendered client island", () => {
    expect(page).toContain("buildDataExplorerModel(loadPublicAtlas(), base)");
    expect(page.match(/<DataExplorerIsland\b/gu)).toHaveLength(1);
    expect(page.match(/client:load/gu)).toHaveLength(1);
    expect(page).toContain("model={model}");
    expect(page).not.toMatch(/atlas\.materials\.map|compactFact|client:only/u);
  });

  it("keeps complete static orientation, thermal caution, group guide, method link, and no-script guidance", () => {
    expect(page.match(/<h1\b/gu)).toHaveLength(1);
    expect(page).toContain("breadcrumbs={breadcrumbs}");
    expect(page).toContain("model.materials.length");
    expect(page).toContain("model.groups.map");
    expect(page).toContain("Named thermal tests are not directly interchangeable");
    expect(page).toContain("methodHref");
    expect(page).toMatch(/<noscript>/u);
  });

  it("imports only local styles and performs no runtime request or raw HTML rendering", () => {
    expect(page).toContain('../../styles/data-explorer.css');
    expect(page).not.toMatch(/fetch\s*\(|XMLHttpRequest|dangerouslySetInnerHTML|set:html|https?:\/\//u);
  });
});
