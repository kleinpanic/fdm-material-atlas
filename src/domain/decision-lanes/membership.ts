import type { AtlasV1 } from "../../data/schema/atlas.ts";
import type { DecisionLaneId, MaterialId, ProcessGateId, VisualizationId } from "../../data/schema/ids.ts";
import type { ProcessGateCapability } from "../../data/schema/process-gate.ts";
import type { SelectorField } from "../../data/schema/selector.ts";
import type { VisualizationKind, VisualizationTargetRef } from "../../data/schema/visualization.ts";
import { resolveSelectorField } from "../selector/field-resolver.ts";
import { compilePredicate, evaluateCompiledPredicate } from "../selector/predicate.ts";

export type DecisionLaneMembership = {
  readonly id: DecisionLaneId;
  readonly label: string;
  readonly need: string;
  readonly propertyChecks: readonly SelectorField[];
  readonly verification: readonly string[];
  readonly processGates: readonly {
    readonly id: ProcessGateId;
    readonly label: string;
    readonly capability: ProcessGateCapability;
    readonly requirement: string;
    readonly verification: string;
  }[];
  readonly candidateMaterialIds: readonly MaterialId[];
  readonly indeterminateMaterialIds: readonly MaterialId[];
  readonly visualizations: readonly {
    readonly id: VisualizationId;
    readonly kind: VisualizationKind;
  }[];
};

function fail(code: "RELATIONSHIP_LANE_DUPLICATE" | "RELATIONSHIP_GATE_MISSING" | "RELATIONSHIP_VISUALIZATION_MISSING" | "RELATIONSHIP_RULE_INVALID"): never {
  throw new Error(code);
}

function compareId(left: string, right: string): number {
  return left.localeCompare(right, "en");
}

function targetLaneId(target: VisualizationTargetRef): DecisionLaneId | undefined {
  return target.kind === "decision-lane-id" ? target.decisionLaneId : undefined;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

/** Derive all lane candidates through the sole bounded predicate implementation. */
export function deriveDecisionLaneMembership(atlas: AtlasV1): readonly DecisionLaneMembership[] {
  const laneIds = new Set<DecisionLaneId>(atlas.decisionLanes.map(({ id }) => id));
  if (laneIds.size !== atlas.decisionLanes.length) fail("RELATIONSHIP_LANE_DUPLICATE");
  const gates = new Map(atlas.processGates.map((gate) => [gate.id, gate]));

  for (const reference of atlas.visualizationReferences) {
    const targets = [reference.subject, ...reference.related];
    for (const target of targets) {
      const laneId = targetLaneId(target);
      if (laneId !== undefined && !laneIds.has(laneId)) fail("RELATIONSHIP_VISUALIZATION_MISSING");
    }
  }

  const models = [...atlas.decisionLanes].sort((left, right) => compareId(left.id, right.id)).map((lane) => {
    let predicate;
    try {
      predicate = compilePredicate(lane.candidateRule);
    } catch {
      return fail("RELATIONSHIP_RULE_INVALID");
    }
    const candidateMaterialIds: MaterialId[] = [];
    const indeterminateMaterialIds: MaterialId[] = [];
    for (const material of [...atlas.materials].sort((left, right) => compareId(left.id, right.id))) {
      let outcome;
      try {
        outcome = evaluateCompiledPredicate(
          predicate,
          (field) => resolveSelectorField(material, field, atlas.vocabularies),
        );
      } catch {
        return fail("RELATIONSHIP_RULE_INVALID");
      }
      if (outcome === "match") candidateMaterialIds.push(material.id);
      if (outcome === "indeterminate") indeterminateMaterialIds.push(material.id);
    }
    const processGates = [...lane.processGateIds].sort(compareId).map((gateId) => {
      const gate = gates.get(gateId);
      if (!gate) return fail("RELATIONSHIP_GATE_MISSING");
      return {
        id: gate.id,
        label: gate.label,
        capability: gate.capability,
        requirement: gate.requirement,
        verification: gate.verification,
      };
    });
    const visualizations = atlas.visualizationReferences
      .filter((reference) => [reference.subject, ...reference.related]
        .some((target) => targetLaneId(target) === lane.id))
      .sort((left, right) => compareId(left.id, right.id))
      .map(({ id, kind }) => ({ id, kind }));
    return {
      id: lane.id,
      label: lane.label,
      need: lane.need,
      propertyChecks: [...lane.propertyChecks],
      verification: [...lane.verification],
      processGates,
      candidateMaterialIds,
      indeterminateMaterialIds,
      visualizations,
    };
  });

  return deepFreeze(models);
}
