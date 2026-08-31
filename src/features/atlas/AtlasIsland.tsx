/** @jsxImportSource preact */
import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

import { filterAtlas, type AtlasFilterState } from "./filter.ts";
import type { AtlasFact, AtlasPageModel, AtlasRow } from "./model.ts";

type Props = Readonly<{ pageModel: AtlasPageModel }>;

function factText(fact: AtlasFact): string {
  return fact.valueLabel ?? fact.value ?? fact.condition ?? fact.reason ?? fact.stateLabel;
}

function MaterialRow({ row, note }: Readonly<{ row: AtlasRow; note?: string }>) {
  return (
    <li class="atlas-row">
      <div class="atlas-row__heading">
        <h3><a href={row.href}>{row.name}</a></h3>
        <p><span class="family-fill-marker" aria-hidden="true" /> {factText(row.family)}</p>
      </div>
      {note && <p class="atlas-row__reason" data-state="verify">{note}</p>}
      <dl class="atlas-row__facts">
        <div><dt>Practical service guidance</dt><dd>{factText(row.serviceTemperature)}</dd></div>
        <div><dt>Named thermal observation</dt><dd>{row.thermalObservations.map(({ metricLabel, measurement }) => `${metricLabel}: ${factText(measurement)}`).join("; ") || "Not reported"}</dd></div>
        <div><dt>Print difficulty</dt><dd>{factText(row.facts["print-difficulty"]!)}</dd></div>
        <div><dt>Relative cost</dt><dd>{factText(row.facts["cost-tier"]!)}</dd></div>
        <div><dt>Enclosure</dt><dd>{factText(row.facts.enclosure!)}</dd></div>
        <div><dt>Wear-resistant nozzle</dt><dd>{factText(row.facts["hardened-nozzle"]!)}</dd></div>
        <div><dt>Drying</dt><dd>{factText(row.facts["drying-priority"]!)}</dd></div>
        <div><dt>Ventilation</dt><dd>{factText(row.facts.ventilation!)}</dd></div>
      </dl>
      {row.uses.length > 0 && <p><strong>Typical uses:</strong> {row.uses.join("; ")}</p>}
      <p class="atlas-row__evidence">{row.evidence.recordCount} public evidence records across {row.evidence.scopes.length} scopes</p>
      <a class="atlas-row__action" href={row.href}>Open material reference</a>
    </li>
  );
}

export function AtlasIsland({ pageModel }: Props) {
  const [hydrated, setHydrated] = useState(false);
  const [filterState, setFilterState] = useState<AtlasFilterState>({ search: "", selections: {} });
  const [announcement, setAnnouncement] = useState("Atlas filters are preparing");
  const result = useMemo(() => filterAtlas(pageModel, filterState), [pageModel, filterState]);

  useEffect(() => setHydrated(true), []);
  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => setAnnouncement(
      `${result.counts.matches} matches; ${result.counts.needsVerification} need verification; ${result.counts.outside} outside these filters.`,
    ), 150);
    return () => window.clearTimeout(timer);
  }, [hydrated, result.counts]);

  const changeSelection = (id: string, value: string) => setFilterState((current) => ({
    ...current,
    selections: { ...current.selections, [id]: value || undefined },
  }));
  const clear = () => {
    setFilterState({ search: "", selections: {} });
    setAnnouncement(`Filters cleared. ${pageModel.rows.length} materials shown.`);
  };

  return (
    <div class="atlas-island">
      <form class="atlas-filters bounded-panel" aria-label="Filter material atlas" onSubmit={(event: JSX.TargetedSubmitEvent<HTMLFormElement>) => event.preventDefault()}>
        <label for="atlas-search">Search material or family</label>
        <input id="atlas-search" type="search" value={filterState.search} disabled={!hydrated} onInput={(event: JSX.TargetedEvent<HTMLInputElement>) => setFilterState((current) => ({ ...current, search: event.currentTarget.value }))} />
        <fieldset>
          <legend>Process and equipment</legend>
          {pageModel.filters.slice(0, 6).map((filter) => (
            <label>{filter.label}<select value={filterState.selections[filter.id] ?? ""} disabled={!hydrated} onChange={(event: JSX.TargetedEvent<HTMLSelectElement>) => changeSelection(filter.id, event.currentTarget.value)}><option value="">Any {filter.label.toLowerCase()}</option>{filter.options.map((option) => <option value={option.id}>{option.label}</option>)}</select></label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Behavior and properties</legend>
          {pageModel.filters.slice(6).map((filter) => (
            <label>{filter.label}<select value={filterState.selections[filter.id] ?? ""} disabled={!hydrated} onChange={(event: JSX.TargetedEvent<HTMLSelectElement>) => changeSelection(filter.id, event.currentTarget.value)}><option value="">Any {filter.label.toLowerCase()}</option>{filter.options.map((option) => <option value={option.id}>{option.label}</option>)}</select></label>
          ))}
        </fieldset>
        <button type="button" disabled={!hydrated} onClick={clear}>Clear filters</button>
      </form>
      <div class="atlas-results">
        <p role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
        {result.activeFilters.length > 0 && <dl class="atlas-active-filters">{result.activeFilters.map((filter) => <div><dt>{filter.label}</dt><dd>{filter.valueLabel}</dd></div>)}</dl>}
        {result.matches.length === 0 && result.needsVerification.length === 0 && <section><h2>No materials match these filters</h2><p>Your filters were not changed. Review the active filters or clear them to return to all materials.</p></section>}
        {result.matches.length > 0 && <section><h2>Matching materials ({result.matches.length})</h2><ol class="atlas-list">{result.matches.map(({ row }) => <MaterialRow row={row} />)}</ol></section>}
        {result.needsVerification.length > 0 && <section><h2>Needs verification for these filters</h2><ol class="atlas-list">{result.needsVerification.map(({ row, unresolvedDimensions }) => <MaterialRow row={row} note={`Verify: ${unresolvedDimensions.join(", ")}`} />)}</ol></section>}
        {result.outside.length > 0 && result.activeFilters.length > 0 && <details class="atlas-outside"><summary>Materials outside these filters ({result.outside.length})</summary><ol class="atlas-list">{result.outside.map(({ row, firstMismatch }) => <MaterialRow row={row} note={`First mismatch: ${firstMismatch}`} />)}</ol></details>}
      </div>
    </div>
  );
}
