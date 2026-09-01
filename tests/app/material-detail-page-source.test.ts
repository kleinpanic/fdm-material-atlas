import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/pages/materials/[slug].astro", "utf8");
const css = readFileSync("src/styles/material-reference.css", "utf8");

describe("material detail route source", () => {
  it("fans out every validated detail model without slugifying or fallback data", () => {
    expect(page).toContain("buildMaterialDetailModels(loadPublicAtlas(), base)");
    expect(page).toContain("models.map((model)");
    expect(page).toContain("params: { slug: model.slug }");
    expect(page).toContain("props: { model }");
    expect(page).toContain("<MaterialReference model={model} />");
    for (const forbidden of [
      "slugify",
      "client:",
      "fetch(",
      "buildTracerViewModel",
      "sample",
      "fallback",
    ])
      expect(page).not.toContain(forbidden);
  });

  it("uses unique model metadata and closed shell routes", () => {
    expect(page).toContain("`${model.name} material reference | FDM Material Atlas`");
    expect(page).toContain("canonicalPath={model.href}");
    expect(page).toContain('internalHref(base, { id: "home" })');
    expect(page).toContain('internalHref(base, { id: "materials" })');
    expect(page).toContain('internalHref(base, { id: "method" })');
  });

  it("styles the reference rail and compact DOM-preserving stack", () => {
    expect(css).toContain("minmax(280px, 320px)");
    expect(css).toContain("@media (max-width: 63.999rem)");
    expect(css).toContain("@media (forced-colors: active)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).not.toMatch(/(?:^|[;{])\s*order\s*:/mu);
    expect(css).not.toContain("position: sticky");
  });
});
