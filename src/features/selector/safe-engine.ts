import {
  prepareSelectorProjection,
  selectProjectedMaterials,
  type PreparedSelectorEvaluator,
} from "../../domain/selector/engine.ts";
import type {
  SelectorEngineOutcome,
  SelectorProjectionV1,
  SelectorSelectionInput,
} from "../../domain/selector/types.ts";

export type SelectorEvaluator = (
  projection: SelectorProjectionV1,
  selection: SelectorSelectionInput,
) => SelectorEngineOutcome;

export type SelectorPreparer = (projection: SelectorProjectionV1) => PreparedSelectorEvaluator;

export type PreparedSafeSelectorEvaluator = (
  selection: SelectorSelectionInput,
) => SafeSelectorEvaluation;

export type SafeSelectorEvaluation =
  | Readonly<{
      kind: "success";
      outcome: Exclude<SelectorEngineOutcome, { kind: "invalid-selection" }>;
    }>
  | Readonly<{ kind: "error"; code: "SELECTOR_EVALUATION_FAILED" }>;

const FAILURE: SafeSelectorEvaluation = Object.freeze({
  kind: "error",
  code: "SELECTOR_EVALUATION_FAILED",
});

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeClosedSelection(
  projection: SelectorProjectionV1,
  selection: SelectorSelectionInput,
): SelectorSelectionInput | null {
  if (!isRecord(selection)) return null;
  const keys = Reflect.ownKeys(selection);
  if (keys.length !== projection.criteria.length || keys.some((key) => typeof key !== "string")) {
    return null;
  }

  const normalized: Record<string, string> = {};
  for (const criterion of projection.criteria) {
    if (!Object.prototype.hasOwnProperty.call(selection, criterion.id)) return null;
    const value = Object.getOwnPropertyDescriptor(selection, criterion.id)?.value;
    if (typeof value !== "string" || !criterion.options.some((option) => option.id === value)) {
      return null;
    }
    normalized[criterion.id] = value;
  }
  return Object.freeze(normalized);
}

function safePreparedEvaluation(
  normalize: (selection: SelectorSelectionInput) => SelectorSelectionInput | null,
  evaluator: PreparedSelectorEvaluator,
  selection: SelectorSelectionInput,
): SafeSelectorEvaluation {
  try {
    const normalized = normalize(selection);
    if (normalized === null) return FAILURE;
    const outcome = evaluator(normalized);
    if (outcome.kind === "invalid-selection") return FAILURE;
    return Object.freeze({ kind: "success", outcome });
  } catch {
    return FAILURE;
  }
}

/** Validate and compile the projection once, then safely evaluate closed selections. */
export function prepareSelectorEvaluator(
  projection: SelectorProjectionV1,
  prepare: SelectorPreparer = prepareSelectorProjection,
): PreparedSafeSelectorEvaluator {
  try {
    const evaluator = prepare(projection);
    const criteria = Object.freeze(
      projection.criteria.map((criterion) =>
        Object.freeze({
          id: criterion.id,
          optionIds: new Set<string>(criterion.options.map(({ id }) => id)),
        }),
      ),
    );
    const normalize = (selection: SelectorSelectionInput): SelectorSelectionInput | null => {
      if (!isRecord(selection)) return null;
      const keys = Reflect.ownKeys(selection);
      if (keys.length !== criteria.length || keys.some((key) => typeof key !== "string")) {
        return null;
      }
      const normalized: Record<string, string> = {};
      for (const criterion of criteria) {
        if (!Object.prototype.hasOwnProperty.call(selection, criterion.id)) return null;
        const value = Object.getOwnPropertyDescriptor(selection, criterion.id)?.value;
        if (typeof value !== "string" || !criterion.optionIds.has(value)) return null;
        normalized[criterion.id] = value;
      }
      return Object.freeze(normalized);
    };
    return (selection) => safePreparedEvaluation(normalize, evaluator, selection);
  } catch {
    return () => FAILURE;
  }
}

/** Invoke the selector without allowing rejected input or thrown details to escape. */
export function evaluateSelectorSafely(
  projection: SelectorProjectionV1,
  selection: SelectorSelectionInput,
  evaluator: SelectorEvaluator = selectProjectedMaterials,
): SafeSelectorEvaluation {
  try {
    const normalized = normalizeClosedSelection(projection, selection);
    if (normalized === null) return FAILURE;
    const outcome = evaluator(projection, normalized);
    if (outcome.kind === "invalid-selection") return FAILURE;
    return Object.freeze({ kind: "success", outcome });
  } catch {
    return FAILURE;
  }
}
