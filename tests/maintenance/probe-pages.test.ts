import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { PagesProbeError, probePages, validateDeployedPageUrl } from "../../tools/probe-pages.mjs";

const PUBLIC_ORIGIN = "https://atlas.test";
const TEST_LIMITS = Object.freeze({
  maxAttempts: 1,
  maxRedirects: 2,
  perRequestTimeoutMs: 500,
  totalDeadlineMs: 2_000,
  bodyLimitBytes: 16_384,
  retryDelayMs: 0,
});

type FixtureOptions = Readonly<{
  base?: "/" | "/atlas-preview/";
  statusPath?: string;
  missingAsset?: boolean;
  contentTypePath?: string;
  markerPath?: string;
  prohibitedPath?: string;
  redirectPath?: string;
  redirectLocation?: string;
  oversizedPath?: string;
  timeoutPath?: string;
  missingNavigation?: "materials" | "data" | "map" | "method";
}>;

type FixtureSite = Readonly<{
  deployedPageUrl: string;
  fetchImpl: typeof fetch;
  requests: readonly string[];
  close: () => Promise<void>;
}>;

const openSites: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(openSites.splice(0).map((close) => close()));
});

function html(canonical: string, content: string, includeMarker = true): string {
  return [
    "<!doctype html><html><head>",
    `<link rel="canonical" href="${canonical}">`,
    "<title>FDM Material Atlas</title></head><body>",
    includeMarker ? '<main id="main-content">FDM Material Atlas' : "<main>Unmarked document",
    content,
    "</main></body></html>",
  ].join("");
}

function send(response: ServerResponse, status: number, type: string, body: string): void {
  response.writeHead(status, { "content-type": type });
  response.end(body);
}

async function createFixtureSite(options: FixtureOptions = {}): Promise<FixtureSite> {
  const base = options.base ?? "/";
  const path = (suffix = "") => `${base}${suffix}`.replace(/\/+/gu, "/");
  const assetPath = path("_astro/app.1a2b3c4d.js");
  const detailPath = path("materials/synthetic-alpha/");
  const requests: string[] = [];

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const requestPath = new URL(request.url ?? "/", "http://fixture.invalid").pathname;
    requests.push(requestPath);

    if (requestPath === options.timeoutPath) return;
    if (requestPath === options.redirectPath) {
      response.writeHead(302, {
        location: options.redirectLocation ?? `${PUBLIC_ORIGIN}${requestPath}`,
      });
      response.end();
      return;
    }
    if (requestPath === options.statusPath) {
      send(response, 404, "text/html; charset=utf-8", "synthetic missing response");
      return;
    }
    if (requestPath === options.oversizedPath) {
      send(response, 200, "text/html; charset=utf-8", "x".repeat(20_000));
      return;
    }

    const canonical = `${PUBLIC_ORIGIN}${requestPath}`;
    const includeMarker = requestPath !== options.markerPath;
    const type =
      requestPath === options.contentTypePath
        ? "application/octet-stream"
        : requestPath === assetPath
          ? "text/javascript; charset=utf-8"
          : "text/html; charset=utf-8";

    if (requestPath === assetPath) {
      if (options.missingAsset) send(response, 404, "text/plain", "missing");
      else send(response, 200, type, 'console.log("public atlas");');
      return;
    }

    const suffix =
      requestPath === options.prohibitedPath
        ? ["authorization:", "Bearer", "synthetic-secret"].join(" ")
        : "";
    if (requestPath === base) {
      const navigation = ["materials", "data", "map", "method"]
        .filter((label) => label !== options.missingNavigation)
        .map((label) => `<a href="${path(`${label}/`)}">${label}</a>`)
        .join("");
      send(
        response,
        200,
        type,
        html(
          canonical,
          `${navigation}<script src="${assetPath}"></script>${suffix}`,
          includeMarker,
        ),
      );
      return;
    }
    if (requestPath === path("materials/")) {
      send(
        response,
        200,
        type,
        html(canonical, `<a href="${detailPath}">Synthetic Alpha</a>${suffix}`, includeMarker),
      );
      return;
    }
    if (
      requestPath === detailPath ||
      ["compare/", "data/", "map/", "method/"].some(
        (suffixPath) => requestPath === path(suffixPath),
      )
    ) {
      send(response, 200, type, html(canonical, suffix, includeMarker));
      return;
    }
    send(response, 404, "text/html; charset=utf-8", "not found");
  });

  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("fixture address unavailable");
  const localOrigin = `http://127.0.0.1:${address.port}`;
  const close = () => new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  openSites.push(close);

  const fetchImpl: typeof fetch = async (input, init) => {
    const publicUrl = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (publicUrl.origin !== PUBLIC_ORIGIN) throw new Error("transport origin escaped");
    return fetch(`${localOrigin}${publicUrl.pathname}${publicUrl.search}`, {
      ...init,
      redirect: "manual",
    });
  };

  return {
    deployedPageUrl: `${PUBLIC_ORIGIN}${base}`,
    fetchImpl,
    requests,
    close,
  };
}

async function expectProbeCode(
  site: FixtureSite,
  code: string,
  overrides: Record<string, unknown> = {},
): Promise<PagesProbeError> {
  try {
    await probePages({
      deployedPageUrl: site.deployedPageUrl,
      fetchImpl: site.fetchImpl,
      ...TEST_LIMITS,
      ...overrides,
    });
    throw new Error("expected probe rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(PagesProbeError);
    expect((error as PagesProbeError).code).toBe(code);
    const serialized = JSON.stringify(error);
    expect(serialized).toBe(JSON.stringify({ code }));
    expect(String(error)).not.toContain(PUBLIC_ORIGIN);
    expect(String(error)).not.toContain("synthetic-secret");
    return error as PagesProbeError;
  }
}

function collectProbeClosure(entry: string): string[] {
  const root = dirname(entry);
  const visited = new Set<string>();
  const visit = (file: string): void => {
    const physical = resolve(file);
    const pathFromRoot = relative(root, physical);
    if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot))
      throw new Error("IMPORT_OUTSIDE");
    if (visited.has(physical)) return;
    if (!physical.endsWith(".mjs")) throw new Error("IMPORT_EXTENSION");
    if (/(?:^|[/\\])(?:generated|dist|node_modules)(?:[/\\]|$)/u.test(physical))
      throw new Error("IMPORT_GENERATED");
    visited.add(physical);
    const source = readFileSync(physical, "utf8");
    const specifiers = [
      ...source.matchAll(/\b(?:import|export)\s+(?:[^"'`]*?\sfrom\s*)?["']([^"']+)["']/gu),
      ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu),
    ].map((match) => match[1]!);
    for (const specifier of specifiers) {
      if (specifier.startsWith("node:")) continue;
      if (!specifier.startsWith("./") && !specifier.startsWith("../"))
        throw new Error("IMPORT_BARE");
      if (!specifier.endsWith(".mjs")) throw new Error("IMPORT_EXTENSION");
      visit(resolve(dirname(physical), specifier));
    }
  };
  visit(entry);
  return [...visited].sort();
}

describe("bounded live Pages probe", () => {
  it.each(["/", "/atlas-preview/"] as const)(
    "accepts a complete same-origin deployment at %s",
    async (base) => {
      const site = await createFixtureSite({ base });
      const events: unknown[] = [];
      const result = await probePages({
        deployedPageUrl: site.deployedPageUrl,
        fetchImpl: site.fetchImpl,
        onEvent: (event: unknown) => events.push(event),
        ...TEST_LIMITS,
      });

      expect(result).toEqual({
        ok: true,
        checks: 7,
        attempts: 1,
        deployment: base === "/" ? "root" : "repository",
      });
      expect(events.map((event) => (event as { label: string }).label)).toEqual([
        "home",
        "materials",
        "material-detail",
        "data",
        "map",
        "method",
        "asset",
      ]);
      expect(JSON.stringify(events)).not.toContain(PUBLIC_ORIGIN);
      expect(new Set(site.requests)).toEqual(
        new Set([
          base,
          `${base}materials/`.replace(/\/+/gu, "/"),
          `${base}materials/synthetic-alpha/`.replace(/\/+/gu, "/"),
          `${base}data/`.replace(/\/+/gu, "/"),
          `${base}map/`.replace(/\/+/gu, "/"),
          `${base}method/`.replace(/\/+/gu, "/"),
          `${base}_astro/app.1a2b3c4d.js`.replace(/\/+/gu, "/"),
        ]),
      );
    },
  );

  it.each([
    [undefined, "PROBE_INPUT_MISSING"],
    ["http://atlas.test/", "PROBE_INPUT_INVALID"],
    ["https://user:pass@atlas.test/", "PROBE_INPUT_INVALID"],
    ["https://atlas.test/?mode=live", "PROBE_INPUT_INVALID"],
    ["https://atlas.test/#status", "PROBE_INPUT_INVALID"],
    ["https://atlas.test/not-normalized", "PROBE_INPUT_INVALID"],
  ])("rejects an invalid deploy output without echoing it", (input, code) => {
    try {
      validateDeployedPageUrl(input);
      throw new Error("expected input rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(PagesProbeError);
      expect((error as PagesProbeError).code).toBe(code);
      expect(String(error)).not.toContain(String(input));
    }
  });

  it("rejects cross-origin redirects and redirect loops with stable codes", async () => {
    const crossOrigin = await createFixtureSite({
      redirectPath: "/materials/",
      redirectLocation: "https://escape.test/materials/",
    });
    await expectProbeCode(crossOrigin, "PROBE_REDIRECT_ORIGIN");

    const loop = await createFixtureSite({
      redirectPath: "/materials/",
      redirectLocation: `${PUBLIC_ORIGIN}/materials/`,
    });
    await expectProbeCode(loop, "PROBE_REDIRECT_LOOP");
  });

  it("rejects redirect excess before following beyond the fixed bound", async () => {
    const site = await createFixtureSite({
      redirectPath: "/materials/",
      redirectLocation: `${PUBLIC_ORIGIN}/compare/`,
    });
    await expectProbeCode(site, "PROBE_REDIRECT_LIMIT", { maxRedirects: 0 });
    expect(site.requests).toEqual(["/", "/materials/"]);
  });

  it("aborts a timed-out request without leaking target data", async () => {
    const site = await createFixtureSite({ timeoutPath: "/materials/" });
    await expectProbeCode(site, "PROBE_TIMEOUT", { perRequestTimeoutMs: 20 });
  });

  it("rejects oversized bodies before parsing deployed content", async () => {
    const site = await createFixtureSite({ oversizedPath: "/materials/" });
    await expectProbeCode(site, "PROBE_BODY_TOO_LARGE", { bodyLimitBytes: 2_048 });
  });

  it.each([
    [{ statusPath: "/data/" }, "PROBE_HTTP_STATUS"],
    [{ missingAsset: true }, "PROBE_HTTP_STATUS"],
    [{ missingNavigation: "map" }, "PROBE_ROUTE_MISSING"],
    [{ contentTypePath: "/map/" }, "PROBE_CONTENT_TYPE"],
    [{ markerPath: "/method/" }, "PROBE_MARKER_MISSING"],
  ] as const)("rejects invalid route or asset responses", async (fixture, code) => {
    const site = await createFixtureSite(fixture);
    await expectProbeCode(site, code);
  });

  it("rejects generic authentication or private-source patterns without returning content", async () => {
    const site = await createFixtureSite({ prohibitedPath: "/data/" });
    const error = await expectProbeCode(site, "PROBE_PROHIBITED_CONTENT");
    expect(Object.keys(error)).toEqual(["code"]);
  });

  it("retries only within the configured origin and attempt bound", async () => {
    const site = await createFixtureSite({ statusPath: "/materials/" });
    const events: unknown[] = [];
    await expectProbeCode(site, "PROBE_HTTP_STATUS", {
      maxAttempts: 2,
      onEvent: (event: unknown) => events.push(event),
    });
    expect(site.requests.filter((path) => path === "/materials/")).toHaveLength(2);
    expect(site.requests.every((path) => path.startsWith("/"))).toBe(true);
    expect(events.every((event) => !JSON.stringify(event).includes("atlas.test"))).toBe(true);
  });

  it("keeps the complete production import closure dependency-free and local", () => {
    const entry = new URL("../../tools/probe-pages.mjs", import.meta.url);
    const closure = collectProbeClosure(entry.pathname);
    expect(closure.map((file) => relative(process.cwd(), file))).toEqual(["tools/probe-pages.mjs"]);

    const fixtureRoot = mkdtempSync(join(tmpdir(), "atlas-probe-imports-"));
    const cases = [
      ["package.mjs", 'import "synthetic-package";', "IMPORT_BARE"],
      ["typescript.mjs", 'import "./helper.ts";', "IMPORT_EXTENSION"],
      ["json.mjs", 'import data from "./data.json" with { type: "json" };', "IMPORT_EXTENSION"],
      ["outside.mjs", 'import "../outside.mjs";', "IMPORT_OUTSIDE"],
      ["generated.mjs", 'import "./generated/helper.mjs";', "IMPORT_GENERATED"],
    ] as const;
    for (const [name, source, code] of cases) {
      const path = join(fixtureRoot, name);
      writeFileSync(path, source, "utf8");
      expect(() => collectProbeClosure(path)).toThrow(code);
    }
  });

  it("starts from a clean copied closure under exact Node without node_modules", () => {
    const sourceEntry = new URL("../../tools/probe-pages.mjs", import.meta.url).pathname;
    const closure = collectProbeClosure(sourceEntry);
    const cleanRoot = mkdtempSync(join(tmpdir(), "atlas-probe-clean-"));
    for (const source of closure) {
      const target = join(cleanRoot, relative(dirname(sourceEntry), source));
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(source, target);
    }
    const cleanEntry = join(cleanRoot, "probe-pages.mjs");
    const env = { ...process.env, DEPLOYED_PAGE_URL: undefined, NODE_PATH: undefined };
    const run = spawnSync(process.execPath, [cleanEntry], {
      cwd: cleanRoot,
      env,
      encoding: "utf8",
      timeout: 5_000,
    });

    expect(run.status).toBe(1);
    expect(run.signal).toBeNull();
    expect(run.stdout).toBe("");
    expect(run.stderr).toBe('{"ok":false,"code":"PROBE_INPUT_MISSING"}\n');
    expect(`${run.stdout}${run.stderr}`).not.toContain(cleanRoot);
  });
});
