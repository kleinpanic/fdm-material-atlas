import { describe, expect, it } from "vitest";

import { selectProjectedMaterials } from "../../src/domain/selector/index.ts";
import {
  decodeSelectorClientModel,
  encodeSelectorClientModel,
} from "../../src/features/selector/client-model.ts";
import { buildSelectorPageModel } from "../../src/features/selector/page-model.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";
import { PUBLIC_ROUTE_REGISTRY } from "../../src/lib/public-route-registry.ts";

const atlas = loadPublicAtlas();
const clientModel = buildSelectorPageModel(atlas, "/atlas-preview/", PUBLIC_ROUTE_REGISTRY);
const runtimeModel = decodeSelectorClientModel(clientModel);

describe("selector client model codec", () => {
  it("round-trips every selector runtime channel within the raw byte budget", () => {
    const encoded = encodeSelectorClientModel(runtimeModel);
    const decoded = decodeSelectorClientModel(encoded);
    expect(decoded).toEqual(runtimeModel);
    expect(decoded.projection.criteria).toHaveLength(7);
    expect(decoded.projection.materials).toHaveLength(23);
    expect(JSON.stringify(encoded).length).toBeLessThanOrEqual(48 * 1024);
    expect(selectProjectedMaterials(decoded.projection, decoded.defaults)).toEqual(
      selectProjectedMaterials(runtimeModel.projection, runtimeModel.defaults),
    );
  });

  it("is deterministic across object insertion order", () => {
    const reorder = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reorder);
      if (value !== null && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reorder(child)]));
      }
      return value;
    };
    expect(JSON.stringify(encodeSelectorClientModel(reorder(runtimeModel) as never))).toBe(
      JSON.stringify(encodeSelectorClientModel(runtimeModel)),
    );
  });

  it.each([
    null,
    [],
    [2, [], [0]],
    [1, ["secret-rejected-value"], [99]],
    [1, ["x"], [1, 2]],
  ])("rejects malformed transport with one data-free code", (input) => {
    let error: unknown;
    try { decodeSelectorClientModel(input as never); } catch (caught) { error = caught; }
    expect(error).toEqual(new Error("SELECTOR_CLIENT_MODEL_INVALID"));
    expect(String(error)).not.toContain("secret-rejected-value");
  });
});
