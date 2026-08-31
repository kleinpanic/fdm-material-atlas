import { afterEach, describe, expect, it, vi } from "vitest";

import type { AtlasV1 } from "../../src/data/schema/atlas.ts";
import type { BasisRef, EvidenceScope } from "../../src/data/schema/evidence.ts";
import type { FactState } from "../../src/data/schema/fact-state.ts";
import type { Material, ThermalObservation } from "../../src/data/schema/material.ts";
import type { ProcessGateRecord } from "../../src/data/schema/process-gate.ts";
import { parseAtlas } from "../../src/data/schema/parse-atlas.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";
import {
  buildTracerViewModel,
  evidenceScopeLabel,
  projectFactState,
  selectTracerMaterial,
} from "../../src/lib/tracer-view-model.ts";
import { createMinimalAtlas } from "../fixtures/atlas-minimal.valid.ts";

function minimalAtlas(): AtlasV1 {
  const result = parseAtlas(createMinimalAtlas());
  if (!result.success) throw new Error("SYNTHETIC_FIXTURE_INVALID");
  return result.data;
}

function cloneMaterial(material: Material, id: string, slug: string): Material {
  return {
    ...material,
    id: id as Material["id"],
    slug,
    name: `Alternate ${slug}`,
  };
}

function cloneThermal(
  observation: ThermalObservation,
  id: string,
): ThermalObservation {
  return { ...observation, id: id as ThermalObservation["id"] };
}

function cloneGate(gate: ProcessGateRecord, id: string): ProcessGateRecord {
  return {
    ...gate,
    id: id as ProcessGateRecord["id"],
    label: `Alternate ${id}`,
  };
}

describe("loadPublicAtlas", () => {
  afterEach(() => {
    vi.doUnmock("node:fs");
    vi.resetModules();
  });

  it("loads the fixed committed public artifact through the parse boundary", () => {
    const atlas = loadPublicAtlas();
    expect(atlas.schemaVersion).toBe(1);
    expect(atlas.materials).toHaveLength(23);
    expect(loadPublicAtlas).toHaveLength(0);
  });

  it("redacts a fixed-artifact read failure behind one stable code", async () => {
    vi.resetModules();
    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs")>();
      return {
        ...actual,
        openSync: () => {
          throw new Error("synthetic-sensitive-read-detail");
        },
      };
    });

    const module = await import("../../src/lib/public-atlas.ts");
    expect(() => module.loadPublicAtlas()).toThrow("PUBLIC_ATLAS_READ_FAILED");
    try {
      module.loadPublicAtlas();
    } catch (error) {
      expect(String(error)).not.toContain("synthetic-sensitive-read-detail");
    }
  });

  it("redacts malformed fixed-artifact content behind one stable code", async () => {
    vi.resetModules();
    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs")>();
      return {
        ...actual,
        fstatSync: () => ({ isFile: () => true, size: 2 }),
        openSync: () => 101,
        readFileSync: () => "{}",
        closeSync: () => undefined,
      };
    });

    const module = await import("../../src/lib/public-atlas.ts");
    expect(() => module.loadPublicAtlas()).toThrow("PUBLIC_ATLAS_INVALID");
  });
});

describe("selectTracerMaterial", () => {
  it("selects the first public material ID independently of input order", () => {
    const atlas = minimalAtlas();
    const first = atlas.materials[0]!;
    const later = cloneMaterial(first, "material-synthetic-zeta", "synthetic-zeta");
    const earlier = cloneMaterial(first, "material-synthetic-aardvark", "synthetic-aardvark");

    expect(
      selectTracerMaterial({ ...atlas, materials: [later, first, earlier] }).id,
    ).toBe("material-synthetic-aardvark");
    expect(
      selectTracerMaterial({ ...atlas, materials: [earlier, first, later] }).id,
    ).toBe("material-synthetic-aardvark");
  });

  it("fails closed when no canonical material exists", () => {
    expect(() => selectTracerMaterial({ ...minimalAtlas(), materials: [] })).toThrow(
      "TRACER_MATERIAL_REQUIRED",
    );
  });
});

describe("buildTracerViewModel", () => {
  it("is invariant to material, thermal, process-gate, and basis array order", () => {
    const atlas = minimalAtlas();
    const first = atlas.materials[0]!;
    const firstThermal = first.thermalObservations[0]!;
    const firstGate = atlas.processGates[0]!;
    const earlierBasis = {
      kind: "source",
      sourceId: atlas.sources[0]!.id,
      scope: "product-specific",
    } as const satisfies BasisRef;
    const laterBasis = {
      kind: "method",
      methodId: atlas.methods[0]!.id,
      scope: "representative-product",
    } as const satisfies BasisRef;
    const earlierThermal = {
      ...cloneThermal(firstThermal, "claim-synthetic-aardvark"),
      basis: [laterBasis, earlierBasis],
    };
    const laterThermal = cloneThermal(firstThermal, "claim-synthetic-zeta");
    const earlierGate = cloneGate(firstGate, "gate-synthetic-aardvark");
    const laterGate = cloneGate(firstGate, "gate-synthetic-zeta");
    const selectedMaterial = {
      ...first,
      thermalObservations: [laterThermal, earlierThermal],
    };
    const otherMaterial = cloneMaterial(
      first,
      "material-synthetic-zeta",
      "synthetic-zeta",
    );
    const forward = {
      ...atlas,
      materials: [otherMaterial, selectedMaterial],
      processGates: [laterGate, earlierGate],
    };
    const reversed = {
      ...forward,
      materials: [...forward.materials].reverse(),
      processGates: [...forward.processGates].reverse(),
    };
    reversed.materials[0] = {
      ...reversed.materials[0]!,
      thermalObservations: [...reversed.materials[0]!.thermalObservations].reverse(),
    };

    expect(buildTracerViewModel(forward)).toEqual(buildTracerViewModel(reversed));
    expect(buildTracerViewModel(forward)).toMatchObject({
      material: {
        id: "material-synthetic-alpha",
        slug: "synthetic-alpha",
        name: "Synthetic Alpha",
      },
      thermal: { id: "claim-synthetic-aardvark" },
      processGate: { id: "gate-synthetic-aardvark" },
      evidenceScope: {
        scope: "product-specific",
        label: "Product-specific value",
      },
    });
  });

  it("projects the real artifact without copied material facts", () => {
    const atlas = loadPublicAtlas();
    const expected = [...atlas.materials].sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    )[0]!;
    const model = buildTracerViewModel(atlas);

    expect(model.material).toEqual({
      id: expected.id,
      slug: expected.slug,
      name: expected.name,
    });
    expect(model.familyOrFill.state).toBe(expected.familyOrFill.value.state);
    expect(model.processGate.marker).toBe("diamond");
    expect(model.evidenceScope.label.length).toBeGreaterThan(0);
  });

  it("renders an explicit missing thermal specimen without inventing a metric", () => {
    const atlas = minimalAtlas();
    const material = { ...atlas.materials[0]!, thermalObservations: [] };
    const model = buildTracerViewModel({ ...atlas, materials: [material] });

    expect(model.thermal).toEqual({
      state: "missing",
      label: "Not reported — no named thermal observation is available.",
    });
  });

  it("fails closed when a process-gate specimen cannot be selected", () => {
    expect(() =>
      buildTracerViewModel({ ...minimalAtlas(), processGates: [] }),
    ).toThrow("TRACER_PROCESS_GATE_REQUIRED");
  });
});

describe("fact and evidence display vocabulary", () => {
  const states: readonly FactState<number>[] = [
    { state: "known", value: 0 },
    { state: "unknown", reason: "Synthetic unknown reason" },
    { state: "conditional", condition: "Synthetic condition", value: 0 },
    { state: "not-applicable", reason: "Synthetic non-applicability" },
    { state: "missing", reason: "Synthetic missing reason" },
  ];

  it("keeps all five fact states distinct and preserves known zero", () => {
    const projected = states.map(projectFactState);
    expect(projected.map(({ state }) => state)).toEqual([
      "known",
      "unknown",
      "conditional",
      "not-applicable",
      "missing",
    ]);
    expect(projected[0]).toMatchObject({ state: "known", value: 0 });
    expect(projected[2]).toMatchObject({ state: "conditional", value: 0 });
    expect(projectFactState({ state: "known", value: false })).toMatchObject({
      state: "known",
      value: false,
    });
  });

  it.each([
    ["product-specific", "Product-specific value"],
    ["representative-product", "Representative product example"],
    ["family-guidance", "Family-level guidance"],
    ["qualitative-heuristic", "Qualitative heuristic"],
    ["starting-profile-guidance", "Starting-profile guidance"],
    ["derived-selector-logic", "Derived selector logic"],
  ] as const satisfies readonly (readonly [EvidenceScope, string])[])(
    "uses the full public label for %s",
    (scope, label) => {
      expect(evidenceScopeLabel(scope)).toBe(label);
    },
  );
});
