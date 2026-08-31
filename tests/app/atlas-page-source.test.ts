import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/pages/materials/index.astro", "utf8");
const css = readFileSync("src/styles/atlas.css", "utf8");

describe("material atlas route source", () => {
  it("loads and compiles only at build time, then renders one SSR island", () => {
    expect(page).toContain("loadPublicAtlas()");
    expect(page).toContain("buildAtlasPageModel(atlas, base)");
    expect(page).toContain("<AtlasIsland pageModel={pageModel} client:load />");
    expect(page.match(/client:load/gu)).toHaveLength(1);
    expect(page).toContain("pageModel.rows.length");
    for (const forbidden of ["client:only", "fetch(", "loading=", "skeleton", "JSON.stringify", "atlas.v1.json"]) expect(page).not.toContain(forbidden);
  });

  it("uses closed base-safe shell routes and approved static orientation", () => {
    expect(page).toContain('internalHref(base, { id: "home" })');
    expect(page).toContain('internalHref(base, { id: "materials" })');
    expect(page).toContain('internalHref(base, { id: "method" })');
    expect(page).toContain("Material atlas");
    expect(page).toContain("Search all validated materials");
    expect(page).toContain("Interactive filters are unavailable. All validated materials remain listed below.");
  });

  it("provides responsive ruled-list styles without nested result scrolling or decorative motion", () => {
    expect(css).toContain("grid-template-columns: minmax(280px, 360px) minmax(0, 1fr)");
    expect(css).toContain("border-block-start");
    expect(css).toContain("@media (max-width: 63.999rem)");
    expect(css).toContain("@media (forced-colors: active)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).not.toMatch(/\.atlas-results[^}]*overflow/isu);
    expect(css).not.toContain("position: sticky");
  });
});
