import type { EvidenceScope } from "../../data/schema/evidence.ts";
import type {
  DecisionLaneId,
  MaterialId,
  ProcessGateId,
} from "../../data/schema/ids.ts";
import type { ThermalMetricKind, ThermalMethod } from "../../data/schema/material.ts";
import type {
  FlexibilityRating,
  ImpactResistanceRating,
  PrintDifficulty,
} from "../../data/schema/vocabularies.ts";

export const MAP_MODES = [
  "decision-paths",
  "thermal-ranges",
  "process-gates",
  "impact-flex-space",
] as const;

export type MapMode = (typeof MAP_MODES)[number];

/** A client-visible link is always an application-relative, build-resolved target. */
export type MapInternalHref = `/${string}`;

export const MAP_OMISSION_CODES = [
  "unknown-value",
  "conditional-without-value",
  "not-applicable",
  "not-reported",
  "impact-value-unavailable",
  "flexibility-value-unavailable",
  "no-observation-in-group",
  "invalid-public-reference",
  "transform-failed",
] as const;

export type MapOmissionCode = (typeof MAP_OMISSION_CODES)[number];

export type MapFilter =
  | { readonly kind: "search"; readonly target: "thermal" | "impact-flex"; readonly query: string }
  | { readonly kind: "maximum-difficulty"; readonly value: PrintDifficulty }
  | { readonly kind: "named-thermal-group"; readonly groupId: string };

export type MapDisposition =
  | { readonly disposition: "plotted" }
  | { readonly disposition: "filtered"; readonly filter: MapFilter }
  | {
      readonly disposition: "omitted";
      readonly code: MapOmissionCode;
      readonly reason: string;
    };

export type MapMaterialReference = {
  readonly id: MaterialId;
  readonly name: string;
  readonly href: MapInternalHref;
  readonly displayOrder: number;
};

export type MapEvidenceContext = {
  readonly scopeLabels: readonly string[];
  readonly scopes: readonly EvidenceScope[];
  readonly qualification?: string;
};

export type MapDisplayFact =
  | { readonly state: "known"; readonly display: readonly string[] }
  | { readonly state: "conditional"; readonly display: readonly string[]; readonly condition: string }
  | { readonly state: "unknown"; readonly display: readonly string[]; readonly reason: string }
  | { readonly state: "not-applicable"; readonly display: readonly string[]; readonly reason?: string }
  | { readonly state: "missing"; readonly display: readonly string[]; readonly reason: string };

export type MapProcessGateReference = {
  readonly id: ProcessGateId;
  readonly label: string;
  readonly capabilityLabel: string;
  readonly requirement: string;
  readonly verification: string;
  readonly href: MapInternalHref;
};

export type MapDecisionLane = {
  readonly id: DecisionLaneId;
  readonly label: string;
  readonly need: string;
  readonly href: MapInternalHref;
  readonly propertyChecks: readonly { readonly field: string; readonly label: string }[];
  readonly candidates: readonly MapMaterialReference[];
  readonly visibleCandidates: readonly MapMaterialReference[];
  readonly overflowCandidates: readonly MapMaterialReference[];
  readonly indeterminateMaterialIds: readonly MaterialId[];
  readonly verification: readonly string[];
  readonly processGates: readonly MapProcessGateReference[];
};

export type MapServiceMeasurement =
  | { readonly shape: "point"; readonly value: number; readonly unit: "degC" }
  | { readonly shape: "interval"; readonly low: number; readonly high: number; readonly unit: "degC" };

export type MapServiceGuidanceRecord = {
  readonly material: MapMaterialReference;
  readonly fact: MapDisplayFact;
  readonly measurement?: MapServiceMeasurement;
  readonly evidence: MapEvidenceContext;
  readonly disposition: MapDisposition;
};

export type MapThermalMember = {
  readonly material: MapMaterialReference;
  readonly metric: ThermalMetricKind;
  readonly metricLabel: string;
  readonly method?: Readonly<ThermalMethod>;
  readonly methodLabel: string;
  readonly fact: MapDisplayFact;
  readonly evidence: MapEvidenceContext;
  readonly disposition: MapDisposition;
};

export type MapThermalGroup = {
  readonly id: string;
  readonly metric: ThermalMetricKind;
  readonly metricLabel: string;
  readonly method?: Readonly<ThermalMethod>;
  readonly methodLabel: string;
  readonly members: readonly MapThermalMember[];
};

export type MapGateRelationship = {
  readonly laneId: DecisionLaneId;
  readonly gateId: ProcessGateId;
  readonly relationship: "applies" | "not-listed";
  readonly label: "Applies — verify this gate" | "Not listed for this lane";
};

export type MapProcessGateModel = {
  readonly lanes: readonly {
    readonly id: DecisionLaneId;
    readonly label: string;
    readonly href: MapInternalHref;
    readonly candidates: readonly MapMaterialReference[];
  }[];
  readonly gates: readonly MapProcessGateReference[];
  readonly relationships: readonly MapGateRelationship[];
};

export type MapImpactFlexRecord = {
  readonly material: MapMaterialReference;
  readonly impact?: ImpactResistanceRating;
  readonly flexibility?: FlexibilityRating;
  readonly printDifficulty?: PrintDifficulty;
  readonly impactFact: MapDisplayFact;
  readonly flexibilityFact: MapDisplayFact;
  readonly disposition: MapDisposition;
  readonly slot?: number;
};

export type MapTransformResult<T> = {
  readonly all: readonly T[];
  readonly plotted: readonly T[];
  readonly filtered: readonly T[];
  readonly omitted: readonly T[];
};

export type MapProjection = {
  readonly lanes: readonly MapDecisionLane[];
  readonly serviceGuidance: {
    readonly domain: { readonly low: number; readonly high: number; readonly unit: "degC" };
    readonly records: readonly MapServiceGuidanceRecord[];
  };
  readonly thermalGroups: readonly MapThermalGroup[];
  readonly processGates: MapProcessGateModel;
  readonly impactFlex: readonly MapImpactFlexRecord[];
  readonly modeFragments: Readonly<Record<MapMode, MapInternalHref>>;
  readonly methodHref: MapInternalHref;
};

export type MapSelectionTarget =
  | { readonly kind: "lane"; readonly id: DecisionLaneId }
  | { readonly kind: "material"; readonly id: MaterialId }
  | { readonly kind: "gate"; readonly id: ProcessGateId }
  | { readonly kind: "thermal-group"; readonly id: string };

export type MapSelectionAction =
  | { readonly type: "set-mode"; readonly mode: MapMode }
  | { readonly type: "select-lane"; readonly laneId: DecisionLaneId }
  | { readonly type: "select-material"; readonly materialId: MaterialId }
  | { readonly type: "select-gate"; readonly gateId: ProcessGateId }
  | { readonly type: "select-thermal-group"; readonly groupId: string }
  | { readonly type: "preview-selection"; readonly target: MapSelectionTarget; readonly source: "focus" | "hover" }
  | { readonly type: "clear-preview"; readonly source: "focus" | "hover" }
  | { readonly type: "set-search"; readonly target: "thermal" | "impact-flex"; readonly query: string }
  | { readonly type: "set-service-sort"; readonly sort: "canonical" | "low-endpoint" | "high-endpoint" }
  | { readonly type: "set-maximum-difficulty"; readonly value?: PrintDifficulty }
  | { readonly type: "set-difficulty-shapes"; readonly enabled: boolean }
  | { readonly type: "clear-filters"; readonly target: "thermal" | "impact-flex" | "all" }
  | {
      readonly type: "clear-selection";
      readonly target: "all" | "lane" | "material" | "gate" | "thermal-group";
    };

