import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { AtlasV1 } from "../../src/data/schema/atlas.ts";
import type { BasisRef } from "../../src/data/schema/evidence.ts";
import type { Material } from "../../src/data/schema/material.ts";
import { parseAtlas } from "../../src/data/schema/parse-atlas.ts";
import { serializeAtlas } from "../../src/data/serialization/stable-json.ts";
import { MATERIAL_SEMANTIC_FIELDS } from "../../src/data/source-contract/semantic-fields.ts";

const artifactPath = resolve(import.meta.dirname, "../../src/data/public/atlas.v1.json");
const artifactBytes = readFileSync(artifactPath);
const parseResult = parseAtlas(JSON.parse(artifactBytes.toString("utf8")));
if (!parseResult.success) throw new Error("Canonical Atlas fixture failed its public parser");
const atlas: AtlasV1 = parseResult.data;

type ClaimLike = { id: string; value: { state: string }; basis: BasisRef[]; qualification?: string | undefined };

function materialClaims(material: Material): ClaimLike[] {
  return [
    material.familyOrFill,
    material.serviceTemperature,
    ...material.thermalObservations.map(({ id, measurement: value, basis, qualification }) => ({ id, value, basis, qualification })),
    ...Object.values(material.properties),
    ...Object.values(material.process),
    ...Object.values(material.guidance),
    material.costTier,
    material.startingProfile.printSpeed,
    material.startingProfile.partCoolingFan,
    material.startingProfile.bridgeSpeed,
    material.startingProfile.bridgeFan,
  ];
}

function resolveSemanticField(material: Material, field: (typeof MATERIAL_SEMANTIC_FIELDS)[number]): unknown {
  switch (field) {
    case "name": return material.name;
    case "familyOrFill": return material.familyOrFill;
    case "serviceTemperature.minimum":
      return material.serviceTemperature.value.state === "known" && material.serviceTemperature.value.value.shape === "range"
        ? material.serviceTemperature.value.value.min : undefined;
    case "serviceTemperature.maximum":
      return material.serviceTemperature.value.state === "known" && material.serviceTemperature.value.value.shape === "range"
        ? material.serviceTemperature.value.value.max : undefined;
    case "thermalObservations.metric": return material.thermalObservations.map(({ metric }) => metric);
    case "thermalObservations.measurement": return material.thermalObservations.map(({ measurement }) => measurement);
    case "properties.wearAbrasion": return material.properties.wearAbrasion;
    case "properties.impactResistance": return material.properties.impactResistance;
    case "properties.creepSustainedLoad": return material.properties.creepSustainedLoad;
    case "properties.outdoorUv": return material.properties.outdoorUv;
    case "properties.moistureSensitivity": return material.properties.moistureSensitivity;
    case "process.printDifficulty": return material.process.printDifficulty;
    case "process.nozzleTemperature": return material.process.nozzleTemperature;
    case "process.bedTemperature": return material.process.bedTemperature;
    case "process.enclosure": return material.process.enclosure;
    case "process.hardenedNozzle": return material.process.hardenedNozzle;
    case "properties.warpTendency": return material.properties.warpTendency;
    case "properties.flexibility": return material.properties.flexibility;
    case "properties.chemicalResistance": return material.properties.chemicalResistance;
    case "properties.density": return material.properties.density;
    case "guidance.bestSuitedFor": return material.guidance.bestSuitedFor;
    case "guidance.tradeoffs": return material.guidance.tradeoffs;
    case "properties.coolingShrinkRisk": return material.properties.coolingShrinkRisk;
    case "properties.dimensionalStability": return material.properties.dimensionalStability;
    case "guidance.coolingFit": return material.guidance.coolingFit;
    case "process.dryingPriority": return material.process.dryingPriority;
    case "process.ventilation": return material.process.ventilation;
    case "costTier": return material.costTier;
    case "startingProfile.printSpeed": return material.startingProfile.printSpeed;
    case "startingProfile.partCoolingFan": return material.startingProfile.partCoolingFan;
    case "startingProfile.bridgeSpeed": return material.startingProfile.bridgeSpeed;
    case "startingProfile.bridgeFan": return material.startingProfile.bridgeFan;
  }
}

describe("sanitized canonical baseline", () => {
  it("contains the reviewed material, evidence, selector, and lane counts", () => {
    expect(atlas.materials).toHaveLength(23);
    expect(atlas.sources).toHaveLength(22);
    expect(atlas.selector.criteria).toHaveLength(7);
    expect(atlas.decisionLanes).toHaveLength(8);
    expect(atlas.processGates.length).toBeGreaterThanOrEqual(8);
    expect(atlas.visualizationReferences.length).toBeGreaterThan(atlas.materials.length);
  });

  it("resolves all 32 reviewed semantic fields for every material", () => {
    expect(MATERIAL_SEMANTIC_FIELDS).toHaveLength(32);
    for (const material of atlas.materials) {
      for (const field of MATERIAL_SEMANTIC_FIELDS) {
        const value = resolveSemanticField(material, field);
        expect(value, `${material.id} must resolve ${field}`).not.toBeUndefined();
        if (Array.isArray(value)) expect(value, `${material.id} must populate ${field}`).not.toHaveLength(0);
      }
    }
  });

  it("uses every public evidence record and all six evidence scopes", () => {
    const basis = [
      ...atlas.materials.flatMap(materialClaims).flatMap(({ basis }) => basis),
      ...atlas.processGates.flatMap(({ basis }) => basis),
    ];
    const referencedSources = new Set(basis.filter((reference) => reference.kind === "source").map(({ sourceId }) => sourceId));
    const scopes = new Set(basis.map(({ scope }) => scope));

    expect([...referencedSources].sort()).toEqual(atlas.sources.map(({ id }) => id).sort());
    expect([...scopes].sort()).toEqual([
      "derived-selector-logic",
      "family-guidance",
      "product-specific",
      "qualitative-heuristic",
      "representative-product",
      "starting-profile-guidance",
    ]);
  });

  it("keeps service guidance separate from every named thermal observation", () => {
    const thermalKinds = new Set(atlas.materials.flatMap(({ thermalObservations }) => thermalObservations.map(({ metric }) => metric)));
    expect(thermalKinds).toEqual(new Set(["glass-transition", "heat-deflection", "melting-point", "vicat-softening"]));

    for (const material of atlas.materials) {
      expect(material.thermalObservations.length).toBeGreaterThan(0);
      for (const observation of material.thermalObservations) {
        expect(observation.id).not.toBe(material.serviceTemperature.id);
        expect(observation.qualification.toLowerCase()).toContain("representative");
      }
      expect(material.serviceTemperature.qualification?.toLowerCase()).toContain("not interchangeable");
    }

    expect(atlas.methods.find(({ id }) => id === "method-thermal-metric-identity")?.description.toLowerCase())
      .toContain("not interchangeable");
  });

  it("marks all four starting-profile fields as cautioned calibration guidance", () => {
    for (const material of atlas.materials) {
      expect(material.startingProfile.interpretation).toBe("calibration-starting-point");
      for (const profileClaim of [
        material.startingProfile.printSpeed,
        material.startingProfile.partCoolingFan,
        material.startingProfile.bridgeSpeed,
        material.startingProfile.bridgeFan,
      ]) {
        expect(profileClaim.basis.length).toBeGreaterThan(0);
        expect(profileClaim.basis.every(({ scope }) => scope === "starting-profile-guidance")).toBe(true);
        expect(profileClaim.qualification?.toLowerCase()).toMatch(/starting|calibration|bridge-test/);
      }
    }
  });

  it("derives lane membership from predicates and resolves typed visualization targets", () => {
    for (const lane of atlas.decisionLanes) {
      expect(lane).toHaveProperty("candidateRule");
      expect(Object.keys(lane)).not.toContain("candidates");
      expect(Object.keys(lane)).not.toContain("candidateMaterialIds");
    }
    const serialized = JSON.stringify(atlas.selector);
    expect(serialized).not.toMatch(/"(?:formula|script|expression|executable)"\s*:/u);
    expect(parseAtlas(atlas)).toMatchObject({ success: true });
  });

  it("keeps the committed bytes exactly canonical", () => {
    expect(artifactBytes.equals(Buffer.from(serializeAtlas(atlas), "utf8"))).toBe(true);
  });
});
