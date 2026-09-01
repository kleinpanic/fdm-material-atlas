import type { BasisRef, EvidenceScope } from "../../data/schema/evidence.ts";
import type { FactState } from "../../data/schema/fact-state.ts";
import type { MaterialId } from "../../data/schema/ids.ts";
import type {
  Material,
  ThermalMethod,
} from "../../data/schema/material.ts";
import type { TemperatureMeasurement } from "../../data/schema/measurements.ts";
import { partitionCompatibleThermalObservations } from "../../domain/thermal/compatibility-groups.ts";
import {
  EVIDENCE_SCOPE_ORDER,
  FACT_STATE_PRESENTATION,
  evidenceScopeLabel,
} from "../../lib/presentation/labels.ts";
import { formatMeasurement } from "../../lib/presentation/measurements.ts";
import { internalHref } from "../../lib/routes.ts";
import type {
  MapDisplayFact,
  MapEvidenceContext,
  MapMaterialReference,
  MapServiceGuidanceRecord,
  MapServiceMeasurement,
  MapThermalGroup,
  MapThermalMember,
  MapTransformResult,
} from "./contracts.ts";

export type ServiceGuidanceSort = "canonical" | "low" | "high";

export type ServiceGuidanceOptions = {
  readonly query: string;
  readonly sort: ServiceGuidanceSort;
};

export type ServiceGuidanceModel = {
  readonly domain?: { readonly low: number; readonly high: number; readonly unit: "degC" };
  readonly ticks: readonly number[];
  readonly query: string;
  readonly sort: ServiceGuidanceSort;
  readonly highlightedMaterialIds: readonly MaterialId[];
  readonly records: MapTransformResult<MapServiceGuidanceRecord>;
};

export type NamedThermalViewRecord = {
  readonly material: MapMaterialReference;
  readonly member?: MapThermalMember;
  readonly disposition: MapThermalMember["disposition"];
};

export type NamedThermalModel = {
  readonly groups: readonly MapThermalGroup[];
  readonly selectedGroupId?: string;
  readonly selectionReset: boolean;
  readonly selectedRecords?: MapTransformResult<NamedThermalViewRecord>;
};

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

function materialReference(material: Material, base: string | undefined): MapMaterialReference {
  return {
    id: material.id,
    name: material.name,
    href: internalHref(base, { id: "material", slug: material.slug }),
    displayOrder: material.displayOrder,
  };
}

function sortedScopes(basis: readonly BasisRef[]): readonly EvidenceScope[] {
  const present = new Set(basis.map(({ scope }) => scope));
  return EVIDENCE_SCOPE_ORDER.filter((scope) => present.has(scope));
}

function evidenceContext(basis: readonly BasisRef[], qualification?: string): MapEvidenceContext {
  const scopes = sortedScopes(basis);
  return {
    scopes,
    scopeLabels: scopes.map(evidenceScopeLabel),
    ...(qualification === undefined ? {} : { qualification }),
  };
}

function evidenceContextFromScopes(scopes: readonly EvidenceScope[], qualification: string): MapEvidenceContext {
  const ordered = EVIDENCE_SCOPE_ORDER.filter((scope) => scopes.includes(scope));
  return {
    scopes: ordered,
    scopeLabels: ordered.map(evidenceScopeLabel),
    qualification,
  };
}

function measurementDisplay(measurement: TemperatureMeasurement): string {
  return formatMeasurement(measurement).text;
}

function displayTemperatureFact(fact: FactState<TemperatureMeasurement>): MapDisplayFact {
  switch (fact.state) {
    case "known":
      return { state: "known", display: [measurementDisplay(fact.value)] };
    case "conditional":
      return {
        state: "conditional",
        display: [
          FACT_STATE_PRESENTATION.conditional.label,
          ...(fact.value === undefined ? [] : [measurementDisplay(fact.value)]),
          fact.condition,
        ],
        condition: fact.condition,
      };
    case "unknown":
      return { state: "unknown", display: [FACT_STATE_PRESENTATION.unknown.label, fact.reason], reason: fact.reason };
    case "not-applicable":
      return {
        state: "not-applicable",
        display: [
          FACT_STATE_PRESENTATION["not-applicable"].label,
          ...(fact.reason === undefined ? [] : [fact.reason]),
        ],
        ...(fact.reason === undefined ? {} : { reason: fact.reason }),
      };
    case "missing":
      return { state: "missing", display: [FACT_STATE_PRESENTATION.missing.label, fact.reason], reason: fact.reason };
  }
}

function serviceMeasurement(fact: FactState<TemperatureMeasurement>): MapServiceMeasurement | undefined {
  if (fact.state !== "known" && !(fact.state === "conditional" && fact.value !== undefined)) return undefined;
  const measurement = fact.value;
  return measurement.shape === "exact"
    ? { shape: "point", value: measurement.value, unit: "degC" }
    : { shape: "interval", low: measurement.min, high: measurement.max, unit: "degC" };
}

function endpoints(measurement: MapServiceMeasurement | undefined): readonly [number, number] | undefined {
  if (measurement === undefined) return undefined;
  return measurement.shape === "point"
    ? [measurement.value, measurement.value]
    : [measurement.low, measurement.high];
}

function omission(fact: FactState<TemperatureMeasurement>): MapServiceGuidanceRecord["disposition"] {
  switch (fact.state) {
    case "known": return { disposition: "plotted" };
    case "conditional": return fact.value === undefined
      ? { disposition: "omitted", code: "conditional-without-value", reason: fact.condition }
      : { disposition: "plotted" };
    case "unknown": return { disposition: "omitted", code: "unknown-value", reason: fact.reason };
    case "not-applicable": return {
      disposition: "omitted",
      code: "not-applicable",
      reason: fact.reason ?? "Practical service guidance is not applicable.",
    };
    case "missing": return { disposition: "omitted", code: "not-reported", reason: fact.reason };
  }
}

function stableMaterialOrder(left: Material, right: Material): number {
  return left.displayOrder - right.displayOrder || compareText(left.id, right.id);
}

function partitionResult<T extends { readonly disposition: MapServiceGuidanceRecord["disposition"] }>(
  all: readonly T[],
): MapTransformResult<T> {
  return {
    all,
    plotted: all.filter(({ disposition }) => disposition.disposition === "plotted"),
    filtered: all.filter(({ disposition }) => disposition.disposition === "filtered"),
    omitted: all.filter(({ disposition }) => disposition.disposition === "omitted"),
  };
}

function normalizedQuery(query: string): string {
  return query.trim().normalize("NFC").toLocaleLowerCase("en-US");
}

/** Build a service-guidance-only domain and complete disposition accounting. */
export function buildServiceGuidanceModel(
  materials: readonly Material[],
  base: string | undefined,
  options: ServiceGuidanceOptions,
): ServiceGuidanceModel {
  const query = normalizedQuery(options.query);
  const drafted = materials.map((material) => {
    const measurement = serviceMeasurement(material.serviceTemperature.value);
    const matches = query === "" || material.name.normalize("NFC").toLocaleLowerCase("en-US").includes(query);
    const initialDisposition = omission(material.serviceTemperature.value);
    const disposition = initialDisposition.disposition === "plotted" && !matches
      ? { disposition: "filtered" as const, filter: { kind: "search" as const, target: "thermal" as const, query } }
      : initialDisposition;
    return {
      source: material,
      record: {
        material: materialReference(material, base),
        fact: displayTemperatureFact(material.serviceTemperature.value),
        ...(measurement === undefined ? {} : { measurement }),
        evidence: evidenceContext(material.serviceTemperature.basis, material.serviceTemperature.qualification),
        disposition,
      } satisfies MapServiceGuidanceRecord,
    };
  });

  drafted.sort((left, right) => {
    if (options.sort === "canonical") return stableMaterialOrder(left.source, right.source);
    const leftEndpoints = endpoints(left.record.measurement);
    const rightEndpoints = endpoints(right.record.measurement);
    const index = options.sort === "low" ? 0 : 1;
    const leftValue = leftEndpoints?.[index];
    const rightValue = rightEndpoints?.[index];
    if (leftValue === undefined && rightValue !== undefined) return 1;
    if (leftValue !== undefined && rightValue === undefined) return -1;
    if (leftValue !== undefined && rightValue !== undefined && leftValue !== rightValue) return leftValue - rightValue;
    return stableMaterialOrder(left.source, right.source);
  });

  const numericEndpoints = drafted.flatMap(({ record }) => endpoints(record.measurement) ?? []);
  const domain = numericEndpoints.length === 0 ? undefined : {
    low: Math.floor((Math.min(...numericEndpoints) - 5) / 10) * 10,
    high: Math.ceil((Math.max(...numericEndpoints) + 5) / 10) * 10,
    unit: "degC" as const,
  };
  const ticks = domain === undefined
    ? []
    : Array.from({ length: Math.floor((domain.high - domain.low) / 10) + 1 }, (_, index) => domain.low + index * 10);
  const records = drafted.map(({ record }) => record);

  return deepFreeze({
    ...(domain === undefined ? {} : { domain }),
    ticks,
    query,
    sort: options.sort,
    highlightedMaterialIds: query === ""
      ? []
      : records.filter(({ disposition }) => disposition.disposition === "plotted").map(({ material }) => material.id),
    records: partitionResult(records),
  });
}

/** Build exact named-test groups and an optional complete selected-group view. */
export function buildNamedThermalModel(
  materials: readonly Material[],
  base: string | undefined,
  selectedGroupId?: string,
): NamedThermalModel {
  const materialById = new Map(materials.map((material) => [material.id, material]));
  const partition = partitionCompatibleThermalObservations(
    materials.flatMap((material) => material.thermalObservations.map((observation) => ({
      materialId: material.id,
      observation,
    }))),
  );
  const methodLabel = (method: Readonly<ThermalMethod> | undefined): string => {
    if (method === undefined) return "Method not represented";
    const dimensions = [
      method.standard,
      method.loadMpa === undefined ? undefined : `${String(method.loadMpa)} MPa load`,
      method.annealed === undefined ? undefined : method.annealed ? "Annealed" : "Not annealed",
      method.conditioning,
      method.otherConditions,
    ].filter((dimension): dimension is string => dimension !== undefined);
    return dimensions.length === 0 ? "Method dimensions not represented" : dimensions.join(" · ");
  };

  const groups = partition.map((group): MapThermalGroup => ({
    id: group.id,
    metric: group.metric,
    metricLabel: group.metricLabel,
    ...(group.method === undefined ? {} : { method: { ...group.method } }),
    methodLabel: methodLabel(group.method),
    members: group.members.map(({ materialId, observation }): MapThermalMember => {
      const material = materialById.get(materialId);
      if (material === undefined) throw new Error("NAMED_THERMAL_MATERIAL_MISSING");
      return {
        material: materialReference(material, base),
        metric: observation.metric,
        metricLabel: observation.metricLabel,
        ...(observation.method === undefined ? {} : { method: { ...observation.method } }),
        methodLabel: methodLabel(observation.method),
        fact: displayTemperatureFact(observation.measurement),
        evidence: evidenceContextFromScopes(observation.basisScopes, observation.qualification),
        disposition: { disposition: "plotted" },
      };
    }),
  }));

  const selectedGroup = selectedGroupId === undefined
    ? undefined
    : groups.find(({ id }) => id === selectedGroupId);
  const selectionReset = selectedGroupId !== undefined && selectedGroup === undefined;
  const orderedMaterials = [...materials].sort(stableMaterialOrder);
  const selectedRows = selectedGroup === undefined ? undefined : orderedMaterials.flatMap((material) => {
    const members = selectedGroup.members.filter(({ material: memberMaterial }) => memberMaterial.id === material.id);
    if (members.length > 0) {
      return members.map((member): NamedThermalViewRecord => ({
        material: materialReference(material, base),
        member,
        disposition: { disposition: "plotted" },
      }));
    }
    return [{
      material: materialReference(material, base),
      disposition: {
        disposition: "omitted" as const,
        code: "no-observation-in-group" as const,
        reason: "No observation in this metric and method group.",
      },
    }];
  });

  return deepFreeze({
    groups,
    ...(selectedGroup === undefined ? {} : {
      selectedGroupId: selectedGroup.id,
      selectedRecords: partitionResult(selectedRows ?? []),
    }),
    selectionReset,
  });
}
