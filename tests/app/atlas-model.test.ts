import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { buildAtlasPageModel } from "../../src/features/atlas/model.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";

const atlas = loadPublicAtlas();

describe("buildAtlasPageModel", () => {
  it("builds the exact compact, ordered, base-safe 23-material index", () => {
    const model = buildAtlasPageModel(atlas, "/atlas-preview/");
    expect(Object.keys(model).sort()).toEqual(["filters", "rows"]);
    expect(model.rows).toHaveLength(23);
    expect(model.rows.map(({ displayOrder, id }) => [displayOrder, id])).toEqual(
      [...model.rows]
        .sort((a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id))
        .map(({ displayOrder, id }) => [displayOrder, id]),
    );
    expect(
      model.rows.every(
        ({ href }) => href.startsWith("/atlas-preview/materials/") && href.endsWith("/"),
      ),
    ).toBe(true);
    expect(Object.keys(model.rows[0]!).sort()).toEqual([
      "displayOrder",
      "evidence",
      "facts",
      "family",
      "href",
      "id",
      "name",
      "serviceTemperature",
      "slug",
      "thermalObservations",
      "uses",
    ]);
    expect(model.filters.map(({ id }) => id)).toEqual([
      "print-difficulty",
      "enclosure",
      "hardened-nozzle",
      "drying-priority",
      "ventilation",
      "cost-tier",
      "outdoor-uv",
      "impact-resistance",
      "flexibility",
      "chemical-resistance",
      "cooling-shrink-risk",
      "dimensional-stability",
    ]);
    expect(gzipSync(JSON.stringify(model), { level: 9 }).byteLength).toBeLessThanOrEqual(64 * 1024);
    expect(
      Object.isFrozen(model) && Object.isFrozen(model.rows) && Object.isFrozen(model.rows[0]),
    ).toBe(true);
  });

  it("keeps practical service guidance distinct from named thermal observations", () => {
    const row = buildAtlasPageModel(atlas, "/").rows[0]!;
    expect(row.serviceTemperature).toHaveProperty("state");
    expect(row.thermalObservations).toHaveLength(1);
    expect(row.thermalObservations[0]).toEqual(
      expect.objectContaining({
        metricLabel: expect.any(String),
        qualification: expect.any(String),
      }),
    );
    expect(row.thermalObservations[0]).not.toHaveProperty("serviceTemperature");
  });

  it("is byte deterministic under material, vocabulary, and ledger permutations", () => {
    const reordered = {
      ...structuredClone(atlas),
      materials: [...atlas.materials].reverse(),
      vocabularies: [...atlas.vocabularies].reverse(),
      sources: [...atlas.sources].reverse(),
      methods: [...atlas.methods].reverse(),
    };
    expect(JSON.stringify(buildAtlasPageModel(reordered, "/x/"))).toBe(
      JSON.stringify(buildAtlasPageModel(atlas, "/x/")),
    );
  });

  it("omits complete-Atlas and operational channels", () => {
    const serialized = JSON.stringify(buildAtlasPageModel(atlas, "/"));
    for (const forbidden of [
      '"sources"',
      '"methods"',
      '"basis"',
      '"startingProfile"',
      '"decisionLanes"',
      '"visualizationReferences"',
      '"url"',
      '"sourceContract"',
      '"credentials"',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it.each([
    ["ATLAS_PAGE_EMPTY", { ...structuredClone(atlas), materials: [] }],
    [
      "ATLAS_PAGE_MATERIAL_DUPLICATE",
      {
        ...structuredClone(atlas),
        materials: [...atlas.materials, structuredClone(atlas.materials[0]!)],
      },
    ],
    [
      "ATLAS_PAGE_SLUG_DUPLICATE",
      {
        ...structuredClone(atlas),
        materials: atlas.materials.map((m, i) =>
          i === 1 ? { ...m, slug: atlas.materials[0]!.slug } : m,
        ),
      },
    ],
    [
      "ATLAS_PAGE_VOCABULARY_INVALID",
      {
        ...structuredClone(atlas),
        vocabularies: atlas.vocabularies.filter((v) => v.id !== "vocabulary-cost-tier"),
      },
    ],
  ])("fails malformed input with stable code %s", (code, candidate) => {
    expect(() => buildAtlasPageModel(candidate as never, "/")).toThrow(code);
  });
});
