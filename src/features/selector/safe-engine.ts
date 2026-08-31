import {
  selectProjectedMaterials,
  type SelectorEngineOutcome,
  type SelectorProjectionV1,
  type SelectorSelectionInput,
} from "../../domain/selector/index.ts";

export type SelectorEvaluator = (
  projection: SelectorProjectionV1,
  selection: SelectorSelectionInput,
) => SelectorEngineOutcome;

export type SafeSelectorEvaluation =
  | Readonly<{ kind: "success"; outcome: Exclude<SelectorEngineOutcome, { kind: "invalid-selection" }> }>
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
