import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseAtlas } from "../../src/data/schema/parse-atlas.ts";
import type { Predicate, SelectorField } from "../../src/data/schema/selector.ts";
import {
  selectMaterials,
  selectProjectedMaterials,
} from "../../src/domain/selector/engine.ts";
import { compileSelectorProjection } from "../../src/domain/selector/projection.ts";
import type { SelectorProjectionV1 } from "../../src/domain/selector/types.ts";
// The publication scanner is deliberately framework-free and is also used for
// in-memory generated artifacts.
import { scanBytes } from "../../tools/scan-publication.mjs";
import { selectorScenarios } from "./fixtures.ts";

const artifactPath = resolve(import.meta.dirname, "../../src/data/public/atlas.v1.json");
const parsed = parseAtlas(JSON.parse(readFileSync(artifactPath, "utf8")) as unknown);
if (!parsed.success) throw new Error("Canonical projection fixture is invalid");
const atlas = parsed.data;

function collectPredicateFields(predicate: Predicate, fields: Set<SelectorField>): void {
  switch (predicate.op) {
    case "equals":
    case "one-of":
    case "at-least":
    case "at-most":
    case "contains-any":
      fields.add(predicate.field);
      return;
    case "all":
    case "any":
      predicate.rules.forEach((rule) => collectPredicateFields(rule, fields));
      return;
    case "not":
      collectPredicateFields(predicate.rule, fields);
  }
}

function referencedFields(): readonly SelectorField[] {
  const fields = new Set<SelectorField>();
  for (const criterion of atlas.selector.criteria) {
    for (const option of criterion.options) {
      if (option.preferenceRule) collectPredicateFields(option.preferenceRule, fields);
      for (const gate of option.hardGates) {
        collectPredicateFields(gate.incompatibleWhen, fields);
      }
    }
  }
  return [...fields].sort();
}

function expectExactProjectionKeys(projection: SelectorProjectionV1): void {
  expect(Object.keys(projection).sort()).toEqual([
    "criteria",
    "kind",
    "materials",
    "processGates",
    "projectionVersion",
    "schemaVersion",
    "stableOrder",
  ]);

  for (const criterion of projection.criteria) {
    expect(Object.keys(criterion).sort()).toEqual([
      "defaultOptionId",
      "displayOrder",
      "id",
      "label",
      "options",
      "role",
      "weight",
    ]);
    for (const option of criterion.options) {
      expect(Object.keys(option).sort()).toEqual([
        "displayOrder",
        "hardGates",
        "id",
        "label",
        ...(option.preferenceRule ? ["preferenceRule"] : []),
      ].sort());
      for (const gate of option.hardGates) {
        expect(Object.keys(gate).sort()).toEqual([
          "incompatibleWhen",
          "processGateId",
          "reasonId",
        ]);
      }
    }
  }

  projection.processGates.forEach((gate) => {
    expect(Object.keys(gate).sort()).toEqual(["id", "label"]);
  });
  projection.materials.forEach((material) => {
    expect(Object.keys(material).sort()).toEqual(["fields", "id", "label"]);
    material.fields.forEach((field) => {
      expect(Object.keys(field).sort()).toEqual(
        field.state === "resolved"
          ? ["field", "state", "value"]
          : ["field", "reason", "state"],
      );
    });
  });
}

describe("compileSelectorProjection", () => {
  it("emits an exact deterministic allow-listed projection of only referenced facts", () => {
    const before = JSON.stringify(atlas);
    const first = compileSelectorProjection(atlas);
    const second = compileSelectorProjection(structuredClone(atlas));
    const fields = referencedFields();
    const referencedGateIds = [...new Set(
      atlas.selector.criteria.flatMap(({ options }) => options.flatMap(({ hardGates }) =>
        hardGates.map(({ processGateId }) => processGateId))),
    )].sort();

    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(atlas)).toBe(before);
    expect(first.criteria).toHaveLength(7);
    expect(first.materials).toHaveLength(23);
    expect(first.processGates.map(({ id }) => id)).toEqual(referencedGateIds);
    expectExactProjectionKeys(first);
    first.materials.forEach((material) => {
      expect(material.fields.map(({ field }) => field).sort()).toEqual(fields);
    });
  });

  it("stays below 64 KiB gzip and excludes full-Atlas-only channels and values", () => {
    const projection = compileSelectorProjection(atlas);
    const serialized = JSON.stringify(projection);
    expect(gzipSync(serialized, { level: 9 }).byteLength).toBeLessThanOrEqual(64 * 1024);

    const forbiddenKeys = [
      "sources",
      "methods",
      "basis",
      "startingProfile",
      "thermalObservations",
      "decisionLanes",
      "visualizationReferences",
      "vocabularies",
      "slug",
      "qualification",
      "verification",
      "authentication",
      "locator",
      "ingestion",
    ];
    const projectionKeys = new Set<string>();
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(visit);
      if (typeof value !== "object" || value === null) return;
      for (const [key, child] of Object.entries(value)) {
        projectionKeys.add(key);
        visit(child);
      }
    };
    visit(projection);
    forbiddenKeys.forEach((key) => expect(projectionKeys.has(key), key).toBe(false));

    expect(serialized).not.toContain(atlas.sources[0]!.url);
    expect(serialized).not.toContain(atlas.methods[0]!.name);
    expect(serialized).not.toContain(atlas.materials[0]!.thermalObservations[0]!.qualification);
  });

  it("passes the publication scanner and detects only an invented marker when injected", () => {
    const marker = "SYNTHETIC-PRIVATE-BOUNDARY-MARKER-04-05";
    const policy = {
      exactPatterns: [{ ruleId: "private-source-pattern", bytes: Buffer.from(marker) }],
      credentialPatterns: [],
      operationalPathPatterns: [],
      operationalPathExceptions: [],
      maximumBytes: 64 * 1024 * 1024,
    };
    const projection = compileSelectorProjection(atlas);
    expect(scanBytes(JSON.stringify(projection), {
      policy,
      surface: "artifact",
      location: Buffer.from("selector-projection.json"),
    })).toEqual([]);

    const marked = { ...projection, kind: marker };
    expect(scanBytes(JSON.stringify(marked), {
      policy,
      surface: "artifact",
      location: Buffer.from("selector-projection.json"),
    })).toMatchObject([{ ruleId: "private-source-pattern", surface: "artifact" }]);
  });

  it("keeps the projected entry deeply equal to the delegating Atlas entry", () => {
    const projection = compileSelectorProjection(atlas);
    const inputs = Object.values(selectorScenarios)
      .filter(({ dataSource }) => dataSource === "canonical")
      .flatMap((scenario) => "baselineInput" in scenario
        ? [scenario.input, scenario.baselineInput]
        : [scenario.input]);
    for (const input of inputs) {
      expect(selectProjectedMaterials(projection, input)).toEqual(selectMaterials(atlas, input));
    }
  });
});
