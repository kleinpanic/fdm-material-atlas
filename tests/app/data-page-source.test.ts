import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../../src/pages/data/index.astro", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../src/styles/data-explorer.css", import.meta.url), "utf8");

describe("data page source contract", () => {
  it("encodes one compact payload and passes it to exactly one server-rendered client island", () => {
    expect(page).toContain("buildDataExplorerModel(loadPublicAtlas(), base)");
    expect(page).toContain("encodeDataExplorerPayload(model)");
    expect(page.match(/<DataExplorerIsland\b/gu)).toHaveLength(1);
    expect(page.match(/client:load/gu)).toHaveLength(1);
    expect(page).toContain("payload={payload}");
    expect(page).not.toMatch(/atlas\.materials\.map|compactFact|client:only/u);
  });

  it("keeps complete static orientation, thermal caution, group guide, method link, and no-script guidance", () => {
    expect(page.match(/<h1\b/gu)).toHaveLength(1);
    expect(page).toContain("breadcrumbs={breadcrumbs}");
    expect(page).toContain("model.materials.length");
    expect(page).toContain("model.groups.map");
    expect(page).toContain("Named thermal tests are not directly interchangeable");
    expect(page).toContain("methodHref");
    expect(page).toMatch(/<noscript\b/u);
  });

  it("imports only local styles and performs no runtime request or raw HTML rendering", () => {
    expect(page).toContain("../../styles/data-explorer.css");
    expect(page).not.toMatch(
      /fetch\s*\(|XMLHttpRequest|dangerouslySetInnerHTML|set:html|https?:\/\//u,
    );
  });

  it("keeps dense data overflow local and preserves an explicit responsive record alternative", () => {
    expect(styles).toMatch(/\.data-table-overflow\s*\{[^}]*overflow-x:\s*auto/su);
    expect(styles).toContain("min-block-size: var(--size-target-min)");
    expect(styles).toContain("@media (max-width: 640px)");
    expect(styles).toContain("@media (min-width: 1024px)");
    expect(styles).toContain(".data-records");
    expect(styles).not.toContain("text-overflow: ellipsis");
    expect(styles).not.toContain("position: sticky");
  });

  it("keeps focus, reduced-motion, and forced-color behavior explicit", () => {
    expect(styles).toContain(":focus-visible");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain("@media (forced-colors: active)");
  });
});
