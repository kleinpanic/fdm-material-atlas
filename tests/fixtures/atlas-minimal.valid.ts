import { decisionLaneIds } from "../../src/data/schema/decision-lane.ts";
import { selectorCriterionIds } from "../../src/data/schema/selector.ts";

const methodBasis = (scope = "family-guidance") => ({
  kind: "method" as const,
  methodId: "method-synthetic-review",
  scope,
});

const claim = (name: string, value: unknown, scope = "family-guidance") => ({
  id: `claim-synthetic-${name}`,
  value: { state: "known" as const, value },
  basis: [methodBasis(scope)],
});

const startingClaim = (name: string, value: unknown) =>
  claim(name, value, "starting-profile-guidance");

export function createMinimalMaterial() {
  return {
    id: "material-synthetic-alpha",
    slug: "synthetic-alpha",
    displayOrder: 1,
    name: "Synthetic Alpha",
    familyOrFill: claim("family", "Synthetic polymer family"),
    serviceTemperature: claim("service-temperature", {
      shape: "range",
      min: -10,
      max: 80,
      unit: "degC",
    }),
    thermalObservations: [
      {
        id: "claim-synthetic-glass-transition",
        metric: "glass-transition",
        metricLabel: "Glass transition temperature",
        measurement: {
          state: "known" as const,
          value: { shape: "exact", value: 62, unit: "degC" },
        },
        method: { standard: "Synthetic standard A", annealed: false },
        qualification: "Synthetic representative value for contract testing.",
        basis: [methodBasis("representative-product")],
      },
    ],
    properties: {
      wearAbrasion: claim("wear", "moderate-wear"),
      impactResistance: claim("impact", "moderate-impact"),
      creepSustainedLoad: claim("creep", "moderate"),
      outdoorUv: claim("outdoor", "limited"),
      moistureSensitivity: claim("moisture", "moderate"),
      warpTendency: claim("warp", "low"),
      flexibility: claim("flexibility", "semi-rigid"),
      chemicalResistance: claim("chemical", "moderate"),
      density: claim("density", { shape: "exact", value: 1.2, unit: "g/cm3" }),
      coolingShrinkRisk: claim("shrink", "moderate"),
      dimensionalStability: claim("stability", "high"),
    },
    process: {
      printDifficulty: claim("difficulty", "moderate"),
      nozzleTemperature: claim("nozzle", { shape: "range", min: 205, max: 225, unit: "degC" }),
      bedTemperature: claim("bed", { shape: "range", min: 50, max: 70, unit: "degC" }),
      enclosure: claim("enclosure", "recommended"),
      hardenedNozzle: claim("hardened-nozzle", "not-required"),
      dryingPriority: claim("drying", "recommended"),
      ventilation: claim("ventilation", "good-ventilation"),
    },
    guidance: {
      bestSuitedFor: claim("uses", ["Synthetic fixtures"]),
      tradeoffs: claim("tradeoffs", ["Verify the selected formulation"]),
      coolingFit: claim("cooling-fit", "managed-cooling"),
    },
    costTier: claim("cost", "medium"),
    startingProfile: {
      interpretation: "calibration-starting-point",
      printSpeed: startingClaim("print-speed", { shape: "exact", value: 55, unit: "mm/s" }),
      partCoolingFan: startingClaim("part-fan", {
        shape: "range",
        min: 20,
        max: 60,
        unit: "percent",
      }),
      bridgeSpeed: startingClaim("bridge-speed", { shape: "exact", value: 28, unit: "mm/s" }),
      bridgeFan: startingClaim("bridge-fan", { shape: "exact", value: 80, unit: "percent" }),
    },
  };
}

const equalsRule = {
  op: "equals" as const,
  field: "process.enclosure" as const,
  value: "recommended",
};

function criterion(id: (typeof selectorCriterionIds)[number], index: number) {
  const primary = id === "selector-primary-goal";
  const optionSuffix = id.slice("selector-".length);
  return {
    id,
    label: `Synthetic criterion ${index + 1}`,
    displayOrder: index,
    ...(primary
      ? { role: "primary" as const, weight: 2 as const }
      : { role: "secondary" as const, weight: 1 as const }),
    defaultOptionId: `option-${optionSuffix}-default`,
    options: [
      {
        id: `option-${optionSuffix}-default`,
        label: "Synthetic default",
        displayOrder: 0,
        preferenceRule: equalsRule,
        hardGates: [
          {
            reasonId: `reason-${optionSuffix}-capability`,
            processGateId: "gate-synthetic-enclosure",
            incompatibleWhen: { op: "not" as const, rule: equalsRule },
          },
        ],
      },
    ],
  };
}

export function createMinimalAtlas() {
  return {
    schemaVersion: 1 as const,
    materials: [createMinimalMaterial()],
    sources: [
      {
        id: "source-synthetic-guide",
        title: "Synthetic materials guide",
        publisher: "Synthetic Materials Institute",
        kind: "manufacturer-guide",
        url: "https://materials.example.com/synthetic-guide",
      },
    ],
    methods: [
      {
        id: "method-synthetic-review",
        name: "Synthetic comparison method",
        description: "Compares only compatible synthetic observations.",
        limitations: ["Application-specific verification remains necessary."],
      },
    ],
    selector: {
      primaryWeight: 2 as const,
      secondaryWeight: 1 as const,
      stableOrder: "score-desc-material-asc" as const,
      criteria: selectorCriterionIds.map(criterion),
    },
    processGates: [
      {
        id: "gate-synthetic-enclosure",
        label: "Synthetic enclosure capability",
        capability: "enclosure",
        requirement: "Use a suitable enclosure when this gate applies.",
        verification: "Confirm that the equipment meets the selected process requirement.",
        basis: [methodBasis("derived-selector-logic")],
      },
    ],
    decisionLanes: decisionLaneIds.map((id, index) => ({
      id,
      label: `Synthetic lane ${index + 1}`,
      need: "Find a suitable material for this synthetic need.",
      propertyChecks: ["properties.outdoorUv" as const],
      candidateRule: {
        op: "one-of" as const,
        field: "properties.outdoorUv" as const,
        values: ["limited", "suitable"],
      },
      verification: ["Verify the selected product and process capability."],
      processGateIds: ["gate-synthetic-enclosure"],
    })),
    visualizationReferences: [
      {
        id: "visualization-synthetic-overview",
        kind: "property-space",
        subject: { kind: "material-id", materialId: "material-synthetic-alpha" },
        related: [
          { kind: "claim-id", claimId: "claim-synthetic-density" },
          { kind: "decision-lane-id", decisionLaneId: "lane-outdoor" },
          { kind: "selector-criterion-id", selectorCriterionId: "selector-primary-goal" },
          { kind: "process-gate-id", processGateId: "gate-synthetic-enclosure" },
          { kind: "material-route", slug: "synthetic-alpha" },
        ],
      },
    ],
    vocabularies: [
      {
        id: "vocabulary-synthetic-rating",
        label: "Synthetic rating vocabulary",
        ordered: true,
        terms: [
          { value: "limited", label: "Limited", order: 0 },
          { value: "suitable", label: "Suitable", order: 1 },
        ],
      },
    ],
  };
}

export type MinimalAtlas = ReturnType<typeof createMinimalAtlas>;
