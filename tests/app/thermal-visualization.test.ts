import { describe, expect, it } from "vitest";

import type { EvidenceScope } from "../../src/data/schema/evidence.ts";
import type { MaterialId } from "../../src/data/schema/ids.ts";
import type { Material } from "../../src/data/schema/material.ts";
import {
  buildNamedThermalModel,
  buildServiceGuidanceModel,
} from "../../src/features/map/thermal.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";

function serviceMaterial(
  index: number,
  value: Material["serviceTemperature"]["value"],
  name = `Synthetic ${index}`,
): Material {
  const material = structuredClone(loadPublicAtlas().materials[0]!);
  material.id = `material-synthetic-service-${index}` as MaterialId;
  material.slug = `synthetic-service-${index}`;
  material.displayOrder = index;
  material.name = name;
  material.serviceTemperature.value = value;
  material.serviceTemperature.qualification = `Qualification ${index}`;
  material.serviceTemperature.basis = [
    { kind: "method", methodId: "method-service-temperature-guidance", scope: "family-guidance" },
    { kind: "source", sourceId: "source-synthetic", scope: "representative-product" },
  ];
  return material;
}

describe("thermal visualization service guidance", () => {
  it("builds the complete 23-record baseline from service endpoints only", () => {
    const atlas = loadPublicAtlas();
    const model = buildServiceGuidanceModel(atlas.materials, "/fdm-material-atlas/", {
      query: "",
      sort: "canonical",
    });

    expect(model.domain).toEqual({ low: 30, high: 260, unit: "degC" });
    expect(model.ticks).toEqual(Array.from({ length: 24 }, (_, index) => 30 + index * 10));
    expect(model.records.all).toHaveLength(23);
    expect(model.records.plotted).toHaveLength(23);
    expect(model.records.filtered).toEqual([]);
    expect(model.records.omitted).toEqual([]);
    expect(model.records.all.every(({ measurement }) => measurement?.unit === "degC")).toBe(true);
    expect(model.records.all.every(({ material }) => material.href.startsWith("/fdm-material-atlas/materials/"))).toBe(true);
    expect(model.records.all[0]!.evidence.scopes).toContain("family-guidance" satisfies EvidenceScope);
  });

  it("retains points, ranges, conditions, qualifications, scopes, and every omission state", () => {
    const materials = [
      serviceMaterial(1, { state: "known", value: { shape: "exact", value: 42, unit: "degC" } }),
      serviceMaterial(2, { state: "known", value: { shape: "range", min: 40, max: 50, unit: "degC" } }),
      serviceMaterial(3, { state: "conditional", condition: "Only after treatment.", value: { shape: "range", min: 60, max: 70, unit: "degC" } }),
      serviceMaterial(4, { state: "conditional", condition: "Value requires verification." }),
      serviceMaterial(5, { state: "unknown", reason: "Unknown synthetic value." }),
      serviceMaterial(6, { state: "not-applicable", reason: "Synthetic claim does not apply." }),
      serviceMaterial(7, { state: "missing", reason: "Synthetic claim is not reported." }),
    ];
    const model = buildServiceGuidanceModel(materials, undefined, { query: "", sort: "canonical" });

    expect(model.records.all.map(({ measurement }) => measurement?.shape)).toEqual([
      "point", "interval", "interval", undefined, undefined, undefined, undefined,
    ]);
    expect(model.records.plotted).toHaveLength(3);
    expect(model.records.omitted.map(({ disposition }) => disposition)).toEqual([
      { disposition: "omitted", code: "conditional-without-value", reason: "Value requires verification." },
      { disposition: "omitted", code: "unknown-value", reason: "Unknown synthetic value." },
      { disposition: "omitted", code: "not-applicable", reason: "Synthetic claim does not apply." },
      { disposition: "omitted", code: "not-reported", reason: "Synthetic claim is not reported." },
    ]);
    expect(model.records.all[2]).toMatchObject({
      fact: { state: "conditional", condition: "Only after treatment." },
      evidence: { qualification: "Qualification 3" },
    });
    expect(model.domain).toEqual({ low: 30, high: 80, unit: "degC" });
  });

  it("uses stable canonical/low/high sorting, explicit ties, and non-destructive search filtering", () => {
    const materials = [
      serviceMaterial(3, { state: "known", value: { shape: "range", min: 40, max: 80, unit: "degC" } }, "Gamma"),
      serviceMaterial(1, { state: "known", value: { shape: "range", min: 40, max: 60, unit: "degC" } }, "Alpha"),
      serviceMaterial(2, { state: "known", value: { shape: "range", min: 50, max: 60, unit: "degC" } }, "Beta"),
    ];

    expect(buildServiceGuidanceModel(materials, undefined, { query: "", sort: "canonical" }).records.all.map(({ material }) => material.name))
      .toEqual(["Alpha", "Beta", "Gamma"]);
    expect(buildServiceGuidanceModel(materials, undefined, { query: "", sort: "low" }).records.all.map(({ material }) => material.name))
      .toEqual(["Alpha", "Gamma", "Beta"]);
    expect(buildServiceGuidanceModel(materials, undefined, { query: "", sort: "high" }).records.all.map(({ material }) => material.name))
      .toEqual(["Alpha", "Beta", "Gamma"]);

    const filtered = buildServiceGuidanceModel(materials, undefined, { query: " beta ", sort: "canonical" });
    expect(filtered.records.all).toHaveLength(3);
    expect(filtered.records.plotted.map(({ material }) => material.name)).toEqual(["Beta"]);
    expect(filtered.records.filtered).toHaveLength(2);
    expect(filtered.highlightedMaterialIds).toEqual([materials[2]!.id]);
    expect(filtered.records.all.filter(({ disposition }) => disposition.disposition === "filtered")).toHaveLength(2);
  });
});

describe("thermal visualization named observations", () => {
  it("builds eight exact comparator groups without a numeric combined series", () => {
    const atlas = loadPublicAtlas();
    const model = buildNamedThermalModel(atlas.materials, "/fdm-material-atlas/");

    expect(model.groups.map(({ members }) => members.length).sort((left, right) => right - left))
      .toEqual([8, 5, 3, 2, 2, 1, 1, 1]);
    expect(model.groups.every(({ members }) => members.length > 0)).toBe(true);
    expect(model).not.toHaveProperty("domain");
    expect(model).not.toHaveProperty("sort");
    expect(model).not.toHaveProperty("average");
    expect(model.groups.flatMap(({ members }) => members).every(({ fact }) => fact.display.some((line) => line.includes("°C")))).toBe(true);
  });

  it("retains exact labels, method dimensions, condition, qualification, scope, value, and href", () => {
    const original = structuredClone(loadPublicAtlas().materials[0]!);
    const observation = original.thermalObservations[0]!;
    observation.metric = "other";
    observation.metricLabel = "Synthetic exact test";
    observation.method = {
      standard: "Synthetic standard",
      loadMpa: 1.23,
      annealed: false,
      conditioning: "Dry conditioned",
      otherConditions: "Synthetic specimen",
    };
    observation.measurement = {
      state: "conditional",
      condition: "Only in the stated condition.",
      value: { shape: "exact", value: 123, unit: "degC" },
    };
    observation.qualification = "Synthetic representative observation.";
    observation.basis = [{ kind: "source", sourceId: "source-synthetic", scope: "representative-product" }];

    const model = buildNamedThermalModel([original], undefined);
    expect(model.groups).toHaveLength(1);
    expect(model.groups[0]).toMatchObject({
      metric: "other",
      metricLabel: "Synthetic exact test",
      method: observation.method,
      members: [{
        metricLabel: "Synthetic exact test",
        method: observation.method,
        fact: { state: "conditional", condition: "Only in the stated condition.", display: expect.arrayContaining(["123 °C"]) },
        evidence: { qualification: "Synthetic representative observation.", scopes: ["representative-product"] },
        material: { href: "/materials/abs/" },
      }],
    });
  });

  it("keeps materials outside a selected group as view absence and resets stale selections", () => {
    const atlas = loadPublicAtlas();
    const baseline = buildNamedThermalModel(atlas.materials, undefined);
    const selectedId = baseline.groups[0]!.id;
    const selected = buildNamedThermalModel(atlas.materials, undefined, selectedId);

    expect(selected.selectedGroupId).toBe(selectedId);
    expect(selected.selectedRecords?.all).toHaveLength(23);
    expect(selected.selectedRecords?.plotted).toHaveLength(baseline.groups[0]!.members.length);
    expect(selected.selectedRecords?.omitted).toHaveLength(23 - baseline.groups[0]!.members.length);
    expect(selected.selectedRecords?.omitted.every(({ member, disposition }) =>
      member === undefined && disposition.disposition === "omitted" && disposition.code === "no-observation-in-group"
    )).toBe(true);

    const stale = buildNamedThermalModel(atlas.materials, undefined, "thermal-group-stale-selection");
    expect(stale.selectedGroupId).toBeUndefined();
    expect(stale.selectionReset).toBe(true);
    expect(stale.selectedRecords).toBeUndefined();
  });
});
