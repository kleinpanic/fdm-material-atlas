import type { MaterialId, SelectorOptionId } from "../../data/schema/ids.ts";
import {
  resolveExplanationToken,
  type ContributionRecord,
  type EliminatedMaterialResult,
  type ExclusionRecord,
  type NormalizedSelectionEntry,
  type SelectorEngineOutcome,
} from "../../domain/selector/index.ts";
import type { SelectorCriterionId } from "../../domain/selector/types.ts";
import type { RouteAction } from "../../lib/public-route-registry.ts";
import { SELECTOR_COPY } from "./copy.ts";
import type {
  SelectorMaterialDisplay,
  SelectorPageModel,
} from "./page-model.ts";

type SelectedCriterionPresentation = Readonly<{
  criterionId: SelectorCriterionId;
  criterionLabel: string;
  optionId: SelectorOptionId;
  optionLabel: string;
  role: NormalizedSelectionEntry["role"];
  scoringNote?: "Not scored for alignment";
}>;

type MaterialRoutesPresentation = Readonly<{
  details: RouteAction;
  startingProfile: RouteAction;
  decisionMaps: SelectorPageModel["routes"]["materials"][number]["decisionMaps"];
  decisionMapFallback: RouteAction;
  methodEvidence: RouteAction;
}>;

type ContributionPresentation = Readonly<{
  record: ContributionRecord;
  criterionLabel: string;
  optionLabel: string;
  explanation: string;
}>;

type ExclusionPresentation = Readonly<{
  record: ExclusionRecord;
  criterionLabel: string;
  optionLabel: string;
  stateLabel: typeof SELECTOR_COPY.confirmedExclusion | typeof SELECTOR_COPY.indeterminateExclusion;
  explanation: string;
}>;

type CompatiblePresentation = Readonly<{
  materialId: MaterialId;
  materialLabel: string;
  familyOrFill: SelectorMaterialDisplay["familyOrFill"];
  rank: number;
  score: number;
  applicableMaximum: number;
  scoreLabel: string;
  compatibilityLabel: typeof SELECTOR_COPY.compatibleState;
  highestAlignment?: typeof SELECTOR_COPY.highestAlignment;
  summaryExplanation: string;
  contributions: readonly ContributionPresentation[];
  routes: MaterialRoutesPresentation;
}>;

type EliminatedPresentation = Readonly<{
  materialId: MaterialId;
  materialLabel: string;
  familyOrFill: SelectorMaterialDisplay["familyOrFill"];
  reasons: readonly ExclusionPresentation[];
  routes: MaterialRoutesPresentation;
}>;

type RankedPresentation = Readonly<{
  kind: "ranked";
  heading: typeof SELECTOR_COPY.compatibleHeading;
  rankingExplanation: typeof SELECTOR_COPY.rankingExplanation;
  alignmentLimitation: typeof SELECTOR_COPY.alignmentBody;
  applicableMaximumNote: typeof SELECTOR_COPY.applicableMaximumNote;
  selection: readonly SelectedCriterionPresentation[];
  compatible: readonly CompatiblePresentation[];
  eliminated: readonly EliminatedPresentation[];
  eliminationsOpen: false;
}>;

type NoCompatiblePresentation = Readonly<{
  kind: "no-compatible";
  heading: typeof SELECTOR_COPY.noCompatibleHeading;
  body: typeof SELECTOR_COPY.noCompatibleBody;
  explanation: string;
  selection: readonly SelectedCriterionPresentation[];
  eliminated: readonly EliminatedPresentation[];
  eliminationsOpen: true;
  reviewActions: readonly [
    Readonly<{ focusTarget: "secondary-summary"; label: typeof SELECTOR_COPY.reviewSecondary }>,
    Readonly<{ focusTarget: "primary-goal"; label: typeof SELECTOR_COPY.reviewPrimary }>,
  ];
}>;

type EmptyPresentation = Readonly<{
  kind: "empty";
  heading: typeof SELECTOR_COPY.emptyHeading;
  body: typeof SELECTOR_COPY.emptyBody;
}>;

type ErrorPresentation = Readonly<{
  kind: "error";
  body: typeof SELECTOR_COPY.errorState;
  action: typeof SELECTOR_COPY.errorAction;
}>;

export type SelectorPresentation =
  | RankedPresentation
  | NoCompatiblePresentation
  | EmptyPresentation
  | ErrorPresentation;

const EMPTY_PRESENTATION: EmptyPresentation = Object.freeze({
  kind: "empty",
  heading: SELECTOR_COPY.emptyHeading,
  body: SELECTOR_COPY.emptyBody,
});

const ERROR_PRESENTATION: ErrorPresentation = Object.freeze({
  kind: "error",
  body: SELECTOR_COPY.errorState,
  action: SELECTOR_COPY.errorAction,
});

function criterionAndOption(
  pageModel: SelectorPageModel,
  criterionId: SelectorCriterionId,
  optionId: SelectorOptionId,
) {
  const criterion = pageModel.projection.criteria.find((candidate) => candidate.id === criterionId);
  const option = criterion?.options.find((candidate) => candidate.id === optionId);
  if (!criterion || !option) throw new Error("SELECTOR_PRESENTATION_LABEL_MISSING");
  return { criterion, option };
}

function presentSelection(
  pageModel: SelectorPageModel,
  selection: readonly NormalizedSelectionEntry[],
): readonly SelectedCriterionPresentation[] {
  return Object.freeze(selection.map((entry) => {
    const { criterion, option } = criterionAndOption(pageModel, entry.criterionId, entry.optionId);
    return Object.freeze({
      criterionId: entry.criterionId,
      criterionLabel: criterion.label,
      optionId: entry.optionId,
      optionLabel: option.label,
      role: entry.role,
      ...(option.preferenceRule === undefined
        ? { scoringNote: "Not scored for alignment" as const }
        : {}),
    });
  }));
}

function materialContext(pageModel: SelectorPageModel, materialId: MaterialId) {
  const display = pageModel.display.materials.find((candidate) => candidate.id === materialId);
  const route = pageModel.routes.materials.find((candidate) => candidate.materialId === materialId);
  if (!display || !route) throw new Error("SELECTOR_PRESENTATION_MATERIAL_MISSING");
  return {
    display,
    routes: Object.freeze({
      details: route.details,
      startingProfile: route.startingProfile,
      decisionMaps: route.decisionMaps,
      decisionMapFallback: pageModel.routes.decisionMapFallback,
      methodEvidence: pageModel.routes.methodEvidence,
    }),
  };
}

function presentContributions(
  pageModel: SelectorPageModel,
  records: readonly ContributionRecord[],
): readonly ContributionPresentation[] {
  return Object.freeze(records.map((record) => {
    const { criterion, option } = criterionAndOption(pageModel, record.criterionId, record.optionId);
    return Object.freeze({
      record,
      criterionLabel: criterion.label,
      optionLabel: option.label,
      explanation: resolveExplanationToken(pageModel.projection, record.explanationToken),
    });
  }));
}

function presentEliminated(
  pageModel: SelectorPageModel,
  records: readonly EliminatedMaterialResult[],
): readonly EliminatedPresentation[] {
  return Object.freeze(records.map((material) => {
    const context = materialContext(pageModel, material.materialId);
    const reasons = Object.freeze(material.exclusions.map((record) => {
      const { criterion, option } = criterionAndOption(pageModel, record.criterionId, record.optionId);
      return Object.freeze({
        record,
        criterionLabel: criterion.label,
        optionLabel: option.label,
        stateLabel: record.outcome === "incompatible"
          ? SELECTOR_COPY.confirmedExclusion
          : SELECTOR_COPY.indeterminateExclusion,
        explanation: resolveExplanationToken(pageModel.projection, record.explanationToken),
      });
    }));
    return Object.freeze({
      materialId: material.materialId,
      materialLabel: material.materialLabel,
      familyOrFill: context.display.familyOrFill,
      reasons,
      routes: context.routes,
    });
  }));
}

/**
 * Project calculation-owned records into render-ready plain data.
 *
 * This boundary copies engine order and totals. It does not evaluate material
 * fields, calculate points, infer compatibility, construct URLs, or emit HTML.
 */
export function presentSelectorOutcome(
  pageModel: SelectorPageModel,
  outcome: SelectorEngineOutcome,
): SelectorPresentation {
  if (pageModel.display.materials.length === 0) return EMPTY_PRESENTATION;
  if (outcome.kind === "invalid-selection") return ERROR_PRESENTATION;

  try {
    const selection = presentSelection(pageModel, outcome.selection);
    const eliminated = presentEliminated(pageModel, outcome.eliminated);

    if (outcome.kind === "no-compatible") {
      return Object.freeze({
        kind: "no-compatible",
        heading: SELECTOR_COPY.noCompatibleHeading,
        body: SELECTOR_COPY.noCompatibleBody,
        explanation: resolveExplanationToken(pageModel.projection, outcome.explanationToken),
        selection,
        eliminated,
        eliminationsOpen: true,
        reviewActions: Object.freeze([
          Object.freeze({ focusTarget: "secondary-summary", label: SELECTOR_COPY.reviewSecondary }),
          Object.freeze({ focusTarget: "primary-goal", label: SELECTOR_COPY.reviewPrimary }),
        ] as const),
      });
    }

    const compatible = Object.freeze(outcome.compatible.map((material, index) => {
      const context = materialContext(pageModel, material.materialId);
      const summaryToken = material.explanationTokens.find((token) => token.kind === "alignment-summary");
      if (!summaryToken) throw new Error("SELECTOR_PRESENTATION_SUMMARY_MISSING");
      return Object.freeze({
        materialId: material.materialId,
        materialLabel: material.materialLabel,
        familyOrFill: context.display.familyOrFill,
        rank: material.rank,
        score: material.score,
        applicableMaximum: material.applicableMaximum,
        scoreLabel: `${material.score} of ${material.applicableMaximum} alignment points`,
        compatibilityLabel: SELECTOR_COPY.compatibleState,
        ...(index === 0 ? { highestAlignment: SELECTOR_COPY.highestAlignment } : {}),
        summaryExplanation: resolveExplanationToken(pageModel.projection, summaryToken),
        contributions: presentContributions(pageModel, material.contributions),
        routes: context.routes,
      });
    }));

    return Object.freeze({
      kind: "ranked",
      heading: SELECTOR_COPY.compatibleHeading,
      rankingExplanation: SELECTOR_COPY.rankingExplanation,
      alignmentLimitation: SELECTOR_COPY.alignmentBody,
      applicableMaximumNote: SELECTOR_COPY.applicableMaximumNote,
      selection,
      compatible,
      eliminated,
      eliminationsOpen: false,
    });
  } catch {
    return ERROR_PRESENTATION;
  }
}
