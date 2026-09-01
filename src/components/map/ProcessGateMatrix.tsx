/** @jsxImportSource preact */
import type { JSX } from "preact";

import type { MapSelectionAction } from "../../features/map/contracts.ts";
import type { buildMapView } from "../../features/map/state.ts";
import { SelectedRecord } from "./SelectedRecord.tsx";

export type MapViewModel = ReturnType<typeof buildMapView>;
export type MapDispatch = (action: MapSelectionAction) => void;

type Props = Readonly<{ view: MapViewModel; dispatch: MapDispatch }>;

function relationshipKey(laneId: string, gateId: string): string {
  return `${laneId}\u0000${gateId}`;
}

/** Complete lane-by-gate renderer. Cells express references, never printer capability. */
export function ProcessGateMatrix({ view, dispatch }: Props) {
  const model = view.processGates;
  const laneDetails = new Map(view.decisionPaths.lanes.map((lane) => [lane.id, lane]));
  const relationships = new Map(model.relationships.map((record) => [
    relationshipKey(record.laneId, record.gateId),
    record,
  ]));
  const active = model.lockedTarget?.mode === "process-gates" ? model.lockedTarget : undefined;
  const selectedLaneId = active?.kind === "lane" ? active.id : undefined;
  const selectedGateId = active?.kind === "gate" ? active.id : undefined;

  const selectLane = (value: string) => {
    if (value === "") {
      dispatch({ type: "clear-selection", mode: "process-gates", target: "all" });
      return;
    }
    const lane = model.lanes.find(({ id }) => id === value);
    if (lane !== undefined) dispatch({ type: "select-lane", mode: "process-gates", laneId: lane.id });
  };
  const selectGate = (value: string) => {
    if (value === "") {
      dispatch({ type: "clear-selection", mode: "process-gates", target: "all" });
      return;
    }
    const gate = model.gates.find(({ id }) => id === value);
    if (gate !== undefined) dispatch({ type: "select-gate", mode: "process-gates", gateId: gate.id });
  };

  const selectedLane = selectedLaneId === undefined
    ? undefined
    : view.decisionPaths.lanes.find(({ id }) => id === selectedLaneId);
  const selectedLaneGates = selectedLaneId === undefined ? [] : model.gates.filter((gate) =>
    relationships.get(relationshipKey(selectedLaneId, gate.id))?.relationship === "applies");
  const selectedProcessLane = selectedLaneId === undefined
    ? undefined
    : model.lanes.find(({ id }) => id === selectedLaneId);
  const selectedGate = selectedGateId === undefined
    ? undefined
    : model.gates.find(({ id }) => id === selectedGateId);
  const selectedGateLanes = selectedGateId === undefined ? [] : model.lanes.flatMap((lane) => {
    if (relationships.get(relationshipKey(lane.id, selectedGateId))?.relationship !== "applies") return [];
    const detail = laneDetails.get(lane.id);
    return detail === undefined ? [] : [{ lane: detail, candidates: lane.candidates }];
  });
  const appliesCount = model.relationships.filter(({ relationship }) => relationship === "applies").length;

  return (
    <section id="process-gates" class="map-mode map-mode--process-gates" aria-labelledby="interactive-process-gates-heading">
      <header class="map-mode__header">
        <p class="technical-eyebrow">Process-gate map</p>
        <h2 id="interactive-process-gates-heading">Which process checks connect to each decision lane?</h2>
        <p>This matrix records direct lane references. It does not evaluate a printer or user capability.</p>
      </header>

      <form class="map-controls" onSubmit={(event: JSX.TargetedSubmitEvent<HTMLFormElement>) => event.preventDefault()}>
        <label>
          <span>Highlight a decision lane</span>
          <select
            aria-label="Highlight a decision lane"
            value={selectedLaneId ?? ""}
            onChange={(event: JSX.TargetedEvent<HTMLSelectElement>) => selectLane(event.currentTarget.value)}
          >
            <option value="">No decision lane selected</option>
            {model.lanes.map((lane) => <option key={lane.id} value={lane.id}>{lane.label}</option>)}
          </select>
        </label>
        <label>
          <span>Highlight a process gate</span>
          <select
            aria-label="Highlight a process gate"
            value={selectedGateId ?? ""}
            onChange={(event: JSX.TargetedEvent<HTMLSelectElement>) => selectGate(event.currentTarget.value)}
          >
            <option value="">No process gate selected</option>
            {model.gates.map((gate) => <option key={gate.id} value={gate.id}>{gate.label}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => dispatch({
          type: "clear-selection", mode: "process-gates", target: "all",
        })}>Clear gate highlight</button>
      </form>

      <p class="map-current-state">
        8 decision lanes × 8 process gates = 64 direct checks. {appliesCount} apply; {64 - appliesCount} are not listed.
      </p>
      <div class="map-legend" aria-label="Process-gate relationship legend">
        <span><span class="map-mark map-mark--applies" aria-hidden="true">✓</span> Applies — verify this gate</span>
        <span><span class="map-mark map-mark--not-listed" aria-hidden="true">○</span> Not listed for this lane</span>
        <span><span class="map-mark map-mark--selected" aria-hidden="true"></span> Selected</span>
      </div>

      <div class="map-horizontal-scroll" role="region" aria-label="Lane by process-gate matrix" tabIndex={0}>
        <p class="map-scroll-instruction">Scroll horizontally to inspect all eight process gates.</p>
        <table class="gate-matrix">
          <caption>Complete direct-reference matrix</caption>
          <thead>
            <tr>
              <th scope="col">Decision lane and candidates</th>
              {model.gates.map((gate) => (
                <th id={gate.id} scope="col" class={selectedGateId === gate.id ? "is-selected" : undefined} key={gate.id}>
                  {gate.label}{selectedGateId === gate.id && <span class="map-selected-text"> Selected</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.lanes.map((lane) => (
              <tr data-gate-row="true" class={selectedLaneId === lane.id ? "is-selected" : undefined} key={lane.id}>
                <th scope="row">
                  <a href={lane.href}>{lane.label}</a>
                  <span>{lane.candidates.length} live {lane.candidates.length === 1 ? "candidate" : "candidates"}</span>
                  {selectedLaneId === lane.id && <span class="map-selected-text">Selected</span>}
                </th>
                {model.gates.map((gate) => {
                  const relationship = relationships.get(relationshipKey(lane.id, gate.id))!;
                  const selected = selectedLaneId === lane.id || selectedGateId === gate.id;
                  return (
                    <td key={gate.id} class={selected ? "is-selected" : undefined}>
                      <button
                        type="button"
                        tabIndex={-1}
                        data-gate-cell={true}
                        data-gate-id={gate.id}
                        data-lane-id={lane.id}
                        aria-label={`${lane.label}; ${gate.label}; ${relationship.label}. Highlight this process gate.`}
                        aria-pressed={selectedGateId === gate.id}
                        onPointerDown={(event: JSX.TargetedPointerEvent<HTMLButtonElement>) => event.preventDefault()}
                        onClick={() => dispatch({ type: "select-gate", mode: "process-gates", gateId: gate.id })}
                      >
                        <span class={`map-mark map-mark--${relationship.relationship}`} aria-hidden="true">
                          {relationship.relationship === "applies" ? "✓" : "○"}
                        </span>
                        <span>{relationship.label}</span>
                        {selected && <span class="map-selected-text">Selected</span>}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedLane !== undefined && selectedProcessLane !== undefined && (
        <SelectedRecord
          kind="process-lane"
          lane={selectedLane}
          gates={selectedLaneGates}
          candidates={selectedProcessLane.candidates}
        />
      )}
      {selectedGate !== undefined && (
        <SelectedRecord kind="process-gate" gate={selectedGate} lanes={selectedGateLanes} />
      )}

      <section class="map-structured-alternative" aria-labelledby="gate-alternative-heading">
        <h3 id="gate-alternative-heading">Process-gate relationships by decision lane</h3>
        <p>This stacked reading view contains the same 64 direct checks as the matrix.</p>
        <ol>
          {model.lanes.map((lane) => {
            const detail = laneDetails.get(lane.id);
            return (
              <li key={lane.id}>
                <h4><a href={lane.href}>{lane.label}</a></h4>
                {detail !== undefined && <p><strong>Need:</strong> {detail.need}</p>}
                <p>{lane.candidates.length} live {lane.candidates.length === 1 ? "candidate" : "candidates"}</p>
                <ul class="map-candidate-links">
                  {lane.candidates.map((candidate) => (
                    <li key={candidate.id}><a href={candidate.href}>{candidate.name}</a></li>
                  ))}
                </ul>
                <dl>
                  {model.gates.map((gate) => {
                    const relationship = relationships.get(relationshipKey(lane.id, gate.id))!;
                    return (
                      <div data-stacked-relationship="true" key={gate.id}>
                        <dt><a href={gate.href}>{gate.label}</a></dt>
                        <dd>
                          <strong>{relationship.label}.</strong> Requirement: {gate.requirement} Verification: {gate.verification}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </li>
            );
          })}
        </ol>
      </section>
    </section>
  );
}
