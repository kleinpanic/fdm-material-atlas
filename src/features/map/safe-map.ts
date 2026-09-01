import type { MapProjection } from "./contracts.ts";

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
