import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { parseAtlas } from "../../src/data/schema/parse-atlas.ts";
import type { MaterialId, ProcessGateId, SelectorOptionId } from "../../src/data/schema/ids.ts";
import * as fieldResolver from "../../src/domain/selector/field-resolver.ts";
import {
  prepareSelectorProjection,
  selectMaterials,
  selectProjectedMaterials,
} from "../../src/domain/selector/engine.ts";
import { compileSelectorProjection } from "../../src/domain/selector/projection.ts";
import type {
  ProjectedSelectorCriterion,
  ProjectedSelectorMaterial,
  SelectorProjectionV1,
} from "../../src/domain/selector/types.ts";
import { makeSyntheticSelectorProjection } from "./fixtures.ts";

const artifactPath = resolve(import.meta.dirname, "../../src/data/public/atlas.v1.json");
const parsed = parseAtlas(JSON.parse(readFileSync(artifactPath, "utf8")) as unknown);
if (!parsed.success) throw new Error("Canonical engine fixture is invalid");
const atlas = parsed.data;

const materialId = (value: string): MaterialId => value as MaterialId;
const optionId = (value: string): SelectorOptionId => value as SelectorOptionId;
const gateId = (value: string): ProcessGateId => value as ProcessGateId;

const primary: ProjectedSelectorCriterion = {
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
      preferenceRule: { op: "equals", field: "properties.outdoorUv", value: "strong" },
      hardGates: [],
    },
  ],
};

const secondary: ProjectedSelectorCriterion = {
  id: "selector-enclosure-capability",
  label: "Enclosure",
  displayOrder: 1,
  defaultOptionId: optionId("option-enclosure-none"),
  role: "secondary",
  weight: 1,
  options: [
    {
      id: optionId("option-enclosure-none"),
      label: "No enclosure",
      displayOrder: 0,
      preferenceRule: { op: "equals", field: "process.enclosure", value: "not-required" },
      hardGates: [],
    },
  ],
};

function material(
  id: string,
  outdoor: "strong" | "limited" = "strong",
  enclosure: "not-required" | "required" = "not-required",
): ProjectedSelectorMaterial {
  return {
    id: materialId(id),
    label: id,
    fields: [
      { field: "properties.outdoorUv", state: "resolved", value: outdoor },
      { field: "process.enclosure", state: "resolved", value: enclosure },
    ],
  };
}

function projection(overrides: Partial<SelectorProjectionV1> = {}): SelectorProjectionV1 {
  return makeSyntheticSelectorProjection({
    criteria: [primary, secondary],
    materials: [material("material-synthetic-b"), material("material-synthetic-a")],
    processGates: [
      { id: gateId("gate-enclosure-capability"), label: "Enclosure" },
      { id: gateId("gate-industrial-hardware"), label: "Industrial hardware" },
    ],
    ...overrides,
  });
}

describe("selectProjectedMaterials", () => {
  it("prepares an immutable projection snapshot for repeated evaluation", () => {
    const mutable = projection() as SelectorProjectionV1;
    const prepared = prepareSelectorProjection(mutable);
    const first = prepared({});

    (mutable.criteria[0] as { defaultOptionId: string }).defaultOptionId =
      "option-invented-after-prepare";
    const firstField = mutable.materials[0]?.fields[0];
    if (firstField?.state === "resolved") {
      (firstField as { value: string }).value = "changed-after-prepare";
    }

    expect(prepared({})).toEqual(first);
  });

  it("applies defaults, normalizes criteria, awards 2:1, and sorts ASCII ties", () => {
    const result = selectProjectedMaterials(
      projection({
        criteria: [secondary, primary],
        materials: [
          material("material-synthetic-z"),
          material("material-synthetic-a"),
          material("material-synthetic-m", "limited"),
        ],
      }),
      {},
    );

    expect(result.kind).toBe("ranked");
    if (result.kind !== "ranked") return;
    expect(result.selection.map(({ criterionId }) => criterionId)).toEqual([
      "selector-primary-goal",
      "selector-enclosure-capability",
    ]);
    expect(result.selection.map(({ optionId }) => optionId)).toEqual([
      "option-goal-outdoor",
      "option-enclosure-none",
    ]);
    expect(result.applicableMaximum).toBe(3);
    expect(
      result.compatible.map(({ materialId, score, rank }) => ({ materialId, score, rank })),
    ).toEqual([
      { materialId: "material-synthetic-a", score: 3, rank: 1 },
      { materialId: "material-synthetic-z", score: 3, rank: 2 },
      { materialId: "material-synthetic-m", score: 1, rank: 3 },
    ]);
    expect(
      result.compatible[0]!.contributions.map(({ possiblePoints, awardedPoints }) => ({
        possiblePoints,
        awardedPoints,
      })),
    ).toEqual([
      { possiblePoints: 2, awardedPoints: 2 },
      { possiblePoints: 1, awardedPoints: 1 },
    ]);
  });

  it("collects every matching or indeterminate gate before scoring", () => {
    const gatedPrimary: ProjectedSelectorCriterion = {
      ...primary,
      options: [
        {
          ...primary.options[0]!,
          hardGates: [
            {
              reasonId: "reason-zeta",
              processGateId: gateId("gate-industrial-hardware"),
              incompatibleWhen: { op: "equals", field: "properties.outdoorUv", value: "strong" },
            },
            {
              reasonId: "reason-alpha",
              processGateId: gateId("gate-enclosure-capability"),
              incompatibleWhen: { op: "equals", field: "properties.flexibility", value: "rigid" },
            },
          ],
        },
      ],
    };
    const result = selectProjectedMaterials(
      projection({ criteria: [secondary, gatedPrimary] }),
      {},
    );

    expect(result.kind).toBe("no-compatible");
    if (result.kind !== "no-compatible") return;
    expect(result.compatible).toEqual([]);
    expect(result.eliminated.map(({ materialId }) => materialId)).toEqual([
      "material-synthetic-a",
      "material-synthetic-b",
    ]);
    for (const eliminated of result.eliminated) {
      expect(eliminated).not.toHaveProperty("rank");
      expect(eliminated).not.toHaveProperty("score");
      expect(eliminated.exclusions.map(({ reasonId, outcome }) => ({ reasonId, outcome }))).toEqual(
        [
          { reasonId: "reason-alpha", outcome: "indeterminate" },
          { reasonId: "reason-zeta", outcome: "incompatible" },
        ],
      );
      expect(eliminated.explanationTokens).toEqual(
        eliminated.exclusions.map(({ explanationToken }) => explanationToken),
      );
    }
    expect(result.explanationToken).toEqual({
      kind: "no-compatible",
      selectedCriterionIds: ["selector-primary-goal", "selector-enclosure-capability"],
      eliminatedCount: 2,
    });
  });

  it("derives every score, maximum, and token from the records created once", () => {
    const result = selectProjectedMaterials(projection(), {});
    expect(result.kind).toBe("ranked");
    if (result.kind !== "ranked") return;

    for (const compatible of result.compatible) {
      expect(compatible.score).toBe(
        compatible.contributions.reduce((sum, record) => sum + record.awardedPoints, 0),
      );
      expect(compatible.applicableMaximum).toBe(
        compatible.contributions.reduce((sum, record) => sum + record.possiblePoints, 0),
      );
      expect(compatible.explanationTokens.slice(0, -1)).toEqual(
        compatible.contributions.map(({ explanationToken }) => explanationToken),
      );
      expect(compatible.explanationTokens.at(-1)).toEqual({
        kind: "alignment-summary",
        score: compatible.score,
        applicableMaximum: compatible.applicableMaximum,
      });
      compatible.contributions.forEach((record) => {
        expect(record.explanationToken).toEqual({
          kind: "contribution",
          criterionId: record.criterionId,
          optionId: record.optionId,
          role: record.role,
          outcome: record.outcome,
          possiblePoints: record.possiblePoints,
          awardedPoints: record.awardedPoints,
        });
      });
    }
  });

  it("does not count a selected gate-only option in the denominator", () => {
    const { preferenceRule: _preferenceRule, ...gateOnlyOption } = secondary.options[0]!;
    void _preferenceRule;
    const gateOnly: ProjectedSelectorCriterion = {
      ...secondary,
      options: [
        {
          ...gateOnlyOption,
          hardGates: [
            {
              reasonId: "reason-enclosure-required",
              processGateId: gateId("gate-enclosure-capability"),
              incompatibleWhen: { op: "equals", field: "process.enclosure", value: "required" },
            },
          ],
        },
      ],
    };
    const result = selectProjectedMaterials(projection({ criteria: [primary, gateOnly] }), {});
    expect(result.kind).toBe("ranked");
    if (result.kind !== "ranked") return;
    expect(result.applicableMaximum).toBe(2);
    expect(result.compatible[0]!.contributions).toHaveLength(1);
  });

  it("returns controlled invalid-selection issues without rejected input", () => {
    const rejected = "invented-sensitive-option-marker";
    const invalidOption = selectProjectedMaterials(projection(), {
      "selector-primary-goal": rejected,
    });
    expect(invalidOption).toEqual({
      kind: "invalid-selection",
      issues: [{ code: "SELECTOR_OPTION_UNKNOWN", criterionId: "selector-primary-goal" }],
    });
    expect(JSON.stringify(invalidOption)).not.toContain(rejected);

    const unknownCriterion = selectProjectedMaterials(projection(), {
      "selector-primary-goal": "option-goal-outdoor",
      "selector-invented-marker": rejected,
    });
    expect(unknownCriterion).toEqual({
      kind: "invalid-selection",
      issues: [{ code: "SELECTOR_CRITERION_UNKNOWN" }],
    });
    expect(JSON.stringify(unknownCriterion)).not.toContain("invented");
    expect(selectProjectedMaterials(projection(), [] as never)).toEqual({
      kind: "invalid-selection",
      issues: [{ code: "SELECTOR_INPUT_NOT_RECORD" }],
    });
  });

  it("is deeply deterministic and does not mutate projection, Atlas, or input", () => {
    const projected = projection();
    const input = Object.freeze({ "selector-primary-goal": "option-goal-outdoor" });
    const projectionBefore = JSON.stringify(projected);
    const atlasBefore = JSON.stringify(atlas);
    const inputBefore = JSON.stringify(input);
    const first = selectProjectedMaterials(projected, input);

    expect(selectProjectedMaterials(projected, input)).toEqual(first);
    expect(selectMaterials(atlas, input)).toEqual(
      selectProjectedMaterials(compileSelectorProjection(atlas), input),
    );
    expect(JSON.stringify(projected)).toBe(projectionBefore);
    expect(JSON.stringify(atlas)).toBe(atlasBefore);
    expect(JSON.stringify(input)).toBe(inputBefore);
  });

  it("routes canonical compilation and both predicate paths through resolveSelectorField", () => {
    const spy = vi.spyOn(fieldResolver, "resolveSelectorField");
    const compiled = compileSelectorProjection(atlas);
    const canonicalCalls = spy.mock.calls.filter(([subject]) => !("fields" in subject));
    expect(canonicalCalls.length).toBeGreaterThan(0);

    spy.mockClear();
    const result = selectProjectedMaterials(compiled, {
      "selector-primary-goal": "option-goal-outdoor",
      "selector-enclosure-capability": "option-enclosure-none",
    });
    expect(result.kind).toBe("ranked");
    const projectedFields = new Set(spy.mock.calls.map(([, field]) => field));
    expect(projectedFields.has("properties.outdoorUv")).toBe(true);
    expect(projectedFields.has("process.enclosure")).toBe(true);
    spy.mockRestore();

    const source = readFileSync(
      resolve(import.meta.dirname, "../../src/domain/selector/engine.ts"),
      "utf8",
    );
    expect(source).toContain("resolveSelectorField");
    expect(source).not.toMatch(/\.split\s*\(/u);
    expect(source).not.toMatch(/material\.(?:properties|process|guidance|serviceTemperature)/u);
  });
});
