import type { EvidenceScope } from "../../data/schema/evidence.ts";
import type { FactState } from "../../data/schema/fact-state.ts";
import type { Material, ThermalObservation } from "../../data/schema/material.ts";
import type { MaterialSemanticKey } from "../materials/claim-registry.ts";

export type DataAttributeGroupKey =
  | "identity-thermal"
  | "mechanical-use"
  | "environment-exposure"
  | "print-process"
  | "dimensional-cooling"
  | "handling-density-cost"
  | "uses-tradeoffs"
  | "starting-profile";

export type DataAttributeValueKind =
  "identity" | "fact" | "service-endpoint" | "thermal-metric" | "thermal-value";

export type DataAttributeSearchPolicy = "display" | "none";
export type DataAttributeFilterPolicy = "state-and-scope" | "scope" | "none";
export type DataAttributeSortPolicy = "canonical" | "label" | "vocabulary" | "number" | "none";

export type DataAttributeReadResult =
  | { readonly kind: "identity"; readonly value: string }
  | {
      readonly kind: "fact";
      readonly fact: FactState<unknown>;
      readonly scopes: readonly EvidenceScope[];
    }
  | {
      readonly kind: "service-endpoint";
      readonly endpoint: "low" | "high";
      readonly unit: "degC";
      readonly fact: FactState<number>;
      readonly scopes: readonly EvidenceScope[];
    }
  | {
      readonly kind: "thermal-metric";
      readonly observations: readonly ThermalObservation[];
    }
  | {
      readonly kind: "thermal-value";
      readonly observations: readonly ThermalObservation[];
    };

export type DataAttributeDescriptor = {
  readonly key: MaterialSemanticKey;
  readonly label: string;
  readonly group: DataAttributeGroupKey;
  readonly displayOrder: number;
  readonly valueKind: DataAttributeValueKind;
  readonly search: DataAttributeSearchPolicy;
  readonly filter: DataAttributeFilterPolicy;
  readonly sort: DataAttributeSortPolicy;
  readonly help: string;
  readonly caution?: string | undefined;
  readonly read: (material: Material) => DataAttributeReadResult;
  readonly states: (material: Material) => readonly FactState<unknown>["state"][];
  readonly scopes: (material: Material) => readonly EvidenceScope[];
};

export type DataAttributeGroup = {
  readonly key: DataAttributeGroupKey;
  readonly label: string;
  readonly fields: readonly DataAttributeDescriptor[];
};
