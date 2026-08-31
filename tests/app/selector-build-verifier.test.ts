import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { SelectorBuildError, verifySelectorBuild } from "../../tools/verify-selector-build.mjs";

const roots: string[] = [];

async function fixture(options: {
  base?: string;
  props?: string;
  component?: string;
  secondIsland?: boolean;
  sourceMap?: boolean;
  extraRoute?: boolean;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "selector-build-"));
  roots.push(root);
  const base = options.base ?? "/atlas-preview/";
  const asset = `${base}_astro/Selector.js`;
  const props = options.props ?? '{"pageModel":{"projection":{"kind":"selector-projection"},"routes":{"compare":{"kind":"unavailable","label":"Comparison is unavailable"}}}}';
  const island = `<astro-island component-url="${asset}" renderer-url="${base}_astro/client.js" props="${props.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"></astro-island>`;
  await mkdir(join(root, "_astro"), { recursive: true });
  await mkdir(join(root, "materials/pla"), { recursive: true });
  await writeFile(join(root, "index.html"), `<!doctype html><a href="${base}materials/pla/">PLA</a>${island}${options.secondIsland ? island : ""}`);
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
    expect(report).toMatchObject({ islandCount: 1, reachableJavaScriptCount: 3, availableHrefCount: 0 });
    expect(report.totalGzipBytes).toBeGreaterThan(0);
    expect(report.totalGzipBytes).toBeLessThanOrEqual(100 * 1024);
  });

  it.each([
    ["SELECTOR_ISLAND_COUNT_INVALID", { secondIsland: true }],
    ["SELECTOR_SOURCE_MAP_FORBIDDEN", { sourceMap: true }],
    ["SELECTOR_CLIENT_IMPORT_FORBIDDEN", { component: 'import "cytoscape"; export const x=1;' }],
    ["SELECTOR_RUNTIME_FETCH_FORBIDDEN", { component: 'fetch("/api/materials"); export const x=1;' }],
    ["SELECTOR_PROPS_BOUNDARY_VIOLATION", { props: '{"pageModel":{"projection":{},"evidence":[{"id":"secret"}]}}' }],
  ])("returns stable code %s", async (expected, options) => {
    const { root, base } = await fixture(options);
    expect(await codeFor(() => verifySelectorBuild({ outputRoot: root, base }))).toBe(expected);
  });

  it("fails one byte above the gzip budget without exposing payload content", async () => {
    const { root, base } = await fixture({ component: `export const x=${JSON.stringify(Array.from({ length: 200_000 }, (_, index) => `${index.toString(36)}-${Math.random()}`).join("|"))}` });
    expect(await codeFor(() => verifySelectorBuild({ outputRoot: root, base, maxGzipBytes: 1 }))).toBe("SELECTOR_PAYLOAD_BUDGET_EXCEEDED");
  });

  it.each([
    ["SELECTOR_AVAILABLE_HREF_MISSING", '{"routes":{"details":{"kind":"available","label":"Details"}}}'],
    ["SELECTOR_AVAILABLE_HREF_INVALID", '{"routes":{"details":{"kind":"available","label":"Details","href":"https://outside.example/"}}}'],
    ["SELECTOR_AVAILABLE_HREF_INVALID", '{"routes":{"details":{"kind":"available","label":"Details","href":"/atlas-preview/atlas-preview/materials/pla/"}}}'],
    ["SELECTOR_AVAILABLE_HREF_INVALID", '{"routes":{"details":{"kind":"available","label":"Details","href":"/atlas-preview/missing/"}}}'],
    ["SELECTOR_AVAILABLE_HREF_INVALID", '{"routes":{"details":{"kind":"available","label":"Details","href":"/atlas-preview/materials/pla/#missing"}}}'],
    ["SELECTOR_UNAVAILABLE_HREF_FORBIDDEN", '{"routes":{"details":{"kind":"unavailable","label":"Later","href":"/atlas-preview/materials/pla/"}}}'],
  ])("blocks invalid route contract with %s", async (expected, props) => {
    const { root, base } = await fixture({ props });
    expect(await codeFor(() => verifySelectorBuild({ outputRoot: root, base }))).toBe(expected);
  });

  it("accepts one valid available route and live fragment", async () => {
    const props = '{"routes":{"details":{"kind":"available","label":"Details","href":"/atlas-preview/materials/pla/#profile"}}}';
    const { root, base } = await fixture({ props });
    await expect(verifySelectorBuild({ outputRoot: root, base })).resolves.toMatchObject({ availableHrefCount: 1 });
  });

  it("does not include private fixture bytes or environment values in failures", async () => {
    const marker = "fixture-private-value-never-report";
    const { root, base } = await fixture({ props: `{"pageModel":{"projection":{},"label":"${marker}"}}` });
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
