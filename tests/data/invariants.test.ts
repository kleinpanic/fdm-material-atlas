import { describe, expect, it } from "vitest";

import { parseAtlas } from "../../src/data/schema/parse-atlas.ts";
import { createMinimalAtlas } from "../fixtures/atlas-minimal.valid.ts";
import {
  mutateAtlas,
  privateLookingSyntheticMarker,
} from "../fixtures/atlas-invalid-cases.ts";

describe("AtlasV1 strict parse boundary", () => {
  it("accepts the synthetic fixture and every canonical root collection", () => {
    const result = parseAtlas(createMinimalAtlas());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schemaVersion).toBe(1);
      expect(Object.keys(result.data)).toEqual([
        "schemaVersion",
        "materials",
        "sources",
        "methods",
        "selector",
        "processGates",
        "decisionLanes",
        "visualizationReferences",
        "vocabularies",
      ]);
    }
  });

  it("rejects an unsupported schema version with a stable safe diagnostic", () => {
    const atlas = { ...createMinimalAtlas(), schemaVersion: 2 };
    const result = parseAtlas(atlas);

    expect(result).toEqual({
      success: false,
      issues: [{ code: "SCHEMA_VERSION_UNSUPPORTED", pointer: "/schemaVersion" }],
    });
  });

  it("rejects root and nested unknown keys without disclosing their names or values", () => {
    const root = {
      ...createMinimalAtlas(),
      [privateLookingSyntheticMarker]: privateLookingSyntheticMarker,
    };
    const nested = mutateAtlas((atlas) => {
      Object.assign(atlas.materials[0]!, {
        [privateLookingSyntheticMarker]: privateLookingSyntheticMarker,
      });
    });

    for (const candidate of [root, nested]) {
      const result = parseAtlas(candidate);
      expect(result.success).toBe(false);
      const rendered = JSON.stringify(result);
      expect(rendered).toContain("SCHEMA_UNKNOWN_KEY");
      expect(rendered).not.toContain(privateLookingSyntheticMarker);
      if (!result.success) {
        for (const issue of result.issues) {
          expect(Object.keys(issue).every((key) => ["code", "pointer", "entityId"].includes(key))).toBe(true);
          expect(issue.pointer.startsWith("/")).toBe(true);
        }
      }
    }
  });
});

