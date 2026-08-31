import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

import { parseAtlas } from "../../src/data/schema/parse-atlas.ts";
import type {
  MaterialId,
  ProcessGateId,
} from "../../src/data/schema/ids.ts";
import type { Material } from "../../src/data/schema/material.ts";
import {
  compileSelectorProjection,
  selectMaterials,
  selectProjectedMaterials,
} from "../../src/domain/selector/index.ts";
import type {
  RankedSelectorOutcome,
  SelectorEngineOutcome,
} from "../../src/domain/selector/types.ts";
import {
  makeSyntheticAtlas,
  selectorScenarioKeys,
  selectorScenarios,
} from "./fixtures.ts";

const artifactPath = resolve(import.meta.dirname, "../../src/data/public/atlas.v1.json");
const parsed = parseAtlas(JSON.parse(readFileSync(artifactPath, "utf8")) as unknown);
if (!parsed.success) throw new Error("Canonical selector regression fixture is invalid");
const atlas = parsed.data;
const projection = compileSelectorProjection(atlas);

const materialId = (value: string): MaterialId => value as MaterialId;
const gateId = (value: string): ProcessGateId => value as ProcessGateId;

type ExclusionExpectation = Readonly<{
  materialId: string;
  reasons: readonly Readonly<[reasonId: string, processGateId: string, outcome: string]>[];
}>;

type RegressionExpectation = Readonly<{
  name: (typeof selectorScenarioKeys)[number];
  kind: "ranked" | "no-compatible";
  applicableMaximum: number;
  compatible: readonly string[];
  primaryContribution?: Readonly<{
    optionId: string;
    awardedPoints: 0 | 2;
    outcome: "match" | "no-match";
  }>;
  exclusion?: ExclusionExpectation;
}>;

const canonicalExpectations: readonly RegressionExpectation[] = [
  {
    name: "easy-prototype-no-enclosure",
    kind: "ranked",
    applicableMaximum: 8,
    compatible: ["material-pla", "material-tough-pla"],
    primaryContribution: {
      optionId: "option-goal-easy-prototypes",
      awardedPoints: 2,
      outcome: "match",
    },
    exclusion: {
      materialId: "material-abs",
      reasons: [
        ["reason-enclosure-required", "gate-enclosure-capability", "incompatible"],
        ["reason-print-difficulty", "gate-industrial-hardware", "incompatible"],
        ["reason-shrink-tolerance", "gate-enclosure-capability", "incompatible"],
        ["reason-ventilation-capability", "gate-ventilation-capability", "incompatible"],
      ],
    },
  },
  {
    name: "abrasive-no-hardened-nozzle",
    kind: "ranked",
    applicableMaximum: 8,
    compatible: ["material-pla", "material-tough-pla"],
    primaryContribution: {
      optionId: "option-goal-decorative",
      awardedPoints: 0,
      outcome: "no-match",
    },
    exclusion: {
      materialId: "material-pa-cf",
      reasons: [
        ["reason-drying-required", "gate-drying-capability", "incompatible"],
        ["reason-enclosure-required", "gate-enclosure-capability", "incompatible"],
        ["reason-hardened-nozzle-required", "gate-hardened-nozzle-capability", "incompatible"],
        ["reason-print-difficulty", "gate-industrial-hardware", "incompatible"],
        ["reason-ventilation-capability", "gate-ventilation-capability", "incompatible"],
      ],
    },
  },
  {
    name: "moisture-sensitive-no-dryer",
    kind: "ranked",
    applicableMaximum: 8,
    compatible: ["material-pla", "material-tough-pla"],
    primaryContribution: {
      optionId: "option-goal-support",
      awardedPoints: 0,
      outcome: "no-match",
    },
    exclusion: {
      materialId: "material-pva-bvoh",
      reasons: [
        ["reason-drying-required", "gate-drying-capability", "incompatible"],
        ["reason-print-difficulty", "gate-industrial-hardware", "incompatible"],
        ["reason-shrink-tolerance", "gate-enclosure-capability", "indeterminate"],
        ["reason-ventilation-capability", "gate-ventilation-capability", "incompatible"],
      ],
    },
  },
  {
    name: "industrial-consumer-hardware",
    kind: "ranked",
    applicableMaximum: 8,
    compatible: ["material-pla", "material-tough-pla"],
    primaryContribution: {
      optionId: "option-goal-high-heat",
      awardedPoints: 0,
      outcome: "no-match",
    },
    exclusion: {
      materialId: "material-peek",
      reasons: [
        ["reason-drying-required", "gate-drying-capability", "incompatible"],
        ["reason-enclosure-required", "gate-enclosure-capability", "incompatible"],
        ["reason-print-difficulty", "gate-industrial-hardware", "incompatible"],
        ["reason-shrink-tolerance", "gate-enclosure-capability", "incompatible"],
        ["reason-ventilation-capability", "gate-ventilation-capability", "incompatible"],
      ],
    },
  },
  {
    name: "high-temperature",
    kind: "ranked",
    applicableMaximum: 8,
    compatible: [
      "material-pa-cf",
      "material-cpe",
      "material-pctg",
      "material-petg",
      "material-petg-cf",
      "material-pla",
      "material-pla-cf",
      "material-tough-pla",
      "material-tpu-95a",
    ],
    primaryContribution: {
      optionId: "option-goal-high-heat",
      awardedPoints: 2,
      outcome: "match",
    },
    exclusion: {
      materialId: "material-peek",
      reasons: [["reason-shrink-tolerance", "gate-enclosure-capability", "incompatible"]],
    },
  },
  {
    name: "outdoor",
    kind: "ranked",
    applicableMaximum: 8,
    compatible: ["material-pla", "material-tough-pla"],
    primaryContribution: {
      optionId: "option-goal-outdoor",
      awardedPoints: 0,
      outcome: "no-match",
    },
    exclusion: {
      materialId: "material-asa",
      reasons: [
        ["reason-enclosure-required", "gate-enclosure-capability", "incompatible"],
        ["reason-print-difficulty", "gate-industrial-hardware", "incompatible"],
        ["reason-shrink-tolerance", "gate-enclosure-capability", "incompatible"],
        ["reason-ventilation-capability", "gate-ventilation-capability", "incompatible"],
      ],
    },
  },
  {
    name: "repeated-flex",
    kind: "ranked",
    applicableMaximum: 8,
    compatible: ["material-tough-pla", "material-pla"],
    primaryContribution: {
      optionId: "option-goal-impact-flex",
      awardedPoints: 2,
      outcome: "match",
    },
    exclusion: {
      materialId: "material-tpu-95a",
      reasons: [
        ["reason-drying-required", "gate-drying-capability", "incompatible"],
        ["reason-ventilation-capability", "gate-ventilation-capability", "incompatible"],
      ],
    },
  },
  {
    name: "chemical-resistance",
    kind: "ranked",
    applicableMaximum: 8,
    compatible: ["material-pla", "material-tough-pla"],
    primaryContribution: {
      optionId: "option-goal-chemical",
      awardedPoints: 0,
      outcome: "no-match",
    },
    exclusion: {
      materialId: "material-polypropylene",
      reasons: [
        ["reason-enclosure-required", "gate-enclosure-capability", "incompatible"],
        ["reason-print-difficulty", "gate-industrial-hardware", "incompatible"],
        ["reason-shrink-tolerance", "gate-enclosure-capability", "incompatible"],
        ["reason-ventilation-capability", "gate-ventilation-capability", "incompatible"],
      ],
    },
  },
  {
    name: "support-material",
    kind: "ranked",
    applicableMaximum: 8,
    compatible: ["material-pla", "material-tough-pla"],
    primaryContribution: {
      optionId: "option-goal-support",
      awardedPoints: 0,
      outcome: "no-match",
    },
    exclusion: {
      materialId: "material-pva-bvoh",
      reasons: [
        ["reason-drying-required", "gate-drying-capability", "incompatible"],
        ["reason-print-difficulty", "gate-industrial-hardware", "incompatible"],
        ["reason-shrink-tolerance", "gate-enclosure-capability", "indeterminate"],
        ["reason-ventilation-capability", "gate-ventilation-capability", "incompatible"],
      ],
    },
  },
  {
    name: "constraint-eliminates-prior-top",
    kind: "ranked",
    applicableMaximum: 8,
    compatible: [
      "material-pctg",
      "material-petg",
      "material-pla",
      "material-tough-pla",
      "material-tpu-95a",
    ],
    primaryContribution: {
      optionId: "option-goal-high-heat",
      awardedPoints: 0,
      outcome: "no-match",
    },
    exclusion: {
      materialId: "material-peek",
      reasons: [
        ["reason-print-difficulty", "gate-industrial-hardware", "incompatible"],
        ["reason-shrink-tolerance", "gate-enclosure-capability", "incompatible"],
      ],
    },
  },
];

function syntheticMaterial(id: string, outdoor: "limited" | "excellent"): Material {
  const source = atlas.materials.find(({ id: candidate }) => candidate === "material-pla");
  if (!source) throw new Error("Canonical synthetic base is missing");
  const material = structuredClone(source);
  material.id = materialId(id);
  material.slug = id.replace(/^material-/u, "");
  material.name = id;
  material.properties.outdoorUv.value = { state: "known", value: outdoor };
  return material;
}

function syntheticAtlas(kind: "tie" | "no-compatible") {
  const synthetic = structuredClone(atlas);
  synthetic.materials = [
    syntheticMaterial("material-synthetic-b", "excellent"),
    syntheticMaterial("material-synthetic-a", "excellent"),
  ];
  if (kind === "no-compatible") {
    const primary = synthetic.selector.criteria.find(({ id }) => id === "selector-primary-goal");
    const highHeat = primary?.options.find(({ id }) => id === "option-goal-high-heat");
    if (!highHeat) throw new Error("Canonical synthetic option is missing");
    highHeat.hardGates = [{
      reasonId: "reason-synthetic-capability",
      processGateId: gateId("gate-synthetic-capability"),
      incompatibleWhen: {
        op: "equals",
        field: "properties.outdoorUv",
        value: "excellent",
      },
    }];
    synthetic.processGates.push({
      ...structuredClone(synthetic.processGates[0]!),
      id: gateId("gate-synthetic-capability"),
      label: "Synthetic capability",
    });
  }
  return makeSyntheticAtlas(atlas, {
    materials: synthetic.materials,
    selector: synthetic.selector,
    processGates: synthetic.processGates,
  });
}

const syntheticExpectations: readonly RegressionExpectation[] = [
  {
    name: "no-compatible-material",
    kind: "no-compatible",
    applicableMaximum: 8,
    compatible: [],
    exclusion: {
      materialId: "material-synthetic-a",
      reasons: [["reason-synthetic-capability", "gate-synthetic-capability", "incompatible"]],
    },
  },
  {
    name: "equal-score-ordering",
    kind: "ranked",
    applicableMaximum: 8,
    compatible: ["material-synthetic-a", "material-synthetic-b"],
    primaryContribution: {
      optionId: "option-goal-outdoor",
      awardedPoints: 2,
      outcome: "match",
    },
  },
];

const cases = selectorScenarioKeys.map((name) => {
  const expected = [...canonicalExpectations, ...syntheticExpectations]
    .find((candidate) => candidate.name === name);
  if (!expected) throw new Error(`Missing selector regression expectation: ${name}`);
  return expected;
});

function expectStableOutcome(outcome: Exclude<SelectorEngineOutcome, { kind: "invalid-selection" }>) {
  const eliminatedIds = outcome.eliminated.map(({ materialId }) => materialId);
  expect(eliminatedIds).toEqual([...eliminatedIds].sort());
  outcome.eliminated.forEach((result) => {
    expect(result).not.toHaveProperty("rank");
    expect(result.exclusions.length).toBeGreaterThan(0);
    expect(result.explanationTokens).toEqual(
      result.exclusions.map(({ explanationToken }) => explanationToken),
    );
  });

  outcome.compatible.forEach((result) => {
    expect(result.score).toBe(
      result.contributions.reduce((sum, contribution) => sum + contribution.awardedPoints, 0),
    );
    expect(result.applicableMaximum).toBe(
      result.contributions.reduce((sum, contribution) => sum + contribution.possiblePoints, 0),
    );
    expect(result.explanationTokens.slice(0, -1)).toEqual(
      result.contributions.map(({ explanationToken }) => explanationToken),
    );
  });
}

describe("required selector regressions", () => {
  test.each(cases)("$name", (expected) => {
    const fixture = selectorScenarios[expected.name];
    const sourceAtlas = expected.name === "no-compatible-material"
      ? syntheticAtlas("no-compatible")
      : expected.name === "equal-score-ordering"
        ? syntheticAtlas("tie")
        : atlas;
    const compiled = sourceAtlas === atlas ? projection : compileSelectorProjection(sourceAtlas);
    const projectedOutcome = selectProjectedMaterials(compiled, fixture.input);
    const atlasOutcome = selectMaterials(sourceAtlas, fixture.input);

    expect(projectedOutcome).toEqual(atlasOutcome);
    expect(projectedOutcome.kind).toBe(expected.kind);
    expect(projectedOutcome.kind).not.toBe("invalid-selection");
    if (projectedOutcome.kind === "invalid-selection") return;

    expect(projectedOutcome.applicableMaximum).toBe(expected.applicableMaximum);
    expect(projectedOutcome.compatible.map(({ materialId }) => materialId)).toEqual(
      expected.compatible,
    );
    expectStableOutcome(projectedOutcome);

    if (expected.primaryContribution) {
      const top = projectedOutcome.compatible[0];
      expect(top).toBeDefined();
      expect(top!.contributions.find(({ criterionId }) =>
        criterionId === "selector-primary-goal")).toMatchObject({
        criterionId: "selector-primary-goal",
        optionId: expected.primaryContribution.optionId,
        role: "primary",
        possiblePoints: 2,
        awardedPoints: expected.primaryContribution.awardedPoints,
        outcome: expected.primaryContribution.outcome,
      });
    } else {
      expect(projectedOutcome.compatible).toEqual([]);
    }

    if (expected.exclusion) {
      const eliminated = projectedOutcome.eliminated.find(
        ({ materialId: id }) => id === expected.exclusion!.materialId,
      );
      expect(eliminated).toBeDefined();
      expect(eliminated!.exclusions.map(({ reasonId, processGateId, outcome }) =>
        [reasonId, processGateId, outcome])).toEqual(expected.exclusion.reasons);
    }

    if (expected.name === "easy-prototype-no-enclosure") {
      const enclosureBlocked = projectedOutcome.eliminated.filter(({ exclusions }) =>
        exclusions.some(({ reasonId }) => reasonId === "reason-enclosure-required"));
      expect(enclosureBlocked.length).toBeGreaterThan(0);
      expect(projectedOutcome.compatible.every(({ materialId: id }) =>
        enclosureBlocked.every(({ materialId: blocked }) => blocked !== id))).toBe(true);
    }

    if (expected.name === "constraint-eliminates-prior-top") {
      const baselineInput = "baselineInput" in fixture ? fixture.baselineInput : undefined;
      const baseline = selectProjectedMaterials(compiled, baselineInput ?? {});
      expect(baseline.kind).toBe("ranked");
      const priorTop = (baseline as RankedSelectorOutcome).compatible[0]?.materialId;
      expect(priorTop).toBe("material-cpe");
      expect(projectedOutcome.eliminated.some(({ materialId: id }) => id === priorTop)).toBe(true);
    }
  });
});
