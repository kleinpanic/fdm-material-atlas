import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const PAGE = resolve(ROOT, "src/pages/index.astro");
const STYLES = resolve(ROOT, "src/styles/selector.css");
const CONTROLS = resolve(ROOT, "src/components/selector/SelectorControls.tsx");
const FOOTER = resolve(ROOT, "src/components/shell/SiteFooter.astro");

describe("selector landing page source contract", () => {
  it("keeps the orientation static and exposes one compact hydrated boundary", async () => {
    const source = await readFile(PAGE, "utf8");

    expect(source).toContain("loadPublicAtlas()");
    expect(source).toContain("buildSelectorPageModel(atlas, base, PUBLIC_ROUTE_REGISTRY)");
    expect(source).toContain("<SelectorIsland pageModel={pageModel} client:load />");
    expect(source.match(/client:load/gu)).toHaveLength(1);
    expect(source.match(/<h1\b/gu)).toHaveLength(1);
    expect(source).toContain("Choose a material that fits your process");
    expect(source).toContain("Alignment scores reflect only the criteria you selected");
    expect(source).toContain("<noscript>");

    expect(source).not.toMatch(/client:(?:only|idle|visible|media)/u);
    expect(source).not.toMatch(/fetch\s*\(/u);
    expect(source).not.toMatch(
      /<SelectorIsland[^>]*(?:\batlas=|\{\.\.\.atlas\}|pageModel=\{atlas\})/u,
    );
    expect(source).not.toMatch(/source-contract|source-adapter|private|spreadsheet/iu);
    expect(source.indexOf("Choose a material that fits your process")).toBeLessThan(
      source.indexOf("<SelectorIsland"),
    );
  });

  it("uses a scoped token-only responsive worksheet contract", async () => {
    const [page, styles] = await Promise.all([readFile(PAGE, "utf8"), readFile(STYLES, "utf8")]);

    expect(page).toContain('import "../styles/selector.css"');
    expect(page).toContain('class="selector-experience"');
    for (const required of [
      "@media (min-width: 64rem)",
      "@media (max-width: 39.999rem)",
      "@media (prefers-reduced-motion: reduce)",
      "@media (forced-colors: active)",
      "minmax(320px, 380px)",
      "min-block-size: var(--size-target-min)",
      "outline: var(--size-focus-ring) solid var(--color-focus)",
      "overflow-wrap: anywhere",
      "input:checked",
      ".selector-shortlist",
      ".selector-eliminated",
      ".selector-compatible-list",
    ]) {
      expect(styles).toContain(required);
    }

    expect(styles).not.toMatch(
      /#[\da-f]{3,8}\b|(?:linear|radial|conic)-gradient|backdrop-filter/iu,
    );
    expect(styles).not.toMatch(
      /position:\s*sticky|overflow(?:-y)?:\s*(?:auto|scroll)|text-overflow:\s*ellipsis/iu,
    );
    expect(styles).not.toMatch(/(?:^|[;{]\s*)order\s*:/mu);
  });

  it("ships the process controls open and production-ready footer guidance", async () => {
    const [controls, footer] = await Promise.all([
      readFile(CONTROLS, "utf8"),
      readFile(FOOTER, "utf8"),
    ]);

    expect(controls).toContain('class="selector-secondary" open');
    expect(footer).toContain("Material guidance is comparative.");
    expect(footer).not.toContain("foundation route");
    expect(footer).not.toContain("not a complete recommendation");
  });
});
