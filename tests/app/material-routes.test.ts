import { describe, expect, it } from "vitest";

import { buildEvidenceIndex } from "../../src/features/materials/evidence-model.ts";
import {
  fragmentHref,
  internalFragmentHref,
  internalHref,
} from "../../src/lib/routes.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";

const DETAIL_FRAGMENTS = [
  "overview",
  "thermal",
  "properties",
  "process",
  "uses-tradeoffs",
  "starting-profile",
  "evidence",
  "limitations",
  "relationships",
] as const;

const METHOD_FRAGMENTS = [
  "evidence-scopes",
  "thermal-metrics",
  "selector-scoring",
  "qualitative-guidance",
  "starting-profiles",
  "methods",
  "sources",
  "limitations",
] as const;

describe("Phase 6 material route inventory", () => {
  it.each(["/", "/atlas-preview/"])("composes every route and anchor exactly once under %s", (base) => {
    const atlas = loadPublicAtlas();
    const evidence = buildEvidenceIndex(atlas);
    const urls = new Set<string>();

    urls.add(internalHref(base, { id: "materials" }));
    urls.add(internalHref(base, { id: "method" }));
    for (const material of atlas.materials) {
      const target = { id: "material" as const, slug: material.slug };
      urls.add(internalHref(base, target));
      for (const fragment of DETAIL_FRAGMENTS) {
        urls.add(internalFragmentHref(base, target, fragment));
      }
    }
    for (const fragment of METHOD_FRAGMENTS) {
      urls.add(internalFragmentHref(base, { id: "method" }, fragment));
    }
    for (const source of atlas.sources) {
      urls.add(internalFragmentHref(base, { id: "method" }, source.id));
    }
    for (const method of atlas.methods) {
      urls.add(internalFragmentHref(base, { id: "method" }, method.id));
    }
    for (const record of evidence.records) {
      const recordId = record.target.kind === "source" ? record.target.sourceId : record.target.methodId;
      expect(internalFragmentHref(base, { id: "method" }, recordId)).toContain(`${fragmentHref(recordId)}`);
      for (const use of record.uses) {
        expect(internalFragmentHref(base, { id: "material", slug: use.materialSlug }, use.claimAnchor))
          .toContain(`${fragmentHref(use.claimAnchor)}`);
      }
    }

    const expected = 2 + atlas.materials.length * (1 + DETAIL_FRAGMENTS.length)
      + METHOD_FRAGMENTS.length + atlas.sources.length + atlas.methods.length
      + evidence.records.flatMap(({ uses }) => uses).length;
    expect(urls.size).toBeLessThanOrEqual(expected);
    expect(atlas.materials).toHaveLength(23);
    expect(evidence.edgeCount).toBe(999);
  });

  it("has no duplicate public material, source, or method identifiers", () => {
    const atlas = loadPublicAtlas();
    const materialSlugs = atlas.materials.map(({ slug }) => slug);
    const recordIds = [...atlas.sources, ...atlas.methods].map(({ id }) => id);

    expect(new Set(materialSlugs).size).toBe(materialSlugs.length);
    expect(new Set(recordIds).size).toBe(recordIds.length);
  });

  it("keeps production selector route availability outside this helper inventory", async () => {
    const routesSource = await import("node:fs").then(({ readFileSync }) =>
      readFileSync("src/lib/routes.ts", "utf8")
    );
    expect(routesSource).not.toMatch(/PUBLIC_ROUTE_REGISTRY|public-atlas|atlas\.v1\.json/u);
  });
});
