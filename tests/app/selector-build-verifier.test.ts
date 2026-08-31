import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { SelectorBuildError, verifySelectorBuild } from "../../tools/verify-selector-build.mjs";
import type { MaterialId } from "../../src/data/schema/ids.ts";
import {
  buildSelectorRouteAvailability,
  type PublicRouteRegistry,
} from "../../src/lib/public-route-registry.ts";

const roots: string[] = [];

function pageProps(route: Record<string, unknown> = { kind: "unavailable", label: "Comparison is unavailable" }) {
  return JSON.stringify({
    pageModel: {
      projection: {
        kind: "selector-projection",
        criteria: [{ id: "selector-primary-goal", defaultOptionId: "option-goal-easy" }],
        materials: [{ id: "material-pla" }],
      },
      defaults: { "selector-primary-goal": "option-goal-easy" },
      display: { materials: [{ id: "material-pla", label: "PLA", familyOrFill: { state: "known", label: "PLA" } }] },
      routes: {
        materials: [{ materialId: "material-pla", details: route }],
        compare: { kind: "unavailable", label: "Comparison is unavailable" },
        decisionMaps: [],
        decisionMapFallback: { kind: "unavailable", label: "Map is unavailable" },
        methodEvidence: { kind: "unavailable", label: "Method is unavailable" },
      },
    },
  });
}

function pagePropsWithCompiledRoutes(base: string) {
  const materialId = "material-pla" as MaterialId;
  const registry: PublicRouteRegistry = Object.freeze({
    materialDetails: Object.freeze([Object.freeze({
      materialId,
      target: Object.freeze({ id: "material" as const, slug: "pla" }),
    })]),
    startingProfiles: Object.freeze([]),
    decisionMaps: Object.freeze([]),
  });
  const routes = buildSelectorRouteAvailability(base, registry, {
    materials: Object.freeze([Object.freeze({
      id: materialId,
      slug: "pla",
      decisionMapLaneIds: Object.freeze([]),
    })]),
    lanes: Object.freeze([]),
  });
  return JSON.stringify({
    pageModel: {
      projection: {
        kind: "selector-projection",
        criteria: [{ id: "selector-primary-goal", defaultOptionId: "option-goal-easy" }],
        materials: [{ id: materialId }],
      },
      defaults: { "selector-primary-goal": "option-goal-easy" },
      display: { materials: [{ id: materialId, label: "PLA", familyOrFill: { state: "known", label: "PLA" } }] },
      routes,
    },
  });
}

async function fixture(options: {
  base?: string;
  props?: string;
  component?: string;
  secondIsland?: boolean;
  sourceMap?: boolean;
  extraRoute?: boolean;
  inlineScript?: string;
  scriptSrc?: string;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "selector-build-"));
  roots.push(root);
  const base = options.base ?? "/atlas-preview/";
  const asset = `${base}_astro/Selector.js`;
  const props = options.props ?? pageProps();
  const island = `<astro-island component-url="${asset}" renderer-url="${base}_astro/client.js" props="${props.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"></astro-island>`;
  await mkdir(join(root, "_astro"), { recursive: true });
  await mkdir(join(root, "materials/pla"), { recursive: true });
  const script = options.scriptSrc === undefined
    ? `<script>${options.inlineScript ?? "window.__selectorBoot=1"}</script>`
    : `<script src="${options.scriptSrc}"></script>`;
  await writeFile(join(root, "index.html"), `<!doctype html><a href="${base}materials/pla/">PLA</a>${island}${options.secondIsland ? island : ""}${script}`);
  await writeFile(join(root, "materials/pla/index.html"), '<!doctype html><h1 id="profile">PLA</h1>');
  await writeFile(join(root, "_astro/Selector.js"), options.component ?? 'import "./shared.js"; export const SelectorIsland=()=>null;');
  await writeFile(join(root, "_astro/shared.js"), "export const shared=1;");
  await writeFile(join(root, "_astro/client.js"), "export const start=1;");
  if (options.sourceMap) await writeFile(join(root, "_astro/Selector.js.map"), "{}");
  if (options.extraRoute) {
    await mkdir(join(root, "compare"), { recursive: true });
    await writeFile(join(root, "compare/index.html"), "<!doctype html><h1>Compare</h1>");
  }
  return { root, base };
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function codeFor(run: () => Promise<unknown>) {
  try {
    await run();
    return "OK";
  } catch (error) {
    expect(error).toBeInstanceOf(SelectorBuildError);
    return (error as SelectorBuildError).code;
  }
}

describe("selector production build verifier", () => {
  it("measures the single emitted island, props, and complete reachable graph", async () => {
    const { root, base } = await fixture();
    const report = await verifySelectorBuild({ outputRoot: root, base });
    expect(report).toMatchObject({ islandCount: 1, inlineScriptCount: 1, reachableJavaScriptCount: 3, availableHrefCount: 0 });
    expect(report.totalGzipBytes).toBeGreaterThan(0);
    expect(report.totalGzipBytes).toBeLessThanOrEqual(100 * 1024);
  });

  it("follows minified static import syntax", async () => {
    const { root, base } = await fixture({ component: 'import{o}from"./shared.js";export const x=o;' });
    await expect(verifySelectorBuild({ outputRoot: root, base })).resolves.toMatchObject({ reachableJavaScriptCount: 3 });
  });

  it("counts and scans every inline home script", async () => {
    const marker = "inline-private-sentinel";
    const { root, base } = await fixture({ inlineScript: `window.value="${marker}"` });
    expect(await codeFor(() => verifySelectorBuild({ outputRoot: root, base, prohibitedExactPatterns: [marker] }))).toBe("SELECTOR_PRIVATE_PATTERN_FORBIDDEN");
  });

  it("rejects external or unaccounted script roots", async () => {
    const { root, base } = await fixture({ scriptSrc: "https://outside.example/client.js" });
    expect(await codeFor(() => verifySelectorBuild({ outputRoot: root, base }))).toBe("SELECTOR_CLIENT_REFERENCE_INVALID");
  });

  it("requires pageModel to be the only top-level prop", async () => {
    const props = JSON.parse(pageProps()) as Record<string, unknown>;
    props.extra = "not-allowed";
    const { root, base } = await fixture({ props: JSON.stringify(props) });
    expect(await codeFor(() => verifySelectorBuild({ outputRoot: root, base }))).toBe("SELECTOR_PROPS_SHAPE_INVALID");
  });

  it("requires projection, display, route, and default counts to agree", async () => {
    const props = JSON.parse(pageProps()) as { pageModel: { display: { materials: unknown[] } } };
    props.pageModel.display.materials = [];
    const { root, base } = await fixture({ props: JSON.stringify(props) });
    expect(await codeFor(() => verifySelectorBuild({ outputRoot: root, base }))).toBe("SELECTOR_PROPS_COUNT_INVALID");
  });

  it.each([
    ["SELECTOR_ISLAND_COUNT_INVALID", { secondIsland: true }],
    ["SELECTOR_SOURCE_MAP_FORBIDDEN", { sourceMap: true }],
    ["SELECTOR_CLIENT_IMPORT_FORBIDDEN", { component: 'import "cytoscape"; export const x=1;' }],
    ["SELECTOR_RUNTIME_FETCH_FORBIDDEN", { component: 'fetch("/api/materials"); export const x=1;' }],
    ["SELECTOR_PROPS_BOUNDARY_VIOLATION", { props: '{"pageModel":{"projection":{},"defaults":{},"display":{},"routes":{},"evidence":[{"id":"secret"}]}}' }],
  ])("returns stable code %s", async (expected, options) => {
    const { root, base } = await fixture(options);
    expect(await codeFor(() => verifySelectorBuild({ outputRoot: root, base }))).toBe(expected);
  });

  it("fails one byte above the gzip budget without exposing payload content", async () => {
    const { root, base } = await fixture({ component: `export const x=${JSON.stringify(Array.from({ length: 200_000 }, (_, index) => `${index.toString(36)}-${Math.random()}`).join("|"))}` });
    expect(await codeFor(() => verifySelectorBuild({ outputRoot: root, base, maxGzipBytes: 1 }))).toBe("SELECTOR_PAYLOAD_BUDGET_EXCEEDED");
  });

  it.each([
    ["SELECTOR_LINK_HREF_MISSING", pageProps({ kind: "link", label: "Details" })],
    ["SELECTOR_LINK_HREF_INVALID", pageProps({ kind: "link", label: "Details", href: "https://outside.example/" })],
    ["SELECTOR_LINK_HREF_INVALID", pageProps({ kind: "link", label: "Details", href: "/atlas-preview/atlas-preview/materials/pla/" })],
    ["SELECTOR_LINK_HREF_INVALID", pageProps({ kind: "link", label: "Details", href: "/atlas-preview/missing/" })],
    ["SELECTOR_LINK_HREF_INVALID", pageProps({ kind: "link", label: "Details", href: "/atlas-preview/materials/pla/#missing" })],
    ["SELECTOR_UNAVAILABLE_HREF_FORBIDDEN", pageProps({ kind: "unavailable", label: "Later", href: "/atlas-preview/materials/pla/" })],
    ["SELECTOR_ROUTE_ACTION_KIND_INVALID", pageProps({ kind: "available", label: "Legacy parallel contract", href: "/atlas-preview/materials/pla/" })],
  ])("blocks invalid route contract with %s", async (expected, props) => {
    const { root, base } = await fixture({ props });
    expect(await codeFor(() => verifySelectorBuild({ outputRoot: root, base }))).toBe(expected);
  });

  it("accepts one valid link and live fragment", async () => {
    const props = pageProps({ kind: "link", label: "Details", href: "/atlas-preview/materials/pla/#profile" });
    const { root, base } = await fixture({ props });
    await expect(verifySelectorBuild({ outputRoot: root, base })).resolves.toMatchObject({ availableHrefCount: 1 });
  });

  it("validates a real link emitted by buildSelectorRouteAvailability", async () => {
    const base = "/atlas-preview/";
    const { root } = await fixture({ base, props: pagePropsWithCompiledRoutes(base) });
    await expect(verifySelectorBuild({ outputRoot: root, base })).resolves.toMatchObject({ availableHrefCount: 1 });
  });

  it("does not include private fixture bytes or environment values in failures", async () => {
    const marker = "fixture-private-value-never-report";
    const { root, base } = await fixture({ props: pageProps({ kind: "unavailable", label: marker }) });
    let error: unknown;
    try {
      await verifySelectorBuild({ outputRoot: root, base, prohibitedExactPatterns: [marker] });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(SelectorBuildError);
    expect(JSON.stringify(error)).not.toContain(marker);
    expect(String(error)).not.toContain(marker);
  });
});
