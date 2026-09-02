import { gunzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { buildComparisonModel } from "../../src/features/comparison/model.ts";
import { encodeComparisonPayload } from "../../src/features/comparison/payload.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";

describe("comparison payload", () => {
  it("round-trips the deterministic comparison model with a compact public index", () => {
    const model = buildComparisonModel(loadPublicAtlas(), "/atlas-preview/");
    const first = encodeComparisonPayload(model);
    const second = encodeComparisonPayload(model);

    expect(first).toEqual(second);
    expect(first.index).toEqual(model.materials.map(({ id, name }) => ({ id, name })));
    expect(
      JSON.parse(gunzipSync(Buffer.from(first.gzipBase64, "base64")).toString("utf8")),
    ).toEqual(model);
    expect(first.gzipBase64.length).toBeLessThan(JSON.stringify(model).length / 10);
  });
});
