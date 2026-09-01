/** @jsxImportSource preact */
import type { JSX } from "preact";

import type {
  MapImpactFlexRecord,
  MapInternalHref,
  MapSelectionAction,
} from "../../features/map/contracts.ts";
import type { buildMapView } from "../../features/map/state.ts";
import { SelectedRecord } from "./SelectedRecord.tsx";

type MapViewModel = ReturnType<typeof buildMapView>;
type Props = Readonly<{
  view: MapViewModel;
  dispatch: (action: MapSelectionAction) => void;
  evidenceHref?: MapInternalHref;
}>;

const PLOT = Object.freeze({ left: 176, top: 48, column: 132, row: 94, width: 660, height: 376 });
const SLOT_OFFSETS = Object.freeze([
  [-30, -18], [0, -18], [30, -18], [-30, 18], [0, 18], [30, 18],
] as const);

function diagramState(record: MapImpactFlexRecord): string {
  if (record.disposition.disposition === "plotted") return "Plotted";
  if (record.disposition.disposition === "filtered") return "Filtered from the diagram";
  return `Not plotted — ${record.disposition.reason}`;
}

function visibleValue(fact: MapImpactFlexRecord["impactFact"]): string {
  return fact.display.join(" — ");
}

function Shape({
  shape,
  x,
  y,
  className,
}: Readonly<{
  shape: NonNullable<MapImpactFlexRecord["shape"]> | "circle";
  x: number;
  y: number;
  className: string;
}>) {
  if (shape === "square") return <rect class={className} x={x - 7} y={y - 7} width={14} height={14} />;
  if (shape === "triangle") return <polygon class={className} points={`${x},${y - 9} ${x - 9},${y + 8} ${x + 9},${y + 8}`} />;
  if (shape === "diamond") return <polygon class={className} points={`${x},${y - 9} ${x - 9},${y} ${x},${y + 9} ${x + 9},${y}`} />;
  return <circle class={className} cx={x} cy={y} r={7} />;
}

/** Complete categorical renderer backed only by the resolved map view. */
export function ImpactFlexMatrix({ view, dispatch, evidenceHref }: Props) {
  const model = view.impactFlex;
  const active = model.activeTarget?.mode === "impact-flex-space" && model.activeTarget.kind === "material"
    ? model.activeTarget
    : undefined;
  const selected = active === undefined
    ? undefined
    : model.records.find(({ material }) => material.id === active.id);
  const impactOrder = new Map(model.impactAxis.map(({ value, order }) => [value, order]));
  const flexibilityOrder = new Map(model.flexibilityAxis.map(({ value, order }) => [value, order]));
  const plotted = model.records.filter(({ disposition }) => disposition.disposition === "plotted");
  const filtered = model.records.filter(({ disposition }) => disposition.disposition === "filtered");
  const omitted = model.records.filter(({ disposition }) => disposition.disposition === "omitted");
  const counts = new Map<string, number>();
  for (const record of plotted) {
    if (record.impact === undefined || record.flexibility === undefined) continue;
    const key = `${record.impact}\u0000${record.flexibility}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const selectMaterial = (record: MapImpactFlexRecord) => dispatch({
    type: "select-material",
    mode: "impact-flex-space",
    materialId: record.material.id,
  });

  return (
    <section id="impact-flex-space" class="map-mode map-mode--impact-flex" aria-labelledby="interactive-impact-flex-heading">
      <header class="map-mode__header">
        <p class="technical-eyebrow">Impact and flexibility</p>
        <h2 id="interactive-impact-flex-heading">Inspect two ordered qualitative categories together</h2>
        <p class="map-limitation">{model.limitation}</p>
      </header>

      <form class="map-controls" onSubmit={(event: JSX.TargetedSubmitEvent<HTMLFormElement>) => event.preventDefault()}>
        <label>
          <span>Find a material in the impact-flex view</span>
          <input
            type="search"
            value={model.query ?? ""}
            onInput={(event: JSX.TargetedEvent<HTMLInputElement>) => dispatch({
              type: "set-search", target: "impact-flex", query: event.currentTarget.value,
            })}
          />
        </label>
        <label>
          <span>Maximum print difficulty</span>
          <select
            value={model.maximumDifficulty ?? ""}
            onChange={(event: JSX.TargetedEvent<HTMLSelectElement>) => {
              const term = model.difficultyTerms.find(({ value }) => value === event.currentTarget.value);
              dispatch({ type: "set-maximum-difficulty", ...(term === undefined ? {} : { value: term.value }) });
            }}
          >
            <option value="">Any print difficulty</option>
            {model.difficultyTerms.map((term) => <option key={term.value} value={term.value}>{term.label}</option>)}
          </select>
        </label>
        <label class="map-checkbox">
          <input
            type="checkbox"
            checked={model.shapesEnabled}
            onChange={(event: JSX.TargetedEvent<HTMLInputElement>) => dispatch({
              type: "set-difficulty-shapes", enabled: event.currentTarget.checked,
            })}
          />
          <span>Encode print difficulty with mark shape</span>
        </label>
        <button type="button" onClick={() => dispatch({ type: "reset-view", mode: "impact-flex-space" })}>
          Clear property-space filters
        </button>
      </form>

      <p class="map-current-state" role="status">
        {plotted.length} plotted; {filtered.length} filtered from the diagram; {omitted.length} not plotted. All {model.records.length} records remain in the table.
      </p>

      <div class="map-legend" aria-label="Impact-flex mark legend">
        <span><span class="map-mark map-mark--open" aria-hidden="true"></span> Material</span>
        <span><span class="map-mark map-mark--conditional" aria-hidden="true">!</span> Conditional — review conditions</span>
        <span><span class="map-mark map-mark--selected" aria-hidden="true"></span> Selected</span>
        {model.shapesEnabled && model.difficultyTerms.map((term) => (
          <span key={term.value}><span class={`map-mark map-mark--${term.shape}`} aria-hidden="true"></span>{term.label}</span>
        ))}
      </div>

      <div class="map-horizontal-scroll" role="region" aria-label="Impact resistance by flexibility matrix" tabIndex={0}>
        <p class="map-scroll-instruction">Scroll horizontally to inspect all category combinations.</p>
        <figure class="impact-flex-figure">
          <svg viewBox="0 0 900 520" role="img" aria-labelledby="impact-flex-title impact-flex-description" focusable="false">
            <title id="impact-flex-title">Impact resistance by flexibility category matrix</title>
            <desc id="impact-flex-description">Twenty categorical cells. Interactive marks duplicate the complete ordered material controls and table below.</desc>
            <text x="506" y="506" text-anchor="middle">Impact resistance</text>
            <text x="24" y="242" text-anchor="middle" transform="rotate(-90 24 242)">Flexibility</text>
            {model.impactAxis.map((term) => (
              <text key={term.value} x={PLOT.left + term.order * PLOT.column + PLOT.column / 2} y="492" text-anchor="middle">{term.label}</text>
            ))}
            {[...model.flexibilityAxis].reverse().map((term, row) => (
              <text key={term.value} x="164" y={PLOT.top + row * PLOT.row + PLOT.row / 2} text-anchor="end">{term.label}</text>
            ))}
            {[...model.flexibilityAxis].reverse().flatMap((flexibility, row) =>
              model.impactAxis.map((impact) => {
                const key = `${impact.value}\u0000${flexibility.value}`;
                return (
                  <g data-impact-cell="true" key={key}>
                    <rect
                      class="impact-flex-cell"
                      x={PLOT.left + impact.order * PLOT.column}
                      y={PLOT.top + row * PLOT.row}
                      width={PLOT.column}
                      height={PLOT.row}
                    />
                    <text
                      class="impact-flex-cell__count"
                      x={PLOT.left + impact.order * PLOT.column + 8}
                      y={PLOT.top + row * PLOT.row + 16}
                    >{counts.get(key) ?? 0}</text>
                  </g>
                );
              }))}
            {plotted.map((record) => {
              const impact = impactOrder.get(record.impact!);
              const flexibility = flexibilityOrder.get(record.flexibility!);
              if (impact === undefined || flexibility === undefined) return null;
              const row = model.flexibilityAxis.length - 1 - flexibility;
              const offset = SLOT_OFFSETS[(record.slot ?? 0) % SLOT_OFFSETS.length]!;
              const x = PLOT.left + impact * PLOT.column + PLOT.column / 2 + offset[0];
              const y = PLOT.top + row * PLOT.row + PLOT.row / 2 + offset[1];
              const isSelected = selected?.material.id === record.material.id;
              const conditional = record.impactFact.state === "conditional" || record.flexibilityFact.state === "conditional";
              return (
                <g
                  key={record.material.id}
                  data-material-mark={true}
                  data-material-id={record.material.id}
                  class={`impact-flex-mark${conditional ? " is-conditional" : ""}${isSelected ? " is-selected" : ""}`}
                  onPointerDown={(event: JSX.TargetedPointerEvent<SVGGElement>) => event.preventDefault()}
                  onClick={() => selectMaterial(record)}
                >
                  {isSelected && <circle class="impact-flex-mark__selection" cx={x} cy={y} r={13} />}
                  <Shape shape={model.shapesEnabled ? record.shape ?? "circle" : "circle"} x={x} y={y} className="impact-flex-mark__shape" />
                </g>
              );
            })}
          </svg>
          <figcaption>Cell spacing indicates category order only. Cell numbers report currently plotted records.</figcaption>
        </figure>
      </div>

      <section class="map-material-controls" aria-labelledby="impact-material-controls-heading">
        <h3 id="impact-material-controls-heading">Ordered material controls</h3>
        <ol>
          {model.records.map((record) => (
            <li key={record.material.id}>
              <button
                type="button"
                data-material-control={true}
                data-material-id={record.material.id}
                aria-pressed={selected?.material.id === record.material.id}
                onFocus={() => dispatch({
                  type: "preview-selection",
                  mode: "impact-flex-space",
                  source: "focus",
                  target: { kind: "material", mode: "impact-flex-space", id: record.material.id },
                })}
                onBlur={() => dispatch({ type: "clear-preview", mode: "impact-flex-space", source: "focus" })}
                onClick={() => selectMaterial(record)}
              >
                Highlight {record.material.name}. {diagramState(record)}
              </button>
            </li>
          ))}
        </ol>
      </section>

      {selected !== undefined && (
        <SelectedRecord
          kind="impact-flex"
          record={selected}
          limitation={model.limitation}
          outsideFilter={model.selectedOutsideFilter}
          {...(evidenceHref === undefined ? {} : { evidenceHref })}
        />
      )}

      {omitted.length > 0 && (
        <section class="map-omissions" aria-labelledby="impact-omissions-heading">
          <h3 id="impact-omissions-heading">Not plotted in the impact-flex matrix</h3>
          <ul>
            {omitted.map((record) => (
              <li key={record.material.id}>
                <a href={record.material.href}>{record.material.name}</a>: {diagramState(record)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div class="map-horizontal-scroll" role="region" aria-label="Complete impact and flexibility material table" tabIndex={0}>
        <p class="map-scroll-instruction">Scroll horizontally to inspect every column.</p>
        <table class="impact-flex-table">
          <caption>All materials in categorical order, including filtered and unplottable records</caption>
          <thead>
            <tr>
              <th scope="col">Material</th>
              <th scope="col">Impact resistance</th>
              <th scope="col">Impact fact state</th>
              <th scope="col">Flexibility</th>
              <th scope="col">Flexibility fact state</th>
              <th scope="col">Print difficulty</th>
              <th scope="col">Diagram state</th>
              <th scope="col">Material reference</th>
            </tr>
          </thead>
          <tbody>
            {model.records.map((record) => (
              <tr data-impact-row="true" key={record.material.id}>
                <th scope="row">{record.material.name}</th>
                <td>{visibleValue(record.impactFact)}</td>
                <td><span class={`map-fact map-fact--${record.impactFact.state}`} aria-hidden="true"></span>{record.impactFact.state}</td>
                <td>{visibleValue(record.flexibilityFact)}</td>
                <td><span class={`map-fact map-fact--${record.flexibilityFact.state}`} aria-hidden="true"></span>{record.flexibilityFact.state}</td>
                <td>{visibleValue(record.printDifficultyFact)}</td>
                <td>{diagramState(record)}</td>
                <td><a href={record.material.href}>Open material reference</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
