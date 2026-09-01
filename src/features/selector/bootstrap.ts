import type { MaterialId, SelectorOptionId } from "../../data/schema/ids.ts";
import type { SelectorProjectionV1 } from "../../domain/selector/index.ts";
import { SELECTOR_COPY } from "./copy.ts";
import type { SelectorPresentation } from "./presentation.ts";
import type { SelectorRuntimePageModel } from "./client-model.ts";

export type SelectorControlsModel = Readonly<{
  projection: Readonly<{ criteria: SelectorProjectionV1["criteria"] }>;
}>;

export type SelectorBootstrap = Readonly<{
  controls: SelectorControlsModel;
  defaults: Readonly<Record<string, SelectorOptionId>>;
  defaultCompatibleIds: readonly MaterialId[];
  defaultAnnouncement: string;
}>;

export function selectorPresentationAnnouncement(presentation: SelectorPresentation): string {
  if (presentation.kind === "ranked") {
    return `${presentation.compatible.length} compatible materials; ${presentation.eliminated.length} eliminated.${presentation.compatible[0] ? ` Highest alignment is ${presentation.compatible[0].materialLabel}.` : ""}`;
  }
  if (presentation.kind === "no-compatible") {
    return "No compatible materials. Your selections were not changed.";
  }
  if (presentation.kind === "error") return SELECTOR_COPY.errorState;
  return presentation.body;
}

/** Build the small, already-evaluated state needed before the first real selector action. */
export function buildSelectorBootstrap(
  pageModel: SelectorRuntimePageModel,
  presentation: SelectorPresentation,
): SelectorBootstrap {
  return Object.freeze({
    controls: Object.freeze({
      projection: Object.freeze({ criteria: pageModel.projection.criteria }),
    }),
    defaults: pageModel.defaults,
    defaultCompatibleIds: Object.freeze(
      presentation.kind === "ranked"
        ? presentation.compatible.map(({ materialId }) => materialId)
        : [],
    ),
    defaultAnnouncement: selectorPresentationAnnouncement(presentation),
  });
}
