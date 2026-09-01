/** @jsxImportSource preact */
import type { JSX, RefObject } from "preact";

import type { SelectorRuntimePageModel } from "../../features/selector/client-model.ts";
import { SELECTOR_COPY } from "../../features/selector/copy.ts";

type Props = Readonly<{
  pageModel: SelectorRuntimePageModel;
  selection: Readonly<Record<string, string>>;
  disabled: boolean;
  primaryFirstRef: RefObject<HTMLInputElement>;
  secondaryDetailsRef: RefObject<HTMLDetailsElement>;
  secondarySummaryRef: RefObject<HTMLElement>;
  onChange: (criterionId: string, optionId: string) => void;
  onInvalid: (criterionId: string) => void;
  onView: () => void;
  onReset: () => void;
}>;

export function SelectorControls({
  pageModel,
  selection,
  disabled,
  primaryFirstRef,
  secondaryDetailsRef,
  secondarySummaryRef,
  onChange,
  onInvalid,
  onView,
  onReset,
}: Props) {
  const primary = pageModel.projection.criteria.find((criterion) => criterion.role === "primary");
  const secondary = pageModel.projection.criteria.filter(
    (criterion) => criterion.role === "secondary",
  );
  if (!primary) return null;

  const selectedLabel = (criterion: (typeof pageModel.projection.criteria)[number]) =>
    criterion.options.find((option) => option.id === selection[criterion.id])?.label ??
    criterion.options.find((option) => option.id === criterion.defaultOptionId)?.label ??
    "";

  const acceptValue = (
    criterion: (typeof pageModel.projection.criteria)[number],
    value: string,
  ) => {
    if (criterion.options.some((option) => option.id === value)) onChange(criterion.id, value);
    else onInvalid(criterion.id);
  };

  return (
    <form
      class="selector-controls"
      aria-describedby="selector-default-note"
      onSubmit={(event: JSX.TargetedSubmitEvent<HTMLFormElement>) => {
        event.preventDefault();
        onView();
      }}
    >
      <p id="selector-default-note">{SELECTOR_COPY.defaultStateNote}</p>
      <fieldset disabled={disabled}>
        <legend>{SELECTOR_COPY.primaryGoalLegend}</legend>
        <div class="selector-goals">
          {primary.options.map((option, index) => (
            <label key={option.id} class="selector-goal">
              <input
                {...(index === 0 ? { ref: primaryFirstRef } : {})}
                type="radio"
                name={primary.id}
                value={option.id}
                checked={selection[primary.id] === option.id}
                onChange={(event: JSX.TargetedEvent<HTMLInputElement>) =>
                  acceptValue(primary, event.currentTarget.value)
                }
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <details ref={secondaryDetailsRef} class="selector-secondary" open>
        <summary ref={secondarySummaryRef}>
          <span>{SELECTOR_COPY.secondaryDisclosure}</span>
          <span class="selector-secondary-values">{secondary.map(selectedLabel).join(" · ")}</span>
        </summary>
        <fieldset disabled={disabled}>
          <legend class="visually-hidden">{SELECTOR_COPY.secondaryDisclosure}</legend>
          {secondary.map((criterion) => (
            <label key={criterion.id} class="selector-select">
              <span>{criterion.label}</span>
              <select
                name={criterion.id}
                value={selection[criterion.id] ?? criterion.defaultOptionId}
                onChange={(event: JSX.TargetedEvent<HTMLSelectElement>) =>
                  acceptValue(criterion, event.currentTarget.value)
                }
              >
                {criterion.options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </fieldset>
      </details>

      <section aria-labelledby="current-selection-heading">
        <h2 id="current-selection-heading">Current selection</h2>
        <dl>
          {pageModel.projection.criteria.map((criterion) => (
            <div key={criterion.id}>
              <dt>{criterion.label}</dt>
              <dd>{selectedLabel(criterion)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div class="selector-actions">
        <button type="submit" disabled={disabled}>
          {SELECTOR_COPY.primaryAction}
        </button>
        <button type="button" disabled={disabled} onClick={onReset}>
          {SELECTOR_COPY.resetAction}
        </button>
      </div>
    </form>
  );
}
