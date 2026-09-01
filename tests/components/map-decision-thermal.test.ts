import { readFileSync } from "node:fs";

import { h, type ComponentChildren, type VNode } from "preact";
import render from "preact-render-to-string";
import { describe, expect, it } from "vitest";

import { DecisionPaths } from "../../src/components/map/DecisionPaths.tsx";
import { ThermalGuidance } from "../../src/components/map/ThermalGuidance.tsx";
import type {
  MapDecisionLane,
  MapMaterialReference,
  MapProjection,
  MapSelectionAction,
} from "../../src/features/map/contracts.ts";
import { compileMapProjection } from "../../src/features/map/projection.ts";
import {
  buildMapView,
  createInitialMapState,
  createMapReducer,
} from "../../src/features/map/state.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";

const projection = compileMapProjection(loadPublicAtlas(), "/repo/");

function count(html: string, fragment: string): number {
  return html.split(fragment).length - 1;
}

function childrenOf(value: ComponentChildren): readonly ComponentChildren[] {
  return Array.isArray(value) ? value : [value];
}

function findNode(
  node: ComponentChildren,
  predicate: (candidate: VNode<Record<string, unknown>>) => boolean,
): VNode<Record<string, unknown>> | undefined {
  if (node === null || node === undefined || typeof node !== "object") return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findNode(child, predicate);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const candidate = node as VNode<Record<string, unknown>>;
  if (predicate(candidate)) return candidate;
  for (const child of childrenOf(candidate.props.children as ComponentChildren)) {
    const found = findNode(child, predicate);
    if (found !== undefined) return found;
  }
  return undefined;
}

function renderDecision(actions: MapSelectionAction[] = [], source: MapProjection = projection): string {
  const state = actions.reduce(createMapReducer(source), createInitialMapState(source));
  return render(h(DecisionPaths, {
    view: buildMapView(source, state),
    dispatch: () => undefined,
  }));
}

function candidatesOfLength(length: number): readonly MapMaterialReference[] {
  return Array.from({ length }, (_, index) => {
    const original = projection.lanes.flatMap(({ candidates }) => candidates)[index % 23]!;
    return {
      ...original,
      id: `material-decision-fixture-${length}-${index}` as MapMaterialReference["id"],
      name: `Decision fixture ${length}-${index}`,
      href: `/repo/materials/decision-fixture-${length}-${index}/`,
      displayOrder: index,
    };
  });
}

function withCandidateCounts(counts: readonly number[]): MapProjection {
  const source = structuredClone(projection) as MapProjection;
  (source.lanes as unknown as MapDecisionLane[]) = source.lanes.map((lane, index) => {
    const candidates = candidatesOfLength(counts[index] ?? lane.candidates.length);
    return {
      ...lane,
      candidates,
      visibleCandidates: candidates.slice(0, 8),
      overflowCandidates: candidates.slice(8),
    };
  });
  return source;
}

describe("decision path renderer", () => {
  it("renders eight ordered, complete four-stage paths with real projection links", () => {
    const html = renderDecision();

    expect(count(html, "data-decision-lane=\"true\"")).toBe(8);
    expect(count(html, "data-decision-stage=\"true\"")).toBe(32);
    expect(count(html, "data-lane-control=\"true\"")).toBe(8);
    expect(html).toContain("Need");
    expect(html).toContain("Properties to check");
    expect(html).toContain("Live candidates");
    expect(html).toContain("Verify and process gates");

    for (const lane of projection.lanes) {
      expect(html).toContain(lane.href);
      expect(html).toContain(lane.need);
      expect(html).toContain(`${lane.candidates.length} live ${lane.candidates.length === 1 ? "candidate" : "candidates"}`);
      for (const property of lane.propertyChecks) expect(html).toContain(property.label);
      for (const candidate of lane.candidates) {
        expect(html).toContain(candidate.name);
        expect(html).toContain(candidate.href);
      }
      for (const statement of lane.verification) expect(html).toContain(statement);
      for (const gate of lane.processGates) {
        expect(html).toContain(gate.label);
        expect(html).toContain(gate.requirement);
        expect(html).toContain(gate.verification);
        expect(html).toContain(gate.href);
      }
    }
  });

  it("makes only the initial index visually focal and selects a lane only after activation", () => {
    const initial = renderDecision();
    expect(count(initial, "is-initial-focus")).toBe(1);
    expect(initial).not.toContain("aria-pressed=\"true\"");

    const lane = projection.lanes[2]!;
    const selected = renderDecision([{ type: "select-lane", mode: "decision-paths", laneId: lane.id }]);
    expect(count(selected, "data-decision-lane=\"true\"")).toBe(8);
    expect(selected).toContain(`data-lane-id="${lane.id}"`);
    expect(selected).toContain("aria-pressed=\"true\"");
    expect(selected).toContain("Selected decision lane");
  });

  it("keeps zero, one, eight, nine, and thirteen-candidate lanes complete", () => {
    const source = withCandidateCounts([0, 1, 8, 9, 13, 1, 8, 9]);
    const html = renderDecision([], source);

    expect(html).toContain("No live candidates satisfy this lane rule");
    expect(count(html, "More live candidates (1)")).toBe(2);
    expect(html).toContain("More live candidates (5)");
    expect(count(html, "data-candidate-control=\"true\"")).toBe(49);
    expect(count(html, "data-candidate-mark=\"true\"")).toBe(49);
  });

  it("dispatches the same action from pointer marks and keyboard-owned controls", () => {
    const view = buildMapView(projection, createInitialMapState(projection));
    const lane = projection.lanes[0]!;
    const candidate = lane.candidates[0]!;
    const controlActions: MapSelectionAction[] = [];
    const controlTree = DecisionPaths({ view, dispatch: (action) => controlActions.push(action) });
    const control = findNode(controlTree, (node) =>
      node.props["data-candidate-control"] === true && node.props["data-material-id"] === candidate.id);
    expect(control).toBeDefined();
    (control!.props.onClick as () => void)();

    const markActions: MapSelectionAction[] = [];
    const markTree = DecisionPaths({ view, dispatch: (action) => markActions.push(action) });
    const mark = findNode(markTree, (node) =>
      node.props["data-candidate-mark"] === true && node.props["data-material-id"] === candidate.id);
    expect(mark).toBeDefined();
    (mark!.props.onClick as () => void)();

    expect(markActions).toEqual(controlActions);
    expect(markActions).toEqual([{
      type: "select-material",
      mode: "decision-paths",
      laneId: lane.id,
      materialId: candidate.id,
    }]);
    expect(mark!.props.tabIndex).toBeUndefined();
  });

  it("keeps candidate previews equivalent and source projection-only", () => {
    const view = buildMapView(projection, createInitialMapState(projection));
    const lane = projection.lanes[0]!;
    const candidate = lane.candidates[0]!;
    const actions: MapSelectionAction[] = [];
    const tree = DecisionPaths({ view, dispatch: (action) => actions.push(action) });
    const control = findNode(tree, (node) =>
      node.props["data-candidate-control"] === true && node.props["data-material-id"] === candidate.id)!;
    (control.props.onFocus as () => void)();
    (control.props.onBlur as () => void)();
    (control.props.onMouseEnter as () => void)();
    (control.props.onMouseLeave as () => void)();
    expect(actions).toEqual([
      {
        type: "preview-selection",
        mode: "decision-paths",
        source: "focus",
        target: { kind: "material", mode: "decision-paths", laneId: lane.id, id: candidate.id },
      },
      { type: "clear-preview", mode: "decision-paths", source: "focus" },
      {
        type: "preview-selection",
        mode: "decision-paths",
        source: "hover",
        target: { kind: "material", mode: "decision-paths", laneId: lane.id, id: candidate.id },
      },
      { type: "clear-preview", mode: "decision-paths", source: "hover" },
    ]);

    const source = readFileSync("src/components/map/DecisionPaths.tsx", "utf8");
    expect(source).not.toMatch(/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|Atlas|querySelector|focus\s*\(|dangerouslySetInnerHTML/iu);
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/iu);
    expect(source).not.toMatch(/href\s*=\s*\{?\s*[`'"]\//u);
    expect(source).not.toContain('role="status"');
  });

  it("uses preview only for visual emphasis until a candidate is activated", () => {
    const lane = projection.lanes[0]!;
    const candidate = lane.candidates[0]!;
    const html = renderDecision([{
      type: "preview-selection",
      mode: "decision-paths",
      source: "focus",
      target: { kind: "material", mode: "decision-paths", laneId: lane.id, id: candidate.id },
    }]);
    expect(html).toContain(`data-material-id="${candidate.id}" aria-pressed="false" data-previewed="true"`);
    expect(html).not.toContain("map-selected-text");
  });
});

const THERMAL_CAUTION = "Practical service guidance, Tg, HDT, Vicat softening, melting point, and other named tests answer different questions. Compare only matching metric and method groups.";

function renderThermal(actions: MapSelectionAction[] = [], source: MapProjection = projection): string {
  const state = actions.reduce(createMapReducer(source), createInitialMapState(source));
  return render(h(ThermalGuidance, {
    view: buildMapView(source, state),
    dispatch: () => undefined,
    methodHref: source.methodHref,
  }));
}

describe("thermal guidance renderer", () => {
  it("places the exact caution before complete practical-service controls and rows", () => {
    const html = renderThermal();

    expect(html).toContain(THERMAL_CAUTION);
    expect(html.indexOf(THERMAL_CAUTION)).toBeLessThan(html.indexOf("Thermal view"));
    expect(html).toContain("Practical service guidance");
    expect(html).toContain("Named thermal observations");
    expect(html).toContain("Find a material in this thermal view");
    expect(html).toContain("Service guidance order");
    expect(html).toContain("Canonical material order");
    expect(html).toContain("Low endpoint");
    expect(html).toContain("High endpoint");
    expect(html).toContain("Clear thermal filters");
    expect(html).not.toContain("Named metric and method group");
    expect(count(html, "data-service-row=\"true\"")).toBe(23);
    expect(count(html, "data-service-control=\"true\"")).toBe(23);
    expect(count(html, "data-service-mark=\"true\"")).toBe(23);
    for (const heading of [
      "Material", "State", "Value", "Unit", "Metric or guidance", "Method and conditions",
      "Qualification", "Evidence scope", "Material reference",
    ]) expect(html).toContain(heading);
    for (const record of projection.serviceGuidance.records) expect(html).toContain(record.material.href);
  });

  it("uses identical material actions for the service diagram and ordered HTML controls", () => {
    const view = buildMapView(projection, createInitialMapState(projection));
    const record = view.thermal.serviceRecords[0]!;
    const controlActions: MapSelectionAction[] = [];
    const controlTree = ThermalGuidance({
      view,
      dispatch: (action) => controlActions.push(action),
      methodHref: projection.methodHref,
    });
    const control = findNode(controlTree, (node) =>
      node.props["data-service-control"] === true && node.props["data-material-id"] === record.material.id)!;
    (control.props.onClick as () => void)();

    const markActions: MapSelectionAction[] = [];
    const markTree = ThermalGuidance({
      view,
      dispatch: (action) => markActions.push(action),
      methodHref: projection.methodHref,
    });
    const mark = findNode(markTree, (node) =>
      node.props["data-service-mark"] === true && node.props["data-material-id"] === record.material.id)!;
    (mark.props.onClick as () => void)();

    expect(markActions).toEqual(controlActions);
    expect(markActions).toEqual([{
      type: "select-material", mode: "thermal-ranges", materialId: record.material.id,
    }]);
    expect(mark.props.tabIndex).toBeUndefined();
  });

  it("does not expose a focused service preview as a locked thermal selection", () => {
    const record = projection.serviceGuidance.records[0]!;
    const html = renderThermal([{
      type: "preview-selection",
      mode: "thermal-ranges",
      source: "focus",
      target: { kind: "material", mode: "thermal-ranges", id: record.material.id },
    }]);
    expect(html).toContain(`data-material-id="${record.material.id}" aria-pressed="false" data-previewed="true"`);
    expect(html).not.toContain("Selected practical service record");
  });

  it("renders one exact named group with its complete table and explicit absences", () => {
    const group = projection.thermalGroups[0]!;
    const html = renderThermal([
      { type: "set-thermal-view", mode: "thermal-ranges", view: "named-observations" },
      { type: "select-thermal-group", mode: "thermal-ranges", groupId: group.id },
    ]);

    expect(html).toContain("Named metric and method group");
    expect(html).not.toContain("Service guidance order");
    expect(count(html, "data-named-row=\"true\"")).toBe(23);
    expect(count(html, "data-named-mark=\"true\"")).toBe(group.members.length);
    expect(html).toContain(group.metricLabel);
    expect(html).toContain(group.methodLabel);
    expect(html).toContain("No observation in this metric and method group");
    expect(html).toContain("Not plotted in this named metric and method group");
    for (const member of group.members) {
      expect(html).toContain(member.material.href);
      expect(html).toContain(member.metricLabel);
      expect(html).toContain(member.methodLabel);
      for (const scope of member.evidence.scopeLabels) expect(html).toContain(scope);
    }
  });

  it("applies the thermal query to named marks, counts, and controls without dropping table rows", () => {
    const group = projection.thermalGroups.find(({ members }) => members.length > 0)!;
    const match = group.members[0]!.material;
    const html = renderThermal([
      { type: "set-thermal-view", mode: "thermal-ranges", view: "named-observations" },
      { type: "select-thermal-group", mode: "thermal-ranges", groupId: group.id },
      { type: "set-search", target: "thermal", query: match.name },
    ]);

    expect(count(html, "data-named-row=\"true\"")).toBe(23);
    expect(count(html, "data-named-control=\"true\"")).toBe(1);
    expect(count(html, "data-named-mark=\"true\"")).toBe(1);
    expect(html).toContain("1 observation plotted; 22 filtered from the diagram and controls");
    expect(html).toContain("All 23 records remain in the table");
  });

  it("shows a bounded recovery state when named mode has no current group", () => {
    const html = renderThermal([
      { type: "set-thermal-view", mode: "thermal-ranges", view: "named-observations" },
    ]);
    expect(html).toContain("Choose a named metric and method group to inspect its records.");
    expect(count(html, "data-named-row=\"true\"")).toBe(0);
    expect(count(html, "data-named-mark=\"true\"")).toBe(0);
  });

  it("dispatches closed view, group, search, sort, and reset actions from native controls", () => {
    const view = buildMapView(projection, createInitialMapState(projection));
    const actions: MapSelectionAction[] = [];
    const tree = ThermalGuidance({
      view,
      dispatch: (action) => actions.push(action),
      methodHref: projection.methodHref,
    });
    const namedRadio = findNode(tree, (node) => node.props["data-thermal-view"] === "named-observations")!;
    const search = findNode(tree, (node) => node.props["aria-label"] === "Find a material in this thermal view")!;
    const sort = findNode(tree, (node) => node.props["aria-label"] === "Service guidance order")!;
    const reset = findNode(tree, (node) => node.props["data-thermal-reset"] === true)!;
    (namedRadio.props.onChange as (event: { currentTarget: { checked: boolean } }) => void)({ currentTarget: { checked: true } });
    (search.props.onInput as (event: { currentTarget: { value: string } }) => void)({ currentTarget: { value: "PLA" } });
    (sort.props.onChange as (event: { currentTarget: { value: string } }) => void)({ currentTarget: { value: "low-endpoint" } });
    (reset.props.onClick as () => void)();
    expect(actions).toEqual([
      { type: "set-thermal-view", mode: "thermal-ranges", view: "named-observations" },
      { type: "set-search", target: "thermal", query: "PLA" },
      { type: "set-service-sort", sort: "low-endpoint" },
      { type: "reset-view", mode: "thermal-ranges" },
    ]);

    const groupActions: MapSelectionAction[] = [];
    const namedState = [
      { type: "set-thermal-view", mode: "thermal-ranges", view: "named-observations" },
    ] satisfies MapSelectionAction[];
    const state = namedState.reduce(createMapReducer(projection), createInitialMapState(projection));
    const namedTree = ThermalGuidance({
      view: buildMapView(projection, state),
      dispatch: (action) => groupActions.push(action),
      methodHref: projection.methodHref,
    });
    const groupSelect = findNode(namedTree, (node) => node.props["aria-label"] === "Named metric and method group")!;
    (groupSelect.props.onChange as (event: { currentTarget: { value: string } }) => void)({
      currentTarget: { value: projection.thermalGroups[0]!.id },
    });
    expect(groupActions).toEqual([{
      type: "select-thermal-group", mode: "thermal-ranges", groupId: projection.thermalGroups[0]!.id,
    }]);
  });

  it("keeps the two thermal concepts in separate accessible trees and stays source-only", () => {
    const service = renderThermal();
    const named = renderThermal([
      { type: "set-thermal-view", mode: "thermal-ranges", view: "named-observations" },
      { type: "select-thermal-group", mode: "thermal-ranges", groupId: projection.thermalGroups[0]!.id },
    ]);
    expect(service).toContain("data-service-diagram=\"true\"");
    expect(service).not.toContain("data-named-diagram=\"true\"");
    expect(named).toContain("data-named-diagram=\"true\"");
    expect(named).not.toContain("data-service-diagram=\"true\"");
    expect(service).toContain("aria-hidden=\"true\"");
    expect(named).toContain("aria-hidden=\"true\"");

    const source = readFileSync("src/components/map/ThermalGuidance.tsx", "utf8");
    expect(source).not.toMatch(/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|Atlas|querySelector|focus\s*\(|dangerouslySetInnerHTML/iu);
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/iu);
    expect(source).not.toMatch(/href\s*=\s*\{?\s*[`'"]\//u);
    expect(source).not.toMatch(/generic heat|heat resistance|heat score|numeric sort|average|combined (?:axis|scale)/iu);
    expect(source).not.toMatch(/transition(?:Property|Duration)?\s*[:=]|animate|keyframes/iu);
    expect(source).not.toContain('role="status"');
  });
});
