import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import * as selector from "../../src/domain/selector/index.ts";

const selectorRoot = resolve(import.meta.dirname, "../../src/domain/selector");
const publicEntry = resolve(selectorRoot, "index.ts");
const projectedEntry = resolve(selectorRoot, "engine.ts");

function runtimeDependencies(entry: string): readonly string[] {
  const visited = new Set<string>();
  const visit = (file: string): void => {
    if (visited.has(file)) return;
    visited.add(file);
    const source = readFileSync(file, "utf8");
    const specifiers = source.matchAll(
      /(?:^|\n)\s*(?!import\s+type\b)(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/gu,
    );
    for (const match of specifiers) {
      const specifier = match[1]!;
      if (!specifier.startsWith(".")) continue;
      const candidate = resolve(dirname(file), specifier);
      const resolved = extname(candidate) ? candidate : `${candidate}.ts`;
      if (existsSync(resolved)) visit(resolved);
    }
  };
  visit(entry);
  return [...visited].sort();
}

describe("selector public API boundary", () => {
  it("exports one compact compiler, one projected evaluator, one Atlas adapter, and one resolver", () => {
    expect(Object.keys(selector).sort()).toEqual([
      "compileSelectorProjection",
      "resolveExplanationToken",
      "selectMaterials",
      "selectProjectedMaterials",
    ]);
    expect(typeof selector.compileSelectorProjection).toBe("function");
    expect(typeof selector.selectProjectedMaterials).toBe("function");
    expect(typeof selector.selectMaterials).toBe("function");
    expect(typeof selector.resolveExplanationToken).toBe("function");
  });

  it("keeps the runtime dependency closure free of UI, frameworks, source adapters, and dynamic code", () => {
    const files = runtimeDependencies(publicEntry);
    const sources = files.map((file) => readFileSync(file, "utf8")).join("\n");
    expect(files.some((file) => file.endsWith("/engine.ts"))).toBe(true);
    expect(files.some((file) => file.endsWith("/projection.ts"))).toBe(true);
    expect(files.some((file) => file.endsWith("/explanations.ts"))).toBe(true);
    expect(files).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/\.(?:astro|tsx|jsx)$/u),
      expect.stringMatching(/(?:private|source-adapter|worksheet|workbook)/iu),
    ]));
    expect(sources).not.toMatch(/(?:from\s+["'](?:astro|preact|react)|\bdocument\.|\bwindow\.)/u);
    expect(sources).not.toMatch(/\b(?:eval|Function)\s*\(/u);
  });

  it("keeps the browser-facing evaluator closure free of the full Atlas artifact", () => {
    const files = runtimeDependencies(projectedEntry);
    const sources = files.map((file) => readFileSync(file, "utf8")).join("\n");
    expect(sources).not.toMatch(/atlas\.v1\.json/u);
    expect(files).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/src\/data\/public/u),
    ]));
  });

  it("contains only one evaluator and one finalization path", () => {
    const engine = readFileSync(projectedEntry, "utf8");
    expect(engine.match(/export function selectProjectedMaterials\s*\(/gu)).toHaveLength(1);
    expect(engine.match(/export function selectMaterials\s*\(/gu)).toHaveLength(1);
    expect(engine.match(/function finalizeCompatible\s*\(/gu)).toHaveLength(1);
    expect(engine.match(/function finalizeEliminated\s*\(/gu)).toHaveLength(1);
    expect(engine).not.toMatch(/function\s+(?:score|rank|evaluateMaterials|selectAtlasMaterials)\s*\(/u);
  });

  it("makes the Atlas convenience body compile and delegate without calculation", () => {
    const engine = readFileSync(projectedEntry, "utf8");
    const adapter = engine.match(
      /export function selectMaterials[\s\S]*?\{([\s\S]*?)\n\}/u,
    )?.[1];
    expect(adapter).toBeDefined();
    expect(adapter?.replace(/\s+/gu, " ").trim()).toBe(
      "return selectProjectedMaterials(compileSelectorProjection(atlas), input);",
    );
  });
});
