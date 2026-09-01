import type { SelectorSelectionInput } from "../../domain/selector/types.ts";
import type { SelectorRuntimePageModel } from "./client-model.ts";
import { SELECTOR_COPY } from "./copy.ts";
import { presentSelectorOutcome, type SelectorPresentation } from "./presentation.ts";
import { prepareSelectorEvaluator } from "./safe-engine.ts";

export type SelectorPresentationEvaluator = (
  selection: SelectorSelectionInput,
) => SelectorPresentation;

/** Prepare the one fail-closed calculation and presentation path used by SSR and the client. */
export function prepareSelectorPresentationEvaluator(
  pageModel: SelectorRuntimePageModel,
): SelectorPresentationEvaluator {
  const evaluate = prepareSelectorEvaluator(pageModel.projection);
  return (selection) => {
    const result = evaluate(selection);
    return result.kind === "success"
      ? presentSelectorOutcome(pageModel, result.outcome)
      : Object.freeze({
          kind: "error" as const,
          body: SELECTOR_COPY.errorState,
          action: SELECTOR_COPY.errorAction,
        });
  };
}
