#!/usr/bin/env node

import { spawn } from "node:child_process";
import { lstat, opendir, readFile, realpath, rm } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const PUBLIC_ORIGIN = "https://atlas.example";
const FORBIDDEN_OUTPUT_TEXT = [
  /<script\b/i,
  /<astro-(?:island|slot)\b/i,
  /\bclient:(?:load|idle|visible|media|only)\b/i,
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
  if (/^(?:javascript|file|blob):/i.test(value) || value.startsWith("//")) fail("URL_SCHEME_FORBIDDEN");
  if (/(?:^|\/)\.\.?\//.test(value) || /%2f|%5c/i.test(value)) fail("URL_PATH_UNSAFE");

  let url;
  try {
    url = new URL(value, new URL(currentPublicPath, PUBLIC_ORIGIN));
  } catch {
    fail("URL_INVALID");
  }
  if (url.origin !== PUBLIC_ORIGIN) {
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
      for (const item of value.split(",")) values.push({ name, value: item.trim().split(/\s+/)[0] ?? "" });
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
  const canonicalMatches = [...html.matchAll(/<link\b[^>]*\brel=["']canonical["'][^>]*\bhref=["']([^"']+)["'][^>]*>/gi)];
  if (canonicalMatches.length !== 1) fail("CANONICAL_COUNT_INVALID");
  const expectedCanonical = new URL(publicPath, PUBLIC_ORIGIN).href;
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
    const html = await readFile(files.get(name).path, "utf8").catch(() => fail("OUTPUT_READ_FAILED"));
    routes.push(inspectHtml(mode, name, html, files));
  }
  if (routes.length !== 2 || !routes.includes("/") || routes.filter((route) => /^\/materials\/[^/]+\/$/.test(route)).length !== 1) {
    fail("ROUTE_INVENTORY_INVALID");
  }

  const cssGraph = new Map();
  for (const name of [...files.keys()].filter((entry) => entry.endsWith(".css")).sort()) {
    const css = await readFile(files.get(name).path, "utf8").catch(() => fail("OUTPUT_READ_FAILED"));
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
    if (FORBIDDEN_OUTPUT_TEXT.slice(3).some((pattern) => pattern.test(text))) fail("OUTPUT_CONTENT_FORBIDDEN");
  }

  if (runPublication) await runPublicationScan(mode);
  return { routes: routes.sort(), fileCount: files.size };
}

async function runPublicationScan(mode) {
  const sensitiveFile = process.env.FDM_PUBLICATION_SENSITIVE_FILE;
  if (typeof sensitiveFile !== "string" || sensitiveFile === "") fail("SENSITIVE_INPUT_REQUIRED");
  const output = await run(
    process.execPath,
    [
      "tools/check-publication.mjs",
      "--root",
      PROJECT_ROOT,
      "--remote-policy",
      "any",
      "--sensitive-file",
      sensitiveFile,
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
    await run("npm", ["run", mode.buildScript], { code: `BUILD_FAILED_${mode.name.toUpperCase()}` });
  }
  const reports = [];
  for (const mode of MODES) reports.push(await inspectMode(mode));
  if (JSON.stringify(reports[0].routes) !== JSON.stringify(reports[1].routes)) fail("ROUTE_PARITY_FAILED");
  return reports;
}

async function runBrowserChecks() {
  const reports = [];
  for (const mode of MODES) reports.push(await inspectMode(mode, { runPublication: false }));
  if (JSON.stringify(reports[0].routes) !== JSON.stringify(reports[1].routes)) fail("ROUTE_PARITY_FAILED");
  for (const mode of MODES) {
    await run("npm", ["run", mode.e2eScript], {
      code: `BROWSER_FAILED_${mode.name.toUpperCase()}`,
      env: safeEnvironment(),
    });
  }
  return reports;
}

async function main() {
  const command = process.argv[2];
  if (process.argv.length !== 3 || !["build", "browser"].includes(command)) fail("ARGUMENTS_INVALID");
  const reports = command === "build" ? await buildAndInspect() : await runBrowserChecks();
  process.stdout.write(`${JSON.stringify({ ok: true, command, modes: reports.map((report, index) => ({ mode: MODES[index].name, routeCount: report.routes.length, fileCount: report.fileCount })) })}\n`);
}

main().catch((error) => {
  const code = error instanceof VerificationError ? error.code : "VERIFICATION_FAILED";
  process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
  process.exitCode = 1;
});
