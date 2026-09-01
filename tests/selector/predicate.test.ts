import { describe, expect, it } from "vitest";

import { permittedPredicateOperators, type SelectorField } from "../../src/data/schema/selector.ts";
import {
  compilePredicate,
  compilePredicateSet,
  evaluateCompiledPredicate,
  evaluateHardGatePredicate,
  evaluatePredicate,
  PredicateConfigurationError,
  PREDICATE_MAX_DEPTH,
  PREDICATE_MAX_NODES,
  type PredicateFieldResolver,
} from "../../src/domain/selector/predicate.ts";
import type {
  PredicateOutcome,
  ProjectedSelectorFieldRecord,
  ProjectedSelectorValue,
} from "../../src/domain/selector/types.ts";

const enclosureField = "process.enclosure" as const;
const temperatureField = "serviceTemperature.maximum" as const;
const guidanceField = "guidance.bestSuitedFor" as const;

function resolved(
  field: SelectorField,
  value: ProjectedSelectorValue,
): ProjectedSelectorFieldRecord {
  return { field, state: "resolved", value };
}

function indeterminate(
  field: SelectorField,
  reason: Extract<ProjectedSelectorFieldRecord, { state: "indeterminate" }>["reason"] = "unknown",
): ProjectedSelectorFieldRecord {
  return { field, state: "indeterminate", reason };
}

function resolverFor(record: ProjectedSelectorFieldRecord): PredicateFieldResolver {
  return () => record;
}

const scalarCases = [
  {
    name: "equals matches an equal string",
    rule: { op: "equals", field: enclosureField, value: "required" },
    record: resolved(enclosureField, "required"),
    expected: "match",
  },
  {
    name: "equals rejects a different string",
    rule: { op: "equals", field: enclosureField, value: "required" },
    record: resolved(enclosureField, "not-required"),
    expected: "no-match",
  },
  {
    name: "one-of matches one controlled value",
    rule: { op: "one-of", field: enclosureField, values: ["required", "preferred"] },
    record: resolved(enclosureField, "preferred"),
    expected: "match",
  },
  {
    name: "one-of rejects an absent controlled value",
    rule: { op: "one-of", field: enclosureField, values: ["required", "preferred"] },
    record: resolved(enclosureField, "not-required"),
    expected: "no-match",
  },
  {
    name: "at-least includes the exact boundary",
    rule: { op: "at-least", field: temperatureField, value: 100 },
    record: resolved(temperatureField, 100),
    expected: "match",
  },
  {
    name: "at-least rejects a lower value",
    rule: { op: "at-least", field: temperatureField, value: 100 },
    record: resolved(temperatureField, 99),
    expected: "no-match",
  },
  {
    name: "at-most includes the exact boundary",
    rule: { op: "at-most", field: temperatureField, value: 100 },
    record: resolved(temperatureField, 100),
    expected: "match",
  },
  {
    name: "at-most rejects a higher value",
    rule: { op: "at-most", field: temperatureField, value: 100 },
    record: resolved(temperatureField, 101),
    expected: "no-match",
  },
  {
    name: "contains-any performs normalized literal substring matching",
    rule: { op: "contains-any", field: guidanceField, values: ["OUTDOOR", "fixture"] },
    record: resolved(guidanceField, ["Durable outdoor housings"]),
    expected: "match",
  },
  {
    name: "contains-any does not interpret regular-expression syntax",
    rule: { op: "contains-any", field: guidanceField, values: ["out.*door"] },
    record: resolved(guidanceField, ["outdoor"]),
    expected: "no-match",
  },
] as const satisfies readonly {
  name: string;
  rule: unknown;
  record: ProjectedSelectorFieldRecord;
  expected: PredicateOutcome;
}[];

describe("predicate scalar operators", () => {
  it.each(scalarCases)("$name", ({ rule, record, expected }) => {
    expect(evaluatePredicate(rule, resolverFor(record))).toBe(expected);
  });

  it.each(["unknown", "conditional", "not-applicable", "missing"] as const)(
    "returns indeterminate when a fact is %s",
    (reason) => {
      const rule = { op: "equals", field: enclosureField, value: "required" };
      expect(evaluatePredicate(rule, resolverFor(indeterminate(enclosureField, reason)))).toBe(
        "indeterminate",
      );
    },
  );

  it.each([
    [
      resolved(enclosureField, ["required"]),
      { op: "equals", field: enclosureField, value: "required" },
    ],
    [resolved(temperatureField, "100"), { op: "at-least", field: temperatureField, value: 100 }],
    [
      resolved(guidanceField, "outdoor"),
      { op: "contains-any", field: guidanceField, values: ["outdoor"] },
    ],
  ] as const)("returns indeterminate for an incompatible resolved value", (record, rule) => {
    expect(evaluatePredicate(rule, resolverFor(record))).toBe("indeterminate");
  });

  it("returns indeterminate when the resolver returns a record for another field", () => {
    const rule = { op: "equals", field: enclosureField, value: "required" };
    expect(
      evaluatePredicate(rule, resolverFor(resolved("process.hardenedNozzle", "required"))),
    ).toBe("indeterminate");
  });
});

describe("three-state composition", () => {
  const outcomes = ["match", "no-match", "indeterminate"] as const;
  const leafFor = (outcome: PredicateOutcome, suffix: string) => ({
    rule: { op: "equals", field: enclosureField, value: suffix },
    value: outcome === "match" ? suffix : outcome === "no-match" ? `${suffix}-other` : undefined,
  });

  function outcomeResolver(
    records: Readonly<Record<string, string | undefined>>,
  ): PredicateFieldResolver {
    return (field) => {
      const value = records[field];
      return value === undefined ? indeterminate(field) : resolved(field, value);
    };
  }

  it.each([
    ["match", "no-match"],
    ["no-match", "match"],
    ["indeterminate", "indeterminate"],
  ] as const)("not maps %s to %s", (input, expected) => {
    const child = leafFor(input, "required");
    const resolver =
      child.value === undefined
        ? resolverFor(indeterminate(enclosureField))
        : resolverFor(resolved(enclosureField, child.value));
    expect(evaluatePredicate({ op: "not", rule: child.rule }, resolver)).toBe(expected);
  });

  const matrix = outcomes.flatMap((left) => outcomes.map((right) => [left, right] as const));

  it.each(matrix)("all combines %s and %s", (left, right) => {
    const leftLeaf = leafFor(left, "required");
    const rightLeaf = {
      rule: { op: "equals", field: "process.hardenedNozzle" as const, value: "required" },
      value: right === "match" ? "required" : right === "no-match" ? "other" : undefined,
    };
    const expected: PredicateOutcome =
      left === "no-match" || right === "no-match"
        ? "no-match"
        : left === "indeterminate" || right === "indeterminate"
          ? "indeterminate"
          : "match";
    expect(
      evaluatePredicate(
        { op: "all", rules: [leftLeaf.rule, rightLeaf.rule] },
        outcomeResolver({
          [enclosureField]: leftLeaf.value,
          "process.hardenedNozzle": rightLeaf.value,
        }),
      ),
    ).toBe(expected);
  });

  it.each(matrix)("any combines %s and %s", (left, right) => {
    const leftLeaf = leafFor(left, "required");
    const rightLeaf = {
      rule: { op: "equals", field: "process.hardenedNozzle" as const, value: "required" },
      value: right === "match" ? "required" : right === "no-match" ? "other" : undefined,
    };
    const expected: PredicateOutcome =
      left === "match" || right === "match"
        ? "match"
        : left === "indeterminate" || right === "indeterminate"
          ? "indeterminate"
          : "no-match";
    expect(
      evaluatePredicate(
        { op: "any", rules: [leftLeaf.rule, rightLeaf.rule] },
        outcomeResolver({
          [enclosureField]: leftLeaf.value,
          "process.hardenedNozzle": rightLeaf.value,
        }),
      ),
    ).toBe(expected);
  });

  it.each([
    ["match", "incompatible"],
    ["no-match", null],
    ["indeterminate", "indeterminate"],
  ] as const)("maps %s to fail-closed hard-gate outcome %s", (outcome, expected) => {
    const leaf = leafFor(outcome, "required");
    const resolver =
      leaf.value === undefined
        ? resolverFor(indeterminate(enclosureField))
        : resolverFor(resolved(enclosureField, leaf.value));
    expect(evaluateHardGatePredicate(leaf.rule, resolver)).toBe(expected);
  });
});

function nestedNot(depth: number): unknown {
  let rule: unknown = { op: "equals", field: enclosureField, value: "required" };
  for (let index = 1; index < depth; index += 1) rule = { op: "not", rule };
  return rule;
}

function predicateWithNodeCount(count: number): unknown {
  const leaf = () => ({ op: "equals", field: enclosureField, value: "required" });
  if (count === 1) return leaf();
  const rules: unknown[] = [];
  let remaining = count - 1;
  while (remaining > 0) {
    if (remaining >= 2) {
      const leaves = Math.min(50, remaining - 1);
      rules.push({ op: "all", rules: Array.from({ length: leaves }, leaf) });
      remaining -= leaves + 1;
    } else {
      rules.push(leaf());
      remaining -= 1;
    }
  }
  return { op: "all", rules };
}

function expectConfigurationCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error("EXPECTED_CONFIGURATION_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(PredicateConfigurationError);
    expect((error as PredicateConfigurationError).code).toBe(code);
    expect((error as Error).message).toBe(code);
  }
}

describe("bounded predicate compilation", () => {
  it("accepts exactly the depth boundary", () => {
    expect(compilePredicate(nestedNot(PREDICATE_MAX_DEPTH))).toBeDefined();
  });

  it("rejects the first depth above the boundary", () => {
    expectConfigurationCode(
      () => compilePredicate(nestedNot(PREDICATE_MAX_DEPTH + 1)),
      "PREDICATE_DEPTH_EXCEEDED",
    );
  });

  it("accepts exactly the node-count boundary", () => {
    expect(compilePredicate(predicateWithNodeCount(PREDICATE_MAX_NODES))).toBeDefined();
  });

  it("rejects the first node above the boundary", () => {
    expectConfigurationCode(
      () => compilePredicate(predicateWithNodeCount(PREDICATE_MAX_NODES + 1)),
      "PREDICATE_NODE_LIMIT_EXCEEDED",
    );
  });

  it.each([
    [{ op: "regex", field: enclosureField, value: ".*" }, "PREDICATE_OPERATOR_INVALID"],
    [{ op: "equals", field: "constructor.prototype", value: "x" }, "PREDICATE_FIELD_INVALID"],
    [{ op: "at-least", field: enclosureField, value: 1 }, "PREDICATE_OPERAND_INVALID"],
    [{ op: "equals", field: temperatureField, value: "100" }, "PREDICATE_OPERAND_INVALID"],
    [{ op: "one-of", field: enclosureField, values: ["required", 1] }, "PREDICATE_OPERAND_INVALID"],
    [
      { op: "contains-any", field: enclosureField, values: ["required"] },
      "PREDICATE_OPERAND_INVALID",
    ],
    [{ op: "all", rules: [] }, "PREDICATE_OPERAND_INVALID"],
    [{ op: "not" }, "PREDICATE_OPERAND_INVALID"],
  ] as const)("rejects invalid configuration with controlled code", (rule, code) => {
    expectConfigurationCode(() => compilePredicate(rule), code);
  });

  it("validates the complete tree before resolving any field", () => {
    let resolverCalls = 0;
    const resolver: PredicateFieldResolver = (field) => {
      resolverCalls += 1;
      return resolved(field, "required");
    };
    expectConfigurationCode(
      () =>
        evaluatePredicate(
          {
            op: "all",
            rules: [
              { op: "equals", field: enclosureField, value: "required" },
              { op: "at-least", field: enclosureField, value: 1 },
            ],
          },
          resolver,
        ),
      "PREDICATE_OPERAND_INVALID",
    );
    expect(resolverCalls).toBe(0);
  });

  it("rejects duplicate hard-gate reason IDs within one option", () => {
    const rule = { op: "equals", field: enclosureField, value: "required" };
    expectConfigurationCode(
      () =>
        compilePredicateSet({
          hardGates: [
            {
              reasonId: "reason-duplicate",
              processGateId: "gate-enclosure-capability",
              incompatibleWhen: rule,
            },
            {
              reasonId: "reason-duplicate",
              processGateId: "gate-drying-capability",
              incompatibleWhen: rule,
            },
          ],
        }),
      "PREDICATE_REASON_DUPLICATE",
    );
  });

  it("compiles every finite operator and dispatches the frozen result", () => {
    const rules = [
      { op: "equals", field: enclosureField, value: "required" },
      { op: "one-of", field: enclosureField, values: ["required"] },
      { op: "at-least", field: temperatureField, value: 90 },
      { op: "at-most", field: temperatureField, value: 110 },
      { op: "contains-any", field: guidanceField, values: ["outdoor"] },
      { op: "all", rules: [{ op: "equals", field: enclosureField, value: "required" }] },
      { op: "any", rules: [{ op: "equals", field: enclosureField, value: "required" }] },
      { op: "not", rule: { op: "equals", field: enclosureField, value: "other" } },
    ] as const;
    expect(rules.map(({ op }) => op)).toEqual(permittedPredicateOperators);
    for (const rule of rules) {
      const compiled = compilePredicate(rule);
      expect(Object.isFrozen(compiled)).toBe(true);
      expect(
        evaluateCompiledPredicate(compiled, (field) =>
          field === temperatureField
            ? resolved(field, 100)
            : field === guidanceField
              ? resolved(field, ["outdoor housings"])
              : resolved(field, "required"),
        ),
      ).toBe("match");
    }
  });
});
