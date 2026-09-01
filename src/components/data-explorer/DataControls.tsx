/** @jsxImportSource preact */
import type { JSX } from "preact";

import { EVIDENCE_SCOPE_PRESENTATION, FACT_STATE_PRESENTATION } from "../../lib/presentation/labels.ts";
import type { ExplorerState, ExplorerSortableField } from "../../features/data-explorer/explore.ts";
import type { DataExplorerModel } from "../../features/data-explorer/model.ts";

export const FACT_STATE_OPTIONS = ["known", "conditional", "unknown", "missing", "not-applicable"] as const;
export const EVIDENCE_SCOPE_OPTIONS = [
  "product-specific",
  "representative-product",
  "family-guidance",
  "qualitative-heuristic",
  "starting-profile-guidance",
  "derived-selector-logic",
] as const;

type Props = Readonly<{
  model: DataExplorerModel;
  state: ExplorerState;
  onChange: (state: ExplorerState) => void;
  onInvalid: () => void;
  onClear: () => void;
}>;

export function DataControls({ model, state, onChange, onInvalid, onClear }: Props) {
  const group = model.groups.find(({ key }) => key === state.group)!;
  const sortable = group.fieldKeys.flatMap((key) => {
    const field = model.fields.find((candidate) => candidate.key === key);
    return field !== undefined && field.sort !== "none" ? [field] : [];
  });
  const updateGroup = (value: string) => {
    const next = model.groups.find(({ key }) => key === value);
    if (!next) return onInvalid();
    const first = next.fieldKeys.flatMap((key) => {
      const field = model.fields.find((candidate) => candidate.key === key);
      return field !== undefined && field.sort !== "none" ? [field] : [];
    })[0];
    if (!first) return onInvalid();
    onChange({ ...state, group: next.key, thermalMetric: "all", sort: { field: first.key as ExplorerSortableField, direction: "asc" } });
  };
  const updateMetric = (value: string) => {
    if (value !== "all" && !model.thermalMetrics.some(({ id }) => id === value)) return onInvalid();
    onChange({ ...state, thermalMetric: value });
  };
  const updateFactState = (value: string) => {
    if (value !== "all" && !FACT_STATE_OPTIONS.some((option) => option === value)) return onInvalid();
    onChange({ ...state, factState: value as ExplorerState["factState"] });
  };
  const updateScope = (value: string) => {
    if (value !== "all" && !EVIDENCE_SCOPE_OPTIONS.some((option) => option === value)) return onInvalid();
    onChange({ ...state, evidenceScope: value as ExplorerState["evidenceScope"] });
  };
  const updateSort = (value: string) => {
    const field = sortable.find(({ key }) => key === value);
    if (!field) return onInvalid();
    onChange({ ...state, sort: { ...state.sort, field: field.key as ExplorerSortableField } });
  };

  return (
    <form class="data-controls" onSubmit={(event: JSX.TargetedSubmitEvent<HTMLFormElement>) => event.preventDefault()}>
      <label><span>Search materials and visible values</span><input type="search" value={state.query} onInput={(event: JSX.TargetedEvent<HTMLInputElement>) => onChange({ ...state, query: event.currentTarget.value })} /></label>
      <label><span>Attribute group</span><select value={state.group} onChange={(event: JSX.TargetedEvent<HTMLSelectElement>) => updateGroup(event.currentTarget.value)}>{model.groups.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
      <label><span>Exact named thermal metric</span><select value={state.thermalMetric} disabled={state.group !== "identity-thermal"} onChange={(event: JSX.TargetedEvent<HTMLSelectElement>) => updateMetric(event.currentTarget.value)}><option value="all">All named metrics</option>{model.thermalMetrics.map((option) => <option key={option.id} value={option.id}>{option.label} — {option.methodLabel}</option>)}</select></label>
      <label><span>Fact state</span><select value={state.factState} onChange={(event: JSX.TargetedEvent<HTMLSelectElement>) => updateFactState(event.currentTarget.value)}><option value="all">All fact states</option>{FACT_STATE_OPTIONS.map((option) => <option key={option} value={option}>{FACT_STATE_PRESENTATION[option].label}</option>)}</select></label>
      <label><span>Evidence scope</span><select value={state.evidenceScope} onChange={(event: JSX.TargetedEvent<HTMLSelectElement>) => updateScope(event.currentTarget.value)}><option value="all">All evidence scopes</option>{EVIDENCE_SCOPE_OPTIONS.map((option) => <option key={option} value={option}>{EVIDENCE_SCOPE_PRESENTATION[option].label}</option>)}</select></label>
      <label><span>Sort field</span><select value={state.sort.field} onChange={(event: JSX.TargetedEvent<HTMLSelectElement>) => updateSort(event.currentTarget.value)}>{sortable.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}</select></label>
      <fieldset><legend>View</legend>{(["table", "records"] as const).map((view) => <label key={view}><input type="radio" name="explorer-view" value={view} checked={state.view === view} onChange={(event: JSX.TargetedEvent<HTMLInputElement>) => event.currentTarget.value === view ? onChange({ ...state, view }) : onInvalid()} />{view === "table" ? "Table" : "Material records"}</label>)}</fieldset>
      <fieldset><legend>Sort direction</legend>{(["asc", "desc"] as const).map((direction) => <label key={direction}><input type="radio" name="sort-direction" value={direction} checked={state.sort.direction === direction} onChange={(event: JSX.TargetedEvent<HTMLInputElement>) => event.currentTarget.value === direction ? onChange({ ...state, sort: { ...state.sort, direction } }) : onInvalid()} />{direction === "asc" ? "Ascending" : "Descending"}</label>)}</fieldset>
      <button type="button" onClick={onClear}>Clear filters</button>
      <section aria-labelledby="explorer-state-heading"><h2 id="explorer-state-heading">Current data view</h2><dl><div><dt>Group</dt><dd>{group.label}</dd></div><div><dt>Results</dt><dd>Updated below</dd></div><div><dt>Presentation</dt><dd>{state.view === "table" ? "Table" : "Material records"}</dd></div></dl></section>
    </form>
  );
}
