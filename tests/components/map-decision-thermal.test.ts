import { readFileSync } from "node:fs";

import { h, type ComponentChildren, type VNode } from "preact";
import render from "preact-render-to-string";
import { describe, expect, it } from "vitest";

import { DecisionPaths } from "../../src/components/map/DecisionPaths.tsx";
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

function candidatesOfLength(lane: MapDecisionLane, length: number): readonly MapMaterialReference[] {
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
    const candidates = candidatesOfLength(lane, counts[index] ?? lane.candidates.length);
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
});
