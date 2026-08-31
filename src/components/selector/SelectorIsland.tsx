/** @jsxImportSource preact */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import type { SelectorPageModel } from "../../features/selector/page-model.ts";
import type { MaterialId } from "../../data/schema/ids.ts";
import { SELECTOR_COPY } from "../../features/selector/copy.ts";
import { presentSelectorOutcome } from "../../features/selector/presentation.ts";
import { evaluateSelectorSafely } from "../../features/selector/safe-engine.ts";
import {
  presentShortlist,
  reduceShortlist,
  type ShortlistAction,
  type ShortlistFocusIntent,
  type ShortlistState,
} from "../../features/selector/shortlist.ts";
import { SelectorControls } from "./SelectorControls.tsx";
import { SelectorResults } from "./SelectorResults.tsx";

type Props = Readonly<{ pageModel: SelectorPageModel }>;

export function SelectorIsland({ pageModel }: Props) {
  const [hydrated, setHydrated] = useState(false);
  const [selection, setSelection] = useState<Readonly<Record<string, string>>>(() => pageModel.defaults);
  const [evaluationInput, setEvaluationInput] = useState<Readonly<Record<string, unknown>>>(() => pageModel.defaults);
  const [announcement, setAnnouncement] = useState<string>(SELECTOR_COPY.hydrationStatus);
  const [announcementCause, setAnnouncementCause] = useState<"aggregate" | "reset">("aggregate");
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

  const evaluation = useMemo(
    () => evaluateSelectorSafely(pageModel.projection, evaluationInput),
    [pageModel.projection, evaluationInput],
  );
  const presentation = useMemo(
    () => evaluation.kind === "success"
      ? presentSelectorOutcome(pageModel, evaluation.outcome)
      : { kind: "error" as const, body: SELECTOR_COPY.errorState, action: SELECTOR_COPY.errorAction },
    [evaluation, pageModel],
  );
  const compatibleIds = presentation.kind === "ranked"
    ? presentation.compatible.map(({ materialId }) => materialId)
    : [];
  const shortlist = presentShortlist(shortlistIds, compatibleIds);

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

  useEffect(() => setHydrated(true), []);
  useEffect(() => {
    if (!hydrated) return;
    if (announcementCause === "reset") {
      setAnnouncement("Selector reset to published defaults.");
      return;
    }
    const next = presentation.kind === "ranked"
      ? `${presentation.compatible.length} compatible materials; ${presentation.eliminated.length} eliminated.${presentation.compatible[0] ? ` Highest alignment is ${presentation.compatible[0].materialLabel}.` : ""}`
      : presentation.kind === "no-compatible"
        ? "No compatible materials. Your selections were not changed."
        : presentation.kind === "error"
          ? SELECTOR_COPY.errorState
          : presentation.body;
    const timer = window.setTimeout(() => setAnnouncement(next), 150);
    return () => window.clearTimeout(timer);
  }, [announcementCause, hydrated, presentation]);

  const reset = () => {
    setAnnouncementCause("reset");
    setSelection(pageModel.defaults);
    setEvaluationInput(pageModel.defaults);
    const transition = reduceShortlist(shortlistIds, { type: "criteria-reset" });
    setShortlistIds(transition.ids);
    setAnnouncement("Selector reset to published defaults.");
  };

  const applyShortlist = (action: ShortlistAction) => {
    const transition = reduceShortlist(shortlistIds, action);
    pendingFocusIntentRef.current = transition.focusIntent;
    setShortlistIds(transition.ids);
    if (transition.announcement) setAnnouncement(transition.announcement);
    if (transition.focusIntent.kind !== "preserve-trigger") {
      setFocusRevision((revision) => revision + 1);
    }
  };

  return (
    <div class="selector-island">
      <SelectorControls
        pageModel={pageModel}
        selection={selection}
        disabled={!hydrated}
        primaryFirstRef={primaryFirstRef}
        secondaryDetailsRef={secondaryDetailsRef}
        secondarySummaryRef={secondarySummaryRef}
        onChange={(criterionId, optionId) => {
          const next = { ...selection, [criterionId]: optionId };
          setAnnouncementCause("aggregate");
          setSelection(next);
          setEvaluationInput(next);
          setShortlistIds(reduceShortlist(shortlistIds, { type: "criteria-changed" }).ids);
        }}
        onInvalid={(criterionId) => {
          setAnnouncementCause("aggregate");
          setEvaluationInput({ ...selection, [criterionId]: null });
        }}
        onView={() => resultsHeadingRef.current?.focus()}
        onReset={reset}
      />
      <p role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
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
        onToggleShortlist={(materialId) => applyShortlist(shortlistIds.includes(materialId)
          ? { type: "remove", materialId, currentResultIds: compatibleIds }
          : { type: "add", materialId })}
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
