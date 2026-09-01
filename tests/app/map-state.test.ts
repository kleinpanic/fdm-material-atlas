import { describe, expect, it } from "vitest";

import type { MapSelectionAction } from "../../src/features/map/contracts.ts";
import { compileMapProjection } from "../../src/features/map/projection.ts";
import {
  buildMapView,
  createInitialMapState,
  createMapReducer,
  type MapState,
} from "../../src/features/map/state.ts";
import { createSafeMapReducer } from "../../src/features/map/safe-map.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";

const projection = compileMapProjection(loadPublicAtlas(), "/repo/");
const lane = projection.lanes[0]!;
const material = lane.candidates[0]!;
const gate = projection.processGates.gates[0]!;
const group = projection.thermalGroups[0]!;

function run(actions: readonly MapSelectionAction[], initial = createInitialMapState(projection)): MapState {
  return actions.reduce(createMapReducer(projection), initial);
}

describe("closed map state", () => {
  it("starts with decision paths focal, preparing status, and no implicit selection", () => {
    const state = createInitialMapState(projection);
    expect(state).toMatchObject({
      mode: "decision-paths",
      hydrated: false,
      decisionPaths: {},
      thermal: { view: "service-guidance", query: "", serviceSort: "canonical" },
      processGates: {},
      impactFlex: { query: "", difficultyShapes: false },
      announcement: "Interactive map controls are preparing. Every path and structured table is already available.",
    });
    expect(state.preview).toBeUndefined();
    expect(buildMapView(projection, state).activeTarget).toBeUndefined();
  });

  it("keeps explicit per-mode selection while mode, hydration, and reset actions share one reducer", () => {
    const selected = run([
      { type: "hydration-ready" },
      { type: "select-lane", mode: "decision-paths", laneId: lane.id },
      { type: "select-material", mode: "decision-paths", laneId: lane.id, materialId: material.id },
      { type: "set-mode", mode: "process-gates" },
      { type: "select-gate", mode: "process-gates", gateId: gate.id },
      { type: "set-mode", mode: "decision-paths" },
    ]);

    expect(selected.hydrated).toBe(true);
    expect(selected.decisionPaths).toEqual({ laneId: lane.id, materialId: material.id });
    expect(selected.processGates).toEqual({ gateId: gate.id });
    expect(buildMapView(projection, selected).activeTarget).toEqual({
      kind: "material",
      mode: "decision-paths",
      laneId: lane.id,
      id: material.id,
    });

    const reset = createMapReducer(projection)(selected, { type: "reset-view", mode: "decision-paths" });
    expect(reset.decisionPaths).toEqual({});
    expect(reset.processGates).toEqual({ gateId: gate.id });
    expect(reset.hydrated).toBe(true);
  });

  it("uses explicit preview context and restores the locked selection on matching leave", () => {
    const locked = run([
      { type: "select-lane", mode: "decision-paths", laneId: lane.id },
      { type: "select-material", mode: "decision-paths", laneId: lane.id, materialId: material.id },
    ]);
    const previewTarget = {
      kind: "gate" as const,
      mode: "process-gates" as const,
      id: gate.id,
    };
    const previewed = createMapReducer(projection)(locked, {
      type: "preview-selection",
      mode: "process-gates",
      source: "focus",
      target: previewTarget,
    });
    expect(buildMapView(projection, previewed).processGates.activeTarget).toEqual(previewTarget);

    const wrongLeave = createMapReducer(projection)(previewed, {
      type: "clear-preview", mode: "process-gates", source: "hover",
    });
    expect(wrongLeave.preview).toEqual(previewed.preview);

    const restored = createMapReducer(projection)(previewed, {
      type: "clear-preview", mode: "process-gates", source: "focus",
    });
    expect(restored.preview).toBeUndefined();
    expect(buildMapView(projection, restored).decisionPaths.activeTarget).toEqual({
      kind: "material", mode: "decision-paths", laneId: lane.id, id: material.id,
    });
  });

  it("keeps process lane and gate selection mutually exclusive", () => {
    const laneSelected = run([
      { type: "select-gate", mode: "process-gates", gateId: gate.id },
      { type: "select-lane", mode: "process-gates", laneId: lane.id },
    ]);
    expect(laneSelected.processGates).toEqual({ laneId: lane.id });

    const gateSelected = createMapReducer(projection)(laneSelected, {
      type: "select-gate", mode: "process-gates", gateId: gate.id,
    });
    expect(gateSelected.processGates).toEqual({ gateId: gate.id });
    expect(buildMapView(projection, gateSelected).processGates.context).toMatchObject({
      kind: "gate",
      gate: { id: gate.id },
    });
  });

  it("switches thermal concepts explicitly and exposes complete sorted/filterable records", () => {
    const uniqueMaterial = projection.serviceGuidance.records.find(
      ({ material: recordMaterial }) => recordMaterial.id === "material-peek",
    )!.material;
    const state = run([
      { type: "set-mode", mode: "thermal-ranges" },
      { type: "set-thermal-view", mode: "thermal-ranges", view: "named-observations" },
      { type: "select-thermal-group", mode: "thermal-ranges", groupId: group.id },
      { type: "set-service-sort", sort: "high-endpoint" },
      { type: "set-search", target: "thermal", query: uniqueMaterial.name },
    ]);
    const view = buildMapView(projection, state).thermal;
    expect(view.view).toBe("named-observations");
    expect(view.selectedGroup?.id).toBe(group.id);
    expect(view.namedRecords).toHaveLength(23);
    expect(view.namedRecords.filter(({ disposition }) => disposition.disposition === "filtered"))
      .toHaveLength(22);
    expect(view.namedRecords.find(({ material: recordMaterial }) => recordMaterial.id === uniqueMaterial.id)?.disposition)
      .not.toMatchObject({ disposition: "filtered" });
    expect(view.serviceRecords).toHaveLength(23);
    expect(view.serviceRecords.filter(({ disposition }) => disposition.disposition === "plotted"))
      .toHaveLength(1);
    const highEndpoints = view.serviceRecords.flatMap(({ measurement }) => measurement === undefined
      ? []
      : [measurement.shape === "point" ? measurement.value : measurement.high]);
    expect(highEndpoints).toEqual([...highEndpoints].sort((left, right) => left - right));
  });

  it("derives impact filters without dropping records and labels a selected filtered material", () => {
    const difficult = projection.impactFlex.records.find(({ printDifficulty }) => printDifficulty === "expert")!;
    const state = run([
      { type: "set-mode", mode: "impact-flex-space" },
      { type: "select-material", mode: "impact-flex-space", materialId: difficult.material.id },
      { type: "set-maximum-difficulty", value: "easy" },
      { type: "set-difficulty-shapes", enabled: true },
    ]);
    const view = buildMapView(projection, state).impactFlex;
    expect(view.records).toHaveLength(23);
    expect(view.query).toBe("");
    expect(view.maximumDifficulty).toBe("easy");
    expect(view.shapesEnabled).toBe(true);
    expect(view.selectedOutsideFilter).toBe(true);
    expect(view.records.find(({ material }) => material.id === difficult.material.id)?.disposition)
      .toMatchObject({ disposition: "filtered", filter: { kind: "maximum-difficulty", value: "easy" } });
  });

  it("clears stale state and filters with fixed recovery when an event ID is invalid", () => {
    const selected = run([
      { type: "select-lane", mode: "decision-paths", laneId: lane.id },
      { type: "set-search", target: "impact-flex", query: "peek" },
    ]);
    const recovered = createMapReducer(projection)(selected, {
      type: "select-material",
      mode: "decision-paths",
      laneId: lane.id,
      materialId: "material-private-rejected" as never,
    });
    expect(recovered.recovery).toEqual({
      code: "MAP_STATE_RECOVERED",
      message: "The map view was reset because its previous state is no longer available.",
    });
    expect(recovered.decisionPaths).toEqual({});
    expect(recovered.impactFlex.query).toBe("");
    expect(JSON.stringify(recovered)).not.toMatch(/private|rejected/u);
  });

  it("catches unexpected reducer failure through one non-echoing safe reducer", () => {
    const initial = createInitialMapState(projection);
    const reducer = createSafeMapReducer(projection, () => {
      throw new Error("PRIVATE_THROW_DETAIL");
    });
    const recovered = reducer(initial, { type: "hydration-ready" });
    expect(recovered.recovery?.code).toBe("MAP_STATE_RECOVERED");
    expect(recovered.decisionPaths).toEqual({});
    expect(JSON.stringify(recovered)).not.toMatch(/private|throw|detail/i);
  });
});
