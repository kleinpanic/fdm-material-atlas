import { readFileSync } from "node:fs";

import { h } from "preact";
import render from "preact-render-to-string";
import { describe, expect, it } from "vitest";

import { MapExplorerIsland } from "../../src/components/map/MapExplorerIsland.tsx";
import { compileMapProjection } from "../../src/features/map/projection.ts";
import { createSafeMapReducer } from "../../src/features/map/safe-map.ts";
import {
  buildMapView,
  createInitialMapState,
  createMapReducer,
} from "../../src/features/map/state.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";

const projection = compileMapProjection(loadPublicAtlas(), "/repo/");
const islandSource = readFileSync(
  new URL("../../src/components/map/MapExplorerIsland.tsx", import.meta.url),
  "utf8",
);

function count(source: string, fragment: string | RegExp): number {
  if (typeof fragment === "string") return source.split(fragment).length - 1;
  return source.match(fragment)?.length ?? 0;
}

describe("map explorer island boundary", () => {
  it("server-renders one preparing state and all four analyses in canonical order", () => {
    const html = render(h(MapExplorerIsland, { projection }));
    const sections = [
      "map-mode--decision-paths",
      "map-mode--thermal",
      "map-mode--process-gates",
      "map-mode--impact-flex",
    ];

    expect(html).toContain("Interactive map controls are preparing. Every path and structured table is already available.");
    expect(count(html, 'role="status"')).toBe(1);
    expect(html).not.toContain("Selected record");
    expect(count(islandSource, /role=\{/g)).toBe(1);
    const positions = sections.map((section) => html.indexOf(section));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it("owns exactly one reducer, presenter, hydration effect, and renderer dispatch seam", () => {
    expect(count(islandSource, /\buseReducer\s*\(/g)).toBe(1);
    expect(count(islandSource, /\bbuildMapView\s*\(/g)).toBe(1);
    expect(count(islandSource, /\buseEffect\s*\(/g)).toBe(1);
    expect(islandSource).toContain("createInitialMapState");
    expect(islandSource).toContain("createSafeMapReducer");
    expect(islandSource).toContain('{ type: "hydration-ready" }');
    expect(islandSource).not.toMatch(/\buseState\s*\(|\buseRef\s*\(|\buseMemo\s*\(|\.focus\s*\(|querySelector/);

    for (const renderer of ["DecisionPaths", "ThermalGuidance", "ProcessGateMatrix", "ImpactFlexMatrix"]) {
      expect(islandSource).toContain(`<${renderer}`);
    }
    expect(count(islandSource, /view=\{view\}/g)).toBe(4);
    expect(count(islandSource, /dispatch=\{dispatch\}/g)).toBe(4);
    expect(islandSource).not.toMatch(/state\.mode\s*===|hidden=|role="tab"|role="tabpanel"/);
  });

  it("uses one bounded live message and a controlled recovery reset without focus movement", () => {
    expect(islandSource).toContain('role={view.status.recovery === undefined ? "status" : "alert"}');
    expect(islandSource).toContain("view.status.announcement");
    expect(islandSource).toContain('aria-live={view.status.recovery === undefined ? "polite" : "assertive"}');
    expect(islandSource).toContain('{ type: "reset-view", mode: "all" }');
    expect(islandSource).not.toMatch(/autoFocus|tabIndex=\{-1\}|document\.|window\./);

    const reducer = createMapReducer(projection);
    const lane = projection.lanes[0]!;
    const selected = reducer(createInitialMapState(projection), {
      type: "select-lane",
      mode: "decision-paths",
      laneId: lane.id,
    });
    const safeReducer = createSafeMapReducer(projection, () => {
      throw new Error("rejected transform detail");
    });
    const recovered = safeReducer(selected, { type: "reset-view", mode: "all" });
    const recoveredView = buildMapView(projection, recovered);

    expect(recoveredView.activeTarget).toBeUndefined();
    expect(recoveredView.decisionPaths.activeTarget).toBeUndefined();
    expect(recoveredView.status.recovery).toEqual({
      code: "MAP_STATE_RECOVERED",
      message: "The map view was reset because its previous state is no longer available.",
    });
    expect(recoveredView.status.announcement.length).toBeLessThanOrEqual(120);
    expect(JSON.stringify(recoveredView.status)).not.toContain("rejected transform detail");
  });

  it("keeps the browser graph closed over compact map contracts and props-only renderers", () => {
    const imports = [...islandSource.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
    expect(imports).toEqual([
      "preact/hooks",
      "../../features/map/contracts.ts",
      "../../features/map/safe-map.ts",
      "../../features/map/state.ts",
      "./DecisionPaths.tsx",
      "./ThermalGuidance.tsx",
      "./ProcessGateMatrix.tsx",
      "./ImpactFlexMatrix.tsx",
    ]);
    expect(islandSource).not.toMatch(
      /fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|window\.location|history\.(?:push|replace)State|URLSearchParams|router|dangerouslySetInnerHTML|import\s*\(|public-atlas|canonical|\.json["']|predicate|comparator|sourceLedger|sources|evidence\.ts|projection\.ts|decision-path\.ts|thermal\.ts|process-gates\.ts|impact-flex\.ts|d3|cytoscape|three|chart\.js/iu,
    );
  });
});
