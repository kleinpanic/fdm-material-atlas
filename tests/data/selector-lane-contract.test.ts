import { describe, expect, it } from "vitest";

import {
  PredicateSchema,
  SelectorDefinitionSchema,
  selectorCriterionIds,
} from "../../src/data/schema/selector.ts";
import {
  DecisionLaneRecordSchema,
  DecisionLaneRegistrySchema,
  decisionLaneIds,
} from "../../src/data/schema/decision-lane.ts";

const equalsRule = {
  op: "equals" as const,
  field: "process.enclosure",
  value: "not-required",
};

function criterion(id: (typeof selectorCriterionIds)[number], index: number) {
  const primary = id === "selector-primary-goal";
  return {
    id,
    label: `Criterion ${index + 1}`,
    displayOrder: index,
    ...(primary ? { role: "primary" as const, weight: 2 as const } : { role: "secondary" as const, weight: 1 as const }),
    defaultOptionId: `option-${id.slice("selector-".length)}-default`,
    options: [
      {
        id: `option-${id.slice("selector-".length)}-default`,
        label: "Default choice",
        displayOrder: 0,
        preferenceRule: equalsRule,
        hardGates: [
          {
            reasonId: "reason-enclosure-unavailable",
            processGateId: "gate-enclosure-capability",
            incompatibleWhen: { op: "not" as const, rule: equalsRule },
          },
        ],
      },
    ],
  };
}

describe("selector predicate AST", () => {
  it.each([
    equalsRule,
    { op: "one-of", field: "process.printDifficulty", values: ["easy", "moderate"] },
    { op: "at-least", field: "serviceTemperature.maximum", value: 90 },
    { op: "at-most", field: "properties.coolingShrinkRisk.order", value: 1 },
    { op: "contains-any", field: "guidance.bestSuitedFor", values: ["outdoor"] },
    { op: "all", rules: [equalsRule] },
    { op: "any", rules: [equalsRule] },
    { op: "not", rule: equalsRule },
  ])("accepts an allow-listed predicate", (rule) => {
    expect(PredicateSchema.safeParse(rule).success).toBe(true);
  });

  it.each([
    { op: "equals", field: "constructor.prototype", value: true },
    { op: "regex", field: "name", value: ".*" },
    { op: "script", source: "return true" },
    { op: "equals", field: "process.enclosure", value: "x", formula: "=A1" },
    { op: "all", rules: [] },
  ])("rejects arbitrary, executable, or empty rules", (rule) => {
    expect(PredicateSchema.safeParse(rule).success).toBe(false);
  });
});

describe("selector definition", () => {
  const selector = {
    primaryWeight: 2,
    secondaryWeight: 1,
    stableOrder: "score-desc-material-asc",
    criteria: selectorCriterionIds.map(criterion),
  } as const;

  it("fixes seven criteria, audited weights, defaults, and hard-gate reasons", () => {
    expect(SelectorDefinitionSchema.parse(selector)).toEqual(selector);
  });

  it.each([
    { ...selector, primaryWeight: 3 },
    { ...selector, criteria: selector.criteria.slice(1) },
    { ...selector, criteria: selector.criteria.map((item, index) => index === 0 ? { ...item, weight: 1 } : item) },
    { ...selector, criteria: selector.criteria.map((item, index) => index === 0 ? { ...item, candidateMaterialIds: ["material-alpha"] } : item) },
  ])("rejects semantic drift or duplicate candidate facts", (value) => {
    expect(SelectorDefinitionSchema.safeParse(value).success).toBe(false);
  });
});

describe("decision-lane registry", () => {
  const lanes = decisionLaneIds.map((id, index) => ({
    id,
    label: `Lane ${index + 1}`,
    need: "Find a suitable material for this need.",
    propertyChecks: ["properties.outdoorUv" as const],
    candidateRule: { op: "one-of" as const, field: "properties.outdoorUv", values: ["suitable", "excellent"] },
    verification: ["Verify the selected product data and process capability."],
    processGateIds: ["gate-enclosure-capability"],
  }));

  it("accepts exactly eight rule-derived lane definitions", () => {
    expect(DecisionLaneRegistrySchema.parse(lanes)).toEqual(lanes);
  });

  it.each([
    { ...lanes[0], id: "lane-invented" },
    { ...lanes[0], candidateMaterialIds: ["material-alpha"] },
    { ...lanes[0], candidateRule: { op: "formula", value: "=FILTER()" } },
    { ...lanes[0], processGateIds: ["not-a-gate"] },
  ])("rejects unknown lanes, embedded candidates, and untyped gates", (value) => {
    expect(DecisionLaneRecordSchema.safeParse(value).success).toBe(false);
  });
});
