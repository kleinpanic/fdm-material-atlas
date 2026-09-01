import type { MapProjection } from "./contracts.ts";
import type { MapSelectionAction } from "./contracts.ts";
import {
  createInitialMapState,
  createMapReducer,
  recoverMapState,
  type MapReducer,
  type MapState,
} from "./state.ts";

export type SafeMapProjection =
  | Readonly<{ readonly kind: "success"; readonly projection: MapProjection }>
  | Readonly<{ readonly kind: "error"; readonly code: "MAP_PROJECTION_FAILED" }>;

const PROJECTION_FAILURE: SafeMapProjection = Object.freeze({
  kind: "error",
  code: "MAP_PROJECTION_FAILED",
});

/** Execute a build-only projection closure without reflecting rejected data or errors. */
export function safeCompileMapProjection(compile: () => MapProjection): SafeMapProjection {
  try {
    const projection = compile();
    return Object.freeze({ kind: "success", projection });
  } catch {
    return PROJECTION_FAILURE;
  }
}

/** Bind one total, non-echoing reducer for direct use by a single useReducer owner. */
export function createSafeMapReducer(
  projection: MapProjection,
  reducer: MapReducer = createMapReducer(projection),
): MapReducer {
  const initial = createInitialMapState(projection);
  return (state: MapState, action: MapSelectionAction): MapState => {
    try {
      return reducer(state, action);
    } catch {
      return recoverMapState(initial.hydrated || state.hydrated ? { hydrated: true } : { hydrated: false });
    }
  };
}
