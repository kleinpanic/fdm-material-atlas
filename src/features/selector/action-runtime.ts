import type { SelectorClientModel, SelectorRuntimePageModel } from "./client-model.ts";
import { decodeSelectorClientModel } from "./client-model.ts";
import { decodeSelectorDeferredPayload } from "./deferred-payload.ts";
import type { SelectorPresentation } from "./presentation.ts";
import { prepareSelectorPresentationEvaluator } from "./runtime-evaluator.ts";

export type PreparedSelectorActionRuntime = Readonly<{
  pageModel: SelectorRuntimePageModel;
  evaluate: (input: Readonly<Record<string, unknown>>) => SelectorPresentation;
}>;

/** Decode and prepare the full selector model only after an actual selector action. */
export function prepareSelectorActionRuntime(
  document: Document,
  pageModel?: SelectorClientModel,
): PreparedSelectorActionRuntime {
  const runtimeModel = pageModel
    ? decodeSelectorClientModel(pageModel)
    : decodeSelectorDeferredPayload(document);
  return Object.freeze({
    pageModel: runtimeModel,
    evaluate: prepareSelectorPresentationEvaluator(runtimeModel),
  });
}
