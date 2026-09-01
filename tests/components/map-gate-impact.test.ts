import { readFileSync } from "node:fs";

import { h, type ComponentChildren, type VNode } from "preact";
import render from "preact-render-to-string";
import { describe, expect, it } from "vitest";

import { ProcessGateMatrix } from "../../src/components/map/ProcessGateMatrix.tsx";
import { ImpactFlexMatrix } from "../../src/components/map/ImpactFlexMatrix.tsx";
import type { MapProjection, MapSelectionAction } from "../../src/features/map/contracts.ts";
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

function renderImpact(actions: MapSelectionAction[] = [], source: MapProjection = projection): string {
  const state = actions.reduce(createMapReducer(source), createInitialMapState(source));
  return render(h(ImpactFlexMatrix, {
    view: buildMapView(source, state),
    dispatch: () => undefined,
    evidenceHref: source.methodHref,
  }));
}

describe("impact and flexibility renderer", () => {
  it("renders every categorical cell, every record, complete controls, and limitation copy", () => {
    const html = renderImpact();

    expect(count(html, "data-impact-cell=\"true\"")).toBe(20);
    expect(count(html, "data-impact-row=\"true\"")).toBe(23);
    expect(count(html, "data-material-control=\"true\"")).toBe(23);
    expect(html).toContain(projection.impactFlex.limitation);
    expect(html).toContain("Find a material in the impact-flex view");
    expect(html).toContain("Maximum print difficulty");
    expect(html).toContain("Encode print difficulty with mark shape");
    expect(html).toContain("Clear property-space filters");
    for (const term of projection.impactFlex.impactAxis) expect(html).toContain(term.label);
    for (const term of projection.impactFlex.flexibilityAxis) expect(html).toContain(term.label);
    for (const record of projection.impactFlex.records) {
      expect(html).toContain(record.material.name);
      expect(html).toContain(record.material.href);
    }
  });

  it("retains filtered and unplottable rows with exact visible diagram states", () => {
    const selected = projection.impactFlex.records.find(({ printDifficulty }) => printDifficulty === "expert")!;
    const filteredHtml = renderImpact([
      { type: "select-material", mode: "impact-flex-space", materialId: selected.material.id },
      { type: "set-maximum-difficulty", value: "easy" },
    ]);
    expect(count(filteredHtml, "data-impact-row=\"true\"")).toBe(23);
    expect(filteredHtml).toContain("Selected record is outside the current diagram filter.");
    expect(filteredHtml).toContain("Filtered from the diagram");
    expect(filteredHtml).toContain("Open material reference");

    const withOmission = structuredClone(projection) as MapProjection;
    const omitted = withOmission.impactFlex.records[0]!;
    const { impact: _impact, ...withoutImpact } = omitted;
    (withOmission.impactFlex.records as unknown as Array<typeof omitted>)[0] = {
      ...withoutImpact,
      impactFact: { state: "unknown", display: ["Unknown", "Verify impact guidance."], reason: "Verify impact guidance." },
      disposition: { disposition: "omitted", code: "impact-value-unavailable", reason: "Impact resistance: Verify impact guidance." },
    };
    const omittedHtml = renderImpact([], withOmission);
    expect(count(omittedHtml, "data-impact-row=\"true\"")).toBe(23);
    expect(omittedHtml).toContain("Not plotted in the impact-flex matrix");
    expect(omittedHtml).toContain("Not plotted — Impact resistance: Verify impact guidance.");
  });

  it("uses the same material action for pointer marks and ordered HTML controls", () => {
    const view = buildMapView(projection, createInitialMapState(projection));
    const material = projection.impactFlex.records[0]!.material;
    const controlActions: MapSelectionAction[] = [];
    const controlTree = ImpactFlexMatrix({
      view,
      dispatch: (action) => controlActions.push(action),
      evidenceHref: projection.methodHref,
    });
    const control = findNode(controlTree, (node) =>
      node.props["data-material-control"] === true && node.props["data-material-id"] === material.id);
    expect(control).toBeDefined();
    (control!.props.onClick as () => void)();

    const pointerActions: MapSelectionAction[] = [];
    const pointerTree = ImpactFlexMatrix({
      view,
      dispatch: (action) => pointerActions.push(action),
      evidenceHref: projection.methodHref,
    });
    const mark = findNode(pointerTree, (node) =>
      node.props["data-material-mark"] === true && node.props["data-material-id"] === material.id);
    expect(mark).toBeDefined();
    (mark!.props.onClick as () => void)();

    expect(pointerActions).toEqual(controlActions);
    expect(pointerActions).toEqual([
      { type: "select-material", mode: "impact-flex-space", materialId: material.id },
    ]);
    expect(mark!.props.tabIndex).toBeUndefined();
  });

  it("keeps a focused impact preview out of pressed state and persistent details", () => {
    const record = projection.impactFlex.records[0]!;
    const html = renderImpact([{
      type: "preview-selection",
      mode: "impact-flex-space",
      source: "focus",
      target: { kind: "material", mode: "impact-flex-space", id: record.material.id },
    }]);
    expect(html).toContain(`data-material-id="${record.material.id}" aria-pressed="false" data-previewed="true"`);
    expect(html).not.toContain("Selected material record");
  });

  it("keeps rendering categorical, non-color, source-independent, and route-safe", () => {
    const source = readFileSync("src/components/map/ImpactFlexMatrix.tsx", "utf8");
    const selectedSource = readFileSync("src/components/map/SelectedRecord.tsx", "utf8");
    expect(source).not.toMatch(/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|Atlas|nearest|similarity|rank|distance|trend|force|drag/iu);
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/iu);
    expect(source).not.toMatch(/href\s*=\s*\{?\s*[`'"]\//u);
    expect(source).not.toMatch(/tabIndex=.*(?:circle|rect|path|polygon|g)/u);
    expect(selectedSource).toContain("No separate evidence action is available in this view.");
  });
});
