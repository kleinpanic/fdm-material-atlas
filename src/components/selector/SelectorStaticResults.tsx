/** @jsxImportSource preact */
import type { RefObject } from "preact";

import type { MaterialId } from "../../data/schema/ids.ts";
import type { SelectorRuntimePageModel } from "../../features/selector/client-model.ts";
import type { SelectorPresentation } from "../../features/selector/presentation.ts";
import { presentShortlist } from "../../features/selector/shortlist.ts";
import { SelectorResults } from "./SelectorResults.tsx";

const EMPTY_HEADING_REF = { current: null } as RefObject<HTMLHeadingElement>;
const NOOP = () => undefined;

/** Complete default results rendered only by Astro; the browser does not hydrate this tree. */
export function SelectorStaticResults({
  pageModel,
  presentation,
}: Readonly<{ pageModel: SelectorRuntimePageModel; presentation: SelectorPresentation }>) {
  return (
    <SelectorResults
      pageModel={pageModel}
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
      renderMode="static-compact"
    />
  );
}
