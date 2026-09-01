#!/usr/bin/env node

import { gzipSync } from "node:zlib";
import { lstat, opendir, readFile, realpath } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { loadPublicationPolicy } from "./lib/publication-policy.mjs";
import { scanPublication } from "./scan-publication.mjs";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://atlas.example";
const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_COMPARE_GZIP = 140 * 1024;
const MAX_DATA_GZIP = 180 * 1024;
const REQUEST_PATTERN = /\b(?:fetch|XMLHttpRequest|EventSource|WebSocket)\s*\(/u;
const FORBIDDEN_CLIENT_TEXT = [
  /sourceMappingURL/iu,
  /(?:source-adapter|sheet-adapter|gog-cli|googleapis)/iu,
  /(?:^|["'`/_.-])(?:cytoscape|plotly|echarts|vis-network|three|deck\.gl)(?:["'`/_.-]|$)/iu,
  /(?:^|["'`/_.-])d3(?:-[a-z]+)?(?:["'`/_.-]|$)/iu,
];
const PROHIBITED_PROP_KEYS = new Set([
  "atlas", "sourceLedger", "sources", "methods", "rules", "ruleRegistry",
  "decisionLanes", "visualizations", "sourceMetadata", "operationalMetadata",
  "workbook", "spreadsheet", "privateMetadata",
]);

export class Phase7BuildError extends Error {
  constructor(code) {
    super(code);
    this.name = "Phase7BuildError";
    this.code = code;
  }

  toJSON() {
    return { code: this.code };
  }
}

function fail(code) {
  throw new Phase7BuildError(code);
}

function decodeAttribute(value) {
  return value
    .replaceAll("&quot;", '"').replaceAll("&#34;", '"').replaceAll("&#x22;", '"')
    .replaceAll("&#39;", "'").replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

function attributes(tag) {
  const result = new Map();
  for (const match of tag.matchAll(/\b([a-z][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/giu)) {
    result.set(match[1].toLowerCase(), decodeAttribute(match[2] ?? match[3] ?? ""));
  }
  return result;
}

function reviveAstro(value) {
  const handlers = {
    0: (item) => reviveObject(item),
    1: (item) => item.map(reviveTuple),
    2: (item) => new RegExp(item),
    3: (item) => new Date(item),
    4: (item) => new Map(item.map(reviveTuple)),
    5: (item) => new Set(item.map(reviveTuple)),
    6: (item) => BigInt(item),
    7: (item) => new URL(item),
    8: (item) => new Uint8Array(item),
    9: (item) => new Uint16Array(item),
    10: (item) => new Uint32Array(item),
    11: (item) => Number.POSITIVE_INFINITY * item,
  };
  function reviveTuple(tuple) {
    return Array.isArray(tuple) && tuple.length === 2 && Number.isInteger(tuple[0]) && tuple[0] in handlers
      ? handlers[tuple[0]](tuple[1])
      : tuple;
  }
  function reviveObject(item) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, reviveTuple(child)]));
  }
  return reviveObject(value);
}

function parseProps(serialized) {
  try {
    const parsed = JSON.parse(serialized);
    const encoded = typeof parsed === "object" && parsed !== null
      && Object.values(parsed).some((value) => Array.isArray(value) && value.length === 2 && Number.isInteger(value[0]));
    return encoded ? reviveAstro(parsed) : parsed;
  } catch {
    fail("PROPS_INVALID");
  }
}

function inspectProps(value, exactPatterns, seen = new Set()) {
  if (typeof value === "string") {
    if (exactPatterns.some((pattern) => pattern !== "" && value.includes(pattern))) fail("CLIENT_PRIVATE_PATTERN_FORBIDDEN");
    return;
  }
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value) || value instanceof Set) {
    for (const child of value) inspectProps(child, exactPatterns, seen);
    return;
  }
  if (value instanceof Map) {
    for (const [key, child] of value) {
      inspectProps(key, exactPatterns, seen);
      inspectProps(child, exactPatterns, seen);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (PROHIBITED_PROP_KEYS.has(key)) fail("PROPS_BOUNDARY_VIOLATION");
    inspectProps(child, exactPatterns, seen);
  }
}

async function collectFiles(root) {
  const literal = await lstat(root).catch(() => fail("OUTPUT_MISSING"));
  if (!literal.isDirectory() || literal.isSymbolicLink() || await realpath(root).catch(() => "") !== root) fail("OUTPUT_INVALID");
  const files = new Map();
  async function walk(directory) {
    const stream = await opendir(directory).catch(() => fail("OUTPUT_INVALID"));
    for await (const entry of stream) {
      const path = join(directory, entry.name);
      const info = await lstat(path).catch(() => fail("OUTPUT_INVALID"));
      if (info.isSymbolicLink()) fail("OUTPUT_SYMLINK_FORBIDDEN");
      if (info.isDirectory()) await walk(path);
      else if (info.isFile()) {
        if (info.size > MAX_FILE_BYTES || files.size >= MAX_FILES) fail("OUTPUT_LIMIT_EXCEEDED");
        files.set(relative(root, path).split(sep).join("/"), { path, size: info.size });
      } else fail("OUTPUT_INVALID");
    }
  }
  await walk(root);
  if ([...files.keys()].some((name) => name.endsWith(".map"))) fail("SOURCE_MAP_FORBIDDEN");
  return files;
}

function localFile(raw, mode, currentRoute, files, code = "ROUTE_LINK_INVALID") {
  if (raw === "" || raw.startsWith("#") || raw.startsWith("data:")) return undefined;
  let url;
  try {
    url = new URL(raw, `${ORIGIN}${posix.join(mode.base, currentRoute.slice(1))}`);
  } catch {
    fail(code);
  }
  if (url.origin !== ORIGIN) {
    if (url.protocol === "https:") return undefined;
    fail(code);
  }
  if (url.search !== "" || (mode.base !== "/" && !url.pathname.startsWith(mode.base))) fail(code);
  if (mode.base === "/" && url.pathname.startsWith("/atlas-preview/")) fail(code);
  let logical;
  try {
    logical = decodeURIComponent(url.pathname.slice(mode.base === "/" ? 1 : mode.base.length));
  } catch {
    fail(code);
  }
  if (logical.includes("\\") || logical.split("/").some((part) => part === "." || part === "..")) fail(code);
  const candidate = logical === "" || logical.endsWith("/") ? `${logical}index.html` : logical;
  if (!files.has(candidate)) fail(code);
  return candidate;
}

function imports(source) {
  const values = [];
  const patterns = [
    /\bimport\s*["']([^"']+)["']/gu,
    /\b(?:import|export)\s*[\w*$,\s{}]+\bfrom\s*["']([^"']+)["']/gu,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu,
  ];
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) values.push(match[1]);
  return values;
}

async function reachableJavaScript(entryNames, files, exactPatterns) {
  const queue = [...entryNames];
  const visited = new Set();
  let gzipBytes = 0;
  while (queue.length > 0) {
    const name = queue.shift();
    if (visited.has(name)) continue;
    const record = files.get(name);
    if (!record || !/\.m?js$/u.test(name)) fail("CLIENT_REFERENCE_INVALID");
    visited.add(name);
    const bytes = await readFile(record.path).catch(() => fail("OUTPUT_READ_FAILED"));
    const source = bytes.toString("utf8");
    if (REQUEST_PATTERN.test(source)) fail("CLIENT_REQUEST_FORBIDDEN");
    if (FORBIDDEN_CLIENT_TEXT.some((pattern) => pattern.test(source))) fail("CLIENT_STACK_FORBIDDEN");
    if (exactPatterns.some((pattern) => pattern !== "" && source.includes(pattern))) fail("CLIENT_PRIVATE_PATTERN_FORBIDDEN");
    gzipBytes += gzipSync(bytes).length;
    for (const specifier of imports(source)) {
      if (!specifier.startsWith(".")) fail("CLIENT_IMPORT_FORBIDDEN");
      const dependency = posix.normalize(posix.join(posix.dirname(name), specifier));
      if (dependency.startsWith("../")) fail("CLIENT_REFERENCE_INVALID");
      queue.push(dependency);
    }
  }
  return { gzipBytes, count: visited.size };
}

async function inspectRoute(mode, route, expectedExport, files, exactPatterns) {
  const htmlName = `${route}/index.html`;
  const html = await readFile(files.get(htmlName)?.path ?? "").catch(() => fail("ROUTE_MISSING"));
  const source = html.toString("utf8");
  const publicRoute = `${mode.base}${route}/`.replaceAll("//", "/");
  const canonical = [...source.matchAll(/<link\b[^>]*\brel=["']canonical["'][^>]*\bhref=["']([^"']+)["'][^>]*>/giu)];
  if (canonical.length !== 1 || canonical[0][1] !== `${ORIGIN}${publicRoute}`) fail("CANONICAL_INVALID");
  if (FORBIDDEN_CLIENT_TEXT.some((pattern) => pattern.test(source))) fail("CLIENT_STACK_FORBIDDEN");
  if (exactPatterns.some((pattern) => pattern !== "" && source.includes(pattern))) fail("CLIENT_PRIVATE_PATTERN_FORBIDDEN");

  for (const match of source.matchAll(/\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/giu)) {
    localFile(decodeAttribute(match[1] ?? match[2] ?? ""), mode, `/${route}/`, files);
  }
  const islands = [...source.matchAll(/<astro-island\b[^>]*>[\s\S]*?<\/astro-island>/giu)];
  if (islands.length !== 1) fail("ISLAND_COUNT_INVALID");
  const complete = islands[0][0];
  const opening = complete.slice(0, complete.indexOf(">") + 1);
  const attrs = attributes(opening);
  if (!opening.includes(" ssr") || attrs.get("client") !== "load" || attrs.get("component-export") !== expectedExport) fail("ISLAND_CONTRACT_INVALID");
  const fallback = complete.slice(opening.length, complete.lastIndexOf("</astro-island>"));
  if (fallback.replace(/<!--[\s\S]*?-->/gu, "").trim() === "") fail("STATIC_FALLBACK_MISSING");
  const serialized = attrs.get("props");
  if (serialized === undefined) fail("PROPS_INVALID");
  const props = parseProps(serialized);
  const expectedKeys = expectedExport === "CompareIsland" ? ["base", "model"] : ["model"];
  if (typeof props !== "object" || props === null || Array.isArray(props) || Object.keys(props).sort().join("\0") !== expectedKeys.join("\0")) fail("PROPS_SHAPE_INVALID");
  inspectProps(props, exactPatterns);
  const component = localFile(attrs.get("component-url") ?? "", mode, `/${route}/`, files, "CLIENT_REFERENCE_INVALID");
  const renderer = localFile(attrs.get("renderer-url") ?? "", mode, `/${route}/`, files, "CLIENT_REFERENCE_INVALID");
  const graph = await reachableJavaScript([component, renderer], files, exactPatterns);
  const totalGzipBytes = graph.gzipBytes + gzipSync(Buffer.from(serialized)).length;
  const budget = expectedExport === "CompareIsland" ? MAX_COMPARE_GZIP : MAX_DATA_GZIP;
  if (totalGzipBytes > budget) fail(expectedExport === "CompareIsland" ? "COMPARE_BUDGET_EXCEEDED" : "DATA_BUDGET_EXCEEDED");
  return { route: `/${route}/`, gzipBytes: totalGzipBytes, javascriptCount: graph.count };
}

async function scanBoundedPublication(rootOutput, repositoryOutput, sensitiveFile) {
  if (typeof sensitiveFile !== "string" || sensitiveFile === "") fail("SENSITIVE_INPUT_REQUIRED");
  let policy;
  try {
    policy = await loadPublicationPolicy({ root: PROJECT_ROOT, sensitiveFile, env: process.env });
  } catch {
    fail("SENSITIVE_INPUT_INVALID");
  }
  for (const selected of [
    { mode: "working" },
    { mode: "artifact", artifactPath: rootOutput },
    { mode: "artifact", artifactPath: repositoryOutput },
  ]) {
    let report;
    try {
      report = await scanPublication({ root: PROJECT_ROOT, policy, ...selected });
    } catch {
      fail("PUBLICATION_SCAN_FAILED");
    }
    if (report.findingCount !== 0) fail("PUBLICATION_SCAN_FAILED");
  }
}

/**
 * @param {{
 *   rootOutput?: string,
 *   repositoryOutput?: string,
 *   prohibitedExactPatterns?: string[],
 *   sensitiveFile?: string,
 *   runPublicationScan?: boolean,
 * }} options
 */
export async function verifyPhase7Build({
  rootOutput = resolve(PROJECT_ROOT, "dist-test/root"),
  repositoryOutput = resolve(PROJECT_ROOT, "dist-test/repository"),
  prohibitedExactPatterns = [],
  sensitiveFile = process.env.FDM_PUBLICATION_SENSITIVE_FILE,
  runPublicationScan = true,
} = {}) {
  if (!Array.isArray(prohibitedExactPatterns) || prohibitedExactPatterns.some((item) => typeof item !== "string")) fail("ARGUMENTS_INVALID");
  const modes = [
    { name: "root", base: "/", output: resolve(rootOutput) },
    { name: "repository", base: "/atlas-preview/", output: resolve(repositoryOutput) },
  ];
  const reports = [];
  for (const mode of modes) {
    const files = await collectFiles(mode.output);
    const compare = await inspectRoute(mode, "compare", "CompareIsland", files, prohibitedExactPatterns);
    const data = await inspectRoute(mode, "data", "DataExplorerIsland", files, prohibitedExactPatterns);
    reports.push(Object.freeze({
      mode: mode.name,
      compareGzipBytes: compare.gzipBytes,
      compareJavaScriptCount: compare.javascriptCount,
      dataGzipBytes: data.gzipBytes,
      dataJavaScriptCount: data.javascriptCount,
    }));
  }
  if (runPublicationScan) await scanBoundedPublication(modes[0].output, modes[1].output, sensitiveFile);
  return Object.freeze({ ok: true, routeCount: 2, modes: Object.freeze(reports) });
}

async function main() {
  try {
    const report = await verifyPhase7Build();
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (error) {
    const code = error instanceof Phase7BuildError ? error.code : "PHASE7_VERIFICATION_FAILED";
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    process.exitCode = 1;
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();
