import { describe, expect, it } from "vitest";

import { compareSelection } from "../../src/features/comparison/difference.ts";
import type { ComparisonValueCell } from "../../src/features/comparison/contracts.ts";
import { buildComparisonModel } from "../../src/features/comparison/model.ts";
import { safeCompare } from "../../src/features/comparison/safe-compare.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";

const model = buildComparisonModel(loadPublicAtlas(), "/");
const IDS = model.materials.slice(0, 5).map(({ id }) => id);

type MutableComparisonValueCell = {
  -readonly [Key in keyof ComparisonValueCell]: ComparisonValueCell[Key];
};

describe("comparison difference transform", () => {
  it.each([2, 3, 4])("preserves selection order for %i materials", (count) => {
    const selected = IDS.slice(0, count).reverse();
    const outcome = compareSelection(model, selected);
    expect(outcome.kind).toBe("comparison");
    if (outcome.kind !== "comparison") return;
    expect(outcome.materials.map(({ id }) => id)).toEqual(selected);
    expect(outcome.groups.map(({ key }) => key)).toEqual(model.groups.map(({ key }) => key));
    expect(outcome.differenceCount + outcome.equalCount).toBe(
      outcome.groups.reduce((sum, group) => sum + group.differing.length + group.equal.length, 0),
    );
  });

  it.each([
    [],
    [IDS[0]],
    [...IDS],
    [IDS[0], IDS[0]],
    [IDS[0], "material-unknown"],
    [IDS[0], {}],
    "material-pla",
    null,
  ])("rejects invalid complete selection %# without accepted IDs", (selected) => {
    expect(compareSelection(model, selected)).toEqual({
      kind: "invalid",
      code: "COMPARISON_SELECTION_INVALID",
    });
  });

  it("classifies structured equality instead of rendered text or evidence identity", () => {
    const candidate = structuredClone(model);
    const [left, right] = candidate.materials;
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    const leftCell = left!.cells.find(({ key }) => key === "family-or-fill")!;
    const rightCell = right!.cells.find(({ key }) => key === "family-or-fill")!;
    expect(leftCell.kind).toBe("value");
    expect(rightCell.kind).toBe("value");
    if (leftCell.kind !== "value" || rightCell.kind !== "value") return;
    const mutableRightCell = rightCell as MutableComparisonValueCell;

    mutableRightCell.display = [...leftCell.display, "Different rendered copy"];
    mutableRightCell.evidence = [
      {
        label: "Different evidence record",
        scope: "family-guidance",
        scopeLabel: "Family guidance",
        href: "/method/#source-different",
      },
    ];
    mutableRightCell.equality = structuredClone(leftCell.equality);

    const outcome = compareSelection(candidate, [left!.id, right!.id]);
    expect(outcome.kind).toBe("comparison");
    if (outcome.kind !== "comparison") return;
    const row = outcome.groups
      .flatMap(({ differing, equal }) => [...differing, ...equal])
      .find(({ key }) => key === "family-or-fill");
    expect(row?.differs).toBe(false);
  });

  it("detects every semantic tuple dimension including zero and false", () => {
    const variants = [
      ["known", ["number", 0], ["qualification", "", ["scopes", "family-guidance"]]],
      ["known", ["boolean", false], ["qualification", "", ["scopes", "family-guidance"]]],
      ["known", ["measurement", "exact", 0, "percent"], ["qualification", "", ["scopes"]]],
      ["known", ["measurement", "range", 0, 1, "percent"], ["qualification", "", ["scopes"]]],
      ["conditional", "Synthetic condition", ["without-value"], ["qualification", "", ["scopes"]]],
      ["unknown", "Synthetic reason", ["qualification", "", ["scopes"]]],
      ["missing", "Synthetic reason", ["qualification", "", ["scopes"]]],
      ["not-applicable", "Synthetic reason", ["qualification", "", ["scopes"]]],
      ["known", ["list", ["item", "first"], ["item", "second"]], ["qualification", "", ["scopes"]]],
    ] as const;

    for (const equality of variants) {
      const candidate = structuredClone(model);
      const [left, right] = candidate.materials;
      const leftCell = left!.cells.find(({ key }) => key === "family-or-fill")!;
      const rightCell = right!.cells.find(({ key }) => key === "family-or-fill")!;
      if (leftCell.kind !== "value" || rightCell.kind !== "value")
        throw new Error("TEST_CELL_INVALID");
      const mutableLeftCell = leftCell as MutableComparisonValueCell;
      const mutableRightCell = rightCell as MutableComparisonValueCell;
      mutableLeftCell.equality = equality;
      mutableRightCell.equality = structuredClone(equality);
      let outcome = compareSelection(candidate, [left!.id, right!.id]);
      expect(outcome.kind).toBe("comparison");
      if (outcome.kind !== "comparison") continue;
      expect(
        outcome.groups.flatMap(({ equal }) => equal).some(({ key }) => key === "family-or-fill"),
      ).toBe(true);

      mutableRightCell.equality = [...equality, ["changed"]];
      outcome = compareSelection(candidate, [left!.id, right!.id]);
      expect(outcome.kind).toBe("comparison");
      if (outcome.kind !== "comparison") continue;
      expect(
        outcome.groups
          .flatMap(({ differing }) => differing)
          .some(({ key }) => key === "family-or-fill"),
      ).toBe(true);
    }
  });

  it("uses comparison-only absence for missing compatible thermal members", () => {
    const pair = model.materials.flatMap((left) =>
      model.materials.flatMap((right) => {
        if (left.id === right.id) return [];
        const leftCell = left.cells.find(({ key }) => key === "thermal-value");
        const rightCell = right.cells.find(({ key }) => key === "thermal-value");
        if (leftCell?.kind !== "thermal" || rightCell?.kind !== "thermal") return [];
        const leftGroups = new Set(leftCell.members.map(({ groupId }) => groupId));
        return rightCell.members.some(({ groupId }) => !leftGroups.has(groupId))
          ? [[left.id, right.id] as const]
          : [];
      }),
    )[0];
    expect(pair).toBeDefined();
    const outcome = compareSelection(model, pair!);
    expect(outcome.kind).toBe("comparison");
    if (outcome.kind !== "comparison") return;
    const thermalRows = outcome.groups
      .flatMap(({ differing }) => differing)
      .filter(({ key }) => key === "thermal-value");
    expect(
      thermalRows.some(({ values }) =>
        values.some(({ kind }) => kind === "no-comparable-observation"),
      ),
    ).toBe(true);
  });

  it("returns one data-free safe failure and no stale result", () => {
    expect(safeCompare(model, [IDS[0]])).toEqual({
      kind: "failure",
      code: "COMPARE_FAILED",
      materials: [],
      groups: [],
      differenceCount: 0,
      equalCount: 0,
    });
    expect(safeCompare({ materials: null } as never, IDS.slice(0, 2))).toEqual({
      kind: "failure",
      code: "COMPARE_FAILED",
      materials: [],
      groups: [],
      differenceCount: 0,
      equalCount: 0,
    });
  });
});
