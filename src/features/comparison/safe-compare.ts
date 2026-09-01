import type {
  ComparisonInvalid,
  ComparisonModel,
  ComparisonSuccess,
  SafeComparisonFailure,
} from "./contracts.ts";
import { compareSelection } from "./difference.ts";

const FAILURE = Object.freeze({
  kind: "failure",
  code: "COMPARE_FAILED",
  materials: Object.freeze([]),
  groups: Object.freeze([]),
  differenceCount: 0,
  equalCount: 0,
} as const satisfies SafeComparisonFailure);

/** Reduce invalid input or projection faults to one data-free, stale-output-free result. */
export function safeCompare(
  model: ComparisonModel,
  input: unknown,
): ComparisonSuccess | SafeComparisonFailure {
  try {
    const outcome: ComparisonSuccess | ComparisonInvalid = compareSelection(model, input);
    return outcome.kind === "comparison" ? outcome : FAILURE;
  } catch {
    return FAILURE;
  }
}
