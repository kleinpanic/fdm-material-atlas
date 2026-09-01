import type { ProcessGateId, SelectorOptionId } from "../../data/schema/ids.ts";
import type {
  ExplanationToken,
  ProjectedSelectorCriterion,
  SelectorCriterionId,
  SelectorProjectionV1,
} from "./types.ts";

export type ExplanationResolutionErrorCode =
  | "EXPLANATION_CATALOG_INVALID"
  | "EXPLANATION_CRITERION_UNKNOWN"
  | "EXPLANATION_OPTION_UNKNOWN"
  | "EXPLANATION_PROCESS_GATE_UNKNOWN"
  | "EXPLANATION_TOKEN_UNSUPPORTED";

/** A controlled programmer-facing failure that never retains rejected token data. */
export class ExplanationResolutionError extends Error {
  readonly code: ExplanationResolutionErrorCode;

  constructor(code: ExplanationResolutionErrorCode) {
    super(code);
    this.name = "ExplanationResolutionError";
    this.code = code;
  }

  toJSON(): Readonly<{ code: ExplanationResolutionErrorCode }> {
    return { code: this.code };
  }
}

type LabelIndexes = Readonly<{
  criteria: ReadonlyMap<SelectorCriterionId, ProjectedSelectorCriterion>;
  processGates: ReadonlyMap<ProcessGateId, string>;
}>;

function fail(code: ExplanationResolutionErrorCode): never {
  throw new ExplanationResolutionError(code);
}

function buildLabelIndexes(projection: SelectorProjectionV1): LabelIndexes {
  const criteria = new Map<SelectorCriterionId, ProjectedSelectorCriterion>();
  for (const criterion of projection.criteria) {
    if (criteria.has(criterion.id)) fail("EXPLANATION_CATALOG_INVALID");
    criteria.set(criterion.id, criterion);

    const optionIds = new Set<SelectorOptionId>();
    for (const option of criterion.options) {
      if (optionIds.has(option.id)) fail("EXPLANATION_CATALOG_INVALID");
      optionIds.add(option.id);
    }
  }

  const processGates = new Map<ProcessGateId, string>();
  for (const gate of projection.processGates) {
    if (processGates.has(gate.id)) fail("EXPLANATION_CATALOG_INVALID");
    processGates.set(gate.id, gate.label);
  }

  return { criteria, processGates };
}

function criterionLabel(indexes: LabelIndexes, criterionId: SelectorCriterionId): string {
  return indexes.criteria.get(criterionId)?.label ?? fail("EXPLANATION_CRITERION_UNKNOWN");
}

function criterionAndOptionLabels(
  indexes: LabelIndexes,
  criterionId: SelectorCriterionId,
  optionId: SelectorOptionId,
): Readonly<{ criterion: string; option: string }> {
  const criterion = indexes.criteria.get(criterionId) ?? fail("EXPLANATION_CRITERION_UNKNOWN");
  const option =
    criterion.options.find(({ id }) => id === optionId) ?? fail("EXPLANATION_OPTION_UNKNOWN");
  return { criterion: criterion.label, option: option.label };
}

function processGateLabel(indexes: LabelIndexes, processGateId: ProcessGateId): string {
  return indexes.processGates.get(processGateId) ?? fail("EXPLANATION_PROCESS_GATE_UNKNOWN");
}

function pointLabel(value: number): string {
  return value === 1 ? "point" : "points";
}

/**
 * Resolve one calculation-owned token to plain text.
 *
 * This function only looks up canonical labels and copies calculation fields. It
 * does not evaluate rules, add points, infer compatibility, or produce markup.
 */
export function resolveExplanationToken(
  projection: SelectorProjectionV1,
  token: ExplanationToken,
): string {
  const indexes = buildLabelIndexes(projection);

  switch (token.kind) {
    case "contribution": {
      const labels = criterionAndOptionLabels(indexes, token.criterionId, token.optionId);
      const outcome =
        token.outcome === "match"
          ? "matched"
          : token.outcome === "no-match"
            ? "did not match"
            : "could not be verified";
      return `${labels.criterion} — ${labels.option}: ${outcome}; ${token.awardedPoints} of ${token.possiblePoints} alignment ${pointLabel(token.possiblePoints)}.`;
    }

    case "exclusion": {
      const labels = criterionAndOptionLabels(indexes, token.criterionId, token.optionId);
      const gate = processGateLabel(indexes, token.processGateId);
      const outcome =
        token.outcome === "incompatible"
          ? "blocked by selected constraint"
          : "cannot be verified and is treated as incompatible";
      return `${labels.criterion} — ${labels.option}: ${outcome}; process gate ${gate}; reason ${token.reasonId}.`;
    }

    case "alignment-summary":
      return `Alignment score: ${token.score} of ${token.applicableMaximum} applicable points. This score measures alignment with selected criteria, not universal material quality or engineering superiority.`;

    case "no-compatible": {
      const constraints = token.selectedCriterionIds
        .map((criterionId) => criterionLabel(indexes, criterionId))
        .join("; ");
      return `No materials match all selected constraints: ${constraints}. ${token.eliminatedCount} materials were eliminated. The selected constraints were not changed or relaxed.`;
    }

    default:
      return fail("EXPLANATION_TOKEN_UNSUPPORTED");
  }
}
