import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";
import { PUBLIC_ROUTE_REGISTRY } from "../../src/lib/public-route-registry.ts";
import { selectProjectedMaterials } from "../../src/domain/selector/index.ts";
import type { NoCompatibleSelectorOutcome } from "../../src/domain/selector/types.ts";
import { buildSelectorPageModel } from "../../src/features/selector/page-model.ts";
import { SELECTOR_COPY } from "../../src/features/selector/copy.ts";
import { presentSelectorOutcome } from "../../src/features/selector/presentation.ts";

const pageModel = buildSelectorPageModel(loadPublicAtlas(), "/atlas-preview/", PUBLIC_ROUTE_REGISTRY);
const rankedOutcome = selectProjectedMaterials(pageModel.projection, pageModel.defaults);

function ranked() {
  expect(rankedOutcome.kind).toBe("ranked");
  if (rankedOutcome.kind !== "ranked") throw new Error("fixture must rank");
  return rankedOutcome;
}

describe("presentSelectorOutcome", () => {
  it("preserves compatible order, rank, totals, every record, and resolver prose", () => {
    const outcome = ranked();
    const presented = presentSelectorOutcome(pageModel, outcome);
    expect(presented.kind).toBe("ranked");
    if (presented.kind !== "ranked") return;

    expect(presented.compatible.map(({ materialId }) => materialId)).toEqual(outcome.compatible.map(({ materialId }) => materialId));
    presented.compatible.forEach((row, index) => {
      const source = outcome.compatible[index]!;
      expect(row.rank).toBe(source.rank);
      expect(row.score).toBe(source.score);
      expect(row.applicableMaximum).toBe(source.applicableMaximum);
      expect(row.contributions).toHaveLength(source.contributions.length);
      expect(row.contributions.map(({ record }) => record)).toEqual(source.contributions);
      expect(row.summaryExplanation).toContain(`${source.score} of ${source.applicableMaximum}`);
      expect(row.highestAlignment).toBe(index === 0 ? SELECTOR_COPY.highestAlignment : undefined);
      expect(row.routes.details).toEqual(pageModel.routes.materials.find(({ materialId }) => materialId === source.materialId)!.details);
    });
  });

  it("preserves all elimination reasons and distinguishes fail-closed uncertainty", () => {
    const outcome = ranked();
    const presented = presentSelectorOutcome(pageModel, outcome);
    if (presented.kind !== "ranked") throw new Error("fixture must rank");

    expect(presented.eliminated.map(({ materialId }) => materialId)).toEqual(outcome.eliminated.map(({ materialId }) => materialId));
    presented.eliminated.forEach((row, index) => {
      const source = outcome.eliminated[index]!;
      expect(row.reasons.map(({ record }) => record)).toEqual(source.exclusions);
      expect(row).not.toHaveProperty("rank");
      expect(row).not.toHaveProperty("score");
      row.reasons.forEach((reason) => {
        expect(reason.stateLabel).toBe(reason.record.outcome === "incompatible"
          ? SELECTOR_COPY.confirmedExclusion
          : SELECTOR_COPY.indeterminateExclusion);
        expect(reason.explanation).toMatch(reason.record.outcome === "incompatible"
          ? /blocked by selected constraint/
          : /cannot be verified and is treated as incompatible/);
      });
    });
    expect(presented.eliminated.some((row) => row.reasons.length > 1)).toBe(true);
    expect(presented.eliminated.some((row) => row.reasons.some(({ record }) => record.outcome === "indeterminate"))).toBe(true);
  });

  it("keeps all seven selected labels and every elimination in no-compatible output", () => {
    const source = ranked();
    const outcome: NoCompatibleSelectorOutcome = {
      kind: "no-compatible",
      selection: source.selection,
      applicableMaximum: source.applicableMaximum,
      compatible: [],
      eliminated: source.eliminated,
      explanationToken: {
        kind: "no-compatible",
        selectedCriterionIds: source.selection.map(({ criterionId }) => criterionId),
        eliminatedCount: source.eliminated.length,
      },
    };
    const presented = presentSelectorOutcome(pageModel, outcome);
    expect(presented.kind).toBe("no-compatible");
    if (presented.kind !== "no-compatible") return;
    expect(presented.selection).toHaveLength(7);
    expect(presented.selection.map(({ optionId }) => optionId)).toEqual(source.selection.map(({ optionId }) => optionId));
    expect(presented.eliminated).toHaveLength(source.eliminated.length);
    expect(presented.eliminationsOpen).toBe(true);
    expect(presented.reviewActions).toEqual([
      { focusTarget: "secondary-summary", label: SELECTOR_COPY.reviewSecondary },
      { focusTarget: "primary-goal", label: SELECTOR_COPY.reviewPrimary },
    ]);
    expect(JSON.stringify(presented.reviewActions)).not.toMatch(/reset|change|select.*option/i);
  });

  it("returns controlled error and empty models without stale ranking", () => {
    const invalid = presentSelectorOutcome(pageModel, {
      kind: "invalid-selection",
      issues: [{ code: "SELECTOR_OPTION_UNKNOWN" }],
    });
    expect(invalid).toEqual({
      kind: "error",
      body: SELECTOR_COPY.errorState,
      action: SELECTOR_COPY.errorAction,
    });
    expect(JSON.stringify(invalid)).not.toMatch(/SELECTOR_OPTION_UNKNOWN|compatible|eliminated|rank/i);

    const empty = presentSelectorOutcome({
      ...pageModel,
      display: { materials: [] },
    }, ranked());
    expect(empty).toEqual({
      kind: "empty",
      heading: SELECTOR_COPY.emptyHeading,
      body: SELECTOR_COPY.emptyBody,
    });
  });

  it("contains no UI-owned scoring, predicate evaluation, sorting, or URL construction", () => {
    const source = readFileSync(new URL("../../src/features/selector/presentation.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\.sort\s*\(|\.reduce\s*\(|evaluatePredicate|incompatibleWhen|internalHref|fragmentHref/);
    expect(source).not.toMatch(/awardedPoints\s*[+*-]|score\s*[+*-]|applicableMaximum\s*[+*-]/);
    expect(source).toContain("resolveExplanationToken");
  });
});
