import { h, type ComponentChildren, type VNode } from "preact";
import render from "preact-render-to-string";
import { describe, expect, it } from "vitest";

import { ProcessGateMatrix } from "../../src/components/map/ProcessGateMatrix.tsx";
import type { MapSelectionAction } from "../../src/features/map/contracts.ts";
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

function renderGate(actions: MapSelectionAction[] = []): string {
  const state = actions.reduce(createMapReducer(projection), createInitialMapState(projection));
  return render(h(ProcessGateMatrix, {
    view: buildMapView(projection, state),
    dispatch: () => undefined,
  }));
}

describe("process gate renderer", () => {
  it("renders the complete 8 by 8 matrix and equally complete stacked alternative", () => {
    const html = renderGate();

    expect(count(html, "data-gate-row=\"true\"")).toBe(8);
    expect(count(html, "data-gate-cell=\"true\"")).toBe(64);
    expect(count(html, "data-stacked-relationship=\"true\"")).toBe(64);
    expect(html).toContain("8 decision lanes × 8 process gates = 64 direct checks");
    expect(html).toContain("Applies — verify this gate");
    expect(html).toContain("Not listed for this lane");
    expect(html).toContain("Highlight a decision lane");
    expect(html).toContain("Highlight a process gate");
    expect(html).toContain("Clear gate highlight");
    for (const lane of projection.processGates.lanes) {
      expect(html).toContain(lane.label);
      expect(html).toContain(`${lane.candidates.length} live ${lane.candidates.length === 1 ? "candidate" : "candidates"}`);
    }
    for (const gate of projection.processGates.gates) expect(html).toContain(gate.label);
  });

  it("shows selected lane and gate context without printer verdict or safety language", () => {
    const lane = projection.processGates.lanes.find(({ id }) => id === "lane-industrial")!;
    const laneHtml = renderGate([{ type: "select-lane", mode: "process-gates", laneId: lane.id }]);
    expect(laneHtml).toContain("Selected decision lane");
    expect(laneHtml).toContain("Selected");
    for (const candidate of lane.candidates) expect(laneHtml).toContain(candidate.href);

    const gate = projection.processGates.gates.find(({ id }) => id === "gate-enclosure-capability")!;
    const gateHtml = renderGate([{ type: "select-gate", mode: "process-gates", gateId: gate.id }]);
    expect(gateHtml).toContain("Selected process gate");
    expect(gateHtml).toContain(gate.capabilityLabel);
    expect(gateHtml).toContain(gate.requirement);
    expect(gateHtml).toContain(gate.verification);
    expect(gateHtml).not.toMatch(/\b(?:available|blocked|safe|unsafe|passes|fails)\b/iu);
  });

  it("dispatches the same validated gate action from a pointer cell and native select", () => {
    const view = buildMapView(projection, createInitialMapState(projection));
    const gate = projection.processGates.gates[0]!;
    const selectActions: MapSelectionAction[] = [];
    const selectTree = ProcessGateMatrix({ view, dispatch: (action) => selectActions.push(action) });
    const select = findNode(selectTree, (node) => node.props["aria-label"] === "Highlight a process gate");
    expect(select).toBeDefined();
    (select!.props.onChange as (event: { currentTarget: { value: string } }) => void)({
      currentTarget: { value: gate.id },
    });

    const pointerActions: MapSelectionAction[] = [];
    const pointerTree = ProcessGateMatrix({ view, dispatch: (action) => pointerActions.push(action) });
    const cell = findNode(pointerTree, (node) =>
      node.props["data-gate-cell"] === true && node.props["data-gate-id"] === gate.id);
    expect(cell).toBeDefined();
    (cell!.props.onClick as () => void)();

    expect(pointerActions).toEqual(selectActions);
    expect(pointerActions).toEqual([
      { type: "select-gate", mode: "process-gates", gateId: gate.id },
    ]);
    expect(cell!.props.tabIndex).toBe(-1);
  });
});
