import type { EvidenceScope } from "../../data/schema/evidence.ts";
import type { FactState } from "../../data/schema/fact-state.ts";
import type { MaterialId, } from "../../data/schema/ids.ts";
import type { ThermalMethod, ThermalMetricKind } from "../../data/schema/material.ts";
import type { MaterialSemanticKey } from "../materials/claim-registry.ts";
import type { DataAttributeGroupKey, DataAttributeValueKind } from "../data-explorer/contracts.ts";

export type SemanticAtom = string | number | boolean;
export type SemanticTuple = readonly (SemanticAtom | SemanticTuple)[];

export type ComparisonEvidenceAction = Readonly<{
  label: string;
  scope: EvidenceScope;
  scopeLabel: string;
  href: string;
}>;

export type ComparisonField = Readonly<{
  key: MaterialSemanticKey;
  label: string;
  valueKind: DataAttributeValueKind;
  help: string;
  caution?: string | undefined;
}>;

export type ComparisonGroup = Readonly<{
  key: DataAttributeGroupKey;
  label: string;
  fields: readonly ComparisonField[];
}>;

export type ComparisonValueCell = Readonly<{
  kind: "value";
  key: MaterialSemanticKey;
  state: FactState<unknown>["state"] | "identity";
  display: readonly string[];
  qualification?: string | undefined;
  scopeLabels: readonly string[];
  evidence: readonly ComparisonEvidenceAction[];
  equality: SemanticTuple;
}>;

export type ComparisonThermalMember = Readonly<{
  groupId: string;
  metric: ThermalMetricKind;
  metricLabel: string;
  method?: ThermalMethod | undefined;
  methodLabel: string;
  state: FactState<unknown>["state"];
  display: readonly string[];
  qualification: string;
  scopeLabels: readonly string[];
  evidence: readonly ComparisonEvidenceAction[];
  equality: SemanticTuple;
}>;

export type ComparisonThermalCell = Readonly<{
  kind: "thermal";
  key: "thermal-metric" | "thermal-value";
  members: readonly ComparisonThermalMember[];
}>;

export type ComparisonCell = ComparisonValueCell | ComparisonThermalCell;

export type ComparisonMaterial = Readonly<{
  id: MaterialId;
  name: string;
  href: string;
  cells: readonly ComparisonCell[];
}>;

export type ComparisonThermalGroup = Readonly<{
  id: string;
  metric: ThermalMetricKind;
  metricLabel: string;
  method?: ThermalMethod | undefined;
  methodLabel: string;
}>;

export type ComparisonModel = Readonly<{
  groups: readonly ComparisonGroup[];
  thermalGroups: readonly ComparisonThermalGroup[];
  materials: readonly ComparisonMaterial[];
}>;
