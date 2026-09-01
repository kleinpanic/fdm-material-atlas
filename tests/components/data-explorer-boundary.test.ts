import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("data explorer component boundary", () => {
  it("keeps one island as the sole state and safe transform owner", () => {
    const island = source("../../src/components/data-explorer/DataExplorerIsland.tsx");
    const controls = source("../../src/components/data-explorer/DataControls.tsx");
    expect(island).toContain("safeExplore");
    expect(island).toContain("useState");
    expect(island).toContain("150");
    expect(island.match(/role="status"/gu)).toHaveLength(1);
    expect(controls).not.toMatch(/safeExplore|exploreData|preact\/hooks/u);
  });

  it("uses labeled native controls for every closed explorer dimension", () => {
    const controls = source("../../src/components/data-explorer/DataControls.tsx");
    expect(controls).toMatch(/<form\b/u);
    expect(controls).toMatch(/type="search"/u);
    expect(controls.match(/<select\b/gu)?.length).toBeGreaterThanOrEqual(5);
    expect(controls).toMatch(/type="radio"/u);
    expect(controls).toMatch(/<dl\b/u);
    expect(controls).toContain("Clear filters");
    expect(controls).toContain("FACT_STATE_OPTIONS");
    expect(controls).toContain("EVIDENCE_SCOPE_OPTIONS");
  });

  it("validates currentTarget values and avoids network, persistence, navigation, and raw HTML", () => {
    const island = source("../../src/components/data-explorer/DataExplorerIsland.tsx");
    const controls = source("../../src/components/data-explorer/DataControls.tsx");
    const all = `${island}\n${controls}`;
    expect(controls).toContain("event.currentTarget.value");
    expect(controls).toMatch(/\.some\s*\(/u);
    expect(all).not.toMatch(/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|dangerouslySetInnerHTML|console\.|window\.location|history\./u);
  });

  it("retains the active group on clear and exposes a controlled reset alert", () => {
    const island = source("../../src/components/data-explorer/DataExplorerIsland.tsx");
    expect(island).toContain("group: current.group");
    expect(island).toContain('role="alert"');
    expect(island).toContain("Reset explorer");
  });
});
