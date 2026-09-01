/** @jsxImportSource preact */
import { useEffect, useReducer } from "preact/hooks";

import type { MapProjection } from "../../features/map/contracts.ts";
import { createSafeMapReducer } from "../../features/map/safe-map.ts";
import { buildMapView, createInitialMapState } from "../../features/map/state.ts";
import { DecisionPaths } from "./DecisionPaths.tsx";
import { ThermalGuidance } from "./ThermalGuidance.tsx";
import { ProcessGateMatrix } from "./ProcessGateMatrix.tsx";
import { ImpactFlexMatrix } from "./ImpactFlexMatrix.tsx";

type Props = Readonly<{ projection: MapProjection }>;

/** One route-local interaction owner for all four visible map analyses. */
export function MapExplorerIsland({ projection }: Props) {
  const [state, dispatch] = useReducer(
    createSafeMapReducer(projection),
    projection,
    createInitialMapState,
  );
  const view = buildMapView(projection, state);

  useEffect(() => {
    dispatch({ type: "hydration-ready" });
  }, []);

  return (
    <div class="map-explorer" data-active-map-section={state.mode}>
      <div
        class={view.status.recovery === undefined ? "map-announcement" : "map-recovery"}
        role={view.status.recovery === undefined ? "status" : "alert"}
        aria-live={view.status.recovery === undefined ? "polite" : "assertive"}
        aria-atomic="true"
      >
        <p>{view.status.announcement}</p>
        {view.status.recovery !== undefined && (
          <button type="button" onClick={() => dispatch({ type: "reset-view", mode: "all" })}>
            Reset all map views
          </button>
        )}
      </div>

      <DecisionPaths view={view} dispatch={dispatch} />
      <ThermalGuidance view={view} dispatch={dispatch} methodHref={projection.methodHref} />
      <ProcessGateMatrix view={view} dispatch={dispatch} />
      <ImpactFlexMatrix view={view} dispatch={dispatch} evidenceHref={projection.methodHref} />
    </div>
  );
}
