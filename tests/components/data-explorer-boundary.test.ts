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

  it("renders a captioned native sortable table inside one named focusable overflow region", () => {
    const table = source("../../src/components/data-explorer/DataTable.tsx");
    expect(table).toMatch(/<table\b/u);
    expect(table).toMatch(/<caption\b/u);
    expect(table).toContain('scope="col"');
    expect(table).toContain('scope="row"');
    expect(table).toContain("aria-sort");
    expect(table).toContain('tabIndex={0}');
    expect(table).toContain('role="region"');
    expect(table).toMatch(/<button\b/u);
    expect(table).toContain('field.sort !== "none"');
  });

  it("uses the same cell renderer and exact record order for the stacked alternative", () => {
    const table = source("../../src/components/data-explorer/DataTable.tsx");
    const records = source("../../src/components/data-explorer/DataRecords.tsx");
    expect(table).toContain("export function DataCell");
    expect(records).toContain('from "./DataTable.tsx"');
    expect(records).toContain("materials.map");
    expect(records).toContain("fields.map");
    expect(records).toMatch(/<article\b/u);
    expect(records).toMatch(/<dl\b/u);
    expect(table).toContain("cell.evidence.length");
  });

  it("mounts only the selected view and renders no empty table or record structure", () => {
    const island = source("../../src/components/data-explorer/DataExplorerIsland.tsx");
    expect(island).toContain('current.view === "table"');
    expect(island).toContain("result.resultCount === 0");
    expect(island).toContain("No materials match");
  });
});
