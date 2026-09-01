import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../../src/pages/compare/index.astro", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../src/styles/comparison.css", import.meta.url), "utf8");

describe("compare page source contract", () => {
  it("compiles one compact model at build time and passes it once to one SSR island", () => {
    expect(page).toContain("buildComparisonModel(loadPublicAtlas(), base)");
    expect(page.match(/<CompareIsland\b/gu)).toHaveLength(1);
    expect(page.match(/client:load/gu)).toHaveLength(1);
    expect(page).toContain("model={model}");
    expect(page).not.toMatch(/client:only|atlas=\{|atlas\.materials\.map|compactFact/u);
  });

  it("keeps static orientation, non-ranking and thermal cautions, fallback, and closed links", () => {
    expect(page.match(/<h1\b/gu)).toHaveLength(1);
    expect(page).toContain("breadcrumbs={breadcrumbs}");
    expect(page).toContain("does not rank a universally better material");
    expect(page).toContain("Named thermal tests are not directly interchangeable");
    expect(page).toMatch(/<noscript>/u);
    expect(page).toContain("methodHref");
    expect(page).toContain("materialsHref");
    expect(page).toContain("homeHref");
    expect(page).toContain('id="comparison-matrix"');
  });

  it("uses only local styles and no request, raw HTML, or guessed route", () => {
    expect(page).toContain("../../styles/comparison.css");
    expect(page).not.toMatch(
      /fetch\s*\(|XMLHttpRequest|dangerouslySetInnerHTML|set:html|https?:\/\//u,
    );
  });

  it("uses one property-first DOM that stacks below 768px without comparison scrolling", () => {
    expect(styles).toContain("grid-template-columns: repeat(auto-fit, minmax(176px, 1fr))");
    expect(styles).toContain("@media (max-width: 768px)");
    expect(styles).toContain("@media (max-width: 640px)");
    expect(styles).toContain("min-block-size: var(--size-target-min)");
    expect(styles).toContain("overflow-wrap: anywhere");
    expect(styles).toContain("max-inline-size: 100%");
    expect(styles).not.toMatch(/overflow-x:\s*(?:auto|scroll)/u);
    expect(styles).not.toContain("position: sticky");
    expect(styles).not.toContain("linear-gradient");
  });

  it("keeps focus, reduced motion, and forced-color behavior explicit", () => {
    expect(styles).toContain(":focus-visible");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain("@media (forced-colors: active)");
  });
});
