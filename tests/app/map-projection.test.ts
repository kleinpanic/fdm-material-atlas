import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import type { AtlasV1 } from "../../src/data/schema/atlas.ts";
import { MAP_MODES } from "../../src/features/map/contracts.ts";
import { compileMapProjection } from "../../src/features/map/projection.ts";
import { safeCompileMapProjection } from "../../src/features/map/safe-map.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";

const TOP_LEVEL_KEYS = [
  "impactFlex",
  "lanes",
  "methodHref",
  "modeFragments",
  "processGates",
  "serviceGuidance",
  "thermalGroups",
] as const;

function cloneAtlas(): AtlasV1 {
  return structuredClone(loadPublicAtlas());
}

function reverseCanonicalRegistries(atlas: AtlasV1): AtlasV1 {
  atlas.materials.reverse();
  atlas.sources.reverse();
  atlas.methods.reverse();
  atlas.decisionLanes.reverse();
  atlas.processGates.reverse();
  atlas.visualizationReferences.reverse();
  atlas.vocabularies.reverse();
  for (const material of atlas.materials) {
    material.thermalObservations.reverse();
  }
  return atlas;
}

describe("compact map projection", () => {
  it("compiles the complete canonical visualization inventory with resolved internal links", () => {
    const projection = compileMapProjection(loadPublicAtlas(), "/fdm-material-atlas/");

    expect(Object.keys(projection).sort()).toEqual(TOP_LEVEL_KEYS);
    expect(projection.lanes).toHaveLength(8);
    expect(new Set(projection.lanes.flatMap(({ candidates }) => candidates.map(({ id }) => id))).size)
      .toBeGreaterThan(0);
    expect(projection.serviceGuidance.records).toHaveLength(23);
    expect(projection.thermalGroups).toHaveLength(8);
    expect(projection.processGates.gates).toHaveLength(8);
    expect(projection.processGates.relationships).toHaveLength(64);
    expect(projection.impactFlex).toHaveLength(23);
    expect(Object.keys(projection.modeFragments).sort()).toEqual([...MAP_MODES].sort());

    const hrefs = JSON.stringify(projection).match(/\/fdm-material-atlas\/[^"\\]*/gu) ?? [];
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.every((href) => href.startsWith("/fdm-material-atlas/"))).toBe(true);
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.lanes[0])).toBe(true);
  });

  it("produces deterministic bytes for every relevant canonical source permutation", () => {
    const expected = JSON.stringify(compileMapProjection(loadPublicAtlas(), "/repo/"));
    const permuted = JSON.stringify(compileMapProjection(reverseCanonicalRegistries(cloneAtlas()), "/repo/"));
    expect(permuted).toBe(expected);
  });

  it("serializes only the public map contract and remains within 8 KiB gzip", () => {
    const atlas = cloneAtlas();
    const sentinel = "PRIVATE_OPERATIONAL_SENTINEL_9d12";
    atlas.sources[0]!.title = sentinel;
    atlas.methods[0]!.description = sentinel;
    atlas.materials[0]!.guidance.tradeoffs.qualification = sentinel;
    atlas.materials[0]!.startingProfile.printSpeed.qualification = sentinel;

    const serialized = JSON.stringify(compileMapProjection(atlas, "/repo/"));
    expect(serialized).not.toContain(sentinel);
    expect(serialized).not.toMatch(/https?:\/\//u);
    expect(serialized).not.toMatch(/(?:sources|methods|selector|startingProfile|thermalObservations|visualizationReferences)/u);
    expect(gzipSync(serialized).byteLength).toBeLessThanOrEqual(8 * 1024);
  });

  it.each([
    ["zero materials", (atlas: AtlasV1) => { atlas.materials = []; }],
    ["incomplete material set", (atlas: AtlasV1) => { atlas.materials.pop(); }],
    ["duplicate material ID", (atlas: AtlasV1) => { atlas.materials[1]!.id = atlas.materials[0]!.id; }],
    ["incomplete lanes", (atlas: AtlasV1) => { atlas.decisionLanes.pop(); }],
    ["incomplete gates", (atlas: AtlasV1) => { atlas.processGates.pop(); }],
    ["incomplete visualization references", (atlas: AtlasV1) => { atlas.visualizationReferences.pop(); }],
    ["dangling gate reference", (atlas: AtlasV1) => { atlas.decisionLanes[0]!.processGateIds[0] = "gate-stale" as never; }],
  ] as const)("reduces %s to one controlled projection failure", (_label, mutate) => {
    const atlas = cloneAtlas();
    mutate(atlas);
    const result = safeCompileMapProjection(() => compileMapProjection(atlas, "/repo/"));
    expect(result).toEqual({ kind: "error", code: "MAP_PROJECTION_FAILED" });
    expect(JSON.stringify(result)).not.toMatch(/material-|gate-|lane-|Error|stack/u);
  });

  it("reduces invalid hrefs, oversized output, and injected transform failures without echo", () => {
    const atlas = cloneAtlas();
    const invalidHref = safeCompileMapProjection(() => compileMapProjection(atlas, "https://rejected.example/"));
    const injected = safeCompileMapProjection(() => {
      throw new Error("PRIVATE_REJECTED_VALUE");
    });

    expect(invalidHref).toEqual({ kind: "error", code: "MAP_PROJECTION_FAILED" });
    expect(injected).toEqual({ kind: "error", code: "MAP_PROJECTION_FAILED" });
    expect(JSON.stringify([invalidHref, injected])).not.toMatch(/rejected|example|private/i);
  });
});
