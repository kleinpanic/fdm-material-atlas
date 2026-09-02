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

  it("defers material sections with stable measured geometry and preserves print layout", () => {
    expect(css).toMatch(/:root\s*\{\s*scroll-behavior:\s*auto;/u);
    expect(css).toMatch(
      /@media screen\s*\{[\s\S]*?section:not\(\s*:first-child\s*\):not\(\s*:target\s*\):not\(\s*:focus-within\s*\)[\s\S]*?content-visibility:\s*auto;[\s\S]*?contain-intrinsic-block-size:\s*auto var\(--material-section-intrinsic-size\);/u,
    );
    for (const [id, size] of [
      ["thermal", "1045px"],
      ["properties", "3142px"],
      ["process", "2088px"],
      ["uses-tradeoffs", "952px"],
      ["starting-profile", "1354px"],
      ["evidence", "3005px"],
      ["limitations", "295px"],
      ["relationships", "2020px"],
    ]) {
      expect(css).toMatch(
        new RegExp(`#${id}\\s*\\{\\s*--material-section-intrinsic-size:\\s*${size};`, "u"),
      );
    }
    expect(css).toContain("@media screen and (max-width: 39.999rem)");
    expect(css).not.toMatch(/:has\(\s*~\s*section:focus-within\s*\)/u);
    expect(css).not.toMatch(/:has\(\s*~\s*section:target\s*\)/u);
    const printRules = css.match(/@media print\s*\{[\s\S]*?\n\}/gu)?.join("\n") ?? "";
    expect(printRules).not.toContain("content-visibility: auto");
    expect(printRules).not.toContain("contain-intrinsic-block-size");
  });
});
