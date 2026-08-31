import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseAtlas } from "../../src/data/schema/parse-atlas.ts";
import type {
  MaterialId,
  ProcessGateId,
  SelectorOptionId,
} from "../../src/data/schema/ids.ts";
import type { ReadonlyPredicate } from "../../src/domain/selector/types.ts";
import {
  compileSelectorProjection,
  resolveExplanationToken,
  selectMaterials,
  selectProjectedMaterials,
} from "../../src/domain/selector/index.ts";
import type {
  ProjectedSelectorMaterial,
  SelectorEngineOutcome,
  SelectorProjectionV1,
  SelectorSelectionInput,
} from "../../src/domain/selector/types.ts";
import { makeSyntheticSelectorProjection, selectorScenarios } from "./fixtures.ts";

const artifactPath = resolve(import.meta.dirname, "../../src/data/public/atlas.v1.json");
const parsed = parseAtlas(JSON.parse(readFileSync(artifactPath, "utf8")) as unknown);
if (!parsed.success) throw new Error("Canonical selector invariant fixture is invalid");
const atlas = parsed.data;
const canonicalProjection = compileSelectorProjection(atlas);
const canonicalInput = selectorScenarios["high-temperature"].input;

const materialId = (value: string): MaterialId => value as MaterialId;
const optionId = (value: string): SelectorOptionId => value as SelectorOptionId;
const gateId = (value: string): ProcessGateId => value as ProcessGateId;

function outcome(
  projection: SelectorProjectionV1 = canonicalProjection,
  input: SelectorSelectionInput = canonicalInput,
): Exclude<SelectorEngineOutcome, { kind: "invalid-selection" }> {
  const result = selectProjectedMaterials(projection, input);
  expect(result.kind).not.toBe("invalid-selection");
  return result as Exclude<SelectorEngineOutcome, { kind: "invalid-selection" }>;
}

function resolvedMaterial(
  id: string,
  enclosure: "not-required" | "required" = "not-required",
): ProjectedSelectorMaterial {
  return {
    id: materialId(id),
    label: id,
    fields: [
      { field: "properties.outdoorUv", state: "resolved", value: "excellent" },
      { field: "process.enclosure", state: "resolved", value: enclosure },
    ],
  };
}

function gateProjection(gated: boolean): SelectorProjectionV1 {
  const base = makeSyntheticSelectorProjection();
  const primary = base.criteria[0]!;
  return makeSyntheticSelectorProjection({
    criteria: [{
      ...primary,
      options: primary.options.map((option) => ({
        ...option,
        hardGates: gated
          ? [{
              reasonId: "reason-enclosure-required",
              processGateId: gateId("gate-synthetic-capability"),
              incompatibleWhen: {
                op: "equals",
                field: "process.enclosure",
                value: "required",
              },
            }]
          : [],
      })),
    }],
    materials: [
      resolvedMaterial("material-synthetic-a"),
      resolvedMaterial("material-synthetic-b", "required"),
    ],
  });
}

function materialIds(result: Exclude<SelectorEngineOutcome, { kind: "invalid-selection" }>) {
  return {
    compatible: result.compatible.map(({ materialId: id }) => id),
    eliminated: result.eliminated.map(({ materialId: id }) => id),
  };
}

describe("selector finite invariants", () => {
  it("01 repeats the same evaluation deeply", () => {
    const first = selectMaterials(atlas, canonicalInput);
    for (let repeat = 0; repeat < 4; repeat += 1) {
      expect(selectMaterials(atlas, canonicalInput)).toEqual(first);
      expect(selectProjectedMaterials(canonicalProjection, canonicalInput)).toEqual(first);
    }
  });

  it("02 ignores material input order", () => {
    const reversed: SelectorProjectionV1 = {
      ...canonicalProjection,
      materials: [...canonicalProjection.materials].reverse(),
    };
    expect(selectProjectedMaterials(reversed, canonicalInput)).toEqual(
      selectProjectedMaterials(canonicalProjection, canonicalInput),
    );

    const reversedAtlas = structuredClone(atlas);
    reversedAtlas.materials.reverse();
    expect(selectMaterials(reversedAtlas, canonicalInput)).toEqual(selectMaterials(atlas, canonicalInput));
  });

  it("03 normalizes criterion, option, gate, and input-key permutations", () => {
    const permuted: SelectorProjectionV1 = {
      ...canonicalProjection,
      criteria: [...canonicalProjection.criteria].reverse().map((criterion) => ({
        ...criterion,
        options: [...criterion.options].reverse().map((option) => ({
          ...option,
          hardGates: [...option.hardGates].reverse(),
        })),
      })),
      processGates: [...canonicalProjection.processGates].reverse(),
    };
    const reversedInput = Object.fromEntries(Object.entries(canonicalInput).reverse());
    expect(selectProjectedMaterials(permuted, reversedInput)).toEqual(
      selectProjectedMaterials(canonicalProjection, canonicalInput),
    );
  });

  it("04 partitions every material exactly once", () => {
    const result = outcome();
    const ids = [...result.compatible, ...result.eliminated].map(({ materialId: id }) => id);
    expect(ids).toHaveLength(canonicalProjection.materials.length);
    expect(new Set(ids).size).toBe(canonicalProjection.materials.length);
  });

  it("05 keeps compatible and eliminated sets disjoint", () => {
    const result = outcome();
    const compatible = new Set(result.compatible.map(({ materialId: id }) => id));
    expect(result.eliminated.every(({ materialId: id }) => !compatible.has(id))).toBe(true);
  });

  it("06 derives each compatible score from awarded records", () => {
    for (const material of outcome().compatible) {
      expect(material.score).toBe(
        material.contributions.reduce((sum, record) => sum + record.awardedPoints, 0),
      );
    }
  });

  it("07 derives each maximum from records and keeps it at least the score", () => {
    for (const material of outcome().compatible) {
      expect(material.applicableMaximum).toBe(
        material.contributions.reduce((sum, record) => sum + record.possiblePoints, 0),
      );
      expect(material.applicableMaximum).toBeGreaterThanOrEqual(material.score);
    }
  });

  it("08 keeps explanation tokens in bijection with calculation records", () => {
    const result = outcome();
    for (const material of result.compatible) {
      expect(material.explanationTokens.slice(0, -1)).toEqual(
        material.contributions.map(({ explanationToken }) => explanationToken),
      );
      for (const record of material.contributions) {
        const text = resolveExplanationToken(canonicalProjection, record.explanationToken);
        expect(text).toContain(`${record.awardedPoints} of ${record.possiblePoints}`);
      }
    }
    for (const material of result.eliminated) {
      expect(material.explanationTokens).toEqual(
        material.exclusions.map(({ explanationToken }) => explanationToken),
      );
      for (const record of material.exclusions) {
        const text = resolveExplanationToken(canonicalProjection, record.explanationToken);
        expect(text).toContain(record.reasonId);
      }
    }
  });

  it("09 retains every matching or indeterminate reason on eliminated materials", () => {
    for (const material of outcome().eliminated) {
      expect(material.exclusions.length).toBeGreaterThan(0);
      expect(material.exclusions.every(({ outcome: state }) =>
        state === "incompatible" || state === "indeterminate")).toBe(true);
    }
  });

  it("10 never assigns rank to an eliminated material", () => {
    expect(outcome().eliminated.every((material) => !("rank" in material))).toBe(true);
  });

  it("11 orders every equal-score group by immutable material ID", () => {
    const compatible = outcome().compatible;
    for (let index = 1; index < compatible.length; index += 1) {
      const previous = compatible[index - 1]!;
      const current = compatible[index]!;
      if (previous.score === current.score) {
        expect(previous.materialId < current.materialId).toBe(true);
      }
      expect(current.rank).toBe(index + 1);
    }
  });

  it("12 cannot add compatibility when a hard gate is added", () => {
    const relaxed = new Set(outcome(gateProjection(false), {}).compatible.map(({ materialId: id }) => id));
    const gated = outcome(gateProjection(true), {}).compatible.map(({ materialId: id }) => id);
    expect(gated.every((id) => relaxed.has(id))).toBe(true);
    expect(gated).toEqual(["material-synthetic-a"]);
  });

  it("13 cannot remove compatibility when only a hard gate is relaxed", () => {
    const gated = new Set(outcome(gateProjection(true), {}).compatible.map(({ materialId: id }) => id));
    const relaxed = outcome(gateProjection(false), {}).compatible.map(({ materialId: id }) => id);
    expect([...gated].every((id) => relaxed.includes(id))).toBe(true);
    expect(relaxed).toEqual(["material-synthetic-a", "material-synthetic-b"]);
  });

  it("14 preserves surviving preference records when only a gate changes", () => {
    const gated = outcome(gateProjection(true), {});
    const relaxed = outcome(gateProjection(false), {});
    const survivor = gated.compatible[0]!;
    expect(relaxed.compatible.find(({ materialId: id }) => id === survivor.materialId)?.contributions)
      .toEqual(survivor.contributions);
  });

  it.each(["unknown", "conditional", "missing", "not-applicable"] as const)(
    "15 gives the %s fact state no preference points",
    (reason) => {
      const projection = makeSyntheticSelectorProjection({
        materials: [{
          id: materialId("material-synthetic-a"),
          label: "Synthetic A",
          fields: [{ field: "properties.outdoorUv", state: "indeterminate", reason }],
        }],
      });
      const result = outcome(projection, {});
      expect(result.compatible[0]?.score).toBe(0);
      expect(result.compatible[0]?.contributions[0]).toMatchObject({
        outcome: "indeterminate",
        awardedPoints: 0,
      });
    },
  );

  it.each(["unknown", "conditional", "missing", "not-applicable"] as const)(
    "16 cannot use the %s fact state to establish gate compatibility",
    (reason) => {
      const projection = gateProjection(true);
      const uncertain: SelectorProjectionV1 = {
        ...projection,
        materials: [{
          id: materialId("material-synthetic-a"),
          label: "Synthetic A",
          fields: [
            { field: "properties.outdoorUv", state: "resolved", value: "excellent" },
            { field: "process.enclosure", state: "indeterminate", reason },
          ],
        }],
      };
      const result = outcome(uncertain, {});
      expect(result.kind).toBe("no-compatible");
      expect(result.eliminated[0]?.exclusions[0]).toMatchObject({ outcome: "indeterminate" });
    },
  );

  it("17 excludes default and gate-only options from an inflated maximum", () => {
    const base = makeSyntheticSelectorProjection();
    const primary = base.criteria[0]!;
    const gateOnly = {
      id: "selector-enclosure-capability" as const,
      label: "Enclosure",
      displayOrder: 1,
      defaultOptionId: optionId("option-enclosure-none"),
      role: "secondary" as const,
      weight: 1 as const,
      options: [{
        id: optionId("option-enclosure-none"),
        label: "No enclosure",
        displayOrder: 0,
        hardGates: [{
          reasonId: "reason-enclosure-required",
          processGateId: gateId("gate-synthetic-capability"),
          incompatibleWhen: { op: "equals" as const, field: "process.enclosure" as const, value: "required" },
        }],
      }],
    };
    const result = outcome(makeSyntheticSelectorProjection({
      criteria: [primary, gateOnly],
      materials: [resolvedMaterial("material-synthetic-a")],
    }), {});
    expect(result.applicableMaximum).toBe(2);
    expect(result.compatible[0]?.contributions).toHaveLength(1);
  });

  it("18 rejects unknown IDs without echoing rejected keys or values", () => {
    const marker = "invented-sensitive-marker";
    const result = selectProjectedMaterials(canonicalProjection, {
      "selector-primary-goal": marker,
      "selector-invented-marker": marker,
    });
    expect(result.kind).toBe("invalid-selection");
    expect(JSON.stringify(result)).not.toContain(marker);
    expect(result).toEqual({
      kind: "invalid-selection",
      issues: [
        { code: "SELECTOR_CRITERION_UNKNOWN" },
        { code: "SELECTOR_OPTION_UNKNOWN", criterionId: "selector-primary-goal" },
      ],
    });
  });

  it("19 fails closed when predicate depth or node budgets are exceeded", () => {
    let deep: ReadonlyPredicate = {
      op: "equals",
      field: "properties.outdoorUv",
      value: "excellent",
    };
    for (let level = 0; level < 33; level += 1) deep = { op: "not", rule: deep };
    const tooMany: ReadonlyPredicate = {
      op: "any",
      rules: Array.from({ length: 513 }, () => ({
        op: "equals" as const,
        field: "properties.outdoorUv" as const,
        value: "excellent",
      })),
    };
    for (const predicate of [deep, tooMany]) {
      const base = makeSyntheticSelectorProjection();
      const projection: SelectorProjectionV1 = {
        ...base,
        criteria: base.criteria.map((criterion, criterionIndex) => ({
          ...criterion,
          options: criterion.options.map((option, optionIndex) => ({
            ...option,
            ...(criterionIndex === 0 && optionIndex === 0 ? { preferenceRule: predicate } : {}),
          })),
        })),
      };
      expect(selectProjectedMaterials(projection, {})).toEqual({
        kind: "invalid-selection",
        issues: [{ code: "SELECTOR_PROJECTION_INVALID" }],
      });
    }
  });

  it("20 leaves the Atlas, projection, and selection deeply unchanged", () => {
    const input = structuredClone(canonicalInput);
    const atlasBefore = JSON.stringify(atlas);
    const projectionBefore = JSON.stringify(canonicalProjection);
    const inputBefore = JSON.stringify(input);
    selectMaterials(atlas, input);
    selectProjectedMaterials(canonicalProjection, input);
    expect(JSON.stringify(atlas)).toBe(atlasBefore);
    expect(JSON.stringify(canonicalProjection)).toBe(projectionBefore);
    expect(JSON.stringify(input)).toBe(inputBefore);
  });
});
