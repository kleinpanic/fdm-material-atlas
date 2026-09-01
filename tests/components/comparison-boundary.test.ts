import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ComparisonGroups } from "../../src/components/comparison/ComparisonGroups.tsx";
import { compareSelection } from "../../src/features/comparison/difference.ts";
import { buildComparisonModel } from "../../src/features/comparison/model.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";

const islandSource = readFileSync(
  new URL("../../src/components/comparison/CompareIsland.tsx", import.meta.url),
  "utf8",
);
const selectionSource = readFileSync(
  new URL("../../src/components/comparison/CompareSelection.tsx", import.meta.url),
  "utf8",
);
const groupsSource = readFileSync(
  new URL("../../src/components/comparison/ComparisonGroups.tsx", import.meta.url),
  "utf8",
);

function textContent(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textContent).join(" ");
  if (typeof value !== "object" || value === null) return "";
  const record = value as { type?: unknown; props?: { children?: unknown } };
  if (typeof record.type === "function") {
    return textContent(record.type(record.props));
  }
  return textContent(record.props?.children);
}

describe("comparison island boundary", () => {
  it("owns one hydration-safe URL state and one validated history replacement", () => {
    expect(islandSource).toContain("useEffect");
    expect(islandSource).toContain("decodeCompareUrlState(window.location.search");
    expect(islandSource).toContain("encodeCompareUrlState(");
    expect(islandSource).toContain("window.history.replaceState(null, \"\", encoded.href)");
    expect(islandSource).not.toMatch(/useState\([^\n]*(?:window|location|history)/u);
    expect(islandSource).not.toMatch(/fetch\(|localStorage|sessionStorage/u);
    expect(islandSource).not.toMatch(/data\/schema\/atlas|public-atlas|comparison\/model/u);
  });

  it("uses four persistent native slots with explicit required and optional meaning", () => {
    expect(selectionSource.match(/<select\b/gu)).toHaveLength(1);
    expect(selectionSource).toContain("Array.from({ length: 4 }");
    expect(selectionSource).toContain("Material 3 (optional)");
    expect(selectionSource).toContain("No additional material");
    expect(selectionSource).toContain("Update comparison");
    expect(selectionSource).toMatch(/aria-describedby/u);
  });

  it("renders semantic property-first groups with differences before equal disclosure", () => {
    const model = buildComparisonModel(loadPublicAtlas(), "/");
    const selected = model.materials.flatMap((left) => model.materials.flatMap((right) => {
      if (left.id === right.id) return [];
      const leftThermal = left.cells.find(({ key }) => key === "thermal-value");
      const rightThermal = right.cells.find(({ key }) => key === "thermal-value");
      if (leftThermal?.kind !== "thermal" || rightThermal?.kind !== "thermal") return [];
      const leftGroups = new Set(leftThermal.members.map(({ groupId }) => groupId));
      return rightThermal.members.some(({ groupId }) => !leftGroups.has(groupId))
        ? [[left.id, right.id] as const]
        : [];
    }))[0];
    expect(selected).toBeDefined();
    const result = compareSelection(model, selected);
    expect(result.kind).toBe("comparison");
    if (result.kind !== "comparison") return;

    const rendered = textContent(ComparisonGroups({ result }));
    expect(rendered).toContain("Difference");
    expect(rendered).toContain("Same across selected materials");
    expect(rendered).toContain("No comparable observation in this metric and method group");
    for (const material of result.materials) expect(rendered).toContain(material.name);
    expect(groupsSource).toMatch(/<dl\b/u);
    expect(groupsSource).toMatch(/<dt\b/u);
    expect(groupsSource).toMatch(/<dd\b/u);
    expect(groupsSource).toMatch(/<details\b/u);
    expect(groupsSource).not.toMatch(/dangerouslySetInnerHTML|innerHTML/u);
    expect(groupsSource).not.toMatch(/winner|score|rank/iu);
  });
});
