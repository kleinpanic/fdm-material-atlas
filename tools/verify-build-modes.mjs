#!/usr/bin/env node

import { spawn } from "node:child_process";
import { lstat, opendir, readFile, realpath, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { loadExactPatterns } from "./lib/publication-policy.mjs";
import { parsePhase8Arguments, verifyPhase8Build } from "./verify-phase8-build.mjs";
import { verifyPhase7Build } from "./verify-phase7-build.mjs";
import { SelectorBuildError, verifySelectorBuild } from "./verify-selector-build.mjs";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const PUBLIC_ORIGIN = "https://atlas.example";
const FORBIDDEN_OUTPUT_TEXT = [
  /sourceMappingURL/i,
  /(?:^|[/_.-])(?:cytoscape|plotly|echarts|vis-network)(?:[/_.-]|$)/i,
  /(?:^|[/_.-])d3(?:-[a-z]+)?(?:[/_.-]|$)/i,
  /three\.module/i,
  /deck\.gl/i,
];

const MODES = Object.freeze([
  {
    name: "root",
    base: "/",
    output: resolve(PROJECT_ROOT, "dist-test/root"),
    buildScript: "build:root",
    e2eScript: "test:e2e:root",
  },
  {
    name: "repository",
    base: "/atlas-preview/",
    output: resolve(PROJECT_ROOT, "dist-test/repository"),
    buildScript: "build:repository",
    e2eScript: "test:e2e:repository",
  },
]);

function pagesMode() {
  const artifact = process.env.ATLAS_PAGES_ARTIFACT;
  const base = process.env.ATLAS_PAGES_BASE;
  const origin = process.env.ATLAS_PAGES_ORIGIN;
  if (artifact !== "dist-pages") fail("PAGES_ARTIFACT_INVALID");
  if (!/^\/(?:[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/)*$/u.test(base ?? ""))
    fail("PAGES_BASE_INVALID");
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    fail("PAGES_ORIGIN_INVALID");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.origin !== origin
  )
    fail("PAGES_ORIGIN_INVALID");
  return Object.freeze({
    name: "pages",
    base,
    origin,
    output: resolve(PROJECT_ROOT, artifact),
    e2eScript: "test:e2e:pages",
  });
}

class VerificationError extends Error {
  constructor(code) {
    super(code);
    this.name = "VerificationError";
    this.code = code;
  }
}

function fail(code) {
  throw new VerificationError(code);
}

function safeEnvironment(extra = {}) {
  const allowed = [
    "PATH",
    "HOME",
    "TMPDIR",
    "TEMP",
    "TMP",
    "CI",
    "TERM",
    "NO_COLOR",
    "FORCE_COLOR",
    "NODE_OPTIONS",
    "NPM_CONFIG_CACHE",
    "PLAYWRIGHT_BROWSERS_PATH",
  ];
  const environment = {};
  for (const name of allowed) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  return { ...environment, ...extra };
}

async function run(command, args, { code, env = safeEnvironment() } = {}) {
  return await new Promise((accept, reject) => {
    const child = spawn(command, args, {
      cwd: PROJECT_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks = [];
    let captured = 0;
    const captureStdout = (chunk) => {
      if (captured >= 1024 * 1024) return;
      const bytes = Buffer.from(chunk);
      stdoutChunks.push(bytes.subarray(0, 1024 * 1024 - captured));
      captured += bytes.length;
    };
    child.stdout.on("data", captureStdout);
    child.stderr.resume();
    child.once("error", () => reject(new VerificationError(code)));
    child.once("close", (status, signal) => {
      if (status !== 0 || signal !== null) {
        reject(new VerificationError(code));
        return;
      }
      accept(Buffer.concat(stdoutChunks).toString("utf8"));
    });
  });
}

function toPublicPath(mode, relativePath) {
  const normalized = relativePath.split(sep).join("/");
  return posix.join(mode.base, normalized);
}

function routeForHtml(relativePath) {
  if (relativePath === "index.html") return "/";
  if (!relativePath.endsWith("/index.html")) fail("HTML_ROUTE_FORMAT_INVALID");
  return `/${relativePath.slice(0, -"index.html".length)}`;
}

async function collectFiles(root) {
  const literal = await lstat(root).catch(() => fail("OUTPUT_MISSING"));
  if (!literal.isDirectory() || literal.isSymbolicLink()) fail("OUTPUT_ROOT_INVALID");
  const physicalRoot = await realpath(root).catch(() => fail("OUTPUT_ROOT_INVALID"));
  if (physicalRoot !== root) fail("OUTPUT_ROOT_INVALID");

  const files = new Map();
  let totalBytes = 0;
  async function walk(directory) {
    const stream = await opendir(directory).catch(() => fail("OUTPUT_INVENTORY_FAILED"));
    for await (const entry of stream) {
      const path = join(directory, entry.name);
      const info = await lstat(path).catch(() => fail("OUTPUT_INVENTORY_FAILED"));
      if (info.isSymbolicLink()) fail("OUTPUT_SYMLINK_FORBIDDEN");
      if (info.isDirectory()) {
        await walk(path);
        continue;
      }
      if (!info.isFile()) fail("OUTPUT_ENTRY_INVALID");
      if (info.size > MAX_FILE_BYTES) fail("OUTPUT_FILE_TOO_LARGE");
      totalBytes += info.size;
      if (totalBytes > MAX_TOTAL_BYTES) fail("OUTPUT_TREE_TOO_LARGE");
      const name = relative(root, path).split(sep).join("/");
      if (name === "" || name.startsWith("../") || files.has(name)) fail("OUTPUT_PATH_INVALID");
      files.set(name, { path, size: info.size });
      if (files.size > MAX_FILES) fail("OUTPUT_FILE_COUNT_EXCEEDED");
    }
  }
  await walk(root);
  return files;
}

function localFileForUrl(mode, rawValue, currentPublicPath, files, { allowExternal = false } = {}) {
  const value = rawValue.trim().replaceAll("&amp;", "&");
  if (value === "" || value.startsWith("data:") || value.startsWith("#")) return undefined;
  if (/^(?:javascript|file|blob):/i.test(value) || value.startsWith("//"))
    fail("URL_SCHEME_FORBIDDEN");
  if (/(?:^|\/)\.\.?\//.test(value) || /%2f|%5c/i.test(value)) fail("URL_PATH_UNSAFE");

  let url;
  try {
    url = new URL(value, new URL(currentPublicPath, mode.origin ?? PUBLIC_ORIGIN));
  } catch {
    fail("URL_INVALID");
  }
  if (url.origin !== (mode.origin ?? PUBLIC_ORIGIN)) {
    if (allowExternal && url.protocol === "https:") return undefined;
    fail("REMOTE_ASSET_FORBIDDEN");
  }
  if (url.search !== "") fail("LOCAL_URL_QUERY_FORBIDDEN");

  const pathname = decodeURI(url.pathname);
  if (mode.base === "/") {
    if (pathname.startsWith("/atlas-preview/")) fail("ROOT_BASE_CONTAMINATED");
  } else {
    if (!pathname.startsWith(mode.base)) fail("REPOSITORY_BASE_MISSING");
    if (pathname.startsWith(`${mode.base}${mode.base.slice(1)}`)) fail("REPOSITORY_BASE_DOUBLED");
  }

  const logical = mode.base === "/" ? pathname.slice(1) : pathname.slice(mode.base.length);
  const candidate = logical === "" || logical.endsWith("/") ? `${logical}index.html` : logical;
  if (!files.has(candidate)) fail("LOCAL_TARGET_MISSING");
  return candidate;
}

function attributeValues(html) {
  const values = [];
  const pattern = /\b(href|src|poster|action|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  for (const match of html.matchAll(pattern)) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? "";
    if (name === "srcset") {
      for (const item of value.split(","))
        values.push({ name, value: item.trim().split(/\s+/)[0] ?? "" });
    } else {
      values.push({ name, value });
    }
  }
  return values;
}

function inspectHtml(mode, name, html, files) {
  const route = routeForHtml(name);
  const publicPath = posix.join(mode.base, route.slice(1));
  if (FORBIDDEN_OUTPUT_TEXT.some((pattern) => pattern.test(html))) fail("CLIENT_RUNTIME_FORBIDDEN");
  const canonicalMatches = [
    ...html.matchAll(/<link\b[^>]*\brel=["']canonical["'][^>]*\bhref=["']([^"']+)["'][^>]*>/gi),
  ];
  if (canonicalMatches.length !== 1) fail("CANONICAL_COUNT_INVALID");
  const expectedCanonical = new URL(publicPath, mode.origin ?? PUBLIC_ORIGIN).href;
  if (canonicalMatches[0][1] !== expectedCanonical) fail("CANONICAL_URL_INVALID");

  for (const attribute of attributeValues(html)) {
    localFileForUrl(mode, attribute.value, publicPath, files, {
      allowExternal: attribute.name === "href" && !attribute.value.includes("atlas.example"),
    });
  }
  return route;
}

function cssDependencies(css) {
  const dependencies = [];
  for (const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s][^)]*?))\s*\)/gi)) {
    dependencies.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  for (const match of css.matchAll(/@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)')\s*\)?/gi)) {
    dependencies.push(match[1] ?? match[2] ?? "");
  }
  return dependencies;
}

function assertNoCssCycles(graph) {
  const visiting = new Set();
  const visited = new Set();
  function visit(node) {
    if (visiting.has(node)) fail("CSS_IMPORT_CYCLE");
    if (visited.has(node)) return;
    visiting.add(node);
    for (const dependency of graph.get(node) ?? []) visit(dependency);
    visiting.delete(node);
    visited.add(node);
  }
  for (const node of graph.keys()) visit(node);
}

async function inspectMode(mode, { runPublication = true } = {}) {
  const files = await collectFiles(mode.output);
  if ([...files.keys()].some((name) => name.endsWith(".map"))) fail("SOURCE_MAP_FORBIDDEN");

  const htmlNames = [...files.keys()].filter((name) => name.endsWith(".html")).sort();
  const routes = [];
  for (const name of htmlNames) {
    const html = await readFile(files.get(name).path, "utf8").catch(() =>
      fail("OUTPUT_READ_FAILED"),
    );
    routes.push(inspectHtml(mode, name, html, files));
  }
  if (!routes.includes("/") || !routes.includes("/materials/") || !routes.includes("/method/")) {
    fail("ROUTE_INVENTORY_INVALID");
  }

  const cssGraph = new Map();
  for (const name of [...files.keys()].filter((entry) => entry.endsWith(".css")).sort()) {
    const css = await readFile(files.get(name).path, "utf8").catch(() =>
      fail("OUTPUT_READ_FAILED"),
    );
    if (FORBIDDEN_OUTPUT_TEXT.some((pattern) => pattern.test(css))) fail("CSS_OUTPUT_FORBIDDEN");
    const publicPath = toPublicPath(mode, name);
    const importedCss = [];
    for (const dependency of cssDependencies(css)) {
      const resolved = localFileForUrl(mode, dependency, publicPath, files);
      if (resolved?.endsWith(".css")) importedCss.push(resolved);
    }
    cssGraph.set(name, importedCss);
  }
  assertNoCssCycles(cssGraph);

  for (const [name, record] of files) {
    if (!/\.(?:html|css|js|mjs|json|xml|txt|svg)$/i.test(name)) continue;
    const text = await readFile(record.path, "utf8").catch(() => fail("OUTPUT_READ_FAILED"));
    if (FORBIDDEN_OUTPUT_TEXT.some((pattern) => pattern.test(text)))
      fail("OUTPUT_CONTENT_FORBIDDEN");
  }

  const sensitiveFile = process.env.FDM_PUBLICATION_SENSITIVE_FILE;
  let exactPatterns;
  try {
    exactPatterns = await loadExactPatterns({
      root: PROJECT_ROOT,
      ...(typeof sensitiveFile === "string" && sensitiveFile !== "" ? { sensitiveFile } : {}),
    });
  } catch {
    fail("SENSITIVE_INPUT_INVALID");
  }
  let selector;
  try {
    selector = await verifySelectorBuild({
      outputRoot: mode.output,
      base: mode.base,
      prohibitedExactPatterns: exactPatterns.map(({ bytes }) => bytes.toString("utf8")),
    });
  } catch (error) {
    if (error instanceof SelectorBuildError) fail(error.code);
    fail("SELECTOR_VERIFICATION_FAILED");
  }
  if (runPublication) await runPublicationScan(mode);
  return {
    routes: routes.sort(),
    fileCount: files.size,
    selectorGzipBytes: selector.totalGzipBytes,
    selectorJavaScriptCount: selector.reachableJavaScriptCount,
  };
}

async function runPublicationScan(mode) {
  const sensitiveFile = process.env.FDM_PUBLICATION_SENSITIVE_FILE;
  const sensitiveArguments =
    typeof sensitiveFile === "string" && sensitiveFile !== ""
      ? ["--sensitive-file", sensitiveFile]
      : [];
  const output = await run(
    process.execPath,
    [
      "tools/check-publication.mjs",
      "--root",
      PROJECT_ROOT,
      "--remote-policy",
      "any",
      ...sensitiveArguments,
      "--artifact",
      mode.output,
    ],
    { code: `PUBLICATION_SCAN_FAILED_${mode.name.toUpperCase()}`, env: safeEnvironment() },
  );
  let report;
  try {
    report = JSON.parse(output.trim());
  } catch {
    fail(`PUBLICATION_SCAN_INVALID_${mode.name.toUpperCase()}`);
  }
  if (report?.ok !== true) fail(`PUBLICATION_SCAN_FAILED_${mode.name.toUpperCase()}`);
}

async function buildAndInspect() {
  for (const mode of MODES) await rm(mode.output, { recursive: true, force: true });
  await run("npm", ["run", "validate:data"], { code: "DATA_VALIDATION_FAILED" });
  for (const mode of MODES) {
    await run("npm", ["run", mode.buildScript], {
      code: `BUILD_FAILED_${mode.name.toUpperCase()}`,
    });
  }
  const reports = [];
  for (const mode of MODES) reports.push(await inspectMode(mode, { runPublication: false }));
  if (JSON.stringify(reports[0].routes) !== JSON.stringify(reports[1].routes))
    fail("ROUTE_PARITY_FAILED");
  return reports;
}

async function runBrowserChecks() {
  const reports = [];
  for (const mode of MODES) reports.push(await inspectMode(mode, { runPublication: false }));
  if (JSON.stringify(reports[0].routes) !== JSON.stringify(reports[1].routes))
    fail("ROUTE_PARITY_FAILED");
  for (const mode of MODES) {
    await run("npm", ["run", mode.e2eScript], {
      code: `BROWSER_FAILED_${mode.name.toUpperCase()}`,
      env: safeEnvironment(),
    });
  }
  return reports;
}

async function inspectExistingBuilds() {
  const reports = [];
  for (const mode of MODES) reports.push(await inspectMode(mode, { runPublication: false }));
  if (JSON.stringify(reports[0].routes) !== JSON.stringify(reports[1].routes))
    fail("ROUTE_PARITY_FAILED");
  return reports;
}

const PREVIEW_CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".woff2", "font/woff2"],
]);
const PREVIEW_COMPRESSIBLE_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".mjs", ".svg"]);

function acceptsGzip(value) {
  const header = Array.isArray(value) ? value.join(",") : (value ?? "");
  return header.split(",").some((entry) => {
    const [encoding, ...parameters] = entry
      .trim()
      .toLowerCase()
      .split(";")
      .map((part) => part.trim());
    if (encoding !== "gzip") return false;
    const quality = parameters.find((parameter) => parameter.startsWith("q="));
    if (quality === undefined) return true;
    const score = Number(quality.slice(2));
    return Number.isFinite(score) && score > 0 && score <= 1;
  });
}

export async function createPreviewServer(mode, { productionCompression = false } = {}) {
  const files = await collectFiles(mode.output);
  const gzipCache = new Map();
  return createServer(async (request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") fail("SERVE_METHOD_INVALID");
      const url = new URL(request.url ?? "", "http://127.0.0.1");
      if (mode.base !== "/" && url.pathname === mode.base.slice(0, -1)) {
        response.writeHead(308, { location: `${mode.base}${url.search}` });
        response.end();
        return;
      }
      if (!url.pathname.startsWith(mode.base)) fail("SERVE_PATH_INVALID");
      const logical = decodeURIComponent(url.pathname.slice(mode.base.length));
      if (
        logical.includes("\\") ||
        logical.split("/").some((segment) => segment === "." || segment === "..")
      )
        fail("SERVE_PATH_INVALID");
      const relativeFile =
        logical === "" || logical.endsWith("/") ? `${logical}index.html` : logical;
      const record = files.get(relativeFile);
      if (record === undefined) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }
      const extension = posix.extname(relativeFile);
      const negotiatesCompression =
        productionCompression && PREVIEW_COMPRESSIBLE_EXTENSIONS.has(extension);
      const useGzip = negotiatesCompression && acceptsGzip(request.headers["accept-encoding"]);
      let bytes;
      if (useGzip) {
        bytes = gzipCache.get(relativeFile);
        if (bytes === undefined) {
          bytes = gzipSync(await readFile(record.path), { level: 9 });
          gzipCache.set(relativeFile, bytes);
        }
      } else if (request.method === "GET") {
        bytes = await readFile(record.path);
      }
      const headers = {
        "content-length": String(useGzip ? bytes.length : record.size),
        "content-type": PREVIEW_CONTENT_TYPES.get(extension) ?? "application/octet-stream",
        "x-content-type-options": "nosniff",
      };
      if (negotiatesCompression) headers.vary = "Accept-Encoding";
      if (useGzip) headers["content-encoding"] = "gzip";
      response.writeHead(200, headers);
      response.end(request.method === "HEAD" ? undefined : bytes);
    } catch {
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end("Invalid request");
    }
  });
}

async function serveMode(modeName) {
  const mode =
    modeName === "pages" ? pagesMode() : MODES.find((candidate) => candidate.name === modeName);
  if (mode === undefined) fail("SERVE_MODE_INVALID");
  const server = await createPreviewServer(mode);
  const port = mode.name === "root" ? 4321 : mode.name === "repository" ? 4322 : 4323;
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", accept);
  }).catch(() => fail("SERVE_START_FAILED"));
  process.on("SIGTERM", () => server.close());
  process.on("SIGINT", () => server.close());
}

async function main() {
  const command = process.argv[2];
  if (command === "serve") {
    if (process.argv.length !== 4) fail("ARGUMENTS_INVALID");
    await serveMode(process.argv[3]);
    return;
  }
  if (command === "phase8") {
    const report = await verifyPhase8Build(parsePhase8Arguments(process.argv.slice(3)));
    process.stdout.write(
      `${JSON.stringify({ ok: true, command, stage: report.stage, routeCount: report.routeCount, modes: report.modes })}\n`,
    );
    return;
  }
  if (command === "pages") {
    if (process.argv.length !== 3) fail("ARGUMENTS_INVALID");
    const mode = pagesMode();
    const report = await inspectMode(mode, { runPublication: true });
    await run("npm", ["exec", "--no", "--", "playwright", "test"], {
      code: "BROWSER_TEST_FAILED",
      env: safeEnvironment({
        ATLAS_TEST_MODE: "pages",
        ATLAS_PAGES_ARTIFACT: "dist-pages",
        ATLAS_PAGES_BASE: mode.base,
        ATLAS_PAGES_ORIGIN: mode.origin,
      }),
    });
    process.stdout.write(
      `${JSON.stringify({ ok: true, command, mode: "pages", routeCount: report.routes.length, fileCount: report.fileCount })}\n`,
    );
    return;
  }
  if (process.argv.length !== 3 || !["build", "browser", "selector", "phase7"].includes(command))
    fail("ARGUMENTS_INVALID");
  if (command === "phase7") {
    const report = await verifyPhase7Build();
    process.stdout.write(
      `${JSON.stringify({ ok: true, command, routeCount: report.routeCount, modes: report.modes })}\n`,
    );
    return;
  }
  const reports =
    command === "build"
      ? await buildAndInspect()
      : command === "browser"
        ? await runBrowserChecks()
        : await inspectExistingBuilds();
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      command,
      modes: reports.map((report, index) => ({
        mode: MODES[index].name,
        routeCount: report.routes.length,
        fileCount: report.fileCount,
        selectorGzipBytes: report.selectorGzipBytes,
        selectorJavaScriptCount: report.selectorJavaScriptCount,
      })),
    })}\n`,
  );
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const code =
      error instanceof VerificationError ||
      (typeof error?.code === "string" && /^[A-Z0-9_]+$/u.test(error.code))
        ? error.code
        : "VERIFICATION_FAILED";
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    process.exitCode = 1;
  });
}
