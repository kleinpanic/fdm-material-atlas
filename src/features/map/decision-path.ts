import type { AtlasV1 } from "../../data/schema/atlas.ts";
import { decisionLaneIds } from "../../data/schema/decision-lane.ts";
import type { DecisionLaneId, MaterialId, ProcessGateId } from "../../data/schema/ids.ts";
import type { ProcessGateCapability } from "../../data/schema/process-gate.ts";
import type { SelectorField } from "../../data/schema/selector.ts";
import type { VisualizationTargetRef } from "../../data/schema/visualization.ts";
import { deriveDecisionLaneMembership } from "../../domain/decision-lanes/membership.ts";
import { internalFragmentHref, internalHref } from "../../lib/routes.ts";
import type {
  MapDecisionLane,
  MapMaterialReference,
  MapProcessGateReference,
} from "./contracts.ts";

type DecisionPathErrorCode =
  | "DECISION_PATH_LANE_DUPLICATE"
  | "DECISION_PATH_LANE_MISSING"
  | "DECISION_PATH_MATERIAL_MISSING"
  | "DECISION_PATH_GATE_MISSING"
  | "DECISION_PATH_VISUALIZATION_MISSING"
  | "DECISION_PATH_PROPERTY_LABEL_MISSING";

const PROPERTY_LABELS = Object.freeze({
  "guidance.bestSuitedFor": "Recommended uses",
  "process.enclosure": "Enclosure requirement",
  "process.hardenedNozzle": "Wear-resistant nozzle requirement",
  "process.printDifficulty": "Print difficulty",
  "process.ventilation": "Ventilation category",
  "properties.chemicalResistance": "Chemical resistance",
  "properties.creepSustainedLoad": "Creep and sustained load",
  "properties.flexibility": "Flexibility",
  "properties.impactResistance": "Impact resistance",
  "properties.moistureSensitivity": "Moisture sensitivity",
  "properties.outdoorUv": "Outdoor and UV behavior",
  "properties.wearAbrasion": "Wear and abrasion",
  "serviceTemperature.maximum": "Maximum service temperature",
} satisfies Partial<Readonly<Record<SelectorField, string>>>);

const CAPABILITY_LABELS = Object.freeze({
  enclosure: "Enclosure capability",
  "hardened-nozzle": "Wear-resistant nozzle capability",
  drying: "Drying capability",
  ventilation: "Ventilation capability",
  "temperature-capability": "Temperature capability",
  "flexible-feed-path": "Flexible feed-path capability",
  "soluble-support-process": "Soluble-support process capability",
  "industrial-hardware": "Industrial hardware capability",
} satisfies Readonly<Record<ProcessGateCapability, string>>);

const VISIBLE_CANDIDATE_LIMIT = 8;

function fail(code: DecisionPathErrorCode): never {
  throw new Error(code);
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en");
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

function validateLaneSet(atlas: AtlasV1): void {
  const ids = atlas.decisionLanes.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) fail("DECISION_PATH_LANE_DUPLICATE");
  if (ids.length !== decisionLaneIds.length || decisionLaneIds.some((id) => !ids.includes(id))) {
    fail("DECISION_PATH_LANE_MISSING");
  }
}

function validateTarget(
  target: VisualizationTargetRef,
  indexes: Readonly<{
    materialIds: ReadonlySet<string>;
    materialSlugs: ReadonlySet<string>;
    gateIds: ReadonlySet<string>;
    laneIds: ReadonlySet<string>;
    criterionIds: ReadonlySet<string>;
  }>,
): void {
  switch (target.kind) {
    case "material-id":
      if (!indexes.materialIds.has(target.materialId)) fail("DECISION_PATH_MATERIAL_MISSING");
      return;
    case "material-route":
      if (!indexes.materialSlugs.has(target.slug)) fail("DECISION_PATH_MATERIAL_MISSING");
      return;
    case "process-gate-id":
      if (!indexes.gateIds.has(target.processGateId)) fail("DECISION_PATH_GATE_MISSING");
      return;
    case "decision-lane-id":
      if (!indexes.laneIds.has(target.decisionLaneId)) fail("DECISION_PATH_VISUALIZATION_MISSING");
      return;
    case "selector-criterion-id":
      if (!indexes.criterionIds.has(target.selectorCriterionId)) fail("DECISION_PATH_VISUALIZATION_MISSING");
      return;
    case "claim-id":
      // Claim referential integrity is enforced at the canonical Atlas boundary.
      return;
  }
}

function validateVisualizationReferences(atlas: AtlasV1): void {
  const indexes = {
    materialIds: new Set(atlas.materials.map(({ id }) => id)),
    materialSlugs: new Set(atlas.materials.map(({ slug }) => slug)),
    gateIds: new Set(atlas.processGates.map(({ id }) => id)),
    laneIds: new Set(atlas.decisionLanes.map(({ id }) => id)),
    criterionIds: new Set(atlas.selector.criteria.map(({ id }) => id)),
  };
  for (const reference of atlas.visualizationReferences) {
    validateTarget(reference.subject, indexes);
    reference.related.forEach((target) => validateTarget(target, indexes));
  }
  for (const laneId of decisionLaneIds) {
    const references = atlas.visualizationReferences.filter((reference) =>
      reference.kind === "decision-path"
      && reference.subject.kind === "decision-lane-id"
      && reference.subject.decisionLaneId === laneId);
    if (references.length !== 1) fail("DECISION_PATH_VISUALIZATION_MISSING");
  }
}

function materialReference(
  atlas: AtlasV1,
  materialId: MaterialId,
  base: string | undefined,
): MapMaterialReference {
  const material = atlas.materials.find(({ id }) => id === materialId);
  if (material === undefined) return fail("DECISION_PATH_MATERIAL_MISSING");
  return {
    id: material.id,
    name: material.name,
    href: internalHref(base, { id: "material", slug: material.slug }),
    displayOrder: material.displayOrder,
  };
}

function gateReference(
  atlas: AtlasV1,
  gateId: ProcessGateId,
  base: string | undefined,
): MapProcessGateReference {
  const gate = atlas.processGates.find(({ id }) => id === gateId);
  if (gate === undefined) return fail("DECISION_PATH_GATE_MISSING");
  return {
    id: gate.id,
    label: gate.label,
    capabilityLabel: CAPABILITY_LABELS[gate.capability],
    requirement: gate.requirement,
    verification: gate.verification,
    href: internalFragmentHref(base, { id: "map" }, gate.id),
  };
}

function propertyLabel(field: SelectorField): string {
  const label = PROPERTY_LABELS[field as keyof typeof PROPERTY_LABELS];
  if (label === undefined) return fail("DECISION_PATH_PROPERTY_LABEL_MISSING");
  return label;
}

/** Build the complete eight-path decision model from current canonical membership. */
export function buildDecisionPaths(
  atlas: AtlasV1,
  base: string | undefined = "/",
): readonly MapDecisionLane[] {
  validateLaneSet(atlas);
  validateVisualizationReferences(atlas);

  const memberships = new Map(
    deriveDecisionLaneMembership(atlas).map((lane) => [lane.id, lane]),
  );
  const paths = decisionLaneIds.map((laneId): MapDecisionLane => {
    const lane = memberships.get(laneId as DecisionLaneId);
    if (lane === undefined) return fail("DECISION_PATH_LANE_MISSING");
    const candidates = lane.candidateMaterialIds
      .map((materialId) => materialReference(atlas, materialId, base))
      .sort((left, right) => left.displayOrder - right.displayOrder || compareText(left.id, right.id));
    return {
      id: lane.id,
      label: lane.label,
      need: lane.need,
      href: internalFragmentHref(base, { id: "map" }, lane.id),
      propertyChecks: lane.propertyChecks.map((field) => ({ field, label: propertyLabel(field) })),
      candidates,
      visibleCandidates: candidates.slice(0, VISIBLE_CANDIDATE_LIMIT),
      overflowCandidates: candidates.slice(VISIBLE_CANDIDATE_LIMIT),
      indeterminateMaterialIds: [...lane.indeterminateMaterialIds].sort(compareText),
      verification: [...lane.verification],
      processGates: lane.processGates.map(({ id }) => gateReference(atlas, id, base)),
    };
  });

  return deepFreeze(paths);
}
