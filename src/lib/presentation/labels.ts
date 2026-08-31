import type { EvidenceScope, EvidenceSource } from "../../data/schema/evidence.ts";
import type { FactState } from "../../data/schema/fact-state.ts";
import type { ThermalMetricKind } from "../../data/schema/material.ts";

export type FactStateKind = FactState<unknown>["state"];
export type ProcessRequirementState =
  | "not-required"
  | "recommended"
  | "required"
  | "conditional"
  | "unknown"
  | "not-applicable";
export type PublicMeasurementUnit = "degC" | "g/cm3" | "mm/s" | "percent";
export type EvidenceSourceKind = EvidenceSource["kind"];

export const FACT_STATE_PRESENTATION = {
  known: { label: "Known" },
  unknown: { label: "Unknown — the public evidence does not provide this value." },
  conditional: { label: "Conditional — review the stated conditions before use." },
  "not-applicable": { label: "Not applicable for this material or claim." },
  missing: { label: "Not reported — the public evidence does not provide this value." },
} as const satisfies Readonly<Record<FactStateKind, { readonly label: string }>>;

export const EVIDENCE_SCOPE_PRESENTATION = {
  "product-specific": {
    label: "Product-specific",
    tracerLabel: "Product-specific value",
    meaning: "The claim applies to the named product or formulation represented by the source.",
  },
  "representative-product": {
    label: "Representative product",
    tracerLabel: "Representative product example",
    meaning: "The value is an example and is not a universal family specification.",
  },
  "family-guidance": {
    label: "Family guidance",
    tracerLabel: "Family-level guidance",
    meaning: "The source supports broad family guidance, with formulation variation expected.",
  },
  "qualitative-heuristic": {
    label: "Qualitative heuristic",
    tracerLabel: "Qualitative heuristic",
    meaning: "The statement is a practical qualitative classification, not a standardized property.",
  },
  "starting-profile-guidance": {
    label: "Starting-profile guidance",
    tracerLabel: "Starting-profile guidance",
    meaning: "The setting is a calibration starting point and is not a guaranteed setting or maximum.",
  },
  "derived-selector-logic": {
    label: "Derived selector logic",
    tracerLabel: "Derived selector logic",
    meaning: "The statement is produced by documented selection rules and is not a measured property.",
  },
} as const satisfies Readonly<
  Record<EvidenceScope, { readonly label: string; readonly tracerLabel: string; readonly meaning: string }>
>;

export const EVIDENCE_SCOPE_ORDER = [
  "product-specific",
  "representative-product",
  "family-guidance",
  "qualitative-heuristic",
  "starting-profile-guidance",
  "derived-selector-logic",
] as const satisfies readonly EvidenceScope[];

export const THERMAL_KIND_PRESENTATION = {
  "glass-transition": { label: "Glass transition (Tg)" },
  "heat-deflection": { label: "Heat deflection temperature (HDT)" },
  "vicat-softening": { label: "Vicat softening" },
  "melting-point": { label: "Melting point/range" },
  other: { label: "Other named metric" },
} as const satisfies Readonly<Record<ThermalMetricKind, { readonly label: string }>>;

export const PROCESS_REQUIREMENT_PRESENTATION = {
  "not-required": { label: "Not required" },
  recommended: { label: "Recommended" },
  required: { label: "Required" },
  conditional: { label: "Conditional — review conditions" },
  unknown: { label: "Unknown — verify before use" },
  "not-applicable": { label: "Not applicable" },
} as const satisfies Readonly<Record<ProcessRequirementState, { readonly label: string }>>;

export const SOURCE_KIND_PRESENTATION = {
  "manufacturer-guide": { label: "Manufacturer guide" },
  "technical-data-sheet": { label: "Technical data sheet" },
  "safety-data-sheet": { label: "Safety data sheet" },
  "product-data": { label: "Product data" },
  "process-guidance": { label: "Process guidance" },
} as const satisfies Readonly<Record<EvidenceSourceKind, { readonly label: string }>>;

export const UNIT_PRESENTATION = {
  degC: { label: "°C" },
  "g/cm3": { label: "g/cm³" },
  "mm/s": { label: "mm/s" },
  percent: { label: "%" },
} as const satisfies Readonly<Record<PublicMeasurementUnit, { readonly label: string }>>;

export type DisplayFact<T> =
  | { readonly state: "known"; readonly label: typeof FACT_STATE_PRESENTATION.known.label; readonly value: T }
  | { readonly state: "unknown"; readonly label: typeof FACT_STATE_PRESENTATION.unknown.label; readonly reason: string }
  | { readonly state: "conditional"; readonly label: typeof FACT_STATE_PRESENTATION.conditional.label; readonly condition: string; readonly value?: T | undefined }
  | { readonly state: "not-applicable"; readonly label: typeof FACT_STATE_PRESENTATION["not-applicable"]["label"]; readonly reason?: string | undefined }
  | { readonly state: "missing"; readonly label: typeof FACT_STATE_PRESENTATION.missing.label; readonly reason: string };

function assertNever(value: never): never {
  void value;
  throw new Error("PRESENTATION_FACT_STATE_INVALID");
}

export function projectFactState<T>(state: FactState<T>): DisplayFact<T> {
  switch (state.state) {
    case "known": return { state: "known", label: FACT_STATE_PRESENTATION.known.label, value: state.value };
    case "unknown": return { state: "unknown", label: FACT_STATE_PRESENTATION.unknown.label, reason: state.reason };
    case "conditional": return { state: "conditional", label: FACT_STATE_PRESENTATION.conditional.label, condition: state.condition, ...(state.value === undefined ? {} : { value: state.value }) };
    case "not-applicable": return { state: "not-applicable", label: FACT_STATE_PRESENTATION["not-applicable"].label, ...(state.reason === undefined ? {} : { reason: state.reason }) };
    case "missing": return { state: "missing", label: FACT_STATE_PRESENTATION.missing.label, reason: state.reason };
    default: return assertNever(state);
  }
}

export function evidenceScopeLabel(scope: EvidenceScope): (typeof EVIDENCE_SCOPE_PRESENTATION)[EvidenceScope]["label"] {
  return EVIDENCE_SCOPE_PRESENTATION[scope].label;
}

export function tracerEvidenceScopeLabel(scope: EvidenceScope): (typeof EVIDENCE_SCOPE_PRESENTATION)[EvidenceScope]["tracerLabel"] {
  return EVIDENCE_SCOPE_PRESENTATION[scope].tracerLabel;
}
