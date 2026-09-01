import type { AtlasV1 } from "../../data/schema/atlas.ts";
import type { BasisRef, Claim, EvidenceScope } from "../../data/schema/evidence.ts";
import type { FactState } from "../../data/schema/fact-state.ts";
import type { MaterialId } from "../../data/schema/ids.ts";
import {
  type Material,
  type ThermalMethod,
} from "../../data/schema/material.ts";
import { partitionCompatibleThermalObservations } from "../../domain/thermal/compatibility-groups.ts";
import {
  EVIDENCE_SCOPE_ORDER,
  FACT_STATE_PRESENTATION,
  evidenceScopeLabel,
} from "../../lib/presentation/labels.ts";
import { formatMeasurement } from "../../lib/presentation/measurements.ts";
import { internalHref } from "../../lib/routes.ts";
import {
  DATA_ATTRIBUTE_GROUPS,
  DATA_ATTRIBUTE_REGISTRY,
} from "../data-explorer/attribute-registry.ts";
import type { DataAttributeDescriptor } from "../data-explorer/contracts.ts";
import {
  MATERIAL_CLAIM_REGISTRY,
  type MaterialClaimDescriptor,
  type MaterialSemanticKey,
} from "../materials/claim-registry.ts";
import { buildMaterialDetailModels, type MaterialDetailClaim } from "../materials/detail-model.ts";
import type {
  ComparisonCell,
  ComparisonEvidenceAction,
  ComparisonGroup,
  ComparisonMaterial,
  ComparisonModel,
  ComparisonThermalGroup,
  ComparisonThermalMember,
  ComparisonValueCell,
  SemanticTuple,
} from "./contracts.ts";

type ComparisonModelErrorCode =
  | "COMPARISON_MATERIALS_EMPTY"
  | "COMPARISON_MATERIAL_DUPLICATE"
  | "COMPARISON_REGISTRY_INVALID"
  | "COMPARISON_CLAIM_MISSING"
  | "COMPARISON_VALUE_INVALID"
  | "COMPARISON_THERMAL_GROUP_MISSING";

function fail(code: ComparisonModelErrorCode): never {
  throw new Error(code);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function sortedScopes(basis: readonly BasisRef[]): readonly EvidenceScope[] {
  return [...new Set(basis.map(({ scope }) => scope))]
    .sort((left, right) => EVIDENCE_SCOPE_ORDER.indexOf(left) - EVIDENCE_SCOPE_ORDER.indexOf(right));
}

function normalizeValue(value: unknown): SemanticTuple {
  if (typeof value === "string") return ["string", value.normalize("NFC")];
  if (typeof value === "number" && Number.isFinite(value)) return ["number", Object.is(value, -0) ? 0 : value];
  if (typeof value === "boolean") return ["boolean", value];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return ["list", ...value.map((item) => ["item", item.normalize("NFC")] as const)];
  }
  if (typeof value === "object" && value !== null && "shape" in value && "unit" in value) {
    const measurement = value as Record<string, unknown>;
    if (measurement.shape === "exact" && typeof measurement.value === "number" && typeof measurement.unit === "string") {
      return ["measurement", "exact", measurement.value, measurement.unit];
    }
    if (
      measurement.shape === "range" &&
      typeof measurement.min === "number" &&
      typeof measurement.max === "number" &&
      typeof measurement.unit === "string"
    ) {
      return ["measurement", "range", measurement.min, measurement.max, measurement.unit];
    }
  }
  return fail("COMPARISON_VALUE_INVALID");
}

function factTuple(
  fact: FactState<unknown>,
  qualification: string | undefined,
  scopes: readonly EvidenceScope[],
): SemanticTuple {
  const suffix: SemanticTuple = [
    "qualification",
    qualification ?? "",
    ["scopes", ...scopes],
  ];
  switch (fact.state) {
    case "known": return ["known", normalizeValue(fact.value), suffix];
    case "conditional": return fact.value === undefined
      ? ["conditional", fact.condition.normalize("NFC"), ["without-value"], suffix]
      : ["conditional", fact.condition.normalize("NFC"), normalizeValue(fact.value), suffix];
    case "unknown": return ["unknown", fact.reason.normalize("NFC"), suffix];
    case "not-applicable": return ["not-applicable", fact.reason?.normalize("NFC") ?? "", suffix];
    case "missing": return ["missing", fact.reason.normalize("NFC"), suffix];
  }
}

function labelLookup(atlas: AtlasV1): ReadonlyMap<string, string> {
  const entries = [...atlas.vocabularies]
    .sort((left, right) => compareText(left.id, right.id))
    .flatMap(({ terms }) => terms.map(({ value, label }) => [value, label] as const));
  const labels = new Map<string, string>();
  for (const [value, label] of entries) if (!labels.has(value)) labels.set(value, label);
  return labels;
}

function valueDisplay(value: unknown, labels: ReadonlyMap<string, string>): readonly string[] {
  if (typeof value === "string") return [labels.get(value) ?? value];
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return [...value];
  if (typeof value === "object" && value !== null && "shape" in value && "unit" in value) {
    return [formatMeasurement(value as Parameters<typeof formatMeasurement>[0]).text];
  }
  return fail("COMPARISON_VALUE_INVALID");
}

function factDisplay(fact: FactState<unknown>, labels: ReadonlyMap<string, string>): readonly string[] {
  switch (fact.state) {
    case "known": return valueDisplay(fact.value, labels);
    case "conditional": return fact.value === undefined
      ? [FACT_STATE_PRESENTATION.conditional.label, fact.condition]
      : [FACT_STATE_PRESENTATION.conditional.label, ...valueDisplay(fact.value, labels), fact.condition];
    case "unknown": return [FACT_STATE_PRESENTATION.unknown.label, fact.reason];
    case "not-applicable": return [FACT_STATE_PRESENTATION["not-applicable"].label, ...(fact.reason === undefined ? [] : [fact.reason])];
    case "missing": return [FACT_STATE_PRESENTATION.missing.label, fact.reason];
  }
}

function actions(claim: MaterialDetailClaim): readonly ComparisonEvidenceAction[] {
  return claim.evidence.map(({ label, scope, href }) => ({
    label,
    scope,
    scopeLabel: evidenceScopeLabel(scope),
    href,
  }));
}

function claimDescriptor(key: MaterialSemanticKey): MaterialClaimDescriptor | undefined {
  return MATERIAL_CLAIM_REGISTRY.find(({ semanticKeys }) =>
    (semanticKeys as readonly MaterialSemanticKey[]).includes(key)
  );
}

function scalarClaim(
  material: Material,
  key: MaterialSemanticKey,
): Claim<unknown> {
  const descriptor = claimDescriptor(key);
  if (descriptor === undefined || descriptor.kind === "identity" || descriptor.kind === "named-thermal-observation") {
    return fail("COMPARISON_CLAIM_MISSING");
  }
  return descriptor.read(material);
}

function detailClaim(
  claims: readonly MaterialDetailClaim[],
  key: MaterialSemanticKey,
): MaterialDetailClaim {
  const descriptor = claimDescriptor(key);
  if (descriptor === undefined || descriptor.kind === "identity" || descriptor.kind === "named-thermal-observation") {
    return fail("COMPARISON_CLAIM_MISSING");
  }
  const match = claims.find(({ descriptorKey }) => descriptorKey === descriptor.key);
  return match ?? fail("COMPARISON_CLAIM_MISSING");
}

function identityCell(material: Material): ComparisonValueCell {
  return {
    kind: "value",
    key: "material-name",
    state: "identity",
    display: [material.name],
    scopeLabels: [],
    evidence: [],
    equality: ["identity", material.name.normalize("NFC")],
  };
}

function serviceEndpointCell(
  material: Material,
  detail: MaterialDetailClaim,
  key: "service-temperature-low" | "service-temperature-high",
): ComparisonValueCell {
  const endpoint = key === "service-temperature-low" ? "low" : "high";
  const claim = material.serviceTemperature;
  const scopes = sortedScopes(claim.basis);
  let fact: FactState<unknown>;
  if (claim.value.state === "known") {
    const measurement = claim.value.value;
    fact = {
      state: "known",
      value: measurement.shape === "exact" ? measurement.value : measurement[endpoint === "low" ? "min" : "max"],
    };
  } else if (claim.value.state === "conditional" && claim.value.value !== undefined) {
    const measurement = claim.value.value;
    fact = {
      state: "conditional",
      condition: claim.value.condition,
      value: measurement.shape === "exact" ? measurement.value : measurement[endpoint === "low" ? "min" : "max"],
    };
  } else {
    fact = claim.value as FactState<unknown>;
  }
  const shape = claim.value.state === "known"
    ? claim.value.value.shape
    : claim.value.state === "conditional" && claim.value.value !== undefined
      ? claim.value.value.shape
      : "without-measurement";
  const display = fact.state === "known"
    ? [`${String(fact.value)} °C`]
    : fact.state === "conditional" && fact.value !== undefined
      ? [FACT_STATE_PRESENTATION.conditional.label, `${String(fact.value)} °C`, fact.condition]
      : factDisplay(fact, new Map());
  return {
    kind: "value",
    key,
    state: fact.state,
    display,
    ...(claim.qualification === undefined ? {} : { qualification: claim.qualification }),
    scopeLabels: scopes.map(evidenceScopeLabel),
    evidence: actions(detail),
    equality: ["service-endpoint", endpoint, shape, factTuple(fact, claim.qualification, scopes)],
  };
}

function scalarCell(
  material: Material,
  detail: MaterialDetailClaim,
  descriptor: DataAttributeDescriptor,
  labels: ReadonlyMap<string, string>,
): ComparisonValueCell {
  const claim = scalarClaim(material, descriptor.key);
  const scopes = sortedScopes(claim.basis);
  return {
    kind: "value",
    key: descriptor.key,
    state: claim.value.state,
    display: factDisplay(claim.value, labels),
    ...(claim.qualification === undefined ? {} : { qualification: claim.qualification }),
    scopeLabels: scopes.map(evidenceScopeLabel),
    evidence: actions(detail),
    equality: factTuple(claim.value, claim.qualification, scopes),
  };
}

function methodLabel(method: ThermalMethod | undefined): string {
  if (method === undefined) return "Method not represented";
  const parts = [
    method.standard,
    method.loadMpa === undefined ? undefined : `${method.loadMpa} MPa load`,
    method.annealed === undefined ? undefined : method.annealed ? "Annealed" : "Not annealed",
    method.conditioning,
    method.otherConditions,
  ].filter((part): part is string => part !== undefined);
  return parts.length === 0 ? "Method dimensions not represented" : parts.join(" · ");
}

type ThermalGroupIndex = {
  readonly groups: readonly ComparisonThermalGroup[];
  readonly byObservation: ReadonlyMap<string, string>;
};

function buildThermalGroups(materials: readonly Material[]): ThermalGroupIndex {
  const partition = partitionCompatibleThermalObservations(
    materials.flatMap((material) => material.thermalObservations.map((observation) => ({
      materialId: material.id,
      observation,
    }))),
  );
  const groups = partition.map(({ id, metric, metricLabel, method }): ComparisonThermalGroup => ({
    id,
    metric,
    metricLabel,
    ...(method === undefined ? {} : { method: { ...method } }),
    methodLabel: methodLabel(method),
  }));
  const membership = new Map(partition.flatMap((group) => group.members.map(({ materialId, observation }) => [
    `${materialId}\u0000${observation.id}`,
    group.id,
  ] as const)));
  return {
    groups,
    byObservation: membership,
  };
}

function thermalCell(
  material: Material,
  detailClaims: readonly MaterialDetailClaim[],
  key: "thermal-metric" | "thermal-value",
  index: ThermalGroupIndex,
  labels: ReadonlyMap<string, string>,
): ComparisonCell {
  const members = [...material.thermalObservations]
    .map((observation): ComparisonThermalMember => {
      const groupId = index.byObservation.get(`${material.id}\u0000${observation.id}`) ?? fail("COMPARISON_THERMAL_GROUP_MISSING");
      const detail = detailClaims.find(({ claimId }) => claimId === observation.id) ?? fail("COMPARISON_CLAIM_MISSING");
      const scopes = sortedScopes(observation.basis);
      // Group membership is established only by compareThermalObservations().
      // Do not add a second client-side comparability rule through display text.
      const groupIdentity: SemanticTuple = ["thermal-group", groupId];
      return {
        groupId,
        metric: observation.metric,
        metricLabel: observation.metricLabel,
        ...(observation.method === undefined ? {} : { method: { ...observation.method } }),
        methodLabel: methodLabel(observation.method),
        state: observation.measurement.state,
        display: key === "thermal-metric"
          ? [observation.metricLabel, methodLabel(observation.method), FACT_STATE_PRESENTATION[observation.measurement.state].label]
          : factDisplay(observation.measurement, labels),
        qualification: observation.qualification,
        scopeLabels: scopes.map(evidenceScopeLabel),
        evidence: actions(detail),
        equality: key === "thermal-metric"
          ? ["thermal-metric", groupIdentity, observation.measurement.state, observation.qualification, ["scopes", ...scopes]]
          : ["thermal-value", groupIdentity, factTuple(observation.measurement, observation.qualification, scopes)],
      };
    })
    .sort((left, right) => compareText(left.groupId, right.groupId));
  return { kind: "thermal", key, members };
}

function validateRegistry(): void {
  const keys = DATA_ATTRIBUTE_REGISTRY.map(({ key }) => key);
  if (keys.length !== 32 || new Set(keys).size !== 32 || DATA_ATTRIBUTE_GROUPS.length !== 8) {
    fail("COMPARISON_REGISTRY_INVALID");
  }
}

/** Compile the build-only canonical Atlas into a compact client comparison projection. */
export function buildComparisonModel(atlas: AtlasV1, base: string | undefined): ComparisonModel {
  validateRegistry();
  if (atlas.materials.length === 0) fail("COMPARISON_MATERIALS_EMPTY");
  const ids = new Set(atlas.materials.map(({ id }) => id));
  const slugs = new Set(atlas.materials.map(({ slug }) => slug));
  if (ids.size !== atlas.materials.length || slugs.size !== atlas.materials.length) fail("COMPARISON_MATERIAL_DUPLICATE");

  const materials = [...atlas.materials]
    .sort((left, right) => left.displayOrder - right.displayOrder || compareText(left.id, right.id));
  const details = buildMaterialDetailModels(atlas, base);
  const detailsById = new Map(details.map((detail) => [detail.id, detail]));
  const thermal = buildThermalGroups(materials);
  const labels = labelLookup(atlas);
  const groups: readonly ComparisonGroup[] = DATA_ATTRIBUTE_GROUPS.map(({ key, label, fields }) => ({
    key,
    label,
    fields: fields.map((field) => ({
      key: field.key,
      label: field.label,
      valueKind: field.valueKind,
      help: field.help,
      ...(field.caution === undefined ? {} : { caution: field.caution }),
    })),
  }));

  const projected: ComparisonMaterial[] = materials.map((material) => {
    const detail = detailsById.get(material.id) ?? fail("COMPARISON_CLAIM_MISSING");
    const cells = DATA_ATTRIBUTE_REGISTRY.map((descriptor): ComparisonCell => {
      if (descriptor.key === "material-name") return identityCell(material);
      if (descriptor.key === "service-temperature-low" || descriptor.key === "service-temperature-high") {
        return serviceEndpointCell(material, detailClaim(detail.claims, descriptor.key), descriptor.key);
      }
      if (descriptor.key === "thermal-metric" || descriptor.key === "thermal-value") {
        return thermalCell(material, detail.claims, descriptor.key, thermal, labels);
      }
      return scalarCell(material, detailClaim(detail.claims, descriptor.key), descriptor, labels);
    });
    if (cells.length !== 32) fail("COMPARISON_REGISTRY_INVALID");
    return {
      id: material.id as MaterialId,
      name: material.name,
      href: internalHref(base, { id: "material", slug: material.slug }),
      cells,
    };
  });

  return deepFreeze({ groups, thermalGroups: thermal.groups, materials: projected });
}
