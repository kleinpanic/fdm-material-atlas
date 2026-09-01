import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { AtlasV1 } from "../../src/data/schema/atlas.ts";
import {
  buildEvidenceIndex,
  buildMaterialEvidenceModel,
} from "../../src/features/materials/evidence-model.ts";
import { EVIDENCE_SCOPE_ORDER } from "../../src/lib/presentation/labels.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";

function reversedAtlas(): AtlasV1 {
  const atlas = structuredClone(loadPublicAtlas());
  atlas.materials.reverse();
  atlas.sources.reverse();
  atlas.methods.reverse();
  for (const material of atlas.materials) {
    material.thermalObservations.reverse();
  }
  return atlas;
}

function firstBasis(atlas: AtlasV1) {
  return atlas.materials[0]!.familyOrFill.basis[0]!;
}

describe("material evidence model", () => {
  it("retains every real claim/basis edge in one bidirectional index", () => {
    const atlas = loadPublicAtlas();
    const index = buildEvidenceIndex(atlas);

    expect(index.edgeCount).toBe(999);
    expect(index.records).toHaveLength(30);
    expect(index.materials).toHaveLength(23);
    expect(index.records.flatMap(({ uses }) => uses)).toHaveLength(999);
    expect(index.materials.reduce((sum, material) => sum + material.edgeCount, 0)).toBe(999);
    expect(
      index.records
        .filter(({ record }) => record.kind === "source")
        .every(({ uses }) => uses.length > 0),
    ).toBe(true);
    expect(
      index.records.filter(({ record, uses }) => record.kind === "method" && uses.length === 0),
    ).toHaveLength(3);
  });

  it("groups records only after preserving scopes and exact supported claims", () => {
    const atlas = loadPublicAtlas();
    const material = atlas.materials[0]!;
    const model = buildMaterialEvidenceModel(atlas, material);

    expect(model.materialSlug).toBe(material.slug);
    expect(
      new Set(
        model.records.map(({ target }) =>
          target.kind === "source" ? target.sourceId : target.methodId,
        ),
      ).size,
    ).toBe(model.records.length);
    for (const record of model.records) {
      expect(record.scopes).toEqual(
        [...record.scopes].sort(
          (left, right) => EVIDENCE_SCOPE_ORDER.indexOf(left) - EVIDENCE_SCOPE_ORDER.indexOf(right),
        ),
      );
      expect(new Set(record.supportedClaims.map(({ claimId }) => claimId)).size).toBe(
        record.supportedClaims.length,
      );
      expect(record.edges.every(({ scope }) => record.scopes.includes(scope))).toBe(true);
    }
  });

  it("uses deterministic route-neutral claim targets and registry order", () => {
    const index = buildEvidenceIndex(loadPublicAtlas());
    const uses = index.records.flatMap(({ uses }) => uses);

    expect(
      uses.every(
        ({ materialSlug, claimAnchor }) =>
          /^[a-z][a-z0-9-]*$/u.test(materialSlug) && /^[a-z][a-z0-9-]*$/u.test(claimAnchor),
      ),
    ).toBe(true);
    expect(uses.every((use) => !("href" in use))).toBe(true);
    expect(index.records.every((record) => !("href" in record))).toBe(true);
  });

  it("is invariant to material, ledger, and thermal array permutations", () => {
    expect(buildEvidenceIndex(reversedAtlas())).toEqual(buildEvidenceIndex(loadPublicAtlas()));
  });

  it("keeps external URLs only on validated source records", () => {
    const index = buildEvidenceIndex(loadPublicAtlas());

    for (const record of index.records) {
      if (record.record.kind === "source") {
        expect(record.record.externalUrl).toMatch(/^https:\/\//u);
      } else {
        expect("externalUrl" in record.record).toBe(false);
      }
    }
    expect(JSON.stringify(index)).not.toMatch(/<\/?[a-z][^>]*>/iu);
  });

  it.each([
    [
      "duplicate records",
      "EVIDENCE_RECORD_DUPLICATE",
      (atlas: AtlasV1) => {
        atlas.sources.push(structuredClone(atlas.sources[0]!));
      },
    ],
    [
      "missing basis",
      "EVIDENCE_BASIS_MISSING",
      (atlas: AtlasV1) => {
        const basis = firstBasis(atlas);
        if (basis.kind === "source")
          basis.sourceId = "source-does-not-exist" as typeof basis.sourceId;
        else basis.methodId = "method-does-not-exist" as typeof basis.methodId;
      },
    ],
    [
      "wrong-kind basis",
      "EVIDENCE_BASIS_WRONG_KIND",
      (atlas: AtlasV1) => {
        atlas.materials[0]!.familyOrFill.basis[0] = {
          kind: "source",
          sourceId: atlas.methods[0]!.id as unknown as AtlasV1["sources"][number]["id"],
          scope: "family-guidance",
        };
      },
    ],
    [
      "unused record",
      "EVIDENCE_RECORD_UNUSED",
      (atlas: AtlasV1) => {
        atlas.sources.push({
          id: "source-unused-record" as AtlasV1["sources"][number]["id"],
          title: "Unused public source",
          publisher: "Example publisher",
          kind: "manufacturer-guide",
          url: "https://example.com/unused",
        });
      },
    ],
  ])("fails %s with one stable redacted code", (_name, code, mutate) => {
    const atlas = structuredClone(loadPublicAtlas());
    mutate(atlas);

    expect(() => buildEvidenceIndex(atlas)).toThrow(code);
    try {
      buildEvidenceIndex(atlas);
    } catch (error) {
      expect((error as Error).message).toBe(code);
      expect((error as Error).message).not.toContain("does-not-exist");
      expect((error as Error).message).not.toContain("Unused public source");
    }
  });

  it("does not import routing or emit hrefs inside the route-neutral layer", () => {
    const source = readFileSync("src/features/materials/evidence-model.ts", "utf8");
    expect(source).not.toMatch(/(?:lib\/routes|from ["'][^"']*routes|\bhref\b)/u);
  });
});
