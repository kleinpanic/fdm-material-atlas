import { describe, expect, it } from "vitest";

import type { AtlasV1 } from "../../src/data/schema/atlas.ts";
import { DATA_ATTRIBUTE_REGISTRY } from "../../src/features/data-explorer/attribute-registry.ts";
import { buildDataExplorerModel } from "../../src/features/data-explorer/model.ts";
import { loadPublicAtlas } from "../../src/lib/public-atlas.ts";

describe("data explorer model", () => {
  it("compiles all materials and all registered attributes", () => {
    const atlas = loadPublicAtlas();
    const model = buildDataExplorerModel(atlas, "/atlas-preview/");

    expect(model.groups).toHaveLength(8);
    expect(model.fields).toHaveLength(32);
    expect(model.fields.map(({ key }) => key)).toEqual(DATA_ATTRIBUTE_REGISTRY.map(({ key }) => key));
    expect(model.materials).toHaveLength(23);
    for (const material of model.materials) {
      expect(material.cells).toHaveLength(32);
      expect(material.cells.map(({ key }) => key)).toEqual(DATA_ATTRIBUTE_REGISTRY.map(({ key }) => key));
      expect(material.href).toMatch(/^\/atlas-preview\/materials\/[a-z0-9-]+\/$/u);
    }
  });

  it("is byte deterministic when canonical arrays are permuted", () => {
    const atlas = structuredClone(loadPublicAtlas());
    const expected = JSON.stringify(buildDataExplorerModel(atlas, "/"));
    atlas.materials.reverse();
    atlas.vocabularies.reverse();
    atlas.sources.reverse();
    atlas.methods.reverse();
    for (const material of atlas.materials) {
      material.thermalObservations.reverse();
      material.familyOrFill.basis.reverse();
    }
    expect(JSON.stringify(buildDataExplorerModel(atlas, "/"))).toBe(expected);
  });

  it("searches only normalized public identity and visible cell text", () => {
    const model = buildDataExplorerModel(loadPublicAtlas(), "/");
    for (const material of model.materials) {
      expect(material.searchKey).toBe(material.searchKey.normalize("NFC").toLocaleLowerCase("en-US"));
      expect(material.searchKey).toContain(material.name.normalize("NFC").toLocaleLowerCase("en-US"));
      expect(material.searchKey).toContain(material.family.normalize("NFC").toLocaleLowerCase("en-US"));
      for (const cell of material.cells) {
        for (const text of cell.searchText) {
          expect(material.searchKey).toContain(text.normalize("NFC").toLocaleLowerCase("en-US"));
        }
      }
    }
  });

  it("exposes no raw canonical branches, operational metadata, or external URLs", () => {
    const model = buildDataExplorerModel(loadPublicAtlas(), "/");
    const serialized = JSON.stringify(model);
    const keys = new Set<string>();
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(visit);
      if (typeof value !== "object" || value === null) return;
      for (const [key, child] of Object.entries(value)) {
        keys.add(key);
        visit(child);
      }
    };
    visit(model);
    expect([...keys]).not.toEqual(expect.arrayContaining([
      "atlas", "selector", "decisionLanes", "processGates", "visualizationReferences",
      "sources", "methods", "basis", "note", "externalUrl", "displayOrder",
    ]));
    expect(serialized).not.toMatch(/https?:\/\//u);
    expect(serialized).not.toMatch(/source-[a-z0-9-]+|method-[a-z0-9-]+|claim-[a-z0-9-]+/u);
  });

  it("fails incomplete and duplicate canonical inputs with controlled codes", () => {
    const empty = structuredClone(loadPublicAtlas()) as AtlasV1;
    empty.materials = [];
    expect(() => buildDataExplorerModel(empty, "/")).toThrow("DATA_EXPLORER_MATERIALS_EMPTY");

    const duplicate = structuredClone(loadPublicAtlas()) as AtlasV1;
    duplicate.materials.push(structuredClone(duplicate.materials[0]!));
    expect(() => buildDataExplorerModel(duplicate, "/")).toThrow("DATA_EXPLORER_MATERIAL_DUPLICATE");
  });
});
