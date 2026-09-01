import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  Phase8BuildError,
  assertPreactivationReceipt,
  assertRegistryStage,
  verifyPhase8Build,
} from "../../tools/verify-phase8-build.mjs";

const temporaryRoots: string[] = [];
const temporaryReceiptFiles: string[] = [];
const modes = ["decision-paths", "thermal-ranges", "process-gates", "impact-flex-space"];
const lanes = [
  "lane-easy-prototypes",
  "lane-outdoor",
  "lane-impact-flex",
  "lane-chemical-exposure",
  "lane-high-heat-sustained-load",
  "lane-industrial",
  "lane-decorative-fills",
  "lane-support-materials",
];
const laneLabels = [
  "Easy prototypes",
  "Outdoor",
  "Impact and flex",
  "Chemical exposure",
  "High heat and sustained load",
  "Industrial",
  "Decorative fills",
  "Support materials",
];

function finalRegistrySource(): string {
  return `decisionMaps: Object.freeze([${lanes.map((lane) =>
    `{ laneId: "${lane}", target: { id: "map" }, fragment: "${lane}" }`,
  ).join(",")}])`;
}

function projection(base: string) {
  const prefix = base === "/" ? "" : base.slice(0, -1);
  const materials = Array.from({ length: 23 }, (_, index) => ({
    id: `material-${index + 1}`,
    name: `Material ${index + 1}`,
    href: `${prefix}/materials/material-${index + 1}/`,
    displayOrder: index + 1,
  }));
  const gateRecords = Array.from({ length: 8 }, (_, index) => ({
    id: `gate-${index + 1}`,
    label: `Gate ${index + 1}`,
    capabilityLabel: `Capability ${index + 1}`,
    requirement: `Requirement ${index + 1}`,
    verification: `Verification ${index + 1}`,
    href: `${prefix}/map/#gate-${index + 1}`,
  }));
  return {
    lanes: lanes.map((id, index) => ({
      id,
      label: `Lane ${index + 1}`,
      need: `Need ${index + 1}`,
      href: `${prefix}/map/#${id}`,
      propertyChecks: [{ field: "impactResistance", label: "Impact resistance" }],
      candidates: [materials[index]!],
      visibleCandidates: [materials[index]!],
      overflowCandidates: [],
      indeterminateMaterialIds: [],
      verification: [`Verify ${index + 1}`],
      processGates: [gateRecords[index]!],
    })),
    serviceGuidance: {
      domain: { low: 20, high: 260, unit: "degC" },
      ticks: [20, 140, 260],
      records: materials.map((material) => ({ material, fact: { state: "known", display: ["Known"] }, evidence: { scopeLabels: ["Family guidance"], scopes: ["family-level-guidance"] }, disposition: { disposition: "plotted" } })),
    },
    thermalGroups: Array.from({ length: 8 }, (_, index) => ({
      id: `thermal-group-${index + 1}`,
      metric: "heat-deflection-temperature",
      metricLabel: `Metric ${index + 1}`,
      methodLabel: `Method ${index + 1}`,
      members: [],
      records: materials.map((material) => ({ material, disposition: { disposition: "omitted", code: "no-observation-in-group", reason: "No observation in group" } })),
    })),
    processGates: {
      lanes: lanes.map((id, index) => ({ id, label: `Lane ${index + 1}`, href: `${prefix}/map/#${id}`, candidates: [materials[index]!] })),
      gates: gateRecords,
      relationships: lanes.flatMap((laneId, laneIndex) => gateRecords.map((gate, gateIndex) => ({ laneId, gateId: gate.id, relationship: laneIndex === gateIndex ? "applies" : "not-listed", label: laneIndex === gateIndex ? "Applies — verify this gate" : "Not listed for this lane" }))),
    },
    impactFlex: {
      limitation: "Ordered qualitative categories are not numeric distance.",
      impactAxis: [{ value: "high-impact", label: "High impact", order: 0 }],
      flexibilityAxis: [{ value: "rigid", label: "Rigid", order: 0 }],
      difficultyTerms: [{ value: "easy", label: "Easy", order: 0, shape: "circle" }],
      records: materials.map((material, slot) => ({ material, impact: "high-impact", flexibility: "rigid", printDifficulty: "easy", impactFact: { state: "known", display: ["High impact"] }, flexibilityFact: { state: "known", display: ["Rigid"] }, printDifficultyFact: { state: "known", display: ["Easy"] }, disposition: { disposition: "plotted" }, slot, shape: "circle" })),
    },
    modeFragments: Object.fromEntries(modes.map((mode) => [mode, `${prefix}/map/#${mode}`])),
    methodHref: `${prefix}/method/`,
  };
}

function island(base: string): string {
  const prefix = base === "/" ? "" : base.slice(0, -1);
  const props = JSON.stringify({ projection: projection(base) }).replaceAll("'", "&#39;");
  const staticAlternatives = [
    "Follow a need through properties, candidates, and process gates",
    "Practical service guidance",
    "Compare only matching metric and method groups.",
    "Process-gate relationships by decision lane",
    "All materials in categorical order",
  ].map((label) => `<h2>${label}</h2>`).join("");
  return `<astro-island component-url="${prefix}/_astro/map.js" component-export="MapExplorerIsland" renderer-url="${prefix}/_astro/client.js" props='${props}' ssr client="visible">${staticAlternatives}</astro-island>`;
}

async function writeMode(root: string, base: string): Promise<void> {
  const prefix = base === "/" ? "" : base.slice(0, -1);
  await mkdir(join(root, "map"), { recursive: true });
  await mkdir(join(root, "method"), { recursive: true });
  await mkdir(join(root, "materials"), { recursive: true });
  await mkdir(join(root, "compare"), { recursive: true });
  await mkdir(join(root, "data"), { recursive: true });
  await mkdir(join(root, "_astro"), { recursive: true });
  for (let index = 1; index <= 23; index += 1) {
    await mkdir(join(root, `materials/material-${index}`), { recursive: true });
    await writeFile(join(root, `materials/material-${index}/index.html`), `<!doctype html><a href="${prefix}/map/">Map</a>`);
  }
  const selectorProjection = { routes: { decisionMaps: [], decisionMapFallback: { kind: "unavailable", label: "Decision map is not available yet" }, materials: [] } };
  await writeFile(join(root, "index.html"), `<!doctype html><link rel="canonical" href="https://atlas.example${base}"><astro-island component-url="${prefix}/_astro/selector.js" component-export="SelectorIsland" renderer-url="${prefix}/_astro/client.js" props='${JSON.stringify({ model: selectorProjection })}' ssr client="load"><p>Decision map is not available yet</p></astro-island>`);
  const fragmentTargets = ["main-content", ...modes, ...lanes, ...projection(base).processGates.gates.map(({ id }) => id)]
    .map((id) => `<span id="${id}"></span>`).join("");
  await writeFile(join(root, "map/index.html"), `<!doctype html><link rel="canonical" href="https://atlas.example${prefix}/map/"><nav>${modes.map((mode) => `<a href="${prefix}/map/#${mode}">${mode}</a>`).join("")}${lanes.map((lane) => `<a href="${prefix}/map/#${lane}">${lane}</a>`).join("")}</nav>${fragmentTargets}${island(base)}`);
  for (const route of ["method", "materials", "compare", "data"]) await writeFile(join(root, `${route}/index.html`), `<!doctype html><a href="${base}">Home</a>`);
  await writeFile(join(root, "_astro/client.js"), "export const hydrate = true;");
  await writeFile(join(root, "_astro/shared.js"), "export const shared = true;");
  await writeFile(join(root, "_astro/map.js"), "import './shared.js'; export const MapExplorerIsland = true;");
  await writeFile(join(root, "_astro/selector.js"), "export const SelectorIsland = true;");
}

async function activateSelector(root: string, base: string): Promise<void> {
  const prefix = base === "/" ? "" : base.slice(0, -1);
  const decisionMaps = lanes.map((laneId, index) => ({
    laneId,
    action: {
      label: `Open ${laneLabels[index]} decision path`,
      targetHref: `${prefix}/map/#${laneId}`,
    },
  }));
  const selectorProjection = {
    routes: {
      decisionMaps,
      decisionMapFallback: { kind: "unavailable", label: "Decision map is not available yet" },
      materials: [],
    },
  };
  await writeFile(
    join(root, "index.html"),
    `<!doctype html><link rel="canonical" href="https://atlas.example${base}"><astro-island component-url="${prefix}/_astro/selector.js" component-export="SelectorIsland" renderer-url="${prefix}/_astro/client.js" props='${JSON.stringify({ model: selectorProjection })}' ssr client="load"></astro-island>`,
  );
}

async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), "phase8-build-"));
  temporaryRoots.push(parent);
  const root = join(parent, "root");
  const repository = join(parent, "repository");
  await mkdir(root);
  await mkdir(repository);
  await writeMode(root, "/");
  await writeMode(repository, "/atlas-preview/");
  return { root, repository };
}

afterEach(async () => {
  await Promise.all([
    ...temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    ...temporaryReceiptFiles.splice(0).map((file) => unlink(file).catch(() => undefined)),
  ]);
});

describe("Phase 8 emitted build verifier", () => {
  it("accepts only the exact explicit eight-lane final registry", () => {
    const registrySource = finalRegistrySource();

    expect(() => assertRegistryStage(registrySource, "final")).not.toThrow();
    expect(() => assertRegistryStage(registrySource.replace(`laneId: "${lanes[0]}"`, `laneId: "${lanes[1]}"`), "final"))
      .toThrow("REGISTRY_ACTIVATION_MISSING");
    expect(() => assertRegistryStage(`${registrySource}\nallDecisionMaps: true`, "final"))
      .toThrow("REGISTRY_ACTIVATION_MISSING");
  });

  it("requires a matching pre-activation receipt and changed final artifacts", () => {
    const artifact = (mode: string, digest: string) => ({ mode, fileCount: 58, digest });
    const bytes = (mode: string) => ({ mode, projectionGzipBytes: 7_300, totalGzipBytes: 26_000 });
    const common = {
      schemaVersion: 1,
      digests: { route: "a".repeat(64), fragments: "b".repeat(64), projectionContract: "c".repeat(64) },
      counts: { routes: 1, modes: 4, lanes: 8, materials: 23 },
    };
    const prior = {
      ...common,
      stage: "pre-activation",
      artifacts: [artifact("root", "d".repeat(64)), artifact("repository", "e".repeat(64))],
      bytes: [bytes("root"), bytes("repository")],
    };
    const current = {
      ...common,
      stage: "final",
      artifacts: [artifact("root", "f".repeat(64)), artifact("repository", "0".repeat(64))],
      bytes: [bytes("root"), bytes("repository")],
    };

    expect(() => assertPreactivationReceipt(prior, current)).not.toThrow();
    expect(() => assertPreactivationReceipt({ ...prior, stage: "final" }, current))
      .toThrow("PREACTIVATION_RECEIPT_INVALID");
    expect(() => assertPreactivationReceipt({
      ...prior,
      artifacts: [artifact("root", "f".repeat(64)), artifact("repository", "e".repeat(64))],
    }, current)).toThrow("PREACTIVATION_RECEIPT_INVALID");
  });

  it("preserves the pre-activation receipt after final verification", async () => {
    const outputs = await fixture();
    const receiptPath = `.planning/.tmp/phase8-preserve-${process.pid}-${Date.now()}.json`;
    const receiptFile = join(process.cwd(), receiptPath);
    temporaryReceiptFiles.push(receiptFile);

    await verifyPhase8Build({
      rootOutput: outputs.root,
      repositoryOutput: outputs.repository,
      stage: "pre-activation",
      receiptPath,
      registrySource: "decisionMaps: Object.freeze([])",
      prohibitedExactPatterns: ["private-fixture-sentinel"],
      runPublicationScan: false,
    });
    const before = await readFile(receiptFile, "utf8");

    await activateSelector(outputs.root, "/");
    await activateSelector(outputs.repository, "/atlas-preview/");
    await verifyPhase8Build({
      rootOutput: outputs.root,
      repositoryOutput: outputs.repository,
      stage: "final",
      receiptPath,
      registrySource: finalRegistrySource(),
      prohibitedExactPatterns: ["private-fixture-sentinel"],
      runPublicationScan: false,
    });

    expect(await readFile(receiptFile, "utf8")).toBe(before);
  });

  it("accepts complete, scoped, pre-activation artifacts in both deployment bases", async () => {
    const outputs = await fixture();
    const report = await verifyPhase8Build({
      rootOutput: outputs.root,
      repositoryOutput: outputs.repository,
      stage: "pre-activation",
      registrySource: "decisionMaps: Object.freeze([])",
      prohibitedExactPatterns: ["private-fixture-sentinel"],
      runPublicationScan: false,
    });
    expect(report).toMatchObject({ ok: true, stage: "pre-activation", routeCount: 1 });
    expect(report.modes.map(({ mode }) => mode)).toEqual(["root", "repository"]);
    expect(report.modes.every(({ projectionGzipBytes, totalGzipBytes }) => projectionGzipBytes > 0 && totalGzipBytes > 0)).toBe(true);
  });

  it.each([
    ["SOURCE_MAP_FORBIDDEN", async (outputs: Awaited<ReturnType<typeof fixture>>) => writeFile(join(outputs.root, "_astro/map.js.map"), "{}")],
    ["MAP_FRAGMENT_MISSING", async (outputs: Awaited<ReturnType<typeof fixture>>) => {
      const path = join(outputs.root, "map/index.html");
      const html = await (await import("node:fs/promises")).readFile(path, "utf8");
      await writeFile(path, html.replace('href="/map/#decision-paths"', 'href="/map/#missing"'));
    }],
    ["MAP_FRAGMENT_TARGET_MISSING", async (outputs: Awaited<ReturnType<typeof fixture>>) => {
      const path = join(outputs.root, "map/index.html");
      const html = await (await import("node:fs/promises")).readFile(path, "utf8");
      await writeFile(path, html.replace('id="gate-1"', 'id="gate-target-removed"'));
    }],
    ["MAP_PROJECTION_PRIVATE_FIELD", async (outputs: Awaited<ReturnType<typeof fixture>>) => {
      const path = join(outputs.root, "map/index.html");
      const html = await (await import("node:fs/promises")).readFile(path, "utf8");
      await writeFile(path, html.replace('"projection":{', '"projection":{"atlas":{},'));
    }],
    ["CLIENT_REQUEST_FORBIDDEN", async (outputs: Awaited<ReturnType<typeof fixture>>) => writeFile(join(outputs.root, "_astro/map.js"), "fetch('/map-data.json')")],
    ["ROUTE_SCOPE_VIOLATION", async (outputs: Awaited<ReturnType<typeof fixture>>) => writeFile(join(outputs.root, "_astro/selector.js"), "import './map.js'; export const SelectorIsland = true;")],
    ["SELECTOR_ACTIVATED_TOO_EARLY", async (outputs: Awaited<ReturnType<typeof fixture>>) => {
      const path = join(outputs.root, "index.html");
      const html = await (await import("node:fs/promises")).readFile(path, "utf8");
      await writeFile(path, html.replaceAll("Decision map is not available yet", "Open material decision map"));
    }],
    ["CLIENT_PRIVATE_PATTERN_FORBIDDEN", async (outputs: Awaited<ReturnType<typeof fixture>>) => writeFile(join(outputs.repository, "_astro/map.js"), "export const value='private-fixture-sentinel'")],
  ])("fails closed with %s", async (code, mutate) => {
    const outputs = await fixture();
    await mutate(outputs);
    const error = await verifyPhase8Build({
      rootOutput: outputs.root,
      repositoryOutput: outputs.repository,
      stage: "pre-activation",
      registrySource: "decisionMaps: Object.freeze([])",
      prohibitedExactPatterns: ["private-fixture-sentinel"],
      runPublicationScan: false,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Phase8BuildError);
    expect((error as Phase8BuildError).code).toBe(code);
    expect(JSON.stringify(error)).not.toContain("private-fixture-sentinel");
  });

  it.each(["", "preactivation", "final "])("rejects an invalid stage token without normalization", async (stage) => {
    const outputs = await fixture();
    await expect(verifyPhase8Build({ rootOutput: outputs.root, repositoryOutput: outputs.repository, stage, runPublicationScan: false })).rejects.toMatchObject({ code: "STAGE_INVALID" });
  });
});
