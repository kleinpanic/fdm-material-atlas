/** @jsxImportSource preact */
import type {
  MapDecisionLane,
  MapImpactFlexRecord,
  MapInternalHref,
  MapMaterialReference,
  MapProcessGateReference,
} from "../../features/map/contracts.ts";

type ProcessLaneRecord = Readonly<{
  kind: "process-lane";
  lane: MapDecisionLane;
  gates: readonly MapProcessGateReference[];
  candidates: readonly MapMaterialReference[];
}>;

type ProcessGateRecord = Readonly<{
  kind: "process-gate";
  gate: MapProcessGateReference;
  lanes: readonly Readonly<{
    lane: MapDecisionLane;
    candidates: readonly MapMaterialReference[];
  }>[];
}>;

type ImpactFlexRecord = Readonly<{
  kind: "impact-flex";
  record: MapImpactFlexRecord;
  limitation: string;
  outsideFilter: boolean;
  evidenceHref?: MapInternalHref;
}>;

export type SelectedRecordProps = ProcessLaneRecord | ProcessGateRecord | ImpactFlexRecord;

function MaterialLinks({ materials }: Readonly<{ materials: readonly MapMaterialReference[] }>) {
  return (
    <ul class="map-selected-record__links">
      {materials.map((material) => (
        <li key={material.id}><a href={material.href}>{material.name}</a></li>
      ))}
    </ul>
  );
}

function FactDetail({ label, fact }: Readonly<{
  label: string;
  fact: MapImpactFlexRecord["impactFact"];
}>) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <span class={`map-fact map-fact--${fact.state}`} aria-hidden="true"></span>
        {fact.display.join(" — ")}
      </dd>
    </div>
  );
}

/** Complete visible detail for the active gate, lane, or impact/flex material. */
export function SelectedRecord(props: SelectedRecordProps) {
  if (props.kind === "process-lane") {
    return (
      <section class="map-selected-record" aria-labelledby="selected-process-lane-heading" aria-live="off">
        <p class="technical-eyebrow">Selected decision lane</p>
        <h3 id="selected-process-lane-heading">{props.lane.label}</h3>
        <p><strong>Need:</strong> {props.lane.need}</p>
        <p><strong>Selected relationship state:</strong> Selected</p>
        <h4>Direct process gates</h4>
        {props.gates.length === 0
          ? <p>No additional process gate is listed for this lane.</p>
          : (
              <dl>
                {props.gates.map((gate) => (
                  <div key={gate.id}>
                    <dt><a href={gate.href}>{gate.label}</a></dt>
                    <dd>Applies — verify this gate. {gate.requirement} {gate.verification}</dd>
                  </div>
                ))}
              </dl>
            )}
        <h4>Live candidates</h4>
        <MaterialLinks materials={props.candidates} />
      </section>
    );
  }

  if (props.kind === "process-gate") {
    return (
      <section class="map-selected-record" aria-labelledby="selected-process-gate-heading" aria-live="off">
        <p class="technical-eyebrow">Selected process gate</p>
        <h3 id="selected-process-gate-heading"><a href={props.gate.href}>{props.gate.label}</a></h3>
        <dl>
          <div><dt>Capability category</dt><dd>{props.gate.capabilityLabel}</dd></div>
          <div><dt>Requirement</dt><dd>{props.gate.requirement}</dd></div>
          <div><dt>Verification guidance</dt><dd>{props.gate.verification}</dd></div>
          <div><dt>Relationship meaning</dt><dd>Applies — verify this gate. This is not a printer capability verdict.</dd></div>
        </dl>
        <h4>Referenced lanes and their live candidates</h4>
        {props.lanes.length === 0 ? <p>No decision lane lists this process gate.</p> : (
          <ul class="map-selected-record__groups">
            {props.lanes.map(({ lane, candidates }) => (
              <li key={lane.id}>
                <h5><a href={lane.href}>{lane.label}</a></h5>
                <p>{lane.need}</p>
                <MaterialLinks materials={candidates} />
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  const { record } = props;
  return (
    <section class="map-selected-record" aria-labelledby="selected-impact-flex-heading" aria-live="off">
      <p class="technical-eyebrow">Selected material</p>
      <h3 id="selected-impact-flex-heading">{record.material.name}</h3>
      {props.outsideFilter && <p class="map-state-label">Selected record is outside the current diagram filter.</p>}
      <dl>
        <FactDetail label="Impact resistance" fact={record.impactFact} />
        <FactDetail label="Flexibility" fact={record.flexibilityFact} />
        <FactDetail label="Print difficulty" fact={record.printDifficultyFact} />
        <div>
          <dt>Diagram state</dt>
          <dd>{record.disposition.disposition === "plotted"
            ? "Plotted"
            : record.disposition.disposition === "filtered"
              ? "Filtered from the diagram"
              : `Not plotted — ${record.disposition.reason}`}</dd>
        </div>
      </dl>
      <p class="map-limitation">{props.limitation}</p>
      <p><a href={record.material.href}>Open material reference</a></p>
      {props.evidenceHref === undefined
        ? <p>No separate evidence action is available in this view.</p>
        : <p><a href={props.evidenceHref}>Review method and evidence conventions</a></p>}
    </section>
  );
}
