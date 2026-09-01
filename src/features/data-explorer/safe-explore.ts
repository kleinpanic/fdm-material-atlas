import {
  defaultExplorerState,
  exploreData,
  type ExplorerFailure,
  type ExplorerSuccess,
} from "./explore.ts";
import type { DataExplorerModel } from "./model.ts";

/** Reduce every invalid state or transform failure to one data-free reset result. */
export function safeExplore(
  model: DataExplorerModel,
  state: unknown,
): ExplorerSuccess | ExplorerFailure {
  try {
    return exploreData(model, state);
  } catch {
    return {
      kind: "failure",
      code: "EXPLORE_FAILED",
      state: defaultExplorerState(model),
      fields: [],
      materials: [],
      resultCount: 0,
    };
  }
}
