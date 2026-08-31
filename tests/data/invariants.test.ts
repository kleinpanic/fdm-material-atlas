import { describe, expect, it } from "vitest";

import { AtlasV1Schema } from "../../src/data/schema/atlas.ts";
import { parseAtlas } from "../../src/data/schema/parse-atlas.ts";
import { validateAtlasInvariants } from "../../src/data/schema/invariants.ts";
import { createMinimalAtlas } from "../fixtures/atlas-minimal.valid.ts";
import {
  mutateAtlas,
  privateLookingSyntheticMarker,
} from "../fixtures/atlas-invalid-cases.ts";

describe("AtlasV1 strict parse boundary", () => {
  it("accepts the synthetic fixture and every canonical root collection", () => {
    const result = parseAtlas(createMinimalAtlas());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schemaVersion).toBe(1);
      expect(Object.keys(result.data)).toEqual([
        "schemaVersion",
        "materials",
        "sources",
        "methods",
        "selector",
        "processGates",
        "decisionLanes",
        "visualizationReferences",
        "vocabularies",
      ]);
    }
  });

  it("rejects an unsupported schema version with a stable safe diagnostic", () => {
    const atlas = { ...createMinimalAtlas(), schemaVersion: 2 };
    const result = parseAtlas(atlas);

    expect(result).toEqual({
      success: false,
      issues: [{ code: "SCHEMA_VERSION_UNSUPPORTED", pointer: "/schemaVersion" }],
    });
  });

  it("rejects root and nested unknown keys without disclosing their names or values", () => {
    const root = {
      ...createMinimalAtlas(),
      [privateLookingSyntheticMarker]: privateLookingSyntheticMarker,
    };
    const nested = mutateAtlas((atlas) => {
      Object.assign(atlas.materials[0]!, {
        [privateLookingSyntheticMarker]: privateLookingSyntheticMarker,
      });
    });

    for (const candidate of [root, nested]) {
      const result = parseAtlas(candidate);
      expect(result.success).toBe(false);
      const rendered = JSON.stringify(result);
      expect(rendered).toContain("SCHEMA_UNKNOWN_KEY");
      expect(rendered).not.toContain(privateLookingSyntheticMarker);
      if (!result.success) {
        for (const issue of result.issues) {
          expect(Object.keys(issue).every((key) => ["code", "pointer", "entityId"].includes(key))).toBe(true);
          expect(issue.pointer.startsWith("/")).toBe(true);
        }
      }
    }
  });
});

function issueCodes(candidate: unknown): string[] {
  const result = parseAtlas(candidate);
  expect(result.success).toBe(false);
  return result.success ? [] : result.issues.map(({ code }) => code);
}

type FixtureVisualizationTarget =
  | { kind: "material-id"; materialId: string }
  | { kind: "claim-id"; claimId: string }
  | { kind: "decision-lane-id"; decisionLaneId: string }
  | { kind: "selector-criterion-id"; selectorCriterionId: string }
  | { kind: "process-gate-id"; processGateId: string }
  | { kind: "material-route"; slug: string };

function setThermalRange(
  atlas: ReturnType<typeof createMinimalAtlas>,
  subject: FixtureVisualizationTarget,
  related: FixtureVisualizationTarget[],
) {
  const reference = atlas.visualizationReferences[0]!;
  Reflect.set(reference, "kind", "thermal-range");
  Reflect.set(reference, "subject", subject);
  Reflect.set(reference, "related", related);
  return reference;
}

function thermalIssues(candidate: unknown) {
  const result = parseAtlas(candidate);
  return result.success
    ? []
    : result.issues.filter(({ code }) => code === "THERMAL_NOT_COMPARABLE");
}

describe("AtlasV1 cross-record invariants", () => {
  it.each([
    ["material ID", (atlas: ReturnType<typeof createMinimalAtlas>) => {
      atlas.materials.push(structuredClone(atlas.materials[0]!));
      Reflect.set(atlas.materials[1]!, "slug", "synthetic-beta");
    }],
    ["material slug", (atlas: ReturnType<typeof createMinimalAtlas>) => {
      const second = structuredClone(atlas.materials[0]!);
      Reflect.set(second, "id", "material-synthetic-beta");
      atlas.materials.push(second);
    }],
    ["source ID", (atlas: ReturnType<typeof createMinimalAtlas>) => {
      atlas.sources.push(structuredClone(atlas.sources[0]!));
    }],
    ["method ID", (atlas: ReturnType<typeof createMinimalAtlas>) => {
      atlas.methods.push(structuredClone(atlas.methods[0]!));
    }],
    ["vocabulary ID", (atlas: ReturnType<typeof createMinimalAtlas>) => {
      atlas.vocabularies.push(structuredClone(atlas.vocabularies[0]!));
    }],
    ["claim ID", (atlas: ReturnType<typeof createMinimalAtlas>) => {
      atlas.materials[0]!.properties.impactResistance.id =
        atlas.materials[0]!.properties.wearAbrasion.id;
    }],
    ["process gate ID", (atlas: ReturnType<typeof createMinimalAtlas>) => {
      atlas.processGates.push(structuredClone(atlas.processGates[0]!));
    }],
    ["visualization ID", (atlas: ReturnType<typeof createMinimalAtlas>) => {
      atlas.visualizationReferences.push(structuredClone(atlas.visualizationReferences[0]!));
    }],
  ] as const)("rejects a duplicate %s", (_label, mutate) => {
    const atlas = createMinimalAtlas();
    mutate(atlas);
    expect(issueCodes(atlas)).toContain("ID_DUPLICATE");
  });

  it.each([
    ["claim method", (atlas: ReturnType<typeof createMinimalAtlas>) => {
      Reflect.set(atlas.materials[0]!.properties.density.basis[0]!, "methodId", "method-missing-review");
    }],
    ["gate basis", (atlas: ReturnType<typeof createMinimalAtlas>) => {
      Reflect.set(atlas.processGates[0]!.basis[0]!, "methodId", "method-missing-review");
    }],
    ["selector gate", (atlas: ReturnType<typeof createMinimalAtlas>) => {
      Reflect.set(atlas.selector.criteria[0]!.options[0]!.hardGates[0]!, "processGateId", "gate-missing-capability");
    }],
    ["lane gate", (atlas: ReturnType<typeof createMinimalAtlas>) => {
      atlas.decisionLanes[0]!.processGateIds = ["gate-missing-capability"];
    }],
    ["visualization material", (atlas: ReturnType<typeof createMinimalAtlas>) => {
      Reflect.set(atlas.visualizationReferences[0]!, "subject", { kind: "material-id", materialId: "material-missing-alpha" });
    }],
    ["visualization claim", (atlas: ReturnType<typeof createMinimalAtlas>) => {
      Reflect.set(atlas.visualizationReferences[0]!.related[0]!, "claimId", "claim-missing-density");
    }],
    ["visualization lane", (atlas: ReturnType<typeof createMinimalAtlas>) => {
      Reflect.set(atlas.visualizationReferences[0]!.related[1]!, "decisionLaneId", "lane-missing-route");
    }],
    ["visualization criterion", (atlas: ReturnType<typeof createMinimalAtlas>) => {
      Reflect.set(atlas.visualizationReferences[0]!.related[2]!, "selectorCriterionId", "selector-missing-goal");
    }],
    ["visualization gate", (atlas: ReturnType<typeof createMinimalAtlas>) => {
      Reflect.set(atlas.visualizationReferences[0]!.related[3]!, "processGateId", "gate-missing-capability");
    }],
    ["visualization route", (atlas: ReturnType<typeof createMinimalAtlas>) => {
      Reflect.set(atlas.visualizationReferences[0]!.related[4]!, "slug", "missing-route");
    }],
  ] as const)("rejects a dangling %s reference", (_label, mutate) => {
    const atlas = createMinimalAtlas();
    mutate(atlas);
    expect(issueCodes(atlas)).toContain("REFERENCE_MISSING");
  });

  it("rejects duplicate selector option IDs", () => {
    const atlas = createMinimalAtlas();
    const option = structuredClone(atlas.selector.criteria[0]!.options[0]!);
    atlas.selector.criteria[0]!.options.push(option);
    expect(issueCodes(atlas)).toContain("ID_DUPLICATE");
  });

  it("rejects duplicate vocabulary term values and ordered-term positions", () => {
    const atlas = createMinimalAtlas();
    atlas.vocabularies[0]!.terms.push(structuredClone(atlas.vocabularies[0]!.terms[0]!));
    expect(issueCodes(atlas)).toContain("ID_DUPLICATE");
  });

  it("rejects a missing fact in a required baseline material field", () => {
    const atlas = createMinimalAtlas();
    Reflect.set(atlas.materials[0]!.properties.density, "value", {
      state: "missing",
      reason: "Synthetic input omitted this required field",
    });
    expect(issueCodes(atlas)).toContain("FIELD_COVERAGE_MISSING");
  });

  it.each([
    ["generic", "Heat resistance", "THERMAL_METRIC_GENERIC"],
    ["service conflation", "Service temperature", "THERMAL_SERVICE_CONFLATION"],
  ] as const)("rejects a %s named thermal observation", (_label, metricLabel, expectedCode) => {
    const atlas = createMinimalAtlas();
    Reflect.set(atlas.materials[0]!.thermalObservations[0]!, "metric", "other");
    atlas.materials[0]!.thermalObservations[0]!.metricLabel = metricLabel;
    expect(issueCodes(atlas)).toContain(expectedCode);
  });

  it("accepts service guidance and a named observation as distinct thermal indicators", () => {
    const atlas = createMinimalAtlas();
    setThermalRange(
      atlas,
      { kind: "claim-id", claimId: atlas.materials[0]!.serviceTemperature.id },
      [{ kind: "claim-id", claimId: atlas.materials[0]!.thermalObservations[0]!.id }],
    );

    expect(parseAtlas(atlas)).toMatchObject({ success: true });
  });

  it("accepts named observations only when their metric and represented method match", () => {
    const atlas = createMinimalAtlas();
    const second = structuredClone(atlas.materials[0]!.thermalObservations[0]!);
    second.id = "claim-synthetic-glass-transition-secondary";
    atlas.materials[0]!.thermalObservations.push(second);
    setThermalRange(
      atlas,
      { kind: "claim-id", claimId: atlas.materials[0]!.thermalObservations[0]!.id },
      [{ kind: "claim-id", claimId: second.id }],
    );

    expect(parseAtlas(atlas)).toMatchObject({ success: true });
  });

  it.each([
    ["metric", (observation: ReturnType<typeof createMinimalAtlas>["materials"][number]["thermalObservations"][number]) => {
      observation.metric = "heat-deflection";
      observation.metricLabel = "Heat deflection temperature";
    }],
    ["standard", (observation: ReturnType<typeof createMinimalAtlas>["materials"][number]["thermalObservations"][number]) => {
      observation.method = { ...observation.method, standard: "Synthetic standard B" };
    }],
    ["load", (observation: ReturnType<typeof createMinimalAtlas>["materials"][number]["thermalObservations"][number]) => {
      Reflect.set(observation.method, "loadMpa", 1.8);
    }],
    ["annealing", (observation: ReturnType<typeof createMinimalAtlas>["materials"][number]["thermalObservations"][number]) => {
      observation.method = { ...observation.method, annealed: true };
    }],
    ["conditioning", (observation: ReturnType<typeof createMinimalAtlas>["materials"][number]["thermalObservations"][number]) => {
      Reflect.set(observation.method, "conditioning", "Synthetic conditioned state");
    }],
    ["other conditions", (observation: ReturnType<typeof createMinimalAtlas>["materials"][number]["thermalObservations"][number]) => {
      Reflect.set(observation.method, "otherConditions", "Synthetic alternate fixture");
    }],
  ] as const)("rejects named observations with a different %s", (_dimension, mutate) => {
    const atlas = createMinimalAtlas();
    const second = structuredClone(atlas.materials[0]!.thermalObservations[0]!);
    second.id = "claim-synthetic-thermal-secondary";
    mutate(second);
    atlas.materials[0]!.thermalObservations.push(second);
    const reference = setThermalRange(
      atlas,
      { kind: "claim-id", claimId: atlas.materials[0]!.thermalObservations[0]!.id },
      [{ kind: "claim-id", claimId: second.id }],
    );

    expect(thermalIssues(atlas)).toEqual([{
      code: "THERMAL_NOT_COMPARABLE",
      pointer: "/visualizationReferences/0/related/0",
      entityId: reference.id,
    }]);
  });

  it.each([
    ["subject", "subject"],
    ["related", "related"],
  ] as const)("rejects a non-thermal claim in the %s position", (_label, position) => {
    const atlas = createMinimalAtlas();
    atlas.materials[0]!.properties.density.value = {
      state: "known",
      value: { shape: "exact", value: 9.876, unit: "g/cm3" },
    };
    const service = { kind: "claim-id" as const, claimId: atlas.materials[0]!.serviceTemperature.id };
    const density = { kind: "claim-id" as const, claimId: atlas.materials[0]!.properties.density.id };
    const reference = setThermalRange(
      atlas,
      position === "subject" ? density : service,
      [position === "related" ? density : service],
    );

    const result = parseAtlas(atlas);
    expect(result.success).toBe(false);
    expect(thermalIssues(atlas)).toEqual([{
      code: "THERMAL_NOT_COMPARABLE",
      pointer: position === "subject"
        ? "/visualizationReferences/0/subject"
        : "/visualizationReferences/0/related/0",
      entityId: reference.id,
    }]);
    expect(JSON.stringify(result)).not.toContain("9.876");
  });

  const resolvedNonClaimTargets = [
    ["material", { kind: "material-id", materialId: "material-synthetic-alpha" }],
    ["route", { kind: "material-route", slug: "synthetic-alpha" }],
    ["lane", { kind: "decision-lane-id", decisionLaneId: "lane-outdoor" }],
    ["criterion", { kind: "selector-criterion-id", selectorCriterionId: "selector-primary-goal" }],
    ["process gate", { kind: "process-gate-id", processGateId: "gate-synthetic-enclosure" }],
  ] as const;

  it.each(resolvedNonClaimTargets)("rejects a resolved %s target as the thermal subject", (_label, target) => {
    const atlas = createMinimalAtlas();
    const reference = setThermalRange(atlas, target, [
      { kind: "claim-id", claimId: atlas.materials[0]!.serviceTemperature.id },
    ]);

    expect(thermalIssues(atlas)).toEqual([{
      code: "THERMAL_NOT_COMPARABLE",
      pointer: "/visualizationReferences/0/subject",
      entityId: reference.id,
    }]);
  });

  it.each(resolvedNonClaimTargets)("rejects a resolved %s target in the thermal related list", (_label, target) => {
    const atlas = createMinimalAtlas();
    const reference = setThermalRange(
      atlas,
      { kind: "claim-id", claimId: atlas.materials[0]!.serviceTemperature.id },
      [target],
    );

    expect(thermalIssues(atlas)).toEqual([{
      code: "THERMAL_NOT_COMPARABLE",
      pointer: "/visualizationReferences/0/related/0",
      entityId: reference.id,
    }]);
  });

  it("rejects a thermal-range reference without a relationship", () => {
    const atlas = createMinimalAtlas();
    const reference = setThermalRange(
      atlas,
      { kind: "claim-id", claimId: atlas.materials[0]!.serviceTemperature.id },
      [],
    );

    expect(thermalIssues(atlas)).toEqual([{
      code: "THERMAL_NOT_COMPARABLE",
      pointer: "/visualizationReferences/0/related",
      entityId: reference.id,
    }]);
  });

  it("maps local schema rules to stable invariant codes", () => {
    const unsafeUrl = createMinimalAtlas();
    unsafeUrl.sources[0]!.url = "http://invalid.example.test/private-marker";
    expect(issueCodes(unsafeUrl)).toContain("URL_UNSAFE");

    const wrongScope = createMinimalAtlas();
    Reflect.set(wrongScope.materials[0]!.startingProfile.printSpeed.basis[0]!, "scope", "family-guidance");
    expect(issueCodes(wrongScope)).toContain("EVIDENCE_SCOPE_INVALID");

    const invalidVocabulary = createMinimalAtlas();
    Reflect.set(invalidVocabulary.materials[0]!.properties.outdoorUv.value, "value", "universally-best");
    expect(issueCodes(invalidVocabulary)).toContain("VOCABULARY_INVALID");
  });

  it("reports embedded lane candidates with a stable code and no rejected value", () => {
    const atlas = createMinimalAtlas();
    Object.assign(atlas.decisionLanes[0]!, {
      candidateMaterialIds: [privateLookingSyntheticMarker],
    });
    const result = parseAtlas(atlas);
    expect(result.success).toBe(false);
    expect(result.success ? [] : result.issues.map(({ code }) => code)).toContain("LANE_CANDIDATE_EMBEDDED");
    expect(JSON.stringify(result)).not.toContain(privateLookingSyntheticMarker);
  });

  it("returns invariant issues in deterministic safe shape", () => {
    const atlas = createMinimalAtlas();
    atlas.processGates.push(structuredClone(atlas.processGates[0]!));
    const direct = validateAtlasInvariants(AtlasV1Schema.parse(atlas));
    const result = parseAtlas(atlas);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toEqual(direct);
      expect(result.issues).toEqual([...result.issues].sort((left, right) =>
        left.pointer.localeCompare(right.pointer) || left.code.localeCompare(right.code),
      ));
      for (const issue of result.issues) {
        expect(Object.keys(issue).every((key) => ["code", "pointer", "entityId"].includes(key))).toBe(true);
      }
    }
  });
});
