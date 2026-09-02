import { gunzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { encodeMapProjectionPayload } from "../../src/features/map/payload.ts";
import { compileMapProjection } from "../../src/features/map/projection.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";

describe("map projection payload", () => {
  it("round-trips the deterministic canonical projection in compact form", () => {
    const projection = compileMapProjection(loadPublicAtlas(), "/atlas-preview/");
    const first = encodeMapProjectionPayload(projection);
    const second = encodeMapProjectionPayload(projection);
    const decoded = JSON.parse(
      gunzipSync(Buffer.from(first.gzipBase64, "base64")).toString("utf8"),
    );

    expect(first).toEqual(second);
    expect(decoded).toEqual(projection);
    expect(decoded.lanes).toHaveLength(8);
    expect(decoded.serviceGuidance.records).toHaveLength(23);
    expect(decoded.thermalGroups).toHaveLength(8);
    expect(decoded.processGates.relationships).toHaveLength(64);
    expect(decoded.impactFlex.records).toHaveLength(23);
    expect(first.gzipBase64.length).toBeLessThan(JSON.stringify(projection).length / 10);
  });
});
