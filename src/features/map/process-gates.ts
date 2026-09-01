import type { AtlasV1 } from "../../data/schema/atlas.ts";
import { decisionLaneIds } from "../../data/schema/decision-lane.ts";
import type {
  DecisionLaneId,
  MaterialId,
  ProcessGateId,
} from "../../data/schema/ids.ts";
import type { ProcessGateCapability } from "../../data/schema/process-gate.ts";
import { deriveDecisionLaneMembership } from "../../domain/decision-lanes/membership.ts";
import { internalFragmentHref, internalHref } from "../../lib/routes.ts";
import type {
  MapGateRelationship,
  MapInternalHref,
  MapMaterialReference,
  MapProcessGateModel,
  MapProcessGateReference,
} from "./contracts.ts";

type ProcessGateMapErrorCode =
  | "PROCESS_GATE_LANE_MISSING"
  | "PROCESS_GATE_LANE_DUPLICATE"
  | "PROCESS_GATE_REGISTRY_MISSING"
  | "PROCESS_GATE_REGISTRY_DUPLICATE"
  | "PROCESS_GATE_REFERENCE_MISSING"
  | "PROCESS_GATE_REFERENCE_DUPLICATE"
  | "PROCESS_GATE_MATERIAL_MISSING"
  | "PROCESS_GATE_SELECTION_MISSING";

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

const EXPECTED_GATE_COUNT = 8;
const NO_ADDITIONAL_GATE_MESSAGE = "No additional process gate is listed for this lane.";

type ProcessGateLane = MapProcessGateModel["lanes"][number];

export type ProcessGateSelection =
  | { readonly kind: "lane"; readonly id: DecisionLaneId }
  | { readonly kind: "gate"; readonly id: ProcessGateId };

export type ProcessGateSelectionContext =
  | {
      readonly kind: "lane";
      readonly lane: ProcessGateLane;
      readonly candidates: readonly MapMaterialReference[];
      readonly gates: readonly MapProcessGateReference[];
      readonly relationships: readonly MapGateRelationship[];
      readonly noAdditionalGateMessage?: typeof NO_ADDITIONAL_GATE_MESSAGE;
    }
  | {
      readonly kind: "gate";
      readonly gate: MapProcessGateReference;
      readonly lanes: readonly {
        readonly lane: ProcessGateLane;
        readonly candidates: readonly MapMaterialReference[];
        readonly relationship: MapGateRelationship;
      }[];
    };

function fail(code: ProcessGateMapErrorCode): never {
  throw new Error(code);
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en");
}

function mapHref(href: string): MapInternalHref {
  if (!href.startsWith("/")) return fail("PROCESS_GATE_SELECTION_MISSING");
  return href as MapInternalHref;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

function validateRegistries(atlas: AtlasV1): void {
  const laneIds = atlas.decisionLanes.map(({ id }) => id);
  const uniqueLaneIds = new Set<string>(laneIds);
  if (uniqueLaneIds.size !== laneIds.length) return fail("PROCESS_GATE_LANE_DUPLICATE");
  if (
    laneIds.length !== decisionLaneIds.length
    || decisionLaneIds.some((id) => !uniqueLaneIds.has(id))
  ) {
    return fail("PROCESS_GATE_LANE_MISSING");
  }

  const gateIds = atlas.processGates.map(({ id }) => id);
  const uniqueGateIds = new Set<string>(gateIds);
  if (uniqueGateIds.size !== gateIds.length) return fail("PROCESS_GATE_REGISTRY_DUPLICATE");
  if (gateIds.length !== EXPECTED_GATE_COUNT) return fail("PROCESS_GATE_REGISTRY_MISSING");

  for (const lane of atlas.decisionLanes) {
    const uniqueReferences = new Set<string>(lane.processGateIds);
    if (uniqueReferences.size !== lane.processGateIds.length) {
      return fail("PROCESS_GATE_REFERENCE_DUPLICATE");
    }
    if (lane.processGateIds.some((gateId) => !uniqueGateIds.has(gateId))) {
      return fail("PROCESS_GATE_REFERENCE_MISSING");
    }
  }
}

function materialReference(
  atlas: AtlasV1,
  materialId: MaterialId,
  base: string | undefined,
): MapMaterialReference {
  const material = atlas.materials.find(({ id }) => id === materialId);
  if (material === undefined) return fail("PROCESS_GATE_MATERIAL_MISSING");
  return {
    id: material.id,
    name: material.name,
    href: mapHref(internalHref(base, { id: "material", slug: material.slug })),
    displayOrder: material.displayOrder,
  };
}

function gateReference(
  gate: AtlasV1["processGates"][number],
  base: string | undefined,
): MapProcessGateReference {
  return {
    id: gate.id,
    label: gate.label,
    capabilityLabel: CAPABILITY_LABELS[gate.capability],
    requirement: gate.requirement,
    verification: gate.verification,
    href: mapHref(internalFragmentHref(base, { id: "map" }, gate.id)),
  };
}

/** Build the complete ordered lane-by-gate matrix from direct canonical references. */
export function buildProcessGateMap(
  atlas: AtlasV1,
  base: string | undefined = "/",
): MapProcessGateModel {
  validateRegistries(atlas);

  const memberships = new Map(
    deriveDecisionLaneMembership(atlas).map((lane) => [lane.id, lane]),
  );
  const gates = [...atlas.processGates]
    .sort((left, right) => compareText(left.id, right.id))
    .map((gate) => gateReference(gate, base));
  const lanes = decisionLaneIds.map((laneId): ProcessGateLane => {
    const lane = memberships.get(laneId as DecisionLaneId);
    if (lane === undefined) return fail("PROCESS_GATE_LANE_MISSING");
    const candidates = lane.candidateMaterialIds
      .map((materialId) => materialReference(atlas, materialId, base))
      .sort((left, right) => left.displayOrder - right.displayOrder || compareText(left.id, right.id));
    return {
      id: lane.id,
      label: lane.label,
      href: mapHref(internalFragmentHref(base, { id: "map" }, lane.id)),
      candidates,
    };
  });
  const appliedByLane = new Map(
    [...memberships].map(([laneId, lane]) => [
      laneId,
      new Set<ProcessGateId>(lane.processGates.map(({ id }) => id)),
    ]),
  );
  const relationships = lanes.flatMap((lane) => gates.map((gate): MapGateRelationship => {
    const applies = appliedByLane.get(lane.id)?.has(gate.id) === true;
    return {
      laneId: lane.id,
      gateId: gate.id,
      relationship: applies ? "applies" : "not-listed",
      label: applies ? "Applies — verify this gate" : "Not listed for this lane",
    };
  }));

  return deepFreeze({ lanes, gates, relationships });
}

/** Resolve lane or gate focus without collapsing candidates shared across lanes. */
export function selectProcessGateContext(
  model: MapProcessGateModel,
  selection: ProcessGateSelection,
): ProcessGateSelectionContext {
  if (selection.kind === "lane") {
    const lane = model.lanes.find(({ id }) => id === selection.id);
    if (lane === undefined) return fail("PROCESS_GATE_SELECTION_MISSING");
    const relationships = model.relationships.filter(
      ({ laneId, relationship }) => laneId === lane.id && relationship === "applies",
    );
    const gateIds = new Set(relationships.map(({ gateId }) => gateId));
    const gates = model.gates.filter(({ id }) => gateIds.has(id));
    return deepFreeze({
      kind: "lane",
      lane,
      candidates: lane.candidates,
      gates,
      relationships,
      ...(gates.length === 0 ? { noAdditionalGateMessage: NO_ADDITIONAL_GATE_MESSAGE } : {}),
    });
  }

  const gate = model.gates.find(({ id }) => id === selection.id);
  if (gate === undefined) return fail("PROCESS_GATE_SELECTION_MISSING");
  const relationships = model.relationships.filter(
    ({ gateId, relationship }) => gateId === gate.id && relationship === "applies",
  );
  const relationshipByLane = new Map(relationships.map((relationship) => [relationship.laneId, relationship]));
  const lanes = model.lanes.flatMap((lane) => {
    const relationship = relationshipByLane.get(lane.id);
    return relationship === undefined ? [] : [{ lane, candidates: lane.candidates, relationship }];
  });
  return deepFreeze({ kind: "gate", gate, lanes });
}
