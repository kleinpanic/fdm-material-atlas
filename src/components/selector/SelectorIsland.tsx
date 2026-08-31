/** @jsxImportSource preact */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import type { SelectorPageModel } from "../../features/selector/page-model.ts";
import { SELECTOR_COPY } from "../../features/selector/copy.ts";
import { presentSelectorOutcome } from "../../features/selector/presentation.ts";
import { evaluateSelectorSafely } from "../../features/selector/safe-engine.ts";
import { SelectorControls } from "./SelectorControls.tsx";

type Props = Readonly<{ pageModel: SelectorPageModel }>;

export function SelectorIsland({ pageModel }: Props) {
  const [hydrated, setHydrated] = useState(false);
  const [selection, setSelection] = useState<Readonly<Record<string, string>>>(() => pageModel.defaults);
  const [evaluationInput, setEvaluationInput] = useState<Readonly<Record<string, unknown>>>(() => pageModel.defaults);
  const [announcement, setAnnouncement] = useState<string>(SELECTOR_COPY.hydrationStatus);
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  const primaryFirstRef = useRef<HTMLInputElement>(null);
  const secondaryDetailsRef = useRef<HTMLDetailsElement>(null);
  const secondarySummaryRef = useRef<HTMLElement>(null);

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

  useEffect(() => setHydrated(true), []);
  useEffect(() => {
    if (!hydrated) return;
    const next = presentation.kind === "ranked"
      ? `${presentation.compatible.length} compatible materials; ${presentation.eliminated.length} eliminated.${presentation.compatible[0] ? ` Highest alignment is ${presentation.compatible[0].materialLabel}.` : ""}`
      : presentation.kind === "no-compatible"
        ? "No compatible materials. Your selections were not changed."
        : presentation.kind === "error"
          ? SELECTOR_COPY.errorState
          : presentation.body;
    const timer = window.setTimeout(() => setAnnouncement(next), 150);
    return () => window.clearTimeout(timer);
  }, [hydrated, presentation]);

  const reset = () => {
    setSelection(pageModel.defaults);
    setEvaluationInput(pageModel.defaults);
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
          setSelection(next);
          setEvaluationInput(next);
        }}
        onInvalid={(criterionId) => setEvaluationInput({ ...selection, [criterionId]: null })}
        onView={() => resultsHeadingRef.current?.focus()}
        onReset={reset}
      />
      <p role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
      <section aria-labelledby="selector-results-heading">
        <h2 id="selector-results-heading" ref={resultsHeadingRef} tabIndex={-1}>
          {presentation.kind === "error" ? "Selector unavailable" : presentation.heading}
        </h2>
        {presentation.kind === "error" ? (
          <div role="alert">
            <p>{presentation.body}</p>
            <button type="button" onClick={reset}>{presentation.action}</button>
          </div>
        ) : presentation.kind === "ranked" ? (
          <p>{presentation.compatible.length} compatible materials; {presentation.eliminated.length} eliminated.</p>
        ) : (
          <p>{presentation.body}</p>
        )}
      </section>
    </div>
  );
}
