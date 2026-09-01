/** @jsxImportSource preact */
import type { JSX } from "preact";

import type {
  MapDecisionLane,
  MapMaterialReference,
  MapSelectionAction,
} from "../../features/map/contracts.ts";
import type { buildMapView } from "../../features/map/state.ts";

type MapViewModel = ReturnType<typeof buildMapView>;
type MapDispatch = (action: MapSelectionAction) => void;
type Props = Readonly<{ view: MapViewModel; dispatch: MapDispatch }>;

function plural(count: number, singular: string, multiple = `${singular}s`): string {
  return count === 1 ? singular : multiple;
}

function candidateTarget(lane: MapDecisionLane, candidate: MapMaterialReference) {
  return {
    kind: "material" as const,
    mode: "decision-paths" as const,
    laneId: lane.id,
    id: candidate.id,
  };
}

function CandidateControl({
  lane,
  candidate,
  selected,
  dispatch,
}: Readonly<{
  lane: MapDecisionLane;
  candidate: MapMaterialReference;
  selected: boolean;
  dispatch: MapDispatch;
}>) {
  const target = candidateTarget(lane, candidate);
  const select = () => dispatch({
    type: "select-material",
    mode: "decision-paths",
    laneId: lane.id,
    materialId: candidate.id,
  });
  return (
    <li class={`decision-candidate${selected ? " is-selected" : ""}`}>
      <button
        type="button"
        data-candidate-control={true}
        data-material-id={candidate.id}
        aria-pressed={selected}
        onFocus={() => dispatch({
          type: "preview-selection",
          mode: "decision-paths",
          source: "focus",
          target,
        })}
        onBlur={() => dispatch({ type: "clear-preview", mode: "decision-paths", source: "focus" })}
        onMouseEnter={() => dispatch({
          type: "preview-selection",
          mode: "decision-paths",
          source: "hover",
          target,
        })}
        onMouseLeave={() => dispatch({ type: "clear-preview", mode: "decision-paths", source: "hover" })}
        onClick={select}
      >
        Highlight {candidate.name} in {lane.label}
        {selected && <span class="map-selected-text"> Selected</span>}
      </button>
      <a href={candidate.href}>Open material reference</a>
    </li>
  );
}

function CandidateControls({ lane, selectedId, dispatch }: Readonly<{
  lane: MapDecisionLane;
  selectedId: MapMaterialReference["id"] | undefined;
  dispatch: MapDispatch;
}>) {
  if (lane.candidates.length === 0) {
    return (
      <div class="map-empty-state">
        <h4>No live candidates satisfy this lane rule</h4>
        <p>The canonical rule returned no material candidates. Review the lane method before publication.</p>
      </div>
    );
  }
  return (
    <>
      <ol class="map-candidate-controls">
        {lane.visibleCandidates.map((candidate) => CandidateControl({
          lane,
          candidate,
          selected: selectedId === candidate.id,
          dispatch,
        }))}
      </ol>
      {lane.overflowCandidates.length > 0 && (
        <details class="map-candidate-overflow">
          <summary>More live candidates ({lane.overflowCandidates.length})</summary>
          <ol start={lane.visibleCandidates.length + 1}>
            {lane.overflowCandidates.map((candidate) => CandidateControl({
              lane,
              candidate,
              selected: selectedId === candidate.id,
              dispatch,
            }))}
          </ol>
        </details>
      )}
    </>
  );
}

function DecisionDiagram({ lane, selectedId, dispatch }: Readonly<{
  lane: MapDecisionLane;
  selectedId: MapMaterialReference["id"] | undefined;
  dispatch: MapDispatch;
}>) {
  const candidates = lane.candidates;
  const width = Math.max(360, candidates.length * 42 + 48);
  return (
    <svg
      class="decision-path-diagram"
      viewBox={`0 0 ${width} 64`}
      aria-hidden="true"
      focusable="false"
    >
      <path class="decision-path-diagram__line" d={`M 24 32 H ${width - 24}`} />
      {candidates.map((candidate, index) => {
        const x = 24 + index * 42;
        const selected = candidate.id === selectedId;
        return (
          <g
            key={candidate.id}
            data-candidate-mark={true}
            data-material-id={candidate.id}
            class={`decision-path-mark${selected ? " is-selected" : ""}`}
            onPointerDown={(event: JSX.TargetedPointerEvent<SVGGElement>) => event.preventDefault()}
            onClick={() => dispatch({
              type: "select-material",
              mode: "decision-paths",
              laneId: lane.id,
              materialId: candidate.id,
            })}
          >
            {selected && <circle class="decision-path-mark__selection" cx={x} cy="32" r="12" />}
            <circle class="decision-path-mark__shape" cx={x} cy="32" r="6" />
          </g>
        );
      })}
    </svg>
  );
}

/** Eight complete canonical paths rendered from the immutable map presentation. */
export function DecisionPaths({ view, dispatch }: Props) {
  const active = view.decisionPaths.activeTarget?.mode === "decision-paths"
    ? view.decisionPaths.activeTarget
    : undefined;
  const selectedLaneId = active?.kind === "lane" || active?.kind === "material" ? active.id : undefined;
  const selectedMaterialId = active?.kind === "material" ? active.id : undefined;
  const effectiveLaneId = active?.kind === "material" ? active.laneId : selectedLaneId;

  return (
    <section id="decision-paths" class="map-mode map-mode--decision-paths" aria-labelledby="interactive-decision-paths-heading">
      <header class="map-mode__header">
        <p class="technical-eyebrow">Decision paths</p>
        <h2 id="interactive-decision-paths-heading">Follow a need through properties, candidates, and process gates</h2>
        <p>Choose one of eight needs to inspect the canonical rule, all live candidates, and every linked process gate.</p>
      </header>

      <nav class="decision-lane-index" aria-label="Decision lane index">
        <ol>
          {view.decisionPaths.lanes.map((lane, index) => {
            const selected = effectiveLaneId === lane.id;
            return (
              <li class={index === 0 && effectiveLaneId === undefined ? "is-initial-focus" : undefined} key={lane.id}>
                <a href={lane.href}>
                  {lane.label}: {lane.candidates.length} live {plural(lane.candidates.length, "candidate")}, {lane.processGates.length} {plural(lane.processGates.length, "gate")}
                </a>
                <button
                  type="button"
                  data-lane-control={true}
                  aria-pressed={selected}
                  onClick={() => dispatch({ type: "select-lane", mode: "decision-paths", laneId: lane.id })}
                >
                  Highlight {lane.label}
                  {selected && <span class="map-selected-text"> Selected decision lane</span>}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <button
        type="button"
        class="map-clear-selection"
        onClick={() => dispatch({ type: "clear-selection", mode: "decision-paths", target: "all" })}
      >Clear lane highlight</button>

      <ol class="decision-path-list">
        {view.decisionPaths.lanes.map((lane) => {
          const selected = effectiveLaneId === lane.id;
          const candidateSelectedId = selected ? selectedMaterialId : undefined;
          return (
            <li
              id={lane.id}
              data-decision-lane={true}
              data-lane-id={lane.id}
              class={`decision-path${selected ? " is-selected" : ""}`}
              key={lane.id}
            >
              <header>
                <p class="technical-eyebrow">Decision lane</p>
                <h3>{lane.label}</h3>
                <p>{lane.candidates.length} live {plural(lane.candidates.length, "candidate")}; {lane.processGates.length} {plural(lane.processGates.length, "process gate")}</p>
                {selected && <p class="map-state-label">Selected decision lane</p>}
              </header>

              <div class="map-horizontal-scroll" role="region" aria-label={`${lane.label} candidate path`} tabIndex={0}>
                <p class="map-scroll-instruction">Scroll horizontally to inspect every candidate mark.</p>
                {DecisionDiagram({ lane, selectedId: candidateSelectedId, dispatch })}
              </div>

              <ol class="decision-path__stages">
                <li data-decision-stage={true}>
                  <h4><span aria-hidden="true">1</span> Need</h4>
                  <p>{lane.need}</p>
                </li>
                <li data-decision-stage={true}>
                  <h4><span aria-hidden="true">2</span> Properties to check</h4>
                  <ul>{lane.propertyChecks.map((property) => <li key={property.field}>{property.label}</li>)}</ul>
                </li>
                <li data-decision-stage={true}>
                  <h4><span aria-hidden="true">3</span> Live candidates</h4>
                  {CandidateControls({ lane, selectedId: candidateSelectedId, dispatch })}
                </li>
                <li data-decision-stage={true}>
                  <h4><span aria-hidden="true">4</span> Verify and process gates</h4>
                  <ul>
                    {lane.verification.map((statement) => <li key={statement}>{statement}</li>)}
                  </ul>
                  {lane.processGates.length === 0 ? <p>No additional process gate is listed for this lane.</p> : (
                    <dl>
                      {lane.processGates.map((gate) => (
                        <div key={gate.id}>
                          <dt><a href={gate.href}>{gate.label}</a></dt>
                          <dd>{gate.requirement} {gate.verification}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </li>
              </ol>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
