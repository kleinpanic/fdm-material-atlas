import type { AtlasV1 } from "../data/schema/atlas.ts";
import type {
  BasisRef,
  EvidenceScope,
} from "../data/schema/evidence.ts";
import type {
  Material,
  ThermalMethod,
  ThermalMetricKind,
  ThermalObservation,
} from "../data/schema/material.ts";
import type { TemperatureMeasurement } from "../data/schema/measurements.ts";
import type {
  ProcessGateCapability,
  ProcessGateRecord,
} from "../data/schema/process-gate.ts";
import {
  EVIDENCE_SCOPE_ORDER,
  projectFactState,
  tracerEvidenceScopeLabel,
  type DisplayFact,
} from "./presentation/labels.ts";

export { projectFactState } from "./presentation/labels.ts";
export type { DisplayFact } from "./presentation/labels.ts";

export type TracerEvidenceScope = {
  readonly scope: EvidenceScope;
  readonly label: ReturnType<typeof tracerEvidenceScopeLabel>;
  readonly referenceKind: BasisRef["kind"];
  readonly referenceId: string;
};

export type TracerThermalSpecimen =
  | {
      readonly state: "observation";
      readonly id: ThermalObservation["id"];
      readonly metric: ThermalMetricKind;
      readonly metricLabel: string;
      readonly measurement: DisplayFact<TemperatureMeasurement>;
      readonly method?: ThermalMethod | undefined;
      readonly qualification: string;
    }
  | {
      readonly state: "missing";
      readonly label: "Not reported — no named thermal observation is available.";
    };

export type TracerViewModel = {
  readonly material: Pick<Material, "id" | "slug" | "name">;
  readonly familyOrFill: DisplayFact<string>;
  readonly thermal: TracerThermalSpecimen;
  readonly processGate: {
    readonly id: ProcessGateRecord["id"];
    readonly label: string;
    readonly capability: ProcessGateCapability;
    readonly requirement: string;
    readonly verification: string;
    readonly marker: "diamond";
    readonly markerLabel: "Process gate";
  };
  readonly evidenceScope: TracerEvidenceScope;
};

function fail(code: string): never {
  throw new Error(code);
}

function compareStableText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableFirst<T>(
  values: readonly T[],
  key: (value: T) => string,
): T | undefined {
  let selected: T | undefined;
  for (const value of values) {
    if (selected === undefined || compareStableText(key(value), key(selected)) < 0) {
      selected = value;
    }
  }
  return selected;
}

/** Return the complete public label for an evidence applicability scope. */
export function evidenceScopeLabel(
  scope: EvidenceScope,
): ReturnType<typeof tracerEvidenceScopeLabel> {
  return tracerEvidenceScopeLabel(scope);
}

function basisReferenceId(reference: BasisRef): string {
  return reference.kind === "source" ? reference.sourceId : reference.methodId;
}

function basisSortKey(reference: BasisRef): string {
  const scopeOrder = EVIDENCE_SCOPE_ORDER.indexOf(reference.scope);
  return `${String(scopeOrder).padStart(2, "0")}:${reference.kind}:${basisReferenceId(reference)}:${reference.note ?? ""}`;
}

function selectBasis(references: readonly BasisRef[]): BasisRef | undefined {
  return stableFirst(references, basisSortKey);
}

function projectEvidenceScope(reference: BasisRef): TracerEvidenceScope {
  return {
    scope: reference.scope,
    label: evidenceScopeLabel(reference.scope),
    referenceKind: reference.kind,
    referenceId: basisReferenceId(reference),
  };
}

/** Select the first canonical public material ID without mutating Atlas order. */
export function selectTracerMaterial(atlas: AtlasV1): Material {
  return (
    stableFirst(atlas.materials, (material) => material.id) ??
    fail("TRACER_MATERIAL_REQUIRED")
  );
}

function selectThermal(material: Material): ThermalObservation | undefined {
  return stableFirst(material.thermalObservations, (observation) => observation.id);
}

function selectProcessGate(atlas: AtlasV1): ProcessGateRecord {
  return (
    stableFirst(atlas.processGates, (gate) => gate.id) ??
    fail("TRACER_PROCESS_GATE_REQUIRED")
  );
}

/** Build the static tracer entirely from validated canonical Atlas records. */
export function buildTracerViewModel(atlas: AtlasV1): TracerViewModel {
  const material = selectTracerMaterial(atlas);
  const observation = selectThermal(material);
  const processGate = selectProcessGate(atlas);
  const evidenceBasis =
    selectBasis(observation?.basis ?? []) ??
    selectBasis(material.familyOrFill.basis) ??
    selectBasis(processGate.basis) ??
    fail("TRACER_EVIDENCE_BASIS_REQUIRED");

  const thermal: TracerThermalSpecimen = observation
    ? {
        state: "observation",
        id: observation.id,
        metric: observation.metric,
        metricLabel: observation.metricLabel,
        measurement: projectFactState(observation.measurement),
        ...(observation.method === undefined ? {} : { method: observation.method }),
        qualification: observation.qualification,
      }
    : {
        state: "missing",
        label: "Not reported — no named thermal observation is available.",
      };

  return {
    material: {
      id: material.id,
      slug: material.slug,
      name: material.name,
    },
    familyOrFill: projectFactState(material.familyOrFill.value),
    thermal,
    processGate: {
      id: processGate.id,
      label: processGate.label,
      capability: processGate.capability,
      requirement: processGate.requirement,
      verification: processGate.verification,
      marker: "diamond",
      markerLabel: "Process gate",
    },
    evidenceScope: projectEvidenceScope(evidenceBasis),
  };
}
