import { describe, expect, it } from "vitest";

import { filterAtlas } from "../../src/features/atlas/filter.ts";
import { buildAtlasPageModel, type AtlasPageModel } from "../../src/features/atlas/model.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";

const model = buildAtlasPageModel(loadPublicAtlas(), "/");

describe("filterAtlas", () => {
  it("returns every row as a match in stable canonical order when clear", () => {
    const result = filterAtlas(model, { search: "", selections: {} });
    expect(result.counts).toEqual({ matches: 23, needsVerification: 0, outside: 0, total: 23 });
    expect(result.matches.map(({ row }) => row.id)).toEqual(model.rows.map(({ id }) => id));
    expect(result.activeFilters).toEqual([]);
  });

  it("searches normalized material name and family/filler only without relevance sorting", () => {
    const byName = filterAtlas(model, { search: `  ${model.rows[0]!.name.toUpperCase()}  `, selections: {} });
    expect(byName.matches.map(({ row }) => row.id)).toContain(model.rows[0]!.id);
    const family = model.rows.find(({ family }) => family.value)?.family.value ?? "polymer";
    expect(filterAtlas(model, { search: family.toUpperCase(), selections: {} }).matches.length).toBeGreaterThan(0);
    expect(filterAtlas(model, { search: "definitely absent phrase", selections: {} }).counts).toEqual({ matches: 0, needsVerification: 0, outside: 23, total: 23 });
  });

  it("classifies known matches, known mismatches, and unresolved states transparently", () => {
    const synthetic = structuredClone(model) as AtlasPageModel;
    const option = synthetic.filters[0]!.options[0]!.id;
    (synthetic.rows[0]!.facts as Record<string, unknown>)["print-difficulty"] = { state: "known", stateLabel: "Known", value: option, valueLabel: "Selected" };
    (synthetic.rows[1]!.facts as Record<string, unknown>)["print-difficulty"] = { state: "known", stateLabel: "Known", value: "other", valueLabel: "Other" };
    (synthetic.rows[2]!.facts as Record<string, unknown>)["print-difficulty"] = { state: "unknown", stateLabel: "Unknown", reason: "Verify" };
    (synthetic.rows[3]!.facts as Record<string, unknown>)["print-difficulty"] = { state: "conditional", stateLabel: "Conditional", condition: "Verify" };
    (synthetic.rows[4]!.facts as Record<string, unknown>)["print-difficulty"] = { state: "missing", stateLabel: "Missing", reason: "Verify" };
    const result = filterAtlas(synthetic, { search: "", selections: { "print-difficulty": option } });
    expect(result.matches.map(({ row }) => row.id)).toContain(synthetic.rows[0]!.id);
    expect(result.outside.find(({ row }) => row.id === synthetic.rows[1]!.id)?.firstMismatch).toBe("Print difficulty");
    for (const row of synthetic.rows.slice(2, 5)) {
      expect(result.needsVerification.find((entry) => entry.row.id === row.id)?.unresolvedDimensions).toEqual(["Print difficulty"]);
    }
  });

  it("gives mismatch precedence over uncertainty and reports all unresolved dimensions", () => {
    const row = model.rows.find(({ facts }) => facts["outdoor-uv"]?.state !== "known" || facts["chemical-resistance"]?.state !== "known");
    const synthetic = structuredClone(model) as AtlasPageModel;
    const target = synthetic.rows.find(({ id }) => id === (row?.id ?? synthetic.rows[0]!.id))!;
    (target.facts as Record<string, unknown>)["outdoor-uv"] = { state: "unknown", stateLabel: "Unknown", reason: "Verify" };
    (target.facts as Record<string, unknown>)["chemical-resistance"] = { state: "missing", stateLabel: "Missing", reason: "Verify" };
    const unresolved = filterAtlas(synthetic, { search: "", selections: { "outdoor-uv": synthetic.filters[6]!.options[0]!.id, "chemical-resistance": synthetic.filters[9]!.options[0]!.id } });
    expect(unresolved.needsVerification.find(({ row: r }) => r.id === target.id)?.unresolvedDimensions).toEqual(["Outdoor and UV behavior", "Chemical resistance"]);
    const mismatch = filterAtlas(synthetic, { search: "no text match", selections: { "outdoor-uv": synthetic.filters[6]!.options[0]!.id } });
    expect(mismatch.outside.find(({ row: r }) => r.id === target.id)?.firstMismatch).toBe("Search");
  });

  it("treats not-applicable as outside unless the selected option explicitly represents that state", () => {
    const synthetic = structuredClone(model) as AtlasPageModel;
    const row = synthetic.rows[0]!;
    (row.facts as Record<string, unknown>)["print-difficulty"] = { state: "not-applicable", stateLabel: "Not applicable" };
    const selectedValue = synthetic.filters[0]!.options[0]!.id;
    expect(filterAtlas(synthetic, { search: "", selections: { "print-difficulty": selectedValue } }).outside.some((entry) => entry.row.id === row.id)).toBe(true);
    (synthetic.filters[0]!.options as unknown as Array<unknown>).push({ id: "state:not-applicable", label: "Not applicable", kind: "state" });
    expect(filterAtlas(synthetic, { search: "", selections: { "print-difficulty": "state:not-applicable" } }).matches.some((entry) => entry.row.id === row.id)).toBe(true);
  });

  it("returns controlled active labels and aggregate counts", () => {
    const selection = model.filters[0]!.options[0]!;
    const result = filterAtlas(model, { search: " pla ", selections: { [model.filters[0]!.id]: selection.id } });
    expect(result.activeFilters).toEqual([
      { id: "search", label: "Search", valueLabel: "pla" },
      { id: model.filters[0]!.id, label: model.filters[0]!.label, valueLabel: selection.label },
    ]);
    expect(result.counts.matches + result.counts.needsVerification + result.counts.outside).toBe(23);
  });

  it("rejects unknown dimensions and options with one redacted code", () => {
    expect(() => filterAtlas(model, { search: "", selections: { invented: "x" } })).toThrow("ATLAS_FILTER_INVALID");
    expect(() => filterAtlas(model, { search: "", selections: { "print-difficulty": "invented" } })).toThrow("ATLAS_FILTER_INVALID");
  });

  it("is deterministic when input rows are permuted", () => {
    const reversed = { ...model, rows: [...model.rows].reverse() };
    expect(filterAtlas(reversed, { search: "", selections: { "cost-tier": "medium" } })).toEqual(filterAtlas(model, { search: "", selections: { "cost-tier": "medium" } }));
  });
});
