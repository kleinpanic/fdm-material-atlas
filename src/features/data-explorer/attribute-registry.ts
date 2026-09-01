import type { BasisRef, Claim, EvidenceScope } from "../../data/schema/evidence.ts";
import type { FactState } from "../../data/schema/fact-state.ts";
import type { Material, ThermalObservation } from "../../data/schema/material.ts";
import type {
  DataAttributeDescriptor,
  DataAttributeGroup,
  DataAttributeGroupKey,
  DataAttributeReadResult,
  DataAttributeSortPolicy,
  DataAttributeValueKind,
} from "./contracts.ts";

const noStates = (): readonly FactState<unknown>["state"][] => [];
const noScopes = (): readonly EvidenceScope[] => [];

function uniqueScopes(basis: readonly BasisRef[]): readonly EvidenceScope[] {
  return [...new Set(basis.map(({ scope }) => scope))];
}

function claimResult(claim: Claim<unknown>): DataAttributeReadResult {
  return { kind: "fact", fact: claim.value, scopes: uniqueScopes(claim.basis) };
}

function claimDescriptor(
  key: DataAttributeDescriptor["key"],
  label: string,
  group: DataAttributeGroupKey,
  displayOrder: number,
  readClaim: (material: Material) => Claim<unknown>,
  options: {
    readonly sort: DataAttributeSortPolicy;
    readonly help: string;
    readonly valueKind?: DataAttributeValueKind;
    readonly caution?: string;
  },
): DataAttributeDescriptor {
  return {
    key,
    label,
    group,
    displayOrder,
    valueKind: options.valueKind ?? "fact",
    search: "display",
    filter: "state-and-scope",
    sort: options.sort,
    help: options.help,
    ...(options.caution === undefined ? {} : { caution: options.caution }),
    read: (material) => claimResult(readClaim(material)),
    states: (material) => [readClaim(material).value.state],
    scopes: (material) => uniqueScopes(readClaim(material).basis),
  };
}

function endpointFact(
  fact: FactState<{ readonly shape: "exact"; readonly value: number; readonly unit: "degC" } | { readonly shape: "range"; readonly min: number; readonly max: number; readonly unit: "degC" }>,
  endpoint: "low" | "high",
): FactState<number> {
  switch (fact.state) {
    case "known":
      return {
        state: "known",
        value: fact.value.shape === "exact" ? fact.value.value : fact.value[endpoint === "low" ? "min" : "max"],
      };
    case "conditional": {
      if (fact.value === undefined) return { state: "conditional", condition: fact.condition };
      return {
        state: "conditional",
        condition: fact.condition,
        value: fact.value.shape === "exact" ? fact.value.value : fact.value[endpoint === "low" ? "min" : "max"],
      };
    }
    case "unknown": return { state: "unknown", reason: fact.reason };
    case "not-applicable": return fact.reason === undefined
      ? { state: "not-applicable" }
      : { state: "not-applicable", reason: fact.reason };
    case "missing": return { state: "missing", reason: fact.reason };
  }
}

function serviceEndpoint(
  key: "service-temperature-low" | "service-temperature-high",
  label: string,
  endpoint: "low" | "high",
  displayOrder: number,
): DataAttributeDescriptor {
  return {
    key,
    label,
    group: "identity-thermal",
    displayOrder,
    valueKind: "service-endpoint",
    search: "display",
    filter: "state-and-scope",
    sort: "number",
    help: `Practical service-temperature ${endpoint} guidance with its evidence state and qualification.`,
    caution: "Practical service guidance is not a named standardized thermal test.",
    read: (material) => ({
      kind: "service-endpoint",
      endpoint,
      unit: "degC",
      fact: endpointFact(material.serviceTemperature.value, endpoint),
      scopes: uniqueScopes(material.serviceTemperature.basis),
    }),
    states: (material) => [material.serviceTemperature.value.state],
    scopes: (material) => uniqueScopes(material.serviceTemperature.basis),
  };
}

function thermalDescriptor(
  key: "thermal-metric" | "thermal-value",
  label: string,
  kind: "thermal-metric" | "thermal-value",
  displayOrder: number,
): DataAttributeDescriptor {
  const observations = (material: Material): readonly ThermalObservation[] => material.thermalObservations;
  return {
    key,
    label,
    group: "identity-thermal",
    displayOrder,
    valueKind: kind,
    search: "display",
    filter: "state-and-scope",
    sort: kind === "thermal-value" ? "none" : "label",
    help: kind === "thermal-value"
      ? "Named thermal measurements with their complete metric and represented method identity."
      : "The full name of each represented thermal test or observation.",
    caution: "Values from unlike thermal metrics or represented methods are not directly interchangeable.",
    read: (material) => ({ kind, observations: observations(material) }),
    states: (material) => observations(material).map(({ measurement }) => measurement.state),
    scopes: (material) => uniqueScopes(observations(material).flatMap(({ basis }) => basis)),
  };
}

const identity: DataAttributeDescriptor = {
  key: "material-name",
  label: "Material name",
  group: "identity-thermal",
  displayOrder: 0,
  valueKind: "identity",
  search: "display",
  filter: "none",
  sort: "canonical",
  help: "Canonical public material-family display name.",
  read: (material) => ({ kind: "identity", value: material.name }),
  states: noStates,
  scopes: noScopes,
};

export const DATA_ATTRIBUTE_REGISTRY = Object.freeze([
  identity,
  claimDescriptor("family-or-fill", "Family or filler", "identity-thermal", 1, (m) => m.familyOrFill, { sort: "label", help: "Polymer family or represented filler identity." }),
  serviceEndpoint("service-temperature-low", "Service temperature — low", "low", 2),
  serviceEndpoint("service-temperature-high", "Service temperature — high", "high", 3),
  thermalDescriptor("thermal-metric", "Named thermal metric", "thermal-metric", 4),
  thermalDescriptor("thermal-value", "Named thermal value", "thermal-value", 5),
  claimDescriptor("wear-abrasion", "Wear and abrasion", "mechanical-use", 6, (m) => m.properties.wearAbrasion, { sort: "vocabulary", help: "Qualitative wear and abrasion behavior." }),
  claimDescriptor("impact-resistance", "Impact resistance", "mechanical-use", 7, (m) => m.properties.impactResistance, { sort: "vocabulary", help: "Qualitative impact-resistance behavior." }),
  claimDescriptor("creep-sustained-load", "Creep and sustained load", "mechanical-use", 8, (m) => m.properties.creepSustainedLoad, { sort: "vocabulary", help: "Qualitative behavior under sustained loading." }),
  claimDescriptor("flexibility", "Flexibility", "mechanical-use", 9, (m) => m.properties.flexibility, { sort: "vocabulary", help: "Qualitative flexibility classification." }),
  claimDescriptor("outdoor-uv", "Outdoor and UV behavior", "environment-exposure", 10, (m) => m.properties.outdoorUv, { sort: "vocabulary", help: "Qualitative outdoor and ultraviolet exposure guidance." }),
  claimDescriptor("moisture-sensitivity", "Moisture sensitivity", "environment-exposure", 11, (m) => m.properties.moistureSensitivity, { sort: "vocabulary", help: "Qualitative sensitivity to absorbed moisture." }),
  claimDescriptor("chemical-resistance", "Chemical resistance", "environment-exposure", 12, (m) => m.properties.chemicalResistance, { sort: "vocabulary", help: "Qualitative chemical-resistance guidance; verify the specific chemical and formulation." }),
  claimDescriptor("print-difficulty", "Print difficulty", "print-process", 13, (m) => m.process.printDifficulty, { sort: "vocabulary", help: "Relative printing difficulty in the documented process context." }),
  claimDescriptor("nozzle-temperature", "Nozzle temperature", "print-process", 14, (m) => m.process.nozzleTemperature, { sort: "number", help: "Nozzle-temperature starting guidance." }),
  claimDescriptor("bed-temperature", "Bed temperature", "print-process", 15, (m) => m.process.bedTemperature, { sort: "number", help: "Build-surface temperature starting guidance." }),
  claimDescriptor("enclosure-requirement", "Enclosure requirement", "print-process", 16, (m) => m.process.enclosure, { sort: "vocabulary", help: "Documented enclosure process requirement." }),
  claimDescriptor("hardened-nozzle-requirement", "Wear-resistant nozzle requirement", "print-process", 17, (m) => m.process.hardenedNozzle, { sort: "vocabulary", help: "Whether a wear-resistant nozzle is recommended or required." }),
  claimDescriptor("warp-tendency", "Warp tendency", "print-process", 18, (m) => m.properties.warpTendency, { sort: "vocabulary", help: "Qualitative tendency to warp during printing and cooling." }),
  claimDescriptor("cooling-shrink-risk", "Cooling-shrink risk", "dimensional-cooling", 19, (m) => m.properties.coolingShrinkRisk, { sort: "vocabulary", help: "Qualitative cooling and shrink risk." }),
  claimDescriptor("dimensional-stability", "Dimensional stability", "dimensional-cooling", 20, (m) => m.properties.dimensionalStability, { sort: "vocabulary", help: "Qualitative dimensional-stability guidance." }),
  claimDescriptor("cooling-fit-guidance", "Cooling and fit guidance", "dimensional-cooling", 21, (m) => m.guidance.coolingFit, { sort: "vocabulary", help: "Cooling approach and fit-calibration guidance." }),
  claimDescriptor("drying-priority", "Drying priority", "handling-density-cost", 22, (m) => m.process.dryingPriority, { sort: "vocabulary", help: "Relative priority of drying before or during printing." }),
  claimDescriptor("ventilation-category", "Ventilation category", "handling-density-cost", 23, (m) => m.process.ventilation, { sort: "vocabulary", help: "Ventilation or odor-control process category." }),
  claimDescriptor("density", "Density", "handling-density-cost", 24, (m) => m.properties.density, { sort: "number", help: "Reported material density with units and evidence scope." }),
  claimDescriptor("relative-cost-tier", "Relative cost tier", "handling-density-cost", 25, (m) => m.costTier, { sort: "vocabulary", help: "Relative qualitative cost tier, not a live price." }),
  claimDescriptor("recommended-uses", "Recommended uses", "uses-tradeoffs", 26, (m) => m.guidance.bestSuitedFor, { sort: "label", help: "Complete source-order list of recommended applications." }),
  claimDescriptor("tradeoffs", "Tradeoffs", "uses-tradeoffs", 27, (m) => m.guidance.tradeoffs, { sort: "label", help: "Complete source-order list of material tradeoffs." }),
  claimDescriptor("starting-print-speed", "Starting print speed", "starting-profile", 28, (m) => m.startingProfile.printSpeed, { sort: "number", help: "Calibration starting point for print speed." }),
  claimDescriptor("part-cooling-fan", "Part-cooling fan", "starting-profile", 29, (m) => m.startingProfile.partCoolingFan, { sort: "number", help: "Calibration starting point for part-cooling fan." }),
  claimDescriptor("bridge-speed", "Bridge speed", "starting-profile", 30, (m) => m.startingProfile.bridgeSpeed, { sort: "number", help: "Calibration starting point for bridge speed." }),
  claimDescriptor("bridge-fan", "Bridge fan", "starting-profile", 31, (m) => m.startingProfile.bridgeFan, { sort: "number", help: "Calibration starting point for bridge fan." }),
] as const satisfies readonly DataAttributeDescriptor[]);

const GROUPS: readonly { readonly key: DataAttributeGroupKey; readonly label: string }[] = [
  { key: "identity-thermal", label: "Identity and thermal behavior" },
  { key: "mechanical-use", label: "Mechanical and use behavior" },
  { key: "environment-exposure", label: "Environment and exposure" },
  { key: "print-process", label: "Print and process requirements" },
  { key: "dimensional-cooling", label: "Dimensional behavior and cooling" },
  { key: "handling-density-cost", label: "Handling, density, and cost" },
  { key: "uses-tradeoffs", label: "Uses and tradeoffs" },
  { key: "starting-profile", label: "Starting print profile" },
];

export const DATA_ATTRIBUTE_GROUPS = Object.freeze(GROUPS.map(({ key, label }) => Object.freeze({
  key,
  label,
  fields: Object.freeze(DATA_ATTRIBUTE_REGISTRY.filter(({ group }) => group === key)),
}))) satisfies readonly DataAttributeGroup[];
