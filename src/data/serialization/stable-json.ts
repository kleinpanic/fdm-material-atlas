import type { BasisRef } from "../schema/evidence.ts";
import type { Predicate } from "../schema/selector.ts";
import type { VisualizationTargetRef } from "../schema/visualization.ts";
import { type AtlasV1 } from "../schema/atlas.ts";
import { parseAtlas } from "../schema/parse-atlas.ts";

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeString(value: string): string {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").normalize("NFC");
}

function normalizeStrings(value: unknown): unknown {
  if (typeof value === "string") return normalizeString(value);
  if (Array.isArray(value)) return value.map(normalizeStrings);
  if (typeof value !== "object" || value === null) return value;
  const normalized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) normalized[key] = normalizeStrings(child);
  return normalized;
}

function basisKey(reference: BasisRef): string {
  const id = reference.kind === "source" ? reference.sourceId : reference.methodId;
  return `${reference.kind}\u0000${id}\u0000${reference.scope}\u0000${reference.note ?? ""}`;
}

function targetKey(target: VisualizationTargetRef): string {
  switch (target.kind) {
    case "material-id":
      return `${target.kind}\u0000${target.materialId}`;
    case "claim-id":
      return `${target.kind}\u0000${target.claimId}`;
    case "decision-lane-id":
      return `${target.kind}\u0000${target.decisionLaneId}`;
    case "selector-criterion-id":
      return `${target.kind}\u0000${target.selectorCriterionId}`;
    case "process-gate-id":
      return `${target.kind}\u0000${target.processGateId}`;
    case "material-route":
      return `${target.kind}\u0000${target.slug}`;
  }
}

function scalarKey(value: string | number | boolean): string {
  return `${typeof value}\u0000${String(value)}`;
}

function orderPredicate(predicate: Predicate): void {
  switch (predicate.op) {
    case "one-of":
      predicate.values = [...predicate.values].sort((left, right) =>
        compareText(scalarKey(left), scalarKey(right)),
      );
      break;
    case "contains-any":
      predicate.values = [...predicate.values].sort(compareText);
      break;
    case "all":
    case "any":
      predicate.rules.forEach(orderPredicate);
      predicate.rules = [...predicate.rules].sort((left, right) =>
        compareText(JSON.stringify(left), JSON.stringify(right)),
      );
      break;
    case "not":
      orderPredicate(predicate.rule);
      break;
    case "equals":
    case "at-least":
    case "at-most":
      break;
  }
}

function orderBasis(basis: BasisRef[]): void {
  basis.sort((left, right) => compareText(basisKey(left), basisKey(right)));
}

function orderAtlasRecords(atlas: AtlasV1): AtlasV1 {
  atlas.materials.sort((left, right) => compareText(left.id, right.id));
  atlas.materials.forEach((material) => {
    orderBasis(material.familyOrFill.basis);
    orderBasis(material.serviceTemperature.basis);
    material.thermalObservations.sort((left, right) => compareText(left.id, right.id));
    material.thermalObservations.forEach(({ basis }) => orderBasis(basis));
    Object.values(material.properties).forEach(({ basis }) => orderBasis(basis));
    Object.values(material.process).forEach(({ basis }) => orderBasis(basis));
    Object.values(material.guidance).forEach(({ basis }) => orderBasis(basis));
    orderBasis(material.costTier.basis);
    orderBasis(material.startingProfile.printSpeed.basis);
    orderBasis(material.startingProfile.partCoolingFan.basis);
    orderBasis(material.startingProfile.bridgeSpeed.basis);
    orderBasis(material.startingProfile.bridgeFan.basis);
  });

  atlas.sources.sort((left, right) => compareText(left.id, right.id));
  atlas.methods.sort((left, right) => compareText(left.id, right.id));

  atlas.selector.criteria.sort((left, right) => compareText(left.id, right.id));
  atlas.selector.criteria.forEach((criterion) => {
    criterion.options.sort((left, right) => compareText(left.id, right.id));
    criterion.options.forEach((option) => {
      if (option.preferenceRule) orderPredicate(option.preferenceRule);
      option.hardGates.sort((left, right) => compareText(left.reasonId, right.reasonId));
      option.hardGates.forEach(({ incompatibleWhen }) => orderPredicate(incompatibleWhen));
    });
  });

  atlas.processGates.sort((left, right) => compareText(left.id, right.id));
  atlas.processGates.forEach(({ basis }) => orderBasis(basis));

  atlas.decisionLanes.sort((left, right) => compareText(left.id, right.id));
  atlas.decisionLanes.forEach((lane) => {
    lane.propertyChecks.sort(compareText);
    lane.processGateIds.sort(compareText);
    orderPredicate(lane.candidateRule);
  });

  atlas.visualizationReferences.sort((left, right) => compareText(left.id, right.id));
  atlas.visualizationReferences.forEach((reference) => {
    reference.related.sort((left, right) => compareText(targetKey(left), targetKey(right)));
  });

  atlas.vocabularies.sort((left, right) => compareText(left.id, right.id));
  atlas.vocabularies.forEach((vocabulary) => {
    vocabulary.terms.sort((left, right) => compareText(left.value, right.value));
  });
  return atlas;
}

/** Produce the canonical UTF-8 JSON representation of a validated AtlasV1. */
export function serializeAtlas(atlas: AtlasV1): string {
  const validated = parseAtlas(atlas);
  if (!validated.success) throw new Error("Atlas serialization rejected invalid input");
  const normalized = normalizeStrings(validated.data) as AtlasV1;
  const canonical = orderAtlasRecords(normalized);
  return `${JSON.stringify(canonical, null, 2)}\n`;
}
