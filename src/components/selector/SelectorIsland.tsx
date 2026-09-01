/** @jsxImportSource preact */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import {
  decodeSelectorClientModel,
  type SelectorClientModel,
  type SelectorRuntimePageModel,
} from "../../features/selector/client-model.ts";
import type { MaterialId } from "../../data/schema/ids.ts";
import { SELECTOR_COPY } from "../../features/selector/copy.ts";
import {
  presentSelectorOutcome,
  type SelectorPresentation,
} from "../../features/selector/presentation.ts";
import { prepareSelectorEvaluator } from "../../features/selector/safe-engine.ts";
import {
  presentShortlist,
  reduceShortlist,
  type ShortlistAction,
  type ShortlistFocusIntent,
  type ShortlistState,
} from "../../features/selector/shortlist.ts";
import { SelectorControls } from "./SelectorControls.tsx";
import { SelectorResults } from "./SelectorResults.tsx";

type Props = Readonly<{ pageModel: SelectorClientModel }>;

function aggregateAnnouncement(presentation: SelectorPresentation): string {
  if (presentation.kind === "ranked") {
    return `${presentation.compatible.length} compatible materials; ${presentation.eliminated.length} eliminated.${presentation.compatible[0] ? ` Highest alignment is ${presentation.compatible[0].materialLabel}.` : ""}`;
  }
  if (presentation.kind === "no-compatible") {
    return "No compatible materials. Your selections were not changed.";
  }
  if (presentation.kind === "error") return SELECTOR_COPY.errorState;
  return presentation.body;
}

function SelectorStatus({ message, immediate }: Readonly<{ message: string; immediate: boolean }>) {
  const [announcement, setAnnouncement] = useState(SELECTOR_COPY.hydrationStatus);
  const previousMessage = useRef(SELECTOR_COPY.hydrationStatus);

  useEffect(() => {
    if (previousMessage.current === message) return;
    previousMessage.current = message;
    if (immediate) {
      setAnnouncement(message);
      return;
    }
    const timer = window.setTimeout(() => setAnnouncement(message), 150);
    return () => window.clearTimeout(timer);
  }, [immediate, message]);

  return (
    <p role="status" aria-live="polite" aria-atomic="true">
      {announcement}
    </p>
  );
}

export function SelectorIsland({ pageModel }: Props) {
  const runtimeModel = useMemo(() => {
    try {
      return decodeSelectorClientModel(pageModel);
    } catch {
      return null;
    }
  }, [pageModel]);
  if (runtimeModel === null) {
    return (
      <div class="selector-island">
        <section class="selector-error" role="alert">
          <h2>Recommendations are unavailable</h2>
          <p>{SELECTOR_COPY.errorState}</p>
          <p>{SELECTOR_COPY.errorAction}</p>
        </section>
      </div>
    );
  }
  return <SelectorRuntimeIsland pageModel={runtimeModel} />;
}

function SelectorRuntimeIsland({ pageModel }: Readonly<{ pageModel: SelectorRuntimePageModel }>) {
  const [selection, setSelection] = useState<Readonly<Record<string, string>>>(
    () => pageModel.defaults,
  );
  const [evaluationInput, setEvaluationInput] = useState<Readonly<Record<string, unknown>>>(
    () => pageModel.defaults,
  );
  const [announcementOverride, setAnnouncementOverride] = useState<string | null>(null);
  const [shortlistIds, setShortlistIds] = useState<ShortlistState>([]);
  const [showAll, setShowAll] = useState(false);
  const [eliminationsOpen, setEliminationsOpen] = useState(false);
  const [focusRevision, setFocusRevision] = useState(0);
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  const shortlistHeadingRef = useRef<HTMLHeadingElement>(null);
  const primaryFirstRef = useRef<HTMLInputElement>(null);
  const secondaryDetailsRef = useRef<HTMLDetailsElement>(null);
  const secondarySummaryRef = useRef<HTMLElement>(null);
  const resultControlRefs = useRef(new Map<MaterialId, HTMLButtonElement>());
  const pendingFocusIntentRef = useRef<ShortlistFocusIntent | null>(null);

  const evaluator = useMemo(
    () => prepareSelectorEvaluator(pageModel.projection),
    [pageModel.projection],
  );
  const evaluation = useMemo(() => evaluator(evaluationInput), [evaluationInput, evaluator]);
  const presentation = useMemo(
    () =>
      evaluation.kind === "success"
        ? presentSelectorOutcome(pageModel, evaluation.outcome)
        : {
            kind: "error" as const,
            body: SELECTOR_COPY.errorState,
            action: SELECTOR_COPY.errorAction,
          },
    [evaluation, pageModel],
  );
  const compatibleIds =
    presentation.kind === "ranked"
      ? presentation.compatible.map(({ materialId }) => materialId)
      : [];
  const shortlist = presentShortlist(shortlistIds, compatibleIds);
  const announcement = announcementOverride ?? aggregateAnnouncement(presentation);

  useLayoutEffect(() => {
    const intent = pendingFocusIntentRef.current;
    if (!intent || intent.kind === "preserve-trigger") return;
    pendingFocusIntentRef.current = null;
    if (intent.kind === "result-shortlist-control") {
      (resultControlRefs.current.get(intent.materialId) ?? resultsHeadingRef.current)?.focus();
    } else if (intent.kind === "shortlist-heading") {
      (shortlistHeadingRef.current ?? resultsHeadingRef.current)?.focus();
    } else {
      resultsHeadingRef.current?.focus();
    }
  }, [focusRevision, shortlistIds]);

  const reset = () => {
    setSelection(pageModel.defaults);
    setEvaluationInput(pageModel.defaults);
    const transition = reduceShortlist(shortlistIds, { type: "criteria-reset" });
    setShortlistIds(transition.ids);
    setAnnouncementOverride("Selector reset to published defaults.");
  };

  const applyShortlist = (action: ShortlistAction) => {
    const transition = reduceShortlist(shortlistIds, action);
    pendingFocusIntentRef.current = transition.focusIntent;
    setShortlistIds(transition.ids);
    if (transition.announcement) setAnnouncementOverride(transition.announcement);
    if (transition.focusIntent.kind !== "preserve-trigger") {
      setFocusRevision((revision) => revision + 1);
    }
  };

  return (
    <div class="selector-island">
      <SelectorControls
        pageModel={pageModel}
        selection={selection}
        primaryFirstRef={primaryFirstRef}
        secondaryDetailsRef={secondaryDetailsRef}
        secondarySummaryRef={secondarySummaryRef}
        onChange={(criterionId, optionId) => {
          const next = { ...selection, [criterionId]: optionId };
          setAnnouncementOverride(null);
          setSelection(next);
          setEvaluationInput(next);
          setShortlistIds(reduceShortlist(shortlistIds, { type: "criteria-changed" }).ids);
        }}
        onInvalid={(criterionId) => {
          setAnnouncementOverride(null);
          setEvaluationInput({ ...selection, [criterionId]: null });
        }}
        onView={() => resultsHeadingRef.current?.focus()}
        onReset={reset}
      />
      <SelectorStatus message={announcement} immediate={announcementOverride !== null} />
      <SelectorResults
        pageModel={pageModel}
        presentation={presentation}
        shortlist={shortlist}
        showAll={showAll}
        eliminationsOpen={eliminationsOpen}
        resultsHeadingRef={resultsHeadingRef}
        shortlistHeadingRef={shortlistHeadingRef}
        registerResultControl={(materialId, element) => {
          if (element) resultControlRefs.current.set(materialId, element);
          else resultControlRefs.current.delete(materialId);
        }}
        onShowAll={() => setShowAll(true)}
        onEliminationsToggle={setEliminationsOpen}
        onToggleShortlist={(materialId) =>
          applyShortlist(
            shortlistIds.includes(materialId)
              ? { type: "remove", materialId, currentResultIds: compatibleIds }
              : { type: "add", materialId },
          )
        }
        onClearShortlist={() => applyShortlist({ type: "clear" })}
        onReview={(target) => {
          if (target === "secondary-summary") {
            if (secondaryDetailsRef.current) secondaryDetailsRef.current.open = true;
            secondarySummaryRef.current?.focus();
          } else {
            primaryFirstRef.current?.focus();
          }
        }}
        onReset={reset}
      />
    </div>
  );
}
