/** @jsxImportSource preact */
import type { JSX } from "preact";

import type {
  MapDisplayFact,
  MapInternalHref,
  MapNamedThermalRecord,
  MapSelectionAction,
  MapServiceGuidanceRecord,
  MapServiceMeasurement,
  MapThermalMember,
} from "../../features/map/contracts.ts";
import type { buildMapView } from "../../features/map/state.ts";

type MapViewModel = ReturnType<typeof buildMapView>;
type MapDispatch = (action: MapSelectionAction) => void;
type Props = Readonly<{
  view: MapViewModel;
  dispatch: MapDispatch;
  methodHref: MapInternalHref;
}>;

const CAUTION =
  "Practical service guidance, Tg, HDT, Vicat softening, melting point, and other named tests answer different questions. Compare only matching metric and method groups.";
const SERVICE_LABEL = "Practical service guidance";

function factState(fact: MapDisplayFact): string {
  switch (fact.state) {
    case "known":
      return "Known";
    case "conditional":
      return "Conditional";
    case "unknown":
      return "Unknown";
    case "not-applicable":
      return "Not applicable";
    case "missing":
      return "Not reported";
  }
}

function measurementValue(measurement: MapServiceMeasurement | undefined): string {
  if (measurement === undefined) return "—";
  return measurement.shape === "point"
    ? String(measurement.value)
    : `${measurement.low}–${measurement.high}`;
}

function measurementUnit(measurement: MapServiceMeasurement | undefined): string {
  return measurement === undefined ? "—" : "°C";
}

function disposition(
  record: Readonly<{ disposition: MapServiceGuidanceRecord["disposition"] }>,
): string {
  if (record.disposition.disposition === "plotted") return "Plotted";
  if (record.disposition.disposition === "filtered") return "Filtered from the diagram";
  return `Not plotted — ${record.disposition.reason}`;
}

function evidenceScopes(
  record: Readonly<{ evidence: MapServiceGuidanceRecord["evidence"] }>,
): string {
  return record.evidence.scopeLabels.length === 0
    ? "Not reported"
    : record.evidence.scopeLabels.join("; ");
}

function qualification(
  record: Readonly<{ evidence: MapServiceGuidanceRecord["evidence"] }>,
): string {
  return record.evidence.qualification ?? "No separate qualification is reported.";
}

function selectThermalMaterial(
  dispatch: MapDispatch,
  materialId: MapServiceGuidanceRecord["material"]["id"],
): void {
  dispatch({ type: "select-material", mode: "thermal-ranges", materialId });
}

function previewHandlers(
  dispatch: MapDispatch,
  materialId: MapServiceGuidanceRecord["material"]["id"],
) {
  const target = { kind: "material" as const, mode: "thermal-ranges" as const, id: materialId };
  return {
    onFocus: () =>
      dispatch({ type: "preview-selection", mode: "thermal-ranges", source: "focus", target }),
    onBlur: () => dispatch({ type: "clear-preview", mode: "thermal-ranges", source: "focus" }),
    onMouseEnter: () =>
      dispatch({ type: "preview-selection", mode: "thermal-ranges", source: "hover", target }),
    onMouseLeave: () =>
      dispatch({ type: "clear-preview", mode: "thermal-ranges", source: "hover" }),
  };
}

function ThermalControls({
  view,
  dispatch,
}: Readonly<{ view: MapViewModel; dispatch: MapDispatch }>) {
  const thermal = view.thermal;
  const setView = (next: "service-guidance" | "named-observations", checked: boolean) => {
    if (checked) dispatch({ type: "set-thermal-view", mode: "thermal-ranges", view: next });
  };
  return (
    <form
      class="map-controls thermal-controls"
      onSubmit={(event: JSX.TargetedSubmitEvent<HTMLFormElement>) => event.preventDefault()}
    >
      <fieldset>
        <legend>Thermal view</legend>
        <label>
          <input
            type="radio"
            name="thermal-view"
            data-thermal-view="service-guidance"
            checked={thermal.view === "service-guidance"}
            onChange={(event: JSX.TargetedEvent<HTMLInputElement>) =>
              setView("service-guidance", event.currentTarget.checked)
            }
          />
          Practical service guidance
        </label>
        <label>
          <input
            type="radio"
            name="thermal-view"
            data-thermal-view="named-observations"
            checked={thermal.view === "named-observations"}
            onChange={(event: JSX.TargetedEvent<HTMLInputElement>) =>
              setView("named-observations", event.currentTarget.checked)
            }
          />
          Named thermal observations
        </label>
      </fieldset>

      <label>
        <span>Find a material in this thermal view</span>
        <input
          type="search"
          aria-label="Find a material in this thermal view"
          value={thermal.query}
          onInput={(event: JSX.TargetedInputEvent<HTMLInputElement>) =>
            dispatch({
              type: "set-search",
              target: "thermal",
              query: event.currentTarget.value,
            })
          }
        />
      </label>

      {thermal.view === "service-guidance" ? (
        <label>
          <span>Service guidance order</span>
          <select
            aria-label="Service guidance order"
            value={thermal.serviceSort}
            onChange={(event: JSX.TargetedEvent<HTMLSelectElement>) => {
              const value = event.currentTarget.value;
              if (value === "canonical" || value === "low-endpoint" || value === "high-endpoint") {
                dispatch({ type: "set-service-sort", sort: value });
              }
            }}
          >
            <option value="canonical">Canonical material order</option>
            <option value="low-endpoint">Low endpoint</option>
            <option value="high-endpoint">High endpoint</option>
          </select>
        </label>
      ) : (
        <label>
          <span>Named metric and method group</span>
          <select
            aria-label="Named metric and method group"
            value={thermal.selectedGroup?.id ?? ""}
            onChange={(event: JSX.TargetedEvent<HTMLSelectElement>) => {
              const group = thermal.groups.find(({ id }) => id === event.currentTarget.value);
              if (group !== undefined)
                dispatch({
                  type: "select-thermal-group",
                  mode: "thermal-ranges",
                  groupId: group.id,
                });
            }}
          >
            <option value="">Choose a metric and method group</option>
            {thermal.groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.metricLabel} — {group.methodLabel}
              </option>
            ))}
          </select>
        </label>
      )}

      <button
        type="button"
        data-thermal-reset={true}
        onClick={() => dispatch({ type: "reset-view", mode: "thermal-ranges" })}
      >
        Clear thermal filters
      </button>
    </form>
  );
}

function ServiceDiagram({
  view,
  dispatch,
}: Readonly<{ view: MapViewModel; dispatch: MapDispatch }>) {
  const { domain, ticks, serviceRecords, activeTarget } = view.thermal;
  const selectedId = activeTarget?.kind === "material" ? activeTarget.id : undefined;
  const left = 184;
  const plotWidth = 640;
  const rowHeight = 44;
  const height = 56 + serviceRecords.length * rowHeight;
  const position = (value: number) =>
    left + ((value - domain.low) / (domain.high - domain.low)) * plotWidth;
  return (
    <svg
      data-service-diagram={true}
      class="thermal-service-diagram"
      viewBox={`0 0 860 ${height}`}
      aria-hidden="true"
      focusable="false"
    >
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            class="thermal-axis-grid"
            x1={position(tick)}
            y1="32"
            x2={position(tick)}
            y2={height - 12}
          />
          <text x={position(tick)} y="22" text-anchor="middle">
            {tick} °C
          </text>
        </g>
      ))}
      {serviceRecords.map((record, index) => {
        const y = 52 + index * rowHeight;
        const selected = selectedId === record.material.id;
        const filtered = record.disposition.disposition === "filtered";
        const measurement = record.measurement;
        const low = measurement?.shape === "interval" ? measurement.low : measurement?.value;
        const high = measurement?.shape === "interval" ? measurement.high : measurement?.value;
        return (
          <g
            key={record.material.id}
            data-service-mark={true}
            data-material-id={record.material.id}
            class={`thermal-service-mark${selected ? " is-selected" : ""}${filtered ? " is-filtered" : ""}`}
            onPointerDown={(event: JSX.TargetedPointerEvent<SVGGElement>) => event.preventDefault()}
            onClick={() => selectThermalMaterial(dispatch, record.material.id)}
          >
            <text x={left - 12} y={y + 5} text-anchor="end">
              {record.material.name}
            </text>
            {low !== undefined && high !== undefined && (
              <>
                {selected && (
                  <line
                    class="thermal-service-mark__selection"
                    x1={position(low) - 4}
                    y1={y}
                    x2={position(high) + 4}
                    y2={y}
                  />
                )}
                <line
                  class={`thermal-service-mark__interval${record.fact.state === "conditional" ? " is-conditional" : ""}`}
                  x1={position(low)}
                  y1={y}
                  x2={position(high)}
                  y2={y}
                />
                <line
                  class="thermal-service-mark__cap"
                  x1={position(low)}
                  y1={y - 7}
                  x2={position(low)}
                  y2={y + 7}
                />
                <line
                  class="thermal-service-mark__cap"
                  x1={position(high)}
                  y1={y - 7}
                  x2={position(high)}
                  y2={y + 7}
                />
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function ServiceSelected({
  record,
  methodHref,
}: Readonly<{
  record: MapServiceGuidanceRecord;
  methodHref: MapInternalHref;
}>) {
  return (
    <section class="map-selected-record" aria-labelledby="selected-service-heading" aria-live="off">
      <p class="technical-eyebrow">Selected practical service record</p>
      <h3 id="selected-service-heading">{record.material.name}</h3>
      <dl>
        <div>
          <dt>State</dt>
          <dd>{factState(record.fact)}</dd>
        </div>
        <div>
          <dt>Value</dt>
          <dd>
            {measurementValue(record.measurement)} {measurementUnit(record.measurement)}
          </dd>
        </div>
        <div>
          <dt>Guidance</dt>
          <dd>{SERVICE_LABEL}</dd>
        </div>
        <div>
          <dt>Qualification</dt>
          <dd>{qualification(record)}</dd>
        </div>
        <div>
          <dt>Evidence scope</dt>
          <dd>{evidenceScopes(record)}</dd>
        </div>
        <div>
          <dt>Diagram state</dt>
          <dd>{disposition(record)}</dd>
        </div>
      </dl>
      <p>
        <a href={record.material.href}>Open material reference</a>
      </p>
      <p>
        <a href={methodHref}>Review method and thermal definitions</a>
      </p>
    </section>
  );
}

function ServiceView({ view, dispatch, methodHref }: Props) {
  const records = view.thermal.serviceRecords;
  const activeId =
    view.thermal.activeTarget?.kind === "material" ? view.thermal.activeTarget.id : undefined;
  const selectedId =
    view.thermal.lockedTarget?.kind === "material" ? view.thermal.lockedTarget.id : undefined;
  const selected =
    selectedId === undefined
      ? undefined
      : records.find(({ material }) => material.id === selectedId);
  const omitted = records.filter(({ disposition: state }) => state.disposition === "omitted");
  const plotted = records.filter(
    ({ disposition: state }) => state.disposition === "plotted",
  ).length;
  const filtered = records.filter(
    ({ disposition: state }) => state.disposition === "filtered",
  ).length;
  return (
    <div class="thermal-view thermal-view--service">
      <p class="map-current-state" aria-live="off">
        {plotted} records plotted; {filtered} filtered from the diagram; {omitted.length} not
        plotted.
      </p>
      <div class="map-legend" aria-label="Practical service guidance legend">
        <span>
          <span class="map-mark map-mark--service-interval" aria-hidden="true"></span> Practical
          service interval
        </span>
        <span>
          <span class="map-mark map-mark--conditional" aria-hidden="true">
            !
          </span>{" "}
          Conditional — review conditions
        </span>
        <span>
          <span class="map-mark map-mark--selected" aria-hidden="true"></span> Selected
        </span>
      </div>
      <div
        class="map-horizontal-scroll"
        role="region"
        aria-label="Practical service guidance diagram"
        tabIndex={0}
      >
        <p class="map-scroll-instruction">
          Scroll horizontally to inspect the Celsius axis and all interval endpoints.
        </p>
        {ServiceDiagram({ view, dispatch })}
      </div>
      <section class="map-material-controls" aria-labelledby="service-material-controls-heading">
        <h3 id="service-material-controls-heading">Ordered practical service controls</h3>
        <ol>
          {records.map((record) => (
            <li key={record.material.id}>
              <button
                type="button"
                data-service-control={true}
                data-material-id={record.material.id}
                aria-pressed={selectedId === record.material.id}
                data-previewed={
                  activeId === record.material.id && selectedId !== record.material.id
                }
                {...previewHandlers(dispatch, record.material.id)}
                onClick={() => selectThermalMaterial(dispatch, record.material.id)}
              >
                Highlight {record.material.name}. {disposition(record)}
              </button>
            </li>
          ))}
        </ol>
      </section>
      {selected !== undefined && ServiceSelected({ record: selected, methodHref })}
      {omitted.length > 0 && (
        <section class="map-omissions" aria-labelledby="service-omissions-heading">
          <h3 id="service-omissions-heading">Not plotted in this service-guidance view</h3>
          <ul>
            {omitted.map((record) => (
              <li key={record.material.id}>
                <a href={record.material.href}>{record.material.name}</a>: {disposition(record)}
              </li>
            ))}
          </ul>
        </section>
      )}
      <div
        class="map-horizontal-scroll"
        role="region"
        aria-label="Complete practical service guidance table"
        tabIndex={0}
      >
        <p class="map-scroll-instruction">Scroll horizontally to inspect every column.</p>
        <table class="thermal-table">
          <caption>Practical service guidance for every material</caption>
          <thead>
            <tr>
              <th scope="col">Material</th>
              <th scope="col">State</th>
              <th scope="col">Value</th>
              <th scope="col">Unit</th>
              <th scope="col">Metric or guidance</th>
              <th scope="col">Method and conditions</th>
              <th scope="col">Qualification</th>
              <th scope="col">Evidence scope</th>
              <th scope="col">Material reference</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr data-service-row={true} key={record.material.id}>
                <th scope="row">{record.material.name}</th>
                <td>
                  {factState(record.fact)} — {disposition(record)}
                </td>
                <td>{measurementValue(record.measurement)}</td>
                <td>{measurementUnit(record.measurement)}</td>
                <td>{SERVICE_LABEL}</td>
                <td>
                  <a href={methodHref}>Review defined method and conditions</a>
                </td>
                <td>{qualification(record)}</td>
                <td>{evidenceScopes(record)}</td>
                <td>
                  <a href={record.material.href}>Open material reference</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NamedShape({
  member,
  x,
  y,
}: Readonly<{ member: MapThermalMember; x: number; y: number }>) {
  const className = `thermal-named-mark__shape thermal-named-mark__shape--${member.metric}`;
  if (member.metric === "glass-transition") return <circle class={className} cx={x} cy={y} r="7" />;
  if (member.metric === "heat-deflection")
    return <rect class={className} x={x - 7} y={y - 7} width="14" height="14" />;
  if (member.metric === "vicat-softening")
    return (
      <polygon
        class={className}
        points={`${x},${y - 9} ${x + 9},${y} ${x},${y + 9} ${x - 9},${y}`}
      />
    );
  if (member.metric === "melting-point")
    return (
      <polygon class={className} points={`${x},${y - 9} ${x + 9},${y + 8} ${x - 9},${y + 8}`} />
    );
  return (
    <path
      class={className}
      d={`M ${x - 7} ${y - 7} L ${x + 7} ${y + 7} M ${x + 7} ${y - 7} L ${x - 7} ${y + 7}`}
    />
  );
}

function NamedDiagram({
  records,
  dispatch,
}: Readonly<{ records: readonly MapNamedThermalRecord[]; dispatch: MapDispatch }>) {
  const members = records.flatMap((record) =>
    record.disposition.disposition === "plotted" && record.member !== undefined
      ? [record.member]
      : [],
  );
  const rowHeight = 48;
  return (
    <svg
      data-named-diagram={true}
      class="thermal-named-diagram"
      viewBox={`0 0 860 ${Math.max(72, members.length * rowHeight + 40)}`}
      aria-hidden="true"
      focusable="false"
    >
      {members.map((member, index) => {
        const y = 28 + index * rowHeight;
        return (
          <g
            key={member.material.id}
            data-named-mark={true}
            data-material-id={member.material.id}
            onPointerDown={(event: JSX.TargetedPointerEvent<SVGGElement>) => event.preventDefault()}
            onClick={() => selectThermalMaterial(dispatch, member.material.id)}
          >
            {NamedShape({ member, x: 184, y })}
            <text x="206" y={y + 5}>
              {member.material.name}: {member.fact.display.join(" — ")}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function NamedSelected({
  record,
  methodHref,
}: Readonly<{ record: MapNamedThermalRecord; methodHref: MapInternalHref }>) {
  const member = record.member;
  return (
    <section class="map-selected-record" aria-labelledby="selected-named-heading" aria-live="off">
      <p class="technical-eyebrow">Selected named thermal record</p>
      <h3 id="selected-named-heading">{record.material.name}</h3>
      {member === undefined ? (
        <p>No observation in this metric and method group.</p>
      ) : (
        <dl>
          <div>
            <dt>State</dt>
            <dd>{factState(member.fact)}</dd>
          </div>
          <div>
            <dt>Value</dt>
            <dd>
              {measurementValue(member.measurement)} {measurementUnit(member.measurement)}
            </dd>
          </div>
          <div>
            <dt>Metric</dt>
            <dd>{member.metricLabel}</dd>
          </div>
          <div>
            <dt>Method and conditions</dt>
            <dd>{member.methodLabel}</dd>
          </div>
          <div>
            <dt>Qualification</dt>
            <dd>{qualification(member)}</dd>
          </div>
          <div>
            <dt>Evidence scope</dt>
            <dd>{evidenceScopes(member)}</dd>
          </div>
        </dl>
      )}
      <p>
        <a href={record.material.href}>Open material reference</a>
      </p>
      <p>
        <a href={methodHref}>Review method and thermal definitions</a>
      </p>
    </section>
  );
}

function NamedView({ view, dispatch, methodHref }: Props) {
  const group = view.thermal.selectedGroup;
  if (group === undefined) {
    return (
      <section class="map-recovery" aria-labelledby="named-group-required-heading">
        <h3 id="named-group-required-heading">
          Choose a named metric and method group to inspect its records.
        </h3>
        <p>Each group preserves one exact metric and represented method identity.</p>
      </section>
    );
  }
  const records = view.thermal.namedRecords;
  const activeId =
    view.thermal.activeTarget?.kind === "material" ? view.thermal.activeTarget.id : undefined;
  const selectedId =
    view.thermal.lockedTarget?.kind === "material" ? view.thermal.lockedTarget.id : undefined;
  const selected =
    selectedId === undefined
      ? undefined
      : records.find(({ material }) => material.id === selectedId);
  const plotted = records.filter(({ disposition: state }) => state.disposition === "plotted");
  const filtered = records.filter(({ disposition: state }) => state.disposition === "filtered");
  const omitted = records.filter(({ disposition: state }) => state.disposition === "omitted");
  const visibleControls = records.filter(
    ({ disposition: state }) => state.disposition !== "filtered",
  );
  return (
    <div class="thermal-view thermal-view--named">
      <p class="map-current-state" aria-live="off">
        {plotted.length} {plotted.length === 1 ? "observation" : "observations"} plotted;{" "}
        {filtered.length} filtered from the diagram and controls; {omitted.length} materials have no
        observation in the group. All {records.length} records remain in the table.
      </p>
      <div class="map-legend" aria-label="Named thermal observation legend">
        <span>
          <span class={`map-mark map-mark--thermal-${group.metric}`} aria-hidden="true"></span>
          {group.metricLabel}
        </span>
        <span>Method and conditions: {group.methodLabel}</span>
      </div>
      <div
        class="map-horizontal-scroll"
        role="region"
        aria-label={`${group.metricLabel} named observation diagram`}
        tabIndex={0}
      >
        <p class="map-scroll-instruction">
          Scroll horizontally to inspect complete observation labels.
        </p>
        {NamedDiagram({ records, dispatch })}
      </div>
      <section class="map-material-controls" aria-labelledby="named-material-controls-heading">
        <h3 id="named-material-controls-heading">Ordered named observation controls</h3>
        <ol>
          {visibleControls.map((record) => (
            <li key={record.material.id}>
              <button
                type="button"
                data-named-control={true}
                data-material-id={record.material.id}
                aria-pressed={selectedId === record.material.id}
                data-previewed={
                  activeId === record.material.id && selectedId !== record.material.id
                }
                {...previewHandlers(dispatch, record.material.id)}
                onClick={() => selectThermalMaterial(dispatch, record.material.id)}
              >
                Highlight {record.material.name}.{" "}
                {record.member === undefined
                  ? "No observation in this metric and method group"
                  : factState(record.member.fact)}
              </button>
            </li>
          ))}
        </ol>
      </section>
      {selected !== undefined && NamedSelected({ record: selected, methodHref })}
      {omitted.length > 0 && (
        <section class="map-omissions" aria-labelledby="named-omissions-heading">
          <h3 id="named-omissions-heading">Not plotted in this named metric and method group</h3>
          <ul>
            {omitted.map((record) => (
              <li key={record.material.id}>
                <a href={record.material.href}>{record.material.name}</a>: No observation in this
                metric and method group
              </li>
            ))}
          </ul>
        </section>
      )}
      <div
        class="map-horizontal-scroll"
        role="region"
        aria-label="Complete named thermal observation table"
        tabIndex={0}
      >
        <p class="map-scroll-instruction">Scroll horizontally to inspect every column.</p>
        <table class="thermal-table">
          <caption>
            {group.metricLabel} — {group.methodLabel}; every material is retained
          </caption>
          <thead>
            <tr>
              <th scope="col">Material</th>
              <th scope="col">State</th>
              <th scope="col">Value</th>
              <th scope="col">Unit</th>
              <th scope="col">Metric or guidance</th>
              <th scope="col">Method and conditions</th>
              <th scope="col">Qualification</th>
              <th scope="col">Evidence scope</th>
              <th scope="col">Diagram state</th>
              <th scope="col">Material reference</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => {
              const member = record.member;
              return (
                <tr data-named-row={true} key={record.material.id}>
                  <th scope="row">{record.material.name}</th>
                  <td>
                    {member === undefined
                      ? "No observation in this metric and method group"
                      : factState(member.fact)}
                  </td>
                  <td>{measurementValue(member?.measurement)}</td>
                  <td>{measurementUnit(member?.measurement)}</td>
                  <td>{member?.metricLabel ?? group.metricLabel}</td>
                  <td>{member?.methodLabel ?? group.methodLabel}</td>
                  <td>
                    {member === undefined
                      ? "View absence; canonical fact state is unchanged."
                      : qualification(member)}
                  </td>
                  <td>
                    {member === undefined
                      ? "Not applicable to this view absence"
                      : evidenceScopes(member)}
                  </td>
                  <td>{disposition(record)}</td>
                  <td>
                    <a href={record.material.href}>Open material reference</a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Separate service-guidance and exact named-test views from one immutable presentation. */
export function ThermalGuidance(props: Props) {
  return (
    <section
      id="thermal-ranges"
      class="map-mode map-mode--thermal"
      aria-labelledby="interactive-thermal-heading"
    >
      <header class="map-mode__header">
        <p class="technical-eyebrow">Thermal guidance</p>
        <h2 id="interactive-thermal-heading">Thermal guidance by defined concept</h2>
        <p class="map-caution">
          <strong>Compare defined concepts only.</strong> {CAUTION}
        </p>
      </header>
      {ThermalControls({ view: props.view, dispatch: props.dispatch })}
      {props.view.thermal.view === "service-guidance" ? ServiceView(props) : NamedView(props)}
    </section>
  );
}
