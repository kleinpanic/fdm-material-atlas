import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseAtlas } from "../../src/data/schema/parse-atlas.ts";
import { serializeAtlas } from "../../src/data/serialization/stable-json.ts";
import { createMinimalAtlas } from "../fixtures/atlas-minimal.valid.ts";
import {
  PublicDataSummaryError,
  formatPublicDataSummary,
  readCanonicalAtlasFile,
  summarizePublicDataChange,
} from "../../tools/summarize-public-data-change.mjs";

function fixtureDirectory(): string {
  return mkdtempSync(join(tmpdir(), "atlas-public-summary-"));
}

function validatedMinimalAtlas(value: unknown = createMinimalAtlas()) {
  const result = parseAtlas(value);
  if (!result.success) throw new Error("SUMMARY_FIXTURE_INVALID");
  return result.data;
}

function fixturePath(name: string, atlas = validatedMinimalAtlas()): string {
  const path = join(fixtureDirectory(), name);
  writeFileSync(path, serializeAtlas(atlas), { encoding: "utf8", mode: 0o600 });
  return path;
}

function renamedAtlas() {
  const atlas = createMinimalAtlas();
  const material = atlas.materials[0]!;
  material.id = "material-synthetic-beta";
  material.slug = "synthetic-beta";
  material.name = "Synthetic Beta";
  const reference = atlas.visualizationReferences[0]!;
  reference.subject = { kind: "material-id", materialId: material.id };
  reference.related = reference.related.map((target) =>
    target.kind === "material-route" ? { kind: "material-route", slug: material.slug } : target,
  );
  return validatedMinimalAtlas(atlas);
}

describe("bounded public canonical-data change summary", () => {
  it("reports equal canonical artifacts as unchanged", () => {
    const atlas = validatedMinimalAtlas();
    const summary = summarizePublicDataChange(atlas, structuredClone(atlas));

    expect(summary).toEqual({
      schemaVersion: 1,
      status: "unchanged",
      counts: {
        materials: { before: 1, after: 1, delta: 0 },
        sources: { before: 1, after: 1, delta: 0 },
        methods: { before: 1, after: 1, delta: 0 },
        selectorCriteria: { before: 7, after: 7, delta: 0 },
        selectorOptions: { before: 7, after: 7, delta: 0 },
        processGates: { before: 1, after: 1, delta: 0 },
        decisionLanes: { before: 8, after: 8, delta: 0 },
        visualizationReferences: { before: 1, after: 1, delta: 0 },
        vocabularies: { before: 1, after: 1, delta: 0 },
        evidenceReferences: { before: 30, after: 30, delta: 0 },
      },
      identifiers: {},
      changedPropertyGroups: {},
    });
  });

  it("reports bounded IDs, aggregate groups, and evidence-reference counts deterministically", () => {
    const before = validatedMinimalAtlas();
    const after = validatedMinimalAtlas();
    const impact = after.materials[0]!.properties.impactResistance.value;
    const tradeoffs = after.materials[0]!.guidance.tradeoffs.value;
    if (impact.state !== "known" || tradeoffs.state !== "known") {
      throw new Error("SUMMARY_FIXTURE_STATE_INVALID");
    }
    impact.value = "high-impact";
    tradeoffs.value = ["Use a reviewed product profile"];
    after.materials[0]!.familyOrFill.basis.push(
      structuredClone(after.materials[0]!.familyOrFill.basis[0]!),
    );

    const first = summarizePublicDataChange(before, after, { identifierLimit: 1 });
    const second = summarizePublicDataChange(structuredClone(before), structuredClone(after), {
      identifierLimit: 1,
    });

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      status: "changed",
      counts: { evidenceReferences: { before: 30, after: 31, delta: 1 } },
      changedPropertyGroups: {
        evidence: { changed: 1, identifiers: ["material-synthetic-alpha"], omitted: 0 },
        guidance: { changed: 1, identifiers: ["material-synthetic-alpha"], omitted: 0 },
        properties: { changed: 1, identifiers: ["material-synthetic-alpha"], omitted: 0 },
      },
    });

    const renamed = summarizePublicDataChange(before, renamedAtlas(), { identifierLimit: 1 });
    expect(renamed).toMatchObject({
      identifiers: {
        materials: {
          added: ["material-synthetic-beta"],
          addedOmitted: 0,
          removed: ["material-synthetic-alpha"],
          removedOmitted: 0,
        },
      },
    });
  });

  it("formats controlled JSON and Markdown without raw public records or source text", () => {
    const before = validatedMinimalAtlas();
    const after = validatedMinimalAtlas();
    const tradeoffs = after.materials[0]!.guidance.tradeoffs.value;
    if (tradeoffs.state !== "known") throw new Error("SUMMARY_FIXTURE_STATE_INVALID");
    tradeoffs.value = [
      "Do not expose this complete source sentence or https://private.invalid/source",
    ];
    const summary = summarizePublicDataChange(before, after);

    for (const format of ["json", "markdown"] as const) {
      const output = formatPublicDataSummary(summary, format);
      if (output === undefined) throw new Error("SUMMARY_FORMAT_FAILED");
      expect(output).not.toContain("private.invalid");
      expect(output).not.toContain("Do not expose");
      expect(output).not.toContain("Synthetic Materials Institute");
      expect(output.length).toBeLessThan(12_000);
    }
  });

  it("accepts only canonical regular files in the operating-system temporary directory", () => {
    const canonical = fixturePath("before.json");
    const atlas = readCanonicalAtlasFile(canonical);
    if (atlas === undefined) throw new Error("SUMMARY_READ_FAILED");
    expect(atlas.materials).toHaveLength(1);

    const symlink = join(fixtureDirectory(), "atlas-link.json");
    symlinkSync(canonical, symlink);
    expect(() => readCanonicalAtlasFile(symlink)).toThrowError(
      expect.objectContaining({ code: "SUMMARY_INPUT_SYMLINK" }),
    );

    const unexpected = join(process.cwd(), "package.json");
    expect(() => readCanonicalAtlasFile(unexpected)).toThrowError(
      expect.objectContaining({ code: "SUMMARY_PATH_UNEXPECTED" }),
    );
  });

  it("rejects invalid, noncanonical, and oversized inputs with stable data-free codes", () => {
    const invalid = join(fixtureDirectory(), "invalid.json");
    writeFileSync(invalid, '{"unknown":"credential-secret"}\n', "utf8");
    const noncanonical = fixturePath("noncanonical.json");
    writeFileSync(noncanonical, JSON.stringify(createMinimalAtlas()), "utf8");
    const oversized = join(fixtureDirectory(), "oversized.json");
    writeFileSync(oversized, " ".repeat(1_100_000), "utf8");

    const cases = [
      [invalid, "SUMMARY_INPUT_INVALID"],
      [noncanonical, "SUMMARY_INPUT_NONCANONICAL"],
      [oversized, "SUMMARY_INPUT_TOO_LARGE"],
    ] as const;
    for (const [path, code] of cases) {
      try {
        readCanonicalAtlasFile(path);
        throw new Error("expected fixture rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(PublicDataSummaryError);
        expect((error as PublicDataSummaryError).code).toBe(code);
        expect(String(error)).not.toContain(readFileSync(path, "utf8").slice(0, 32));
      }
    }
  });

  it("keeps the tool source read-only and offline", () => {
    const source = readFileSync(
      new URL("../../tools/summarize-public-data-change.mjs", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/u);
    expect(source).not.toMatch(/["'`](?:commit|push|pull-request|merge|refresh|gog)["'`]/iu);
    expect(source).not.toMatch(/\bgit\s+(?:commit|push|merge)\b/iu);
    expect(source).not.toMatch(/writeFile|appendFile|createWriteStream/u);
  });
});
