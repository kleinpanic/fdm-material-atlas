import { describe, expect, expectTypeOf, it } from "vitest";

import { selectorCriterionIds } from "../../src/data/schema/selector.ts";
import type {
  SelectorEngineOutcome,
  SelectorProjectionV1,
  SelectorSelectionInput,
} from "../../src/domain/selector/types.ts";
import {
  makeSyntheticSelectorProjection,
  selectorScenarioKeys,
  selectorScenarios,
} from "./fixtures.ts";

const expectedScenarioKeys = [
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

const publicId = /^[a-z][a-z0-9]*-[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function inspectJsonSafety(value: unknown): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    expect(Number.isFinite(value)).toBe(true);
    return;
  }
  expect(typeof value).not.toBe("undefined");
  expect(typeof value).not.toBe("bigint");
  expect(typeof value).not.toBe("function");
  expect(typeof value).not.toBe("symbol");
  if (Array.isArray(value)) {
    value.forEach(inspectJsonSafety);
    return;
  }
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  Object.values(value as Record<string, unknown>).forEach(inspectJsonSafety);
}

describe("selector public contracts", () => {
  it("accepts unknown-key state without narrowing rejected raw values into output", () => {
    expectTypeOf<SelectorSelectionInput>().toEqualTypeOf<Readonly<Record<string, unknown>>>();
    expectTypeOf<SelectorEngineOutcome>().toBeObject();

    const raw: SelectorSelectionInput = Object.freeze({
      "selector-primary-goal": "option-goal-outdoor",
      "not-a-canonical-key": { mustNotEscape: true },
    });
    expect(raw["not-a-canonical-key"]).toEqual({ mustNotEscape: true });
  });

  it("defines one explicit ranked, no-compatible, or invalid-selection outcome", () => {
    const kinds = ["ranked", "no-compatible", "invalid-selection"] as const satisfies readonly SelectorEngineOutcome["kind"][];
    expect(kinds).toEqual(["ranked", "no-compatible", "invalid-selection"]);
  });

  it("serializes only the selector projection allowlist", () => {
    const projection = makeSyntheticSelectorProjection();
    expect(Object.keys(projection).sort()).toEqual([
      "criteria",
      "kind",
      "materials",
      "processGates",
      "projectionVersion",
      "schemaVersion",
      "stableOrder",
    ]);
    inspectJsonSafety(projection);
    expect(JSON.parse(JSON.stringify(projection))).toEqual(projection);

    const serialized = JSON.stringify(projection).toLowerCase();
    for (const forbidden of [
      "sources",
      "evidence",
      "startingprofile",
      "decisionlanes",
      "visualizationreferences",
      "methods",
      "authentication",
      "locator",
      "spreadsheet",
      "workbook",
    ]) {
      expect(serialized).not.toContain(`\"${forbidden}\"`);
    }
  });

  it("keeps every projection layer readonly at the type boundary", () => {
    function compileOnly(projection: SelectorProjectionV1): void {
      // @ts-expect-error selector projections are immutable
      projection.projectionVersion = 2;
      // @ts-expect-error projection collections are immutable
      projection.materials.push(projection.materials[0]);
      // @ts-expect-error projected field records are immutable
      projection.materials[0]?.fields.push(projection.materials[0].fields[0]);
    }
    expect(typeof compileOnly).toBe("function");
  });
});

describe("selector regression fixture catalog", () => {
  it("names exactly the twelve required scenarios", () => {
    expect(selectorScenarioKeys).toEqual(expectedScenarioKeys);
    expect(Object.keys(selectorScenarios)).toEqual(expectedScenarioKeys);
  });

  it("uses only canonical selection keys and controlled public IDs", () => {
    const criterionIds = new Set<string>(selectorCriterionIds);
    for (const scenario of Object.values(selectorScenarios)) {
      for (const selection of [scenario.input, scenario.baselineInput].filter(Boolean)) {
        for (const [criterionId, optionId] of Object.entries(selection ?? {})) {
          expect(criterionIds.has(criterionId), `${scenario.key}:${criterionId}`).toBe(true);
          expect(optionId, `${scenario.key}:${criterionId}`).toMatch(/^option-[a-z0-9]+(?:-[a-z0-9]+)*$/u);
        }
      }
      for (const id of scenario.expectedPublicIds) {
        expect(id, scenario.key).toMatch(publicId);
      }
    }
  });
});
