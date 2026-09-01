import { describe, expect, it } from "vitest";

import {
  defaultExplorerState,
  exploreData,
  type ExplorerState,
} from "../../src/features/data-explorer/explore.ts";
import { buildDataExplorerModel, type DataExplorerModel } from "../../src/features/data-explorer/model.ts";
import { safeExplore } from "../../src/features/data-explorer/safe-explore.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";

const model = buildDataExplorerModel(loadPublicAtlas(), "/");

function withState(patch: Partial<ExplorerState>): ExplorerState {
  return { ...defaultExplorerState(model), ...patch };
}

function sortableFixture(states: readonly [string, string, number | undefined][]): DataExplorerModel {
  const fixture = structuredClone(model);
  fixture.materials = fixture.materials.slice(0, states.length).map((material, index) => {
    const [id, state, value] = states[index]!;
    const cells = material.cells.map((cell) => cell.key === "density"
      ? { ...cell, states: state === "identity" ? [] : [state], sortKey: { kind: "number", state, ...(value === undefined ? {} : { value }) } }
      : cell);
    return { ...material, id, cells };
  }) as DataExplorerModel["materials"];
  return fixture;
}

describe("data explorer transform", () => {
  it("returns every row and every active-group cell by default", () => {
    const result = exploreData(model, defaultExplorerState(model));
    expect(result.kind).toBe("exploration");
    if (result.kind !== "exploration") return;
    expect(result.materials).toHaveLength(23);
    expect(result.fields.map(({ key }) => key)).toEqual(model.groups[0]!.fieldKeys);
    expect(result.materials.every(({ cells }) => cells.length === result.fields.length)).toBe(true);
  });

  it("combines search, group, fact-state, and evidence-scope filters without deleting row cells", () => {
    const group = "print-process" as const;
    const activeKeys = model.groups.find(({ key }) => key === group)!.fieldKeys;
    const candidate = model.materials.find((material) => material.cells.some((cell) =>
      activeKeys.includes(cell.key) && cell.states.includes("known") && cell.scopes.includes("family-guidance")
    ))!;
    const query = candidate.name.slice(0, 4).toLocaleLowerCase("en-US");
    const result = exploreData(model, withState({
      query,
      group,
      factState: "known",
      evidenceScope: "family-guidance",
      sort: { field: "print-difficulty", direction: "asc" },
    }));
    expect(result.kind).toBe("exploration");
    if (result.kind !== "exploration") return;
    expect(result.materials.length).toBeGreaterThan(0);
    for (const material of result.materials) {
      expect(material.name.toLocaleLowerCase("en-US")).toContain(query);
      expect(material.cells.map(({ key }) => key)).toEqual(activeKeys);
      expect(material.cells.some(({ states }) => states.includes("known"))).toBe(true);
      expect(material.cells.some(({ scopes }) => scopes.includes("family-guidance"))).toBe(true);
    }
  });

  it("filters by exact thermal compatibility group and narrows only thermal member lists", () => {
    const metric = model.thermalMetrics[0]!;
    const result = exploreData(model, withState({ thermalMetric: metric.id }));
    expect(result.kind).toBe("exploration");
    if (result.kind !== "exploration") return;
    expect(result.materials.length).toBeGreaterThan(0);
    for (const material of result.materials) {
      expect(material.cells).toHaveLength(model.groups[0]!.fieldKeys.length);
      for (const cell of material.cells) {
        if (cell.kind === "thermal") expect(cell.members.every(({ groupId }) => groupId === metric.id)).toBe(true);
      }
    }
  });

  it("sorts comparable known values in either direction but keeps non-known states after them", () => {
    const fixture = sortableFixture([
      ["material-z-unknown", "unknown", undefined],
      ["material-b-known", "known", 2],
      ["material-a-known", "known", 1],
    ]);
    const base = { ...defaultExplorerState(fixture), group: "handling-density-cost" as const };
    const ascending = exploreData(fixture, { ...base, sort: { field: "density", direction: "asc" } });
    const descending = exploreData(fixture, { ...base, sort: { field: "density", direction: "desc" } });
    expect(ascending.kind === "exploration" && ascending.materials.map(({ id }) => id)).toEqual([
      "material-a-known", "material-b-known", "material-z-unknown",
    ]);
    expect(descending.kind === "exploration" && descending.materials.map(({ id }) => id)).toEqual([
      "material-b-known", "material-a-known", "material-z-unknown",
    ]);
  });

  it("keeps conditional, unknown, missing, and not-applicable in fixed interface order", () => {
    const fixture = sortableFixture([
      ["material-na", "not-applicable", undefined],
      ["material-missing", "missing", undefined],
      ["material-unknown", "unknown", undefined],
      ["material-conditional", "conditional", undefined],
    ]);
    const base = { ...defaultExplorerState(fixture), group: "handling-density-cost" as const };
    for (const direction of ["asc", "desc"] as const) {
      const result = exploreData(fixture, { ...base, sort: { field: "density", direction } });
      expect(result.kind === "exploration" && result.materials.map(({ id }) => id)).toEqual([
        "material-conditional", "material-unknown", "material-missing", "material-na",
      ]);
    }
  });

  it("uses stable material-ID ties and forbids named thermal value sorting", () => {
    const fixture = sortableFixture([
      ["material-z", "known", 1],
      ["material-a", "known", 1],
    ]);
    const base = { ...defaultExplorerState(fixture), group: "handling-density-cost" as const };
    for (const direction of ["asc", "desc"] as const) {
      const result = exploreData(fixture, { ...base, sort: { field: "density", direction } });
      expect(result.kind === "exploration" && result.materials.map(({ id }) => id)).toEqual(["material-a", "material-z"]);
    }
    expect(() => exploreData(model, withState({ sort: { field: "thermal-value", direction: "asc" } })))
      .toThrow("EXPLORER_STATE_INVALID");
  });

  it("resets invalid state through a controlled total boundary with no stale rows", () => {
    const invalid = { ...defaultExplorerState(model), group: "not-a-group" };
    const result = safeExplore(model, invalid);
    expect(result).toMatchObject({
      kind: "failure",
      code: "EXPLORE_FAILED",
      materials: [],
      state: defaultExplorerState(model),
    });
    expect(JSON.stringify(result)).not.toContain("not-a-group");
  });
});
