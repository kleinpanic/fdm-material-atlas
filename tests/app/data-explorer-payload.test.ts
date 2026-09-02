import { gunzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { buildDataExplorerModel } from "../../src/features/data-explorer/model.ts";
import { encodeDataExplorerPayload } from "../../src/features/data-explorer/payload.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";

describe("data explorer payload", () => {
  it("round-trips the deterministic model with compact public metadata", () => {
    const model = buildDataExplorerModel(loadPublicAtlas(), "/atlas-preview/");
    const first = encodeDataExplorerPayload(model);
    const second = encodeDataExplorerPayload(model);

    expect(first).toEqual(second);
    expect(first.index).toEqual(model.materials.map(({ id, name }) => ({ id, name })));
    expect(first.groups).toEqual(
      model.groups.map(({ key, label, fieldKeys }) => ({
        key,
        label,
        fieldCount: fieldKeys.length,
      })),
    );
    expect(
      JSON.parse(gunzipSync(Buffer.from(first.gzipBase64, "base64")).toString("utf8")),
    ).toEqual(model);
    expect(JSON.stringify(first).length).toBeLessThan(JSON.stringify(model).length / 8);
  });
});
