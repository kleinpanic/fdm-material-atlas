import type { AtlasV1 } from "./atlas.ts";
import type { BasisRef } from "./evidence.ts";
import {
  compareThermalObservations,
  type ThermalObservation,
} from "./material.ts";
import type { AtlasIssue } from "./parse-atlas.ts";
import type { VisualizationTargetRef } from "./visualization.ts";

type ClaimLike = {
  id: string;
  value: { state: string };
  basis: BasisRef[];
};

type ClaimEntry = {
  claim: ClaimLike;
  pointer: string;
  entityId: string;
};

type ThermalEntry = {
  observation: ThermalObservation;
  pointer: string;
  entityId: string;
};

function issue(code: AtlasIssue["code"], pointer: string, entityId?: string): AtlasIssue {
  return { code, pointer, ...(entityId === undefined ? {} : { entityId }) };
}

function duplicateIssues<T>(
  values: readonly T[],
  key: (value: T) => string,
  pointer: (index: number) => string,
  entityId?: (value: T) => string | undefined,
): AtlasIssue[] {
  const seen = new Set<string>();
  const issues: AtlasIssue[] = [];
  values.forEach((value, index) => {
    const identifier = key(value);
    if (seen.has(identifier)) {
      issues.push(issue("ID_DUPLICATE", pointer(index), entityId?.(value)));
    } else {
      seen.add(identifier);
    }
  });
  return issues;
}

function materialClaims(atlas: AtlasV1): { claims: ClaimEntry[]; thermal: ThermalEntry[] } {
  const claims: ClaimEntry[] = [];
  const thermal: ThermalEntry[] = [];
  const add = (claim: ClaimLike, pointer: string, materialId: string) => {
    claims.push({ claim, pointer, entityId: materialId });
  };

  atlas.materials.forEach((material, materialIndex) => {
    const base = `/materials/${materialIndex}`;
    add(material.familyOrFill, `${base}/familyOrFill`, material.id);
    add(material.serviceTemperature, `${base}/serviceTemperature`, material.id);
    for (const [name, claim] of Object.entries(material.properties)) {
      add(claim, `${base}/properties/${name}`, material.id);
    }
    for (const [name, claim] of Object.entries(material.process)) {
      add(claim, `${base}/process/${name}`, material.id);
    }
    for (const [name, claim] of Object.entries(material.guidance)) {
      add(claim, `${base}/guidance/${name}`, material.id);
    }
    add(material.costTier, `${base}/costTier`, material.id);
    for (const name of ["printSpeed", "partCoolingFan", "bridgeSpeed", "bridgeFan"] as const) {
      add(material.startingProfile[name], `${base}/startingProfile/${name}`, material.id);
    }
    material.thermalObservations.forEach((observation, observationIndex) => {
      thermal.push({
        observation,
        pointer: `${base}/thermalObservations/${observationIndex}`,
        entityId: material.id,
      });
    });
  });
  return { claims, thermal };
}

function validateBasis(
  basis: readonly BasisRef[],
  pointer: string,
  entityId: string,
  sourceIds: ReadonlySet<string>,
  methodIds: ReadonlySet<string>,
): AtlasIssue[] {
  const issues: AtlasIssue[] = [];
  basis.forEach((reference, index) => {
    const resolved = reference.kind === "source"
      ? sourceIds.has(reference.sourceId)
      : methodIds.has(reference.methodId);
    if (!resolved) {
      issues.push(issue("REFERENCE_MISSING", `${pointer}/basis/${index}`, entityId));
    }
  });
  return issues;
}

function validateTarget(
  target: VisualizationTargetRef,
  pointer: string,
  entityId: string,
  indexes: {
    materialIds: ReadonlySet<string>;
    claimIds: ReadonlySet<string>;
    laneIds: ReadonlySet<string>;
    criterionIds: ReadonlySet<string>;
    processGateIds: ReadonlySet<string>;
    routeSlugs: ReadonlySet<string>;
  },
): AtlasIssue[] {
  const resolved = (() => {
    switch (target.kind) {
      case "material-id": return indexes.materialIds.has(target.materialId);
      case "claim-id": return indexes.claimIds.has(target.claimId);
      case "decision-lane-id": return indexes.laneIds.has(target.decisionLaneId);
      case "selector-criterion-id": return indexes.criterionIds.has(target.selectorCriterionId);
      case "process-gate-id": return indexes.processGateIds.has(target.processGateId);
      case "material-route": return indexes.routeSlugs.has(target.slug);
    }
  })();
  return resolved ? [] : [issue("REFERENCE_MISSING", pointer, entityId)];
}

const GENERIC_THERMAL_LABELS = new Set([
  "heat",
  "heat resistance",
  "heat-resistance",
  "temperature",
  "thermal resistance",
]);

const SERVICE_THERMAL_LABEL_PATTERN = /\b(service|operating|continuous[- ]use) temperature\b/iu;

function validateThermalTransformations(
  atlas: AtlasV1,
  thermalById: ReadonlyMap<string, ThermalObservation>,
): AtlasIssue[] {
  const issues: AtlasIssue[] = [];
  atlas.visualizationReferences.forEach((reference, referenceIndex) => {
    if (reference.kind !== "thermal-range" || reference.subject.kind !== "claim-id") return;
    const subject = thermalById.get(reference.subject.claimId);
    if (!subject) return;
    reference.related.forEach((target, targetIndex) => {
      if (target.kind !== "claim-id") return;
      const related = thermalById.get(target.claimId);
      if (related && !compareThermalObservations(subject, related).comparable) {
        issues.push(issue(
          "THERMAL_NOT_COMPARABLE",
          `/visualizationReferences/${referenceIndex}/related/${targetIndex}`,
          reference.id,
        ));
      }
    });
  });
  return issues;
}

/** Validate graph and scientific invariants after strict structural parsing. */
export function validateAtlasInvariants(atlas: AtlasV1): AtlasIssue[] {
  const issues: AtlasIssue[] = [];
  const { claims, thermal } = materialClaims(atlas);

  issues.push(
    ...duplicateIssues(atlas.materials, ({ id }) => id, (index) => `/materials/${index}/id`, ({ id }) => id),
    ...duplicateIssues(atlas.materials, ({ slug }) => slug, (index) => `/materials/${index}/slug`, ({ id }) => id),
    ...duplicateIssues(atlas.sources, ({ id }) => id, (index) => `/sources/${index}/id`, ({ id }) => id),
    ...duplicateIssues(atlas.methods, ({ id }) => id, (index) => `/methods/${index}/id`, ({ id }) => id),
    ...duplicateIssues(atlas.processGates, ({ id }) => id, (index) => `/processGates/${index}/id`, ({ id }) => id),
    ...duplicateIssues(atlas.decisionLanes, ({ id }) => id, (index) => `/decisionLanes/${index}/id`, ({ id }) => id),
    ...duplicateIssues(atlas.visualizationReferences, ({ id }) => id, (index) => `/visualizationReferences/${index}/id`, ({ id }) => id),
    ...duplicateIssues(atlas.vocabularies, ({ id }) => id, (index) => `/vocabularies/${index}/id`, ({ id }) => id),
    ...duplicateIssues(claims, ({ claim }) => claim.id, (index) => `${claims[index]!.pointer}/id`, ({ entityId }) => entityId),
    ...duplicateIssues(thermal, ({ observation }) => observation.id, (index) => `${thermal[index]!.pointer}/id`, ({ entityId }) => entityId),
  );

  const allClaimEntries = [
    ...claims.map(({ claim, pointer, entityId }) => ({ id: claim.id, pointer, entityId })),
    ...thermal.map(({ observation, pointer, entityId }) => ({ id: observation.id, pointer, entityId })),
  ];
  issues.push(...duplicateIssues(
    allClaimEntries,
    ({ id }) => id,
    (index) => `${allClaimEntries[index]!.pointer}/id`,
    ({ entityId }) => entityId,
  ));

  const optionEntries = atlas.selector.criteria.flatMap((criterion, criterionIndex) =>
    criterion.options.map((option, optionIndex) => ({ option, criterionIndex, optionIndex })),
  );
  issues.push(...duplicateIssues(
    atlas.selector.criteria,
    ({ id }) => id,
    (index) => `/selector/criteria/${index}/id`,
    ({ id }) => id,
  ));
  issues.push(...duplicateIssues(
    optionEntries,
    ({ option }) => option.id,
    (index) => `/selector/criteria/${optionEntries[index]!.criterionIndex}/options/${optionEntries[index]!.optionIndex}/id`,
    ({ option }) => option.id,
  ));

  atlas.vocabularies.forEach((vocabulary, vocabularyIndex) => {
    issues.push(...duplicateIssues(
      vocabulary.terms,
      ({ value }) => value,
      (termIndex) => `/vocabularies/${vocabularyIndex}/terms/${termIndex}/value`,
      () => vocabulary.id,
    ));
    const orderedTerms = vocabulary.terms.filter(({ order }) => order !== undefined);
    if (vocabulary.ordered && orderedTerms.length !== vocabulary.terms.length) {
      issues.push(issue("VOCABULARY_INVALID", `/vocabularies/${vocabularyIndex}/terms`, vocabulary.id));
    }
    issues.push(...duplicateIssues(
      orderedTerms,
      ({ order }) => String(order),
      (termIndex) => `/vocabularies/${vocabularyIndex}/terms/${termIndex}/order`,
      () => vocabulary.id,
    ));
  });

  const sourceIds = new Set(atlas.sources.map(({ id }) => id));
  const methodIds = new Set(atlas.methods.map(({ id }) => id));
  for (const { claim, pointer, entityId } of claims) {
    issues.push(...validateBasis(claim.basis, pointer, entityId, sourceIds, methodIds));
    if (claim.value.state === "missing") {
      issues.push(issue("FIELD_COVERAGE_MISSING", `${pointer}/value`, entityId));
    }
  }
  for (const { observation, pointer, entityId } of thermal) {
    issues.push(...validateBasis(observation.basis, pointer, entityId, sourceIds, methodIds));
    const normalizedLabel = observation.metricLabel.toLocaleLowerCase("en-US");
    if (observation.metric === "other" && GENERIC_THERMAL_LABELS.has(normalizedLabel)) {
      issues.push(issue("THERMAL_METRIC_GENERIC", `${pointer}/metricLabel`, entityId));
    }
    if (observation.metric === "other" && SERVICE_THERMAL_LABEL_PATTERN.test(normalizedLabel)) {
      issues.push(issue("THERMAL_SERVICE_CONFLATION", `${pointer}/metricLabel`, entityId));
    }
  }

  atlas.processGates.forEach((gate, gateIndex) => {
    issues.push(...validateBasis(gate.basis, `/processGates/${gateIndex}`, gate.id, sourceIds, methodIds));
  });

  const materialIds = new Set(atlas.materials.map(({ id }) => id));
  const routeSlugs = new Set(atlas.materials.map(({ slug }) => slug));
  const claimIds = new Set(allClaimEntries.map(({ id }) => id));
  const laneIds = new Set(atlas.decisionLanes.map(({ id }) => id));
  const criterionIds = new Set(atlas.selector.criteria.map(({ id }) => id));
  const processGateIds = new Set(atlas.processGates.map(({ id }) => id));
  const indexes = { materialIds, claimIds, laneIds, criterionIds, processGateIds, routeSlugs };

  optionEntries.forEach(({ option, criterionIndex, optionIndex }) => {
    option.hardGates.forEach((gate, gateIndex) => {
      if (!processGateIds.has(gate.processGateId)) {
        issues.push(issue(
          "REFERENCE_MISSING",
          `/selector/criteria/${criterionIndex}/options/${optionIndex}/hardGates/${gateIndex}/processGateId`,
          option.id,
        ));
      }
    });
  });

  atlas.decisionLanes.forEach((lane, laneIndex) => {
    lane.processGateIds.forEach((gateId, gateIndex) => {
      if (!processGateIds.has(gateId)) {
        issues.push(issue("REFERENCE_MISSING", `/decisionLanes/${laneIndex}/processGateIds/${gateIndex}`, lane.id));
      }
    });
  });

  atlas.visualizationReferences.forEach((reference, referenceIndex) => {
    issues.push(...validateTarget(reference.subject, `/visualizationReferences/${referenceIndex}/subject`, reference.id, indexes));
    reference.related.forEach((target, targetIndex) => {
      issues.push(...validateTarget(target, `/visualizationReferences/${referenceIndex}/related/${targetIndex}`, reference.id, indexes));
    });
  });

  const thermalById = new Map(thermal.map(({ observation }) => [observation.id, observation]));
  issues.push(...validateThermalTransformations(atlas, thermalById));

  const deduplicated = new Map<string, AtlasIssue>();
  for (const atlasIssue of issues) {
    const key = `${atlasIssue.pointer}\u0000${atlasIssue.code}\u0000${atlasIssue.entityId ?? ""}`;
    deduplicated.set(key, atlasIssue);
  }
  return [...deduplicated.values()].sort((left, right) =>
    left.pointer.localeCompare(right.pointer) ||
    left.code.localeCompare(right.code) ||
    (left.entityId ?? "").localeCompare(right.entityId ?? ""),
  );
}

