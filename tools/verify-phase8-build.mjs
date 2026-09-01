#!/usr/bin/env node

import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { lstat, mkdir, opendir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { loadExactPatterns, loadPublicationPolicy } from "./lib/publication-policy.mjs";
import { scanPublication } from "./scan-publication.mjs";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://atlas.example";
const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_PROJECTION_GZIP = 8 * 1024;
const MAX_ROUTE_GZIP = 120 * 1024;
const MAX_VISUALIZATION_MODULE_GZIP = 30 * 1024;
const REQUEST_PATTERN = /\b(?:fetch|XMLHttpRequest|EventSource|WebSocket)\s*\(/u;
const MAP_MODES = Object.freeze(["decision-paths", "thermal-ranges", "process-gates", "impact-flex-space"]);
const LANE_IDS = Object.freeze([
  "lane-easy-prototypes", "lane-outdoor", "lane-impact-flex", "lane-chemical-exposure",
  "lane-high-heat-sustained-load", "lane-industrial", "lane-decorative-fills", "lane-support-materials",
]);
const LANE_LABELS = Object.freeze([
  "Easy prototypes", "Outdoor", "Impact and flex", "Chemical exposure",
  "High heat and sustained load", "Industrial", "Decorative fills", "Support materials",
]);
const STATIC_ALTERNATIVES = Object.freeze([
  "Follow a need through properties, candidates, and process gates",
  "Practical service guidance",
  "Compare only matching metric and method groups.",
  "Process-gate relationships by decision lane",
  "All materials in categorical order",
]);
const PROHIBITED_KEYS = new Set([
  "atlas", "sources", "sourceLedger", "methods", "rules", "ruleRegistry", "claims", "profiles",
  "sourceMetadata", "privateMetadata", "operationalMetadata", "workbook", "spreadsheet",
]);

export class Phase8BuildError extends Error {
  constructor(code) {
    super(code);
    this.name = "Phase8BuildError";
    this.code = code;
  }

  toJSON() {
    return { code: this.code };
  }
}

function fail(code) {
  throw new Phase8BuildError(code);
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function decodeAttribute(value) {
  return value.replaceAll("&quot;", '"').replaceAll("&#34;", '"').replaceAll("&#x22;", '"')
    .replaceAll("&#39;", "'").replaceAll("&#x27;", "'").replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">").replaceAll("&amp;", "&");
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
    0: (item) => reviveObject(item), 1: (item) => item.map(reviveTuple), 2: (item) => new RegExp(item),
    3: (item) => new Date(item), 4: (item) => new Map(item.map(reviveTuple)), 5: (item) => new Set(item.map(reviveTuple)),
    6: (item) => BigInt(item), 7: (item) => new URL(item), 8: (item) => new Uint8Array(item),
    9: (item) => new Uint16Array(item), 10: (item) => new Uint32Array(item), 11: (item) => Number.POSITIVE_INFINITY * item,
  };
  function reviveTuple(tuple) {
    return Array.isArray(tuple) && tuple.length === 2 && Number.isInteger(tuple[0]) && tuple[0] in handlers
      ? handlers[tuple[0]](tuple[1]) : tuple;
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

async function collectFiles(root) {
  const absolute = resolve(root);
  const literal = await lstat(absolute).catch(() => fail("OUTPUT_MISSING"));
  if (!literal.isDirectory() || literal.isSymbolicLink() || await realpath(absolute).catch(() => "") !== absolute) fail("OUTPUT_INVALID");
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
        const name = relative(absolute, path).split(sep).join("/");
        if (name === "" || name.startsWith("../") || files.has(name)) fail("OUTPUT_INVALID");
        files.set(name, { path, size: info.size });
      } else fail("OUTPUT_INVALID");
    }
  }
  await walk(absolute);
  if ([...files.keys()].some((name) => name.endsWith(".map"))) fail("SOURCE_MAP_FORBIDDEN");
  return files;
}

function localFile(raw, mode, currentRoute, files, code = "MAP_LINK_INVALID") {
  if (raw === "" || raw.startsWith("#") || raw.startsWith("data:")) return undefined;
  if (/^(?:javascript|file|blob):/iu.test(raw) || raw.startsWith("//")) fail("UNSAFE_HREF_FORBIDDEN");
  let url;
  try { url = new URL(raw, `${ORIGIN}${posix.join(mode.base, currentRoute.slice(1))}`); } catch { fail(code); }
  if (url.origin !== ORIGIN) {
    if (url.protocol === "https:") return undefined;
    fail("UNSAFE_HREF_FORBIDDEN");
  }
  if (url.search !== "" || (mode.base !== "/" && !url.pathname.startsWith(mode.base))) fail(code);
  if (mode.base === "/" && url.pathname.startsWith("/atlas-preview/")) fail(code);
  let logical;
  try { logical = decodeURIComponent(url.pathname.slice(mode.base === "/" ? 1 : mode.base.length)); } catch { fail(code); }
  if (logical.includes("\\") || logical.split("/").some((part) => part === "." || part === "..")) fail("UNSAFE_HREF_FORBIDDEN");
  const candidate = logical === "" || logical.endsWith("/") ? `${logical}index.html` : logical;
  if (!files.has(candidate)) fail(code);
  return candidate;
}

function imports(source) {
  const values = [];
  for (const pattern of [
    /\bimport\s*["']([^"']+)["']/gu,
    /\b(?:import|export)\s*[\w*$,\s{}]+\bfrom\s*["']([^"']+)["']/gu,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu,
  ]) for (const match of source.matchAll(pattern)) values.push(match[1]);
  return values;
}

async function reachableJavaScript(entryNames, files, exactPatterns) {
  const queue = [...entryNames];
  const visited = new Set();
  let gzipBytes = 0;
  let largestModuleGzipBytes = 0;
  while (queue.length > 0) {
    const name = queue.shift();
    if (visited.has(name)) continue;
    const record = files.get(name);
    if (!record || !/\.m?js$/u.test(name)) fail("CLIENT_REFERENCE_INVALID");
    visited.add(name);
    const bytes = await readFile(record.path).catch(() => fail("OUTPUT_READ_FAILED"));
    const source = bytes.toString("utf8");
    if (REQUEST_PATTERN.test(source)) fail("CLIENT_REQUEST_FORBIDDEN");
    if (exactPatterns.some((pattern) => pattern !== "" && source.includes(pattern))) fail("CLIENT_PRIVATE_PATTERN_FORBIDDEN");
    const compressed = gzipSync(bytes).length;
    gzipBytes += compressed;
    largestModuleGzipBytes = Math.max(largestModuleGzipBytes, compressed);
    for (const specifier of imports(source)) {
      if (!specifier.startsWith(".")) fail("CLIENT_IMPORT_FORBIDDEN");
      const dependency = posix.normalize(posix.join(posix.dirname(name), specifier));
      if (dependency.startsWith("../")) fail("CLIENT_REFERENCE_INVALID");
      queue.push(dependency);
    }
  }
  return { names: visited, gzipBytes, largestModuleGzipBytes };
}

function inspectProjection(value, exactPatterns, mode, files, allowedFragments, seen = new Set()) {
  if (typeof value === "string") {
    if (value.includes("<") || value.includes(">")) fail("UNESCAPED_MARKUP_FORBIDDEN");
    if (exactPatterns.some((pattern) => pattern !== "" && value.includes(pattern))) fail("CLIENT_PRIVATE_PATTERN_FORBIDDEN");
    return;
  }
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value) || value instanceof Set) {
    for (const child of value) inspectProjection(child, exactPatterns, mode, files, allowedFragments, seen);
    return;
  }
  if (value instanceof Map) {
    for (const [key, child] of value) {
      inspectProjection(key, exactPatterns, mode, files, allowedFragments, seen);
      inspectProjection(child, exactPatterns, mode, files, allowedFragments, seen);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (PROHIBITED_KEYS.has(key)) fail("MAP_PROJECTION_PRIVATE_FIELD");
    if (key.toLowerCase().endsWith("href") && typeof child === "string") {
      const url = new URL(child, ORIGIN);
      if (url.hash !== "" && url.pathname.endsWith("/map/")) {
        const fragment = decodeURIComponent(url.hash.slice(1));
        if (!allowedFragments.has(fragment)) fail("MAP_FRAGMENT_UNKNOWN");
      }
      localFile(child.split("#")[0], mode, "/map/", files);
    }
    inspectProjection(child, exactPatterns, mode, files, allowedFragments, seen);
  }
}

function assertArray(value, count, code) {
  if (!Array.isArray(value) || value.length !== count) fail(code);
}

function assertProjectionContract(projection, mode, files, exactPatterns) {
  if (typeof projection !== "object" || projection === null || Array.isArray(projection)) fail("MAP_PROJECTION_INVALID");
  assertArray(projection.lanes, 8, "MAP_LANE_COUNT_INVALID");
  if (projection.lanes.map(({ id }) => id).join("\0") !== LANE_IDS.join("\0")) fail("MAP_LANE_COUNT_INVALID");
  const gateIds = projection.processGates?.gates?.map(({ id }) => id);
  assertArray(gateIds, 8, "MAP_GATE_COUNT_INVALID");
  const allowedFragments = new Set(["main-content", ...MAP_MODES, ...LANE_IDS, ...gateIds]);
  assertArray(projection.serviceGuidance?.records, 23, "MAP_PROJECTION_PARITY_INVALID");
  assertArray(projection.thermalGroups, 8, "MAP_PROJECTION_PARITY_INVALID");
  for (const group of projection.thermalGroups) assertArray(group.records, 23, "MAP_PROJECTION_PARITY_INVALID");
  assertArray(projection.processGates?.lanes, 8, "MAP_PROJECTION_PARITY_INVALID");
  assertArray(projection.processGates?.relationships, 64, "MAP_PROJECTION_PARITY_INVALID");
  assertArray(projection.impactFlex?.records, 23, "MAP_PROJECTION_PARITY_INVALID");
  if (Object.keys(projection.modeFragments ?? {}).sort().join("\0") !== [...MAP_MODES].sort().join("\0")) fail("MAP_FRAGMENT_MISSING");
  const prefix = mode.base === "/" ? "" : mode.base.slice(0, -1);
  for (const id of MAP_MODES) if (projection.modeFragments[id] !== `${prefix}/map/#${id}`) fail("MAP_FRAGMENT_MISSING");
  for (const lane of projection.lanes) if (lane.href !== `${prefix}/map/#${lane.id}`) fail("MAP_FRAGMENT_MISSING");
  inspectProjection(projection, exactPatterns, mode, files, allowedFragments);
  return { allowedFragments, projectionGzipBytes: gzipSync(Buffer.from(JSON.stringify(projection))).length };
}

function islandRecords(html) {
  return [...html.matchAll(/<astro-island\b[^>]*>[\s\S]*?<\/astro-island>/giu)].map((match) => {
    const complete = match[0];
    const opening = complete.slice(0, complete.indexOf(">") + 1);
    return { complete, opening, attrs: attributes(opening) };
  });
}

function assertExactFragmentTargets(html, allowedFragments) {
  const counts = new Map();
  for (const match of html.matchAll(/<[a-z][^>]*>/giu)) {
    const id = attributes(match[0]).get("id");
    if (id !== undefined) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const fragment of allowedFragments) {
    if (counts.get(fragment) !== 1) fail("MAP_FRAGMENT_TARGET_MISSING");
  }
}

async function inspectMap(mode, files, exactPatterns) {
  const html = await readFile(files.get("map/index.html")?.path ?? "", "utf8").catch(() => fail("MAP_ROUTE_MISSING"));
  if (exactPatterns.some((pattern) => pattern !== "" && html.includes(pattern))) fail("CLIENT_PRIVATE_PATTERN_FORBIDDEN");
  const canonical = [...html.matchAll(/<link\b[^>]*\brel=["']canonical["'][^>]*\bhref=["']([^"']+)["'][^>]*>/giu)];
  const prefix = mode.base === "/" ? "" : mode.base.slice(0, -1);
  if (canonical.length !== 1 || canonical[0][1] !== `${ORIGIN}${prefix}/map/`) fail("MAP_CANONICAL_INVALID");
  const islands = islandRecords(html);
  if (islands.length !== 1) fail("MAP_ISLAND_COUNT_INVALID");
  const island = islands[0];
  if (!island.opening.includes(" ssr") || island.attrs.get("client") !== "visible" || island.attrs.get("component-export") !== "MapExplorerIsland") fail("MAP_ISLAND_CONTRACT_INVALID");
  const serialized = island.attrs.get("props");
  if (serialized === undefined) fail("PROPS_INVALID");
  const props = parseProps(serialized);
  if (typeof props !== "object" || props === null || Object.keys(props).join("\0") !== "projection") fail("PROPS_INVALID");
  const contract = assertProjectionContract(props.projection, mode, files, exactPatterns);
  assertExactFragmentTargets(html, contract.allowedFragments);
  if (contract.projectionGzipBytes > MAX_PROJECTION_GZIP) fail("MAP_PROJECTION_BUDGET_EXCEEDED");
  for (const copy of STATIC_ALTERNATIVES) if (!island.complete.includes(copy)) fail("MAP_STATIC_ALTERNATIVE_MISSING");
  for (const fragment of [...MAP_MODES, ...LANE_IDS]) {
    const target = `${prefix}/map/#${fragment}`;
    if (!html.includes(`href="${target}"`) && !html.includes(`href='${target}'`)) fail("MAP_FRAGMENT_MISSING");
  }
  for (const match of html.matchAll(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/giu)) {
    const href = decodeAttribute(match[1] ?? match[2] ?? "");
    const url = new URL(href, `${ORIGIN}${prefix}/map/`);
    if (url.origin === ORIGIN && url.pathname === `${prefix}/map/` && url.hash !== "") {
      const fragment = decodeURIComponent(url.hash.slice(1));
      if (!contract.allowedFragments.has(fragment)) fail("MAP_FRAGMENT_UNKNOWN");
    }
    localFile(href, mode, "/map/", files);
  }
  const component = localFile(island.attrs.get("component-url") ?? "", mode, "/map/", files, "CLIENT_REFERENCE_INVALID");
  const renderer = localFile(island.attrs.get("renderer-url") ?? "", mode, "/map/", files, "CLIENT_REFERENCE_INVALID");
  const graph = await reachableJavaScript([component, renderer], files, exactPatterns);
  const rendererGraph = await reachableJavaScript([renderer], files, exactPatterns);
  const totalGzipBytes = graph.gzipBytes + gzipSync(Buffer.from(serialized)).length;
  if (totalGzipBytes > MAX_ROUTE_GZIP) fail("MAP_ROUTE_BUDGET_EXCEEDED");
  if (graph.largestModuleGzipBytes > MAX_VISUALIZATION_MODULE_GZIP) fail("MAP_MODULE_BUDGET_EXCEEDED");
  return { html, projection: props.projection, projectionGzipBytes: contract.projectionGzipBytes, totalGzipBytes, javascriptCount: graph.names.size, graph: graph.names, component, rendererGraph: rendererGraph.names };
}

async function inspectSelectorStage(mode, files, stage, exactPatterns) {
  const html = await readFile(files.get("index.html")?.path ?? "", "utf8").catch(() => fail("SELECTOR_ROUTE_MISSING"));
  const island = islandRecords(html).find(({ attrs }) => attrs.get("component-export") === "SelectorIsland");
  if (!island) fail("SELECTOR_MODEL_MISSING");
  const serialized = island.attrs.get("props");
  if (serialized === undefined) fail("SELECTOR_MODEL_MISSING");
  if (exactPatterns.some((pattern) => pattern !== "" && serialized.includes(pattern))) fail("CLIENT_PRIVATE_PATTERN_FORBIDDEN");
  parseProps(serialized);
  if (!serialized.includes("decisionMaps") || !serialized.includes("decisionMapFallback")) fail("SELECTOR_MODEL_MISSING");
  if (stage === "pre-activation") {
    if (serialized.includes("/map/#lane-") || serialized.includes("Open material decision map") || !island.complete.includes("Decision map is not available yet")) fail("SELECTOR_ACTIVATED_TOO_EARLY");
  } else {
    if (
      !LANE_IDS.every((laneId) => serialized.includes(`/map/#${laneId}`))
      || !LANE_LABELS.every((label) => serialized.includes(`Open ${label} decision path`))
    ) fail("SELECTOR_ACTIVATION_MISSING");
  }
  const entries = [];
  for (const record of islandRecords(html)) {
    const component = localFile(record.attrs.get("component-url") ?? "", mode, "/", files, "CLIENT_REFERENCE_INVALID");
    const renderer = localFile(record.attrs.get("renderer-url") ?? "", mode, "/", files, "CLIENT_REFERENCE_INVALID");
    entries.push(component, renderer);
  }
  return await reachableJavaScript(entries, files, exactPatterns);
}

async function inspectOtherRoutes(mode, files, exactPatterns, forbiddenGraph) {
  for (const route of ["materials", "compare", "data"]) {
    const html = await readFile(files.get(`${route}/index.html`)?.path ?? "", "utf8").catch(() => fail("ROUTE_SCOPE_PROOF_MISSING"));
    if (html.includes("MapExplorerIsland") || MAP_MODES.some((modeId) => html.includes(`data-active-map-section=\"${modeId}\"`))) fail("ROUTE_SCOPE_VIOLATION");
    for (const island of islandRecords(html)) {
      const component = localFile(island.attrs.get("component-url") ?? "", mode, `/${route}/`, files, "CLIENT_REFERENCE_INVALID");
      const renderer = localFile(island.attrs.get("renderer-url") ?? "", mode, `/${route}/`, files, "CLIENT_REFERENCE_INVALID");
      const graph = await reachableJavaScript([component, renderer], files, exactPatterns);
      for (const name of graph.names) if (forbiddenGraph.has(name)) fail("ROUTE_SCOPE_VIOLATION");
    }
  }
}

function normalizeProjection(value, base) {
  const prefix = base === "/" ? "" : base.slice(0, -1);
  return JSON.parse(JSON.stringify(value).replaceAll(`${prefix}/`, "/"));
}

async function artifactDigest(files) {
  const hash = createHash("sha256");
  for (const name of [...files.keys()].sort()) {
    hash.update(name); hash.update("\0"); hash.update(await readFile(files.get(name).path)); hash.update("\0");
  }
  return hash.digest("hex");
}

async function scanBoundedPublication(rootOutput, repositoryOutput, sensitiveFile) {
  let policy;
  try {
    policy = await loadPublicationPolicy({ root: PROJECT_ROOT, ...(sensitiveFile ? { sensitiveFile } : {}), env: process.env });
  } catch { fail("SENSITIVE_INPUT_INVALID"); }
  for (const selected of [{ mode: "working" }, { mode: "artifact", artifactPath: rootOutput }, { mode: "artifact", artifactPath: repositoryOutput }]) {
    const report = await scanPublication({ root: PROJECT_ROOT, policy, ...selected }).catch(() => fail("PUBLICATION_SCAN_FAILED"));
    if (report.findingCount !== 0) fail("PUBLICATION_SCAN_FAILED");
  }
}

export function assertRegistryStage(registrySource, stage) {
  if (typeof registrySource !== "string") fail("REGISTRY_SOURCE_INVALID");
  const closed = /decisionMaps\s*:\s*Object\.freeze\(\[\]\)/u.test(registrySource);
  if (stage === "pre-activation" && !closed) fail("REGISTRY_ACTIVATED_TOO_EARLY");
  if (stage === "final") {
    if (closed || /\ballDecisionMaps\s*:/u.test(registrySource)) fail("REGISTRY_ACTIVATION_MISSING");
    for (const laneId of LANE_IDS) {
      const escaped = laneId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      const laneCount = [...registrySource.matchAll(new RegExp(`laneId:\\s*"${escaped}"`, "gu"))].length;
      const fragmentCount = [...registrySource.matchAll(new RegExp(`fragment:\\s*"${escaped}"`, "gu"))].length;
      if (laneCount !== 1 || fragmentCount !== 1) fail("REGISTRY_ACTIVATION_MISSING");
    }
  }
}

function sameKeys(value, expected) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function validDigest(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

export function assertPreactivationReceipt(prior, current) {
  if (!sameKeys(prior, ["schemaVersion", "stage", "artifacts", "digests", "counts", "bytes"])
      || prior.schemaVersion !== 1 || prior.stage !== "pre-activation"
      || !sameKeys(prior.digests, ["route", "fragments", "projectionContract"])
      || !sameKeys(prior.counts, ["routes", "modes", "lanes", "materials"])
      || JSON.stringify(prior.digests) !== JSON.stringify(current.digests)
      || JSON.stringify(prior.counts) !== JSON.stringify(current.counts)
      || !Array.isArray(prior.artifacts) || prior.artifacts.length !== 2
      || !Array.isArray(prior.bytes) || prior.bytes.length !== 2) fail("PREACTIVATION_RECEIPT_INVALID");

  for (const mode of ["root", "repository"]) {
    const before = prior.artifacts.find((entry) => entry?.mode === mode);
    const after = current.artifacts.find((entry) => entry.mode === mode);
    const byteRecord = prior.bytes.find((entry) => entry?.mode === mode);
    if (!sameKeys(before, ["mode", "fileCount", "digest"]) || !sameKeys(byteRecord, ["mode", "projectionGzipBytes", "totalGzipBytes"])
        || !Number.isInteger(before.fileCount) || before.fileCount !== after.fileCount
        || !validDigest(before.digest) || before.digest === after.digest
        || !Number.isInteger(byteRecord.projectionGzipBytes) || byteRecord.projectionGzipBytes < 1
        || !Number.isInteger(byteRecord.totalGzipBytes) || byteRecord.totalGzipBytes < 1) {
      fail("PREACTIVATION_RECEIPT_INVALID");
    }
  }
}

function receiptTarget(receiptPath) {
  const allowedDirectory = resolve(PROJECT_ROOT, ".planning/.tmp");
  const target = resolve(receiptPath);
  if (dirname(target) !== allowedDirectory) fail("RECEIPT_PATH_INVALID");
  return target;
}

async function readPreactivationReceipt(receiptPath) {
  const target = receiptTarget(receiptPath);
  const info = await lstat(target).catch(() => fail("PREACTIVATION_RECEIPT_INVALID"));
  if (!info.isFile() || info.isSymbolicLink() || info.size < 2 || info.size > 64 * 1024) fail("PREACTIVATION_RECEIPT_INVALID");
  try {
    return JSON.parse(await readFile(target, "utf8"));
  } catch {
    fail("PREACTIVATION_RECEIPT_INVALID");
  }
}

async function writeReceipt(receiptPath, receipt) {
  const allowedDirectory = resolve(PROJECT_ROOT, ".planning/.tmp");
  const target = receiptTarget(receiptPath);
  await mkdir(allowedDirectory, { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, target).catch(() => fail("RECEIPT_WRITE_FAILED"));
}

/**
 * @param {{
 *   rootOutput?: string,
 *   repositoryOutput?: string,
 *   stage?: string,
 *   receiptPath?: string,
 *   registrySource?: string,
 *   prohibitedExactPatterns?: string[],
 *   sensitiveFile?: string,
 *   runPublicationScan?: boolean,
 * }} options
 */
export async function verifyPhase8Build({
  rootOutput = resolve(PROJECT_ROOT, "dist-test/root"), repositoryOutput = resolve(PROJECT_ROOT, "dist-test/repository"),
  stage, receiptPath, registrySource, prohibitedExactPatterns, sensitiveFile = process.env.FDM_PUBLICATION_SENSITIVE_FILE,
  runPublicationScan = true,
} = {}) {
  if (stage !== "pre-activation" && stage !== "final") fail("STAGE_INVALID");
  if (stage === "final" && receiptPath === undefined) fail("PREACTIVATION_RECEIPT_INVALID");
  const priorReceipt = stage === "final" ? await readPreactivationReceipt(receiptPath) : undefined;
  if (prohibitedExactPatterns === undefined) {
    try {
      const loaded = await loadExactPatterns({ root: PROJECT_ROOT, ...(sensitiveFile ? { sensitiveFile } : {}) });
      prohibitedExactPatterns = loaded.map(({ bytes }) => bytes.toString("utf8"));
    } catch { fail("SENSITIVE_INPUT_INVALID"); }
  }
  if (!Array.isArray(prohibitedExactPatterns) || prohibitedExactPatterns.some((value) => typeof value !== "string")) fail("ARGUMENTS_INVALID");
  const source = registrySource ?? await readFile(resolve(PROJECT_ROOT, "src/lib/public-route-registry.ts"), "utf8").catch(() => fail("REGISTRY_SOURCE_INVALID"));
  assertRegistryStage(source, stage);
  const modes = [
    { name: "root", base: "/", output: resolve(rootOutput) },
    { name: "repository", base: "/atlas-preview/", output: resolve(repositoryOutput) },
  ];
  const reports = [];
  for (const mode of modes) {
    const files = await collectFiles(mode.output);
    const map = await inspectMap(mode, files, prohibitedExactPatterns);
    const selectorGraph = await inspectSelectorStage(mode, files, stage, prohibitedExactPatterns);
    const forbiddenGraph = new Set([map.component]);
    for (const name of selectorGraph.names) if (forbiddenGraph.has(name)) fail("ROUTE_SCOPE_VIOLATION");
    await inspectOtherRoutes(mode, files, prohibitedExactPatterns, forbiddenGraph);
    reports.push({ mode: mode.name, files, ...map, artifactDigest: await artifactDigest(files) });
  }
  if (JSON.stringify(normalizeProjection(reports[0].projection, "/")) !== JSON.stringify(normalizeProjection(reports[1].projection, "/atlas-preview/"))) fail("MAP_BASE_PARITY_INVALID");
  const publicReports = reports.map(({ mode, files, artifactDigest: artifact, projectionGzipBytes, totalGzipBytes, javascriptCount }) => ({
    mode, fileCount: files.size, artifactDigest: artifact, projectionGzipBytes, totalGzipBytes, javascriptCount,
  }));
  const receipt = {
    schemaVersion: 1, stage,
    artifacts: publicReports.map(({ mode, fileCount, artifactDigest }) => ({ mode, fileCount, digest: artifactDigest })),
    digests: {
      route: digest("map"), fragments: digest([...MAP_MODES, ...LANE_IDS].join("\0")),
      projectionContract: digest(JSON.stringify(normalizeProjection(reports[0].projection, "/"))),
    },
    counts: { routes: 1, modes: MAP_MODES.length, lanes: LANE_IDS.length, materials: 23 },
    bytes: publicReports.map(({ mode, projectionGzipBytes, totalGzipBytes }) => ({ mode, projectionGzipBytes, totalGzipBytes })),
  };
  if (priorReceipt !== undefined) assertPreactivationReceipt(priorReceipt, receipt);
  if (runPublicationScan) await scanBoundedPublication(modes[0].output, modes[1].output, sensitiveFile);
  if (stage === "pre-activation" && receiptPath !== undefined) await writeReceipt(receiptPath, receipt);
  return Object.freeze({ ok: true, stage, routeCount: 1, modes: Object.freeze(publicReports.map(({ artifactDigest: _digest, ...report }) => Object.freeze(report))) });
}

export function parsePhase8Arguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]; const value = argv[index + 1];
    if (!value || !["--stage", "--receipt"].includes(flag) || flag.slice(2) in options) fail("ARGUMENTS_INVALID");
    options[flag.slice(2)] = value;
  }
  if (Object.keys(options).length === 0 || !options.stage) fail("ARGUMENTS_INVALID");
  return { stage: options.stage, ...(options.receipt ? { receiptPath: options.receipt } : {}) };
}

async function main() {
  try {
    const report = await verifyPhase8Build(parsePhase8Arguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (error) {
    const code = error instanceof Phase8BuildError ? error.code : "PHASE8_VERIFICATION_FAILED";
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    process.exitCode = 1;
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();
