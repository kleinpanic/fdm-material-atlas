import { describe, expect, it } from "vitest";

import type {
  ProcessGateId,
  SelectorOptionId,
} from "../../src/data/schema/ids.ts";
import {
  ExplanationResolutionError,
  resolveExplanationToken,
} from "../../src/domain/selector/explanations.ts";
import type {
  ContributionExplanationToken,
  ContributionRecord,
  ExclusionExplanationToken,
  ExclusionRecord,
  ExplanationToken,
  SelectorCriterionId,
} from "../../src/domain/selector/types.ts";
import { makeSyntheticSelectorProjection } from "./fixtures.ts";

const optionId = (value: string): SelectorOptionId => value as SelectorOptionId;
const gateId = (value: string): ProcessGateId => value as ProcessGateId;

const projection = makeSyntheticSelectorProjection({
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
          label: "Outdoor use",
          displayOrder: 0,
          hardGates: [],
        },
      ],
    },
    {
      id: "selector-enclosure-capability",
      label: "Enclosure capability",
      displayOrder: 1,
      defaultOptionId: optionId("option-enclosure-none"),
      role: "secondary",
      weight: 1,
      options: [
        {
          id: optionId("option-enclosure-none"),
          label: "No enclosure",
          displayOrder: 0,
          hardGates: [],
        },
      ],
    },
  ],
  processGates: [
    {
      id: gateId("gate-enclosure-capability"),
      label: "Enclosure capability",
    },
  ],
});

const primaryContribution = (
  outcome: ContributionExplanationToken["outcome"],
  awardedPoints: 0 | 1 | 2,
): ContributionExplanationToken => ({
  kind: "contribution",
  criterionId: "selector-primary-goal",
  optionId: optionId("option-goal-outdoor"),
  role: "primary",
  outcome,
  possiblePoints: 2,
  awardedPoints,
});

const enclosureExclusion = (
  outcome: ExclusionExplanationToken["outcome"],
): ExclusionExplanationToken => ({
  kind: "exclusion",
  criterionId: "selector-enclosure-capability",
  optionId: optionId("option-enclosure-none"),
  reasonId: "reason-enclosure-required",
  processGateId: gateId("gate-enclosure-capability"),
  outcome,
});

describe("resolveExplanationToken", () => {
  it.each([
    {
      token: primaryContribution("match", 2),
      expected: "Primary goal — Outdoor use: matched; 2 of 2 alignment points.",
    },
    {
      token: primaryContribution("no-match", 0),
      expected: "Primary goal — Outdoor use: did not match; 0 of 2 alignment points.",
    },
    {
      token: primaryContribution("indeterminate", 0),
      expected: "Primary goal — Outdoor use: could not be verified; 0 of 2 alignment points.",
    },
    {
      token: {
        kind: "contribution",
        criterionId: "selector-enclosure-capability",
        optionId: optionId("option-enclosure-none"),
        role: "secondary",
        outcome: "match",
        possiblePoints: 1,
        awardedPoints: 1,
      } satisfies ContributionExplanationToken,
      expected: "Enclosure capability — No enclosure: matched; 1 of 1 alignment point.",
    },
  ])("renders canonical contribution labels and exact token points", ({ token, expected }) => {
    expect(resolveExplanationToken(projection, token)).toBe(expected);
  });

  it.each([
    {
      token: enclosureExclusion("incompatible"),
      expected:
        "Enclosure capability — No enclosure: blocked by selected constraint; process gate Enclosure capability; reason reason-enclosure-required.",
    },
    {
      token: enclosureExclusion("indeterminate"),
      expected:
        "Enclosure capability — No enclosure: cannot be verified and is treated as incompatible; process gate Enclosure capability; reason reason-enclosure-required.",
    },
  ])("renders the exact exclusion outcome and controlled references", ({ token, expected }) => {
    expect(resolveExplanationToken(projection, token)).toBe(expected);
  });

  it("states alignment totals without claiming quality or engineering superiority", () => {
    expect(
      resolveExplanationToken(projection, {
        kind: "alignment-summary",
        score: 3,
        applicableMaximum: 5,
      }),
    ).toBe(
      "Alignment score: 3 of 5 applicable points. This score measures alignment with selected criteria, not universal material quality or engineering superiority.",
    );
  });

  it("identifies the unchanged no-compatible constraint set without relaxing it", () => {
    expect(
      resolveExplanationToken(projection, {
        kind: "no-compatible",
        selectedCriterionIds: [
          "selector-primary-goal",
          "selector-enclosure-capability",
        ],
        eliminatedCount: 23,
      }),
    ).toBe(
      "No materials match all selected constraints: Primary goal; Enclosure capability. 23 materials were eliminated. The selected constraints were not changed or relaxed.",
    );
  });

  it("resolves every record through its one calculation-owned token", () => {
    const contributionToken = primaryContribution("match", 2);
    const contribution: ContributionRecord = {
      kind: "preference",
      criterionId: contributionToken.criterionId,
      optionId: contributionToken.optionId,
      role: contributionToken.role,
      outcome: contributionToken.outcome,
      possiblePoints: contributionToken.possiblePoints,
      awardedPoints: contributionToken.awardedPoints,
      explanationToken: contributionToken,
    };
    const exclusionToken = enclosureExclusion("indeterminate");
    const exclusion: ExclusionRecord = {
      kind: "hard-constraint",
      criterionId: exclusionToken.criterionId,
      optionId: exclusionToken.optionId,
      reasonId: exclusionToken.reasonId,
      processGateId: exclusionToken.processGateId,
      outcome: exclusionToken.outcome,
      explanationToken: exclusionToken,
    };

    expect(resolveExplanationToken(projection, contribution.explanationToken)).toContain("2 of 2");
    expect(resolveExplanationToken(projection, exclusion.explanationToken)).toContain(
      "cannot be verified and is treated as incompatible",
    );
    expect(contribution.explanationToken).toEqual({
      kind: "contribution",
      criterionId: contribution.criterionId,
      optionId: contribution.optionId,
      role: contribution.role,
      outcome: contribution.outcome,
      possiblePoints: contribution.possiblePoints,
      awardedPoints: contribution.awardedPoints,
    });
    expect(exclusion.explanationToken).toMatchObject({
      criterionId: exclusion.criterionId,
      optionId: exclusion.optionId,
      reasonId: exclusion.reasonId,
      processGateId: exclusion.processGateId,
      outcome: exclusion.outcome,
    });
  });

  it.each([
    {
      code: "EXPLANATION_CRITERION_UNKNOWN",
      token: {
        ...primaryContribution("match", 2),
        criterionId: "selector-private-marker" as SelectorCriterionId,
      },
    },
    {
      code: "EXPLANATION_OPTION_UNKNOWN",
      token: {
        ...primaryContribution("match", 2),
        optionId: optionId("option-private-marker"),
      },
    },
    {
      code: "EXPLANATION_PROCESS_GATE_UNKNOWN",
      token: {
        ...enclosureExclusion("incompatible"),
        processGateId: gateId("gate-private-marker"),
      },
    },
    {
      code: "EXPLANATION_CRITERION_UNKNOWN",
      token: {
        kind: "no-compatible",
        selectedCriterionIds: ["selector-private-marker" as SelectorCriterionId],
        eliminatedCount: 0,
      },
    },
  ] as const)("fails missing references with stable redacted code $code", ({ code, token }) => {
    let caught: unknown;
    try {
      resolveExplanationToken(projection, token as ExplanationToken);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ExplanationResolutionError);
    expect(caught).toMatchObject({ code, message: code });
    expect(JSON.stringify(caught)).not.toContain("private-marker");
  });
});
