/** @jsxImportSource preact */
import type { RefObject } from "preact";

import type { MaterialId } from "../../data/schema/ids.ts";
import {
  decodeSelectorClientModel,
  type SelectorClientModel,
} from "../../features/selector/client-model.ts";
import { prepareSelectorPresentationEvaluator } from "../../features/selector/runtime-evaluator.ts";
import { presentShortlist } from "../../features/selector/shortlist.ts";
import { SelectorResults } from "./SelectorResults.tsx";

const EMPTY_HEADING_REF = { current: null } as RefObject<HTMLHeadingElement>;
const NOOP = () => undefined;

/** Complete default results rendered only by Astro; the browser does not hydrate this tree. */
export function SelectorStaticResults({ pageModel }: Readonly<{ pageModel: SelectorClientModel }>) {
  const runtimeModel = decodeSelectorClientModel(pageModel);
  const presentation = prepareSelectorPresentationEvaluator(runtimeModel)(runtimeModel.defaults);
  return (
    <SelectorResults
      pageModel={runtimeModel}
      presentation={presentation}
      shortlist={presentShortlist([], [])}
      showAll={false}
      eliminationsOpen={false}
      resultsHeadingRef={EMPTY_HEADING_REF}
      shortlistHeadingRef={EMPTY_HEADING_REF}
      registerResultControl={
        NOOP as (materialId: MaterialId, element: HTMLButtonElement | null) => void
      }
      onShowAll={NOOP}
      onEliminationsToggle={NOOP}
      onToggleShortlist={NOOP}
      onClearShortlist={NOOP}
      onReview={NOOP}
      onReset={NOOP}
    />
  );
}
