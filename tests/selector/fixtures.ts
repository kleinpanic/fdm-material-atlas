import type { AtlasV1 } from "../../src/data/schema/atlas.ts";
import type {
  MaterialId,
  ProcessGateId,
  SelectorOptionId,
} from "../../src/data/schema/ids.ts";
import type { Material } from "../../src/data/schema/material.ts";
import type {
  SelectorProjectionV1,
  SelectorSelectionInput,
} from "../../src/domain/selector/types.ts";

export const selectorScenarioKeys = [
  "easy-prototype-no-enclosure",
  "abrasive-no-hardened-nozzle",
  "moisture-sensitive-no-dryer",
  "industrial-consumer-hardware",
  "high-temperature",
  "outdoor",
  "repeated-flex",
  "chemical-resistance",
  "support-material",
  "no-compatible-material",
  "equal-score-ordering",
  "constraint-eliminates-prior-top",
] as const;

export type SelectorScenarioKey = (typeof selectorScenarioKeys)[number];

export type SelectorScenarioFixture = Readonly<{
  key: SelectorScenarioKey;
  dataSource: "canonical" | "synthetic";
  input: SelectorSelectionInput;
  baselineInput?: SelectorSelectionInput;
  expectedPublicIds: readonly string[];
}>;

const selection = (input: Record<string, string>): SelectorSelectionInput => Object.freeze(input);

export const selectorScenarios = {
  "easy-prototype-no-enclosure": {
    key: "easy-prototype-no-enclosure",
    dataSource: "canonical",
    input: selection({
      "selector-primary-goal": "option-goal-easy-prototypes",
      "selector-enclosure-capability": "option-enclosure-none",
    }),
    expectedPublicIds: [
      "option-goal-easy-prototypes",
      "option-enclosure-none",
      "material-pla",
      "reason-enclosure-required",
      "gate-enclosure-capability",
    ],
  },
  "abrasive-no-hardened-nozzle": {
    key: "abrasive-no-hardened-nozzle",
    dataSource: "canonical",
    input: selection({
      "selector-primary-goal": "option-goal-decorative",
      "selector-hardened-nozzle-capability": "option-hardened-nozzle-none",
    }),
    expectedPublicIds: [
      "material-pa-cf",
      "reason-hardened-nozzle-required",
      "gate-hardened-nozzle-capability",
    ],
  },
  "moisture-sensitive-no-dryer": {
    key: "moisture-sensitive-no-dryer",
    dataSource: "canonical",
    input: selection({
      "selector-primary-goal": "option-goal-support",
      "selector-dryer-capability": "option-dryer-none",
    }),
    expectedPublicIds: [
      "material-pva-bvoh",
      "reason-drying-required",
      "gate-drying-capability",
    ],
  },
  "industrial-consumer-hardware": {
    key: "industrial-consumer-hardware",
    dataSource: "canonical",
    input: selection({
      "selector-primary-goal": "option-goal-high-heat",
      "selector-max-print-difficulty": "option-difficulty-moderate",
      "selector-enclosure-capability": "option-enclosure-none",
      "selector-hardened-nozzle-capability": "option-hardened-nozzle-none",
      "selector-dryer-capability": "option-dryer-none",
      "selector-ventilation-capability": "option-ventilation-general",
    }),
    expectedPublicIds: [
      "material-peek",
      "reason-print-difficulty",
      "reason-enclosure-required",
      "reason-drying-required",
      "reason-ventilation-capability",
      "gate-industrial-hardware",
    ],
  },
  "high-temperature": {
    key: "high-temperature",
    dataSource: "canonical",
    input: selection({
      "selector-primary-goal": "option-goal-high-heat",
      "selector-max-print-difficulty": "option-difficulty-expert",
      "selector-enclosure-capability": "option-enclosure-available",
      "selector-hardened-nozzle-capability": "option-hardened-nozzle-available",
      "selector-dryer-capability": "option-dryer-available",
      "selector-ventilation-capability": "option-ventilation-engineered",
    }),
    expectedPublicIds: ["option-goal-high-heat", "material-peek"],
  },
  outdoor: {
    key: "outdoor",
    dataSource: "canonical",
    input: selection({ "selector-primary-goal": "option-goal-outdoor" }),
    expectedPublicIds: ["option-goal-outdoor", "material-asa"],
  },
  "repeated-flex": {
    key: "repeated-flex",
    dataSource: "canonical",
    input: selection({ "selector-primary-goal": "option-goal-impact-flex" }),
    expectedPublicIds: ["option-goal-impact-flex", "material-tpu-95a"],
  },
  "chemical-resistance": {
    key: "chemical-resistance",
    dataSource: "canonical",
    input: selection({ "selector-primary-goal": "option-goal-chemical" }),
    expectedPublicIds: ["option-goal-chemical", "material-polypropylene"],
  },
  "support-material": {
    key: "support-material",
    dataSource: "canonical",
    input: selection({ "selector-primary-goal": "option-goal-support" }),
    expectedPublicIds: ["option-goal-support", "material-pva-bvoh"],
  },
  "no-compatible-material": {
    key: "no-compatible-material",
    dataSource: "synthetic",
    input: selection({ "selector-primary-goal": "option-goal-high-heat" }),
    expectedPublicIds: ["material-synthetic-a", "gate-synthetic-capability"],
  },
  "equal-score-ordering": {
    key: "equal-score-ordering",
    dataSource: "synthetic",
    input: selection({ "selector-primary-goal": "option-goal-outdoor" }),
    expectedPublicIds: ["material-synthetic-a", "material-synthetic-b"],
  },
  "constraint-eliminates-prior-top": {
    key: "constraint-eliminates-prior-top",
    dataSource: "canonical",
    baselineInput: selection({
      "selector-primary-goal": "option-goal-high-heat",
      "selector-max-print-difficulty": "option-difficulty-expert",
      "selector-enclosure-capability": "option-enclosure-available",
      "selector-dryer-capability": "option-dryer-available",
      "selector-ventilation-capability": "option-ventilation-engineered",
    }),
    input: selection({
      "selector-primary-goal": "option-goal-high-heat",
      "selector-max-print-difficulty": "option-difficulty-moderate",
      "selector-enclosure-capability": "option-enclosure-available",
      "selector-dryer-capability": "option-dryer-available",
      "selector-ventilation-capability": "option-ventilation-engineered",
    }),
    expectedPublicIds: [
      "material-peek",
      "reason-print-difficulty",
      "gate-industrial-hardware",
    ],
  },
} as const satisfies Readonly<Record<SelectorScenarioKey, SelectorScenarioFixture>>;

/** Clone a validated public Atlas while replacing only explicit synthetic surfaces. */
export function makeSyntheticAtlas(
  base: AtlasV1,
  overrides: Partial<Pick<AtlasV1, "materials" | "selector" | "processGates" | "vocabularies">> = {},
): AtlasV1 {
  return { ...base, ...overrides };
}

/** Clone one public material for focused synthetic mutations without a second fact table. */
export function makeSyntheticMaterial(base: Material, overrides: Partial<Material> = {}): Material {
  return { ...base, ...overrides };
}

const materialId = (value: string): MaterialId => value as MaterialId;
const optionId = (value: string): SelectorOptionId => value as SelectorOptionId;
const processGateId = (value: string): ProcessGateId => value as ProcessGateId;

/** Create a compact, fully invented projection for pure selector unit tests. */
export function makeSyntheticSelectorProjection(
  overrides: Partial<SelectorProjectionV1> = {},
): SelectorProjectionV1 {
  const projection: SelectorProjectionV1 = {
    kind: "selector-projection",
    schemaVersion: 1,
    projectionVersion: 1,
    stableOrder: "score-desc-material-asc",
    criteria: [
      {
        id: "selector-primary-goal",
        label: "Primary goal",
        displayOrder: 0,
        defaultOptionId: optionId("option-goal-outdoor"),
        role: "primary",
        weight: 2,
        options: [
          {
            id: optionId("option-goal-outdoor"),
            label: "Outdoor",
            displayOrder: 0,
            preferenceRule: {
              op: "equals",
              field: "properties.outdoorUv",
              value: "strong",
            },
            hardGates: [],
          },
        ],
      },
    ],
    processGates: [
      {
        id: processGateId("gate-synthetic-capability"),
        label: "Synthetic capability",
      },
    ],
    materials: [
      {
        id: materialId("material-synthetic-a"),
        label: "Synthetic A",
        fields: [
          {
            field: "properties.outdoorUv",
            state: "resolved",
            value: "strong",
          },
        ],
      },
      {
        id: materialId("material-synthetic-b"),
        label: "Synthetic B",
        fields: [
          {
            field: "properties.outdoorUv",
            state: "indeterminate",
            reason: "unknown",
          },
        ],
      },
    ],
  };

  return { ...projection, ...overrides };
}
