/** @jsxImportSource preact */
import type { JSX, RefObject } from "preact";

import type { MaterialId } from "../../data/schema/ids.ts";
import type { RouteAction } from "../../lib/public-route-registry.ts";
import {
  SELECTOR_COPY,
  eliminatedDisclosure,
  shortlistAddLabel,
  shortlistRemoveLabel,
} from "../../features/selector/copy.ts";
import type { SelectorRuntimePageModel } from "../../features/selector/client-model.ts";
import type { SelectorPresentation } from "../../features/selector/presentation.ts";
import type { PresentedShortlistItem } from "../../features/selector/shortlist.ts";

type Props = Readonly<{
  pageModel: SelectorRuntimePageModel;
  presentation: SelectorPresentation;
  shortlist: readonly PresentedShortlistItem[];
  showAll: boolean;
  eliminationsOpen: boolean;
  resultsHeadingRef: RefObject<HTMLHeadingElement>;
  shortlistHeadingRef: RefObject<HTMLHeadingElement>;
  registerResultControl: (materialId: MaterialId, element: HTMLButtonElement | null) => void;
  onShowAll: () => void;
  onEliminationsToggle: (open: boolean) => void;
  onToggleShortlist: (materialId: MaterialId) => void;
  onClearShortlist: () => void;
  onReview: (target: "secondary-summary" | "primary-goal") => void;
  onReset: () => void;
}>;

function RouteLink({ action }: Readonly<{ action: RouteAction; key?: unknown }>) {
  return action.kind === "link"
    ? <a href={action.href}>{action.label}</a>
    : <span>{action.label}</span>;
}

function familyLabel(family: SelectorRuntimePageModel["display"]["materials"][number]["familyOrFill"]) {
  return family.state === "unavailable"
    ? "Family or filler not available"
    : family.state === "conditional"
      ? `${family.label} (conditional)`
      : family.label;
}

export function SelectorResults({
  pageModel,
  presentation,
  shortlist,
  showAll,
  eliminationsOpen,
  resultsHeadingRef,
  shortlistHeadingRef,
  registerResultControl,
  onShowAll,
  onEliminationsToggle,
  onToggleShortlist,
  onClearShortlist,
  onReview,
  onReset,
}: Props) {
  const labelFor = (materialId: MaterialId) =>
    pageModel.display.materials.find((material) => material.id === materialId)?.label ?? "Material";
  const shortlisted = new Set(shortlist.map(({ materialId }) => materialId));

  if (presentation.kind === "error") {
    return (
      <section aria-labelledby="selector-results-heading">
        <h2 id="selector-results-heading" ref={resultsHeadingRef} tabIndex={-1}>Selector unavailable</h2>
        <div role="alert">
          <p>{presentation.body}</p>
          <button type="button" onClick={onReset}>{presentation.action}</button>
        </div>
      </section>
    );
  }

  if (presentation.kind === "empty") {
    return (
      <section aria-labelledby="selector-results-heading">
        <h2 id="selector-results-heading" ref={resultsHeadingRef} tabIndex={-1}>{presentation.heading}</h2>
        <p>{presentation.body}</p>
      </section>
    );
  }

  const compatible = presentation.kind === "ranked" ? presentation.compatible : [];
  const visibleCompatible = showAll ? compatible : compatible.slice(0, 10);

  return (
    <div class="selector-results">
      {shortlist.length > 0 && (
        <section class="selector-shortlist" aria-labelledby="shortlist-heading">
          <h2 id="shortlist-heading" ref={shortlistHeadingRef} tabIndex={-1}>Shortlist</h2>
          <ol>
            {shortlist.map((item) => (
              <li key={item.materialId} data-shortlist-status={item.status}>
                <span>{labelFor(item.materialId)}</span>
                <span class="selector-shortlist-status">
                  <span class="selector-state-marker" aria-hidden="true">
                    {item.status === "compatible" ? "✓" : "×"}
                  </span>
                  {item.status === "compatible" ? "Compatible" : "Now eliminated by current constraints"}
                </span>
                {item.status === "now-eliminated" && (
                  <a href={`#eliminated-${item.materialId}`}>Review exclusion</a>
                )}
                <button
                  type="button"
                  aria-label={shortlistRemoveLabel(labelFor(item.materialId))}
                  onClick={() => onToggleShortlist(item.materialId)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ol>
          {pageModel.routes.compare.kind === "link" && shortlist.length >= 2
            ? <a href={pageModel.routes.compare.href}>{pageModel.routes.compare.label}</a>
            : <p>{SELECTOR_COPY.compareUnavailable}</p>}
          <button type="button" onClick={onClearShortlist}>{SELECTOR_COPY.clearShortlist}</button>
        </section>
      )}

      <section aria-labelledby="selector-results-heading">
        <h2 id="selector-results-heading" ref={resultsHeadingRef} tabIndex={-1}>
          {presentation.heading}
          {presentation.kind === "ranked" && (
            <span class="selector-compatible-count" aria-hidden="true">{presentation.compatible.length} {SELECTOR_COPY.compatibleCountLabel}</span>
          )}
        </h2>

        {presentation.kind === "no-compatible" ? (
          <div class="selector-no-compatible">
            <p>{presentation.body}</p>
            <p>{presentation.explanation}</p>
            <dl>
              {presentation.selection.map((choice) => (
                <div key={choice.criterionId}>
                  <dt>{choice.criterionLabel}</dt>
                  <dd>{choice.optionLabel}</dd>
                </div>
              ))}
            </dl>
            {presentation.reviewActions.map((action) => (
              <button type="button" key={action.focusTarget} onClick={() => onReview(action.focusTarget)}>
                {action.label}
              </button>
            ))}
            <button type="button" onClick={onReset}>{SELECTOR_COPY.resetAction}</button>
          </div>
        ) : (
          <>
            <p>{presentation.rankingExplanation}</p>
            <p>{presentation.alignmentLimitation}</p>
            <p>{presentation.applicableMaximumNote}</p>
            <ol class="selector-compatible-list">
              {visibleCompatible.map((material) => {
                const isShortlisted = shortlisted.has(material.materialId);
                return (
                  <li key={material.materialId} data-alignment={material.highestAlignment ? "highest" : "ranked"}>
                    <article>
                      <p class="selector-rank" data-numeric>Rank {material.rank}</p>
                      <h3>{material.materialLabel}</h3>
                      <p class="selector-family"><span class="selector-family-marker" aria-hidden="true">◇</span>{familyLabel(material.familyOrFill)}</p>
                      <p>{material.compatibilityLabel}</p>
                      {material.highestAlignment && <p class="selector-highest-alignment">{material.highestAlignment}</p>}
                      <p class="selector-score" data-numeric>{material.scoreLabel}</p>
                      <p>{material.summaryExplanation}</p>
                      <details class="selector-calculation">
                        <summary>{SELECTOR_COPY.resultDisclosure}</summary>
                        <ul>
                          {material.contributions.map((contribution) => (
                            <li
                              key={`${contribution.record.criterionId}-${contribution.record.optionId}`}
                              data-contribution-state={contribution.visualState}
                            >
                              <span class="selector-contribution-points" data-numeric>
                                {contribution.visualState === "zero" && (
                                  <span class="selector-state-marker" aria-hidden="true">○</span>
                                )}
                                {contribution.pointsLabel}
                              </span>
                              <strong>{contribution.criterionLabel}: {contribution.optionLabel}</strong>
                              <span>{contribution.explanation}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                      <button
                        ref={(element: HTMLButtonElement | null) => registerResultControl(material.materialId, element)}
                        type="button"
                        onClick={() => onToggleShortlist(material.materialId)}
                      >
                        {isShortlisted
                          ? shortlistRemoveLabel(material.materialLabel)
                          : shortlistAddLabel(material.materialLabel)}
                      </button>
                      <nav class="selector-result-actions" aria-label={`Next steps for ${material.materialLabel}`}>
                        <RouteLink action={material.routes.details} />
                        <RouteLink action={material.routes.startingProfile} />
                        {material.routes.decisionMaps.length > 0
                          ? material.routes.decisionMaps.map(({ laneId, action }) => <RouteLink key={laneId} action={action} />)
                          : <RouteLink action={material.routes.decisionMapFallback} />}
                        <RouteLink action={material.routes.methodEvidence} />
                      </nav>
                    </article>
                  </li>
                );
              })}
            </ol>
            {compatible.length > 10 && !showAll
              ? <button type="button" onClick={onShowAll}>Show all {compatible.length} compatible materials</button>
              : compatible.length > 10 && <p>Showing all {compatible.length} compatible materials</p>}
          </>
        )}

        {presentation.eliminated.length > 0 && (
          <details
            open={presentation.eliminationsOpen || eliminationsOpen}
            onToggle={(event: JSX.TargetedEvent<HTMLDetailsElement>) => onEliminationsToggle(event.currentTarget.open)}
            class="selector-eliminated"
          >
            <summary>
              <span>{eliminatedDisclosure(presentation.eliminated.length)}</span>
              <span class="selector-eliminated-help">{SELECTOR_COPY.eliminatedHelp}</span>
            </summary>
            <ol>
              {presentation.eliminated.map((material) => (
                <li key={material.materialId}>
                  <article>
                    <h3 id={`eliminated-${material.materialId}`} tabIndex={-1}>{material.materialLabel}</h3>
                    <p class="selector-family"><span class="selector-family-marker" aria-hidden="true">◇</span>{familyLabel(material.familyOrFill)}</p>
                    <ul>
                      {material.reasons.map((reason) => (
                        <li
                          key={`${reason.record.criterionId}-${reason.record.reasonId}`}
                          data-exclusion-state={reason.visualState}
                        >
                          <span class="selector-exclusion-marker" aria-hidden="true">
                            {reason.visualState === "blocked" ? "×" : "!"}
                          </span>
                          <strong>{reason.stateLabel}</strong>
                          <span>{reason.criterionLabel}: {reason.optionLabel}</span>
                          <span>{reason.explanation}</span>
                        </li>
                      ))}
                    </ul>
                    <RouteLink action={material.routes.details} />
                  </article>
                </li>
              ))}
            </ol>
          </details>
        )}
      </section>
    </div>
  );
}
