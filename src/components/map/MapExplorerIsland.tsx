/** @jsxImportSource preact */
import { useEffect, useReducer, useState } from "preact/hooks";

import type { MapProjection } from "../../features/map/contracts.ts";
import type { MapProjectionPayload } from "../../features/map/payload.ts";
import { createSafeMapReducer } from "../../features/map/safe-map.ts";
import { buildMapView, createInitialMapState } from "../../features/map/state.ts";
import { DecisionPaths } from "./DecisionPaths.tsx";
import { ThermalGuidance } from "./ThermalGuidance.tsx";
import { ProcessGateMatrix } from "./ProcessGateMatrix.tsx";
import { ImpactFlexMatrix } from "./ImpactFlexMatrix.tsx";

type Props = Readonly<{ payload: MapProjectionPayload }>;

const MAX_DECOMPRESSED_BYTES = 1024 * 1024;

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = window.atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function decodeMapProjection(gzipBase64: string): Promise<MapProjection> {
  const compressed = decodeBase64(gzipBase64);
  const decompressed = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
  const bytes = await new Response(decompressed).arrayBuffer();
  if (bytes.byteLength > MAX_DECOMPRESSED_BYTES) throw new Error("MAP_PAYLOAD_TOO_LARGE");
  return JSON.parse(new TextDecoder().decode(bytes)) as MapProjection;
}

type ExplorerProps = Readonly<{ projection: MapProjection }>;

/** One route-local interaction owner for all four visible map analyses. */
export function MapExplorer({ projection }: ExplorerProps) {
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

/** Defer projection parsing until the visible island is activated. */
export function MapExplorerIsland({ payload }: Props) {
  const [projection, setProjection] = useState<MapProjection | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void decodeMapProjection(payload.gzipBase64)
      .then((decoded) => {
        if (active) setProjection(decoded);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [payload.gzipBase64]);

  if (failed) {
    return (
      <div class="map-recovery" role="alert">
        <p>The interactive map could not be prepared. The static decision paths remain below.</p>
      </div>
    );
  }
  if (projection === null) {
    return (
      <div class="map-announcement" role="status" aria-live="polite" aria-atomic="true">
        <p>Interactive map controls are preparing. Static decision paths remain available.</p>
      </div>
    );
  }
  return <MapExplorer projection={projection} />;
}
