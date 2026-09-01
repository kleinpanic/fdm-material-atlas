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

function compact(value: unknown): unknown {
  const strings = new Set<string>();
  const collect = (item: unknown): void => {
    if (typeof item === "string") strings.add(item);
    else if (Array.isArray(item)) item.forEach(collect);
    else if (item !== null && typeof item === "object") Object.entries(item).forEach(([key, child]) => { strings.add(key); collect(child); });
  };
  collect(value);
  const dictionary = [...strings].sort();
  const indexes = new Map(dictionary.map((item, index) => [item, index]));
  const encode = (item: unknown): unknown => {
    if (typeof item === "string") return [0, indexes.get(item)];
    if (typeof item === "number") return [3, item];
    if (typeof item === "boolean") return [4, item ? 1 : 0];
    if (item === null) return [5];
    if (Array.isArray(item)) return [2, ...item.map(encode)];
    const tuple: unknown[] = [1];
    for (const [key, child] of Object.entries(item as object).sort(([left], [right]) => left.localeCompare(right, "en"))) {
      tuple.push(indexes.get(key), encode(child));
    }
    return tuple;
  };
  return [1, dictionary, encode(value)];
}

function runtimePageModel(route: Record<string, unknown> = { kind: "unavailable", label: "Comparison is unavailable" }) {
  return {
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
    };
}

function pageProps(route?: Record<string, unknown>, transform: (model: ReturnType<typeof runtimePageModel>) => unknown = (model) => model) {
  return JSON.stringify({ pageModel: compact(transform(runtimePageModel(route))) });
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
    pageModel: compact({
      projection: {
        kind: "selector-projection",
        criteria: [{ id: "selector-primary-goal", defaultOptionId: "option-goal-easy" }],
        materials: [{ id: materialId }],
      },
      defaults: { "selector-primary-goal": "option-goal-easy" },
      display: { materials: [{ id: materialId, label: "PLA", familyOrFill: { state: "known", label: "PLA" } }] },
      routes,
    }),
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
  componentUrl?: string;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "selector-build-"));
  roots.push(root);
  const base = options.base ?? "/atlas-preview/";
  const asset = options.componentUrl ?? `${base}_astro/Selector.js`;
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
    expect(report.indexHtmlBytes).toBeGreaterThan(0);
    expect(report.selectorEntryJavaScriptBytes).toBeGreaterThan(0);
  });

  it("accepts exact raw boundaries and fails one byte over either cap", async () => {
    const { root, base } = await fixture();
    const report = await verifySelectorBuild({ outputRoot: root, base });
    await expect(verifySelectorBuild({
      outputRoot: root,
      base,
      maxIndexHtmlBytes: report.indexHtmlBytes,
      maxSelectorEntryJavaScriptBytes: report.selectorEntryJavaScriptBytes,
    })).resolves.toMatchObject({ indexHtmlBytes: report.indexHtmlBytes });
    expect(await codeFor(() => verifySelectorBuild({ outputRoot: root, base, maxIndexHtmlBytes: report.indexHtmlBytes - 1 })))
      .toBe("SELECTOR_INDEX_HTML_BUDGET_EXCEEDED");
    expect(await codeFor(() => verifySelectorBuild({ outputRoot: root, base, maxSelectorEntryJavaScriptBytes: report.selectorEntryJavaScriptBytes - 1 })))
      .toBe("SELECTOR_ENTRY_JAVASCRIPT_BUDGET_EXCEEDED");
  });

  it.each([
    ["external", "https://outside.example/Selector.js"],
    ["missing", "/atlas-preview/_astro/missing.js"],
    ["escaped", "/atlas-preview/%2e%2e/index.html"],
    ["non-JavaScript", "/atlas-preview/materials/pla/"],
  ])("rejects a %s selector component entry", async (_label, componentUrl) => {
    const { root, base } = await fixture({ componentUrl });
    expect(await codeFor(() => verifySelectorBuild({ outputRoot: root, base }))).toBe("SELECTOR_CLIENT_REFERENCE_INVALID");
  });

  it("rejects the obsolete expanded page model boundary", async () => {
    const { root, base } = await fixture({ props: JSON.stringify({ pageModel: runtimePageModel() }) });
    expect(await codeFor(() => verifySelectorBuild({ outputRoot: root, base }))).toBe("SELECTOR_PROPS_SHAPE_INVALID");
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
    const props = pageProps(undefined, (model) => ({ ...model, display: { materials: [] } }));
    const { root, base } = await fixture({ props });
    expect(await codeFor(() => verifySelectorBuild({ outputRoot: root, base }))).toBe("SELECTOR_PROPS_COUNT_INVALID");
  });

  it.each([
    ["SELECTOR_ISLAND_COUNT_INVALID", { secondIsland: true }],
    ["SELECTOR_SOURCE_MAP_FORBIDDEN", { sourceMap: true }],
    ["SELECTOR_CLIENT_IMPORT_FORBIDDEN", { component: 'import "cytoscape"; export const x=1;' }],
    ["SELECTOR_RUNTIME_FETCH_FORBIDDEN", { component: 'fetch("/api/materials"); export const x=1;' }],
    ["SELECTOR_PROPS_BOUNDARY_VIOLATION", { props: pageProps(undefined, (model) => ({ ...model, evidence: [{ id: "secret" }] })) }],
  ])("returns stable code %s", async (expected, options) => {
    const { root, base } = await fixture(options);
    expect(await codeFor(() => verifySelectorBuild({ outputRoot: root, base }))).toBe(expected);
  });

  it("fails one byte above the gzip budget without exposing payload content", async () => {
    const { root, base } = await fixture({ component: `export const x=${JSON.stringify(Array.from({ length: 200_000 }, (_, index) => `${index.toString(36)}-${Math.random()}`).join("|"))}` });
    expect(await codeFor(() => verifySelectorBuild({
      outputRoot: root,
      base,
      maxGzipBytes: 1,
      maxSelectorEntryJavaScriptBytes: 16 * 1024 * 1024,
    }))).toBe("SELECTOR_PAYLOAD_BUDGET_EXCEEDED");
  }, 20_000);

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
