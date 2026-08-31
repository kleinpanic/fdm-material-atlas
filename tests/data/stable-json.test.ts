import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { parseAtlas } from "../../src/data/schema/parse-atlas.ts";
import { serializeAtlas } from "../../src/data/serialization/stable-json.ts";
import { createMinimalAtlas } from "../fixtures/atlas-minimal.valid.ts";
import { privateLookingSyntheticMarker } from "../fixtures/atlas-invalid-cases.ts";

function parsedAtlas(candidate: unknown = createMinimalAtlas()) {
  const result = parseAtlas(candidate);
  if (!result.success) throw new Error(`Synthetic fixture failed with ${result.issues.length} safe issues`);
  return result.data;
}

function withPermutationData() {
  const atlas = createMinimalAtlas();
  atlas.sources.push({
    id: "source-synthetic-second",
    title: "Second synthetic guide",
    publisher: "Synthetic Materials Institute",
    kind: "technical-data-sheet",
    url: "https://materials.example.com/second-guide",
  } as never);
  atlas.methods.push({
    id: "method-synthetic-second",
    name: "Second synthetic method",
    description: "Provides another public-safe method record.",
    limitations: ["Synthetic limitation order is meaningful."],
  } as never);
  atlas.processGates.push({
    id: "gate-synthetic-drying",
    label: "Synthetic drying capability",
    capability: "drying",
    requirement: "Use suitable drying equipment when this gate applies.",
    verification: "Confirm that the equipment meets the drying requirement.",
    basis: [{
      kind: "method",
      methodId: "method-synthetic-review",
      scope: "derived-selector-logic",
    }],
  } as never);
  atlas.visualizationReferences.push({
    id: "visualization-synthetic-second",
    kind: "equipment-gate",
    subject: { kind: "process-gate-id", processGateId: "gate-synthetic-drying" },
    related: [{ kind: "material-id", materialId: "material-synthetic-alpha" }],
  } as never);
  atlas.vocabularies.push({
    id: "vocabulary-synthetic-second",
    label: "Second synthetic vocabulary",
    ordered: false,
    terms: [{ value: "synthetic-value", label: "Synthetic value" }],
  } as never);
  atlas.materials[0]!.properties.density.basis.push({
    kind: "source",
    sourceId: "source-synthetic-guide",
    scope: "representative-product",
  } as never);
  return atlas;
}

function reverseCanonicalSets(atlas: ReturnType<typeof withPermutationData>) {
  atlas.sources.reverse();
  atlas.methods.reverse();
  atlas.selector.criteria.reverse();
  atlas.processGates.reverse();
  atlas.decisionLanes.reverse();
  atlas.visualizationReferences.reverse();
  atlas.vocabularies.reverse();
  atlas.materials[0]!.properties.density.basis.reverse();
  atlas.visualizationReferences[1]!.related.reverse();
  return atlas;
}

const validatorPath = fileURLToPath(new URL("../../tools/validate-public-data.ts", import.meta.url));

function runValidator(contents: string) {
  const root = mkdtempSync(join(tmpdir(), "atlas-validator-"));
  const dataPath = join(root, "src/data/public/atlas.v1.json");
  mkdirSync(dirname(dataPath), { recursive: true });
  writeFileSync(dataPath, contents, "utf8");
  const result = spawnSync(process.execPath, ["--experimental-strip-types", validatorPath], {
    cwd: root,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "" },
  });
  rmSync(root, { recursive: true, force: true });
  return result;
}

describe("canonical AtlasV1 serialization", () => {
  it("produces identical UTF-8 JSON for equivalent input permutations", () => {
    const first = parsedAtlas(withPermutationData());
    const second = parsedAtlas(reverseCanonicalSets(withPermutationData()));

    expect(serializeAtlas(first)).toBe(serializeAtlas(second));
  });

  it("uses schema order, NFC text, two-space JSON, LF, and exactly one final newline", () => {
    const candidate = createMinimalAtlas();
    candidate.materials[0]!.name = "Synthe\u0301tic Alpha";
    const serialized = serializeAtlas(parsedAtlas(candidate));

    expect(serialized.startsWith('{\n  "schemaVersion": 1,\n  "materials": [')).toBe(true);
    expect(serialized).toContain("Synth\u00e9tic Alpha");
    expect(serialized).not.toContain("\r");
    expect(serialized.endsWith("\n")).toBe(true);
    expect(serialized.endsWith("\n\n")).toBe(false);
  });

  it("preserves the canonical value across parse, serialize, and parse", () => {
    const first = parsedAtlas(reverseCanonicalSets(withPermutationData()));
    const serialized = serializeAtlas(first);
    const reparsed = parseAtlas(JSON.parse(serialized));

    expect(reparsed.success).toBe(true);
    if (reparsed.success) {
      expect(serializeAtlas(reparsed.data)).toBe(serialized);
      expect(reparsed.data.materials[0]!.displayOrder).toBe(1);
    }
  });
});

describe("public data validator CLI", () => {
  it("accepts only exact canonical bytes and emits aggregate public-safe counts", () => {
    const result = runValidator(serializeAtlas(parsedAtlas()));

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      counts: {
        materials: 1,
        sources: 1,
        methods: 1,
        processGates: 1,
        decisionLanes: 8,
        visualizationReferences: 1,
        vocabularies: 1,
      },
    });
    expect(result.stderr).toBe("");
  }, 15_000);

  it("rejects valid but noncanonical bytes with SERIALIZATION_DRIFT", () => {
    const result = runValidator(JSON.stringify(parsedAtlas()));

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      ok: false,
      issueCount: 1,
      issues: [{ code: "SERIALIZATION_DRIFT", pointer: "/" }],
    });
  }, 15_000);

  it("never reproduces rejected values in diagnostics", () => {
    const invalid = {
      ...createMinimalAtlas(),
      [privateLookingSyntheticMarker]: privateLookingSyntheticMarker,
    };
    const result = runValidator(JSON.stringify(invalid));
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).not.toBe(0);
    expect(output).toContain("SCHEMA_UNKNOWN_KEY");
    expect(output).not.toContain(privateLookingSyntheticMarker);
  }, 15_000);
});
