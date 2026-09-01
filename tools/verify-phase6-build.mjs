#!/usr/bin/env node

import { gzipSync } from "node:zlib";
import { lstat, opendir, readFile, realpath } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { loadExactPatterns } from "./lib/publication-policy.mjs";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MODES = Object.freeze([
  { name: "root", base: "/", output: resolve(PROJECT_ROOT, "dist-test/root") },
  { name: "repository", base: "/atlas-preview/", output: resolve(PROJECT_ROOT, "dist-test/repository") },
]);
const DETAIL_FRAGMENTS = Object.freeze(["overview", "thermal", "properties", "process", "uses-tradeoffs", "starting-profile", "evidence", "limitations", "relationships"]);
const METHOD_FRAGMENTS = Object.freeze(["evidence-scopes", "thermal-metrics", "selector-scoring", "qualitative-guidance", "starting-profiles", "methods", "sources", "limitations"]);

export class Phase6BuildError extends Error {
  constructor(code) { super(code); this.name = "Phase6BuildError"; this.code = code; }
  toJSON() { return { code: this.code }; }
}
function fail(code) { throw new Phase6BuildError(code); }

async function filesUnder(root) {
  const stat = await lstat(root).catch(() => fail("PHASE6_OUTPUT_MISSING"));
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(root).catch(() => "") !== root) fail("PHASE6_OUTPUT_INVALID");
  const files = new Map();
  async function walk(directory) {
    const entries = await opendir(directory).catch(() => fail("PHASE6_OUTPUT_INVALID"));
    for await (const entry of entries) {
      const path = join(directory, entry.name);
      const info = await lstat(path).catch(() => fail("PHASE6_OUTPUT_INVALID"));
      if (info.isSymbolicLink()) fail("PHASE6_OUTPUT_SYMLINK");
      if (info.isDirectory()) await walk(path);
      else if (info.isFile()) files.set(relative(root, path).split(sep).join("/"), { path, size: info.size });
      else fail("PHASE6_OUTPUT_INVALID");
    }
  }
  await walk(root);
  return files;
}

function ids(html) {
  return new Set([...html.matchAll(/\bid\s*=\s*(?:"([^"]+)"|'([^']+)')/gi)].map((match) => match[1] ?? match[2]));
}
function anchors(html) {
  return [...html.matchAll(/<a\b([^>]*)\bhref\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>/gi)].map((match) => ({ tag: match[0], attrs: match[1], href: match[2] ?? match[3] }));
}
function routeFile(pathname, base) {
  if (!pathname.startsWith(base) || (base !== "/" && pathname.startsWith(`${base}${base.slice(1)}`))) fail("PHASE6_BASE_PATH_INVALID");
  const logical = pathname.slice(base.length);
  if (logical.includes("\\") || logical.split("/").some((part) => part === "." || part === "..")) fail("PHASE6_LOCAL_LINK_INVALID");
  return logical === "" || logical.endsWith("/") ? `${logical}index.html` : logical;
}

async function inspectMode(mode, atlas) {
  const files = await filesUnder(mode.output);
  if ([...files.keys()].some((name) => name.endsWith(".map"))) fail("PHASE6_SOURCE_MAP_FORBIDDEN");
  const html = new Map();
  for (const [name, record] of files) if (name.endsWith(".html")) html.set(name, await readFile(record.path, "utf8"));
  const materialFiles = atlas.materials.map(({ slug }) => `materials/${slug}/index.html`);
  for (const name of ["index.html", "materials/index.html", "method/index.html", ...materialFiles]) if (!html.has(name)) fail("PHASE6_ROUTE_MISSING");
  if (materialFiles.length !== 23 || new Set(materialFiles).size !== 23) fail("PHASE6_MATERIAL_COUNT_INVALID");

  const method = html.get("method/index.html");
  const methodIds = ids(method);
  for (const fragment of [...METHOD_FRAGMENTS, ...atlas.sources.map(({ id }) => id), ...atlas.methods.map(({ id }) => id)]) {
    if (!methodIds.has(fragment)) fail("PHASE6_METHOD_FRAGMENT_MISSING");
  }
  for (const name of materialFiles) {
    const material = html.get(name);
    const materialIds = ids(material);
    for (const fragment of DETAIL_FRAGMENTS) if (!materialIds.has(fragment)) fail("PHASE6_DETAIL_FRAGMENT_MISSING");
    if ((material.match(/<astro-island\b/gi) ?? []).length !== 0 || (material.match(/<script\b/gi) ?? []).length !== 0) fail("PHASE6_STATIC_ROUTE_SCRIPT_FORBIDDEN");
  }
  if ((method.match(/<astro-island\b/gi) ?? []).length !== 0 || (method.match(/<script\b/gi) ?? []).length !== 0) fail("PHASE6_STATIC_ROUTE_SCRIPT_FORBIDDEN");
  const atlasHtml = html.get("materials/index.html");
  if ((atlasHtml.match(/<astro-island\b/gi) ?? []).length !== 1) fail("PHASE6_ATLAS_ISLAND_COUNT_INVALID");

  for (const [name, document] of html) {
    const current = new URL(posix.join(mode.base, name === "index.html" ? "" : name.replace(/index\.html$/, "")), "https://atlas.example");
    for (const { tag, href } of anchors(document)) {
      if (/^(?:mailto|tel):/i.test(href)) continue;
      let url;
      try { url = new URL(href.replaceAll("&amp;", "&"), current); } catch { fail("PHASE6_LINK_INVALID"); }
      if (url.origin !== current.origin) {
        if (url.protocol !== "https:") fail("PHASE6_EXTERNAL_LINK_PROTOCOL");
        if (/\btarget=["']_blank["']/i.test(tag) && !/\brel=["'][^"']*noopener[^"']*noreferrer[^"']*["']/i.test(tag)) fail("PHASE6_EXTERNAL_LINK_ISOLATION");
        continue;
      }
      const target = routeFile(url.pathname, mode.base);
      if (!files.has(target)) fail("PHASE6_LOCAL_TARGET_MISSING");
      if (url.hash) {
        const targetHtml = html.get(target);
        if (!targetHtml || !ids(targetHtml).has(decodeURIComponent(url.hash.slice(1)))) fail("PHASE6_LOCAL_FRAGMENT_MISSING");
      }
    }
  }

  let gzipBytes = 0;
  let javascriptCount = 0;
  for (const [name, record] of files) if (name.endsWith(".js") || name.endsWith(".mjs")) {
    gzipBytes += gzipSync(await readFile(record.path)).length;
    javascriptCount += 1;
  }
  const props = [...atlasHtml.matchAll(/\bprops=(?:"([^"]*)"|'([^']*)')/gi)].map((match) => match[1] ?? match[2]).join("");
  gzipBytes += gzipSync(props).length;
  if (gzipBytes > 100 * 1024) fail("PHASE6_ATLAS_PAYLOAD_EXCEEDED");
  return { mode: mode.name, routeCount: html.size, materialCount: materialFiles.length, atlasIslandCount: 1, staticRouteJavaScriptCount: 0, atlasGzipBytes: gzipBytes, javascriptCount };
}

export async function verifyPhase6Build({ modes = DEFAULT_MODES, atlasPath = resolve(PROJECT_ROOT, "src/data/public/atlas.v1.json"), sensitiveFile = process.env.FDM_PUBLICATION_SENSITIVE_FILE, runPublication = true } = {}) {
  let atlas;
  try { atlas = JSON.parse(await readFile(atlasPath, "utf8")); } catch { fail("PHASE6_ATLAS_INVALID"); }
  if (!Array.isArray(atlas.materials) || !Array.isArray(atlas.sources) || !Array.isArray(atlas.methods)) fail("PHASE6_ATLAS_INVALID");
  const reports = [];
  for (const mode of modes) reports.push(await inspectMode(mode, atlas));
  if (new Set(reports.map(({ routeCount }) => routeCount)).size !== 1) fail("PHASE6_ROUTE_PARITY_FAILED");
  if (runPublication) {
    if (typeof sensitiveFile !== "string" || sensitiveFile === "") fail("PHASE6_SENSITIVE_INPUT_REQUIRED");
    let patterns;
    try { patterns = await loadExactPatterns({ root: PROJECT_ROOT, sensitiveFile }); } catch { fail("PHASE6_SENSITIVE_INPUT_INVALID"); }
    for (const mode of modes) {
      const files = await filesUnder(mode.output);
      for (const { path } of files.values()) {
        const bytes = await readFile(path).catch(() => fail("PHASE6_PUBLICATION_SCAN_FAILED"));
        if (patterns.some(({ bytes: pattern }) => bytes.indexOf(pattern) !== -1)) fail("PHASE6_PUBLICATION_SCAN_FAILED");
      }
    }
  }
  return Object.freeze({ ok: true, modes: reports });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--stage" || args[1] !== "final") fail("PHASE6_ARGUMENTS_INVALID");
  process.stdout.write(`${JSON.stringify(await verifyPhase6Build())}\n`);
}
if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, code: error instanceof Phase6BuildError ? error.code : "PHASE6_VERIFICATION_FAILED" })}\n`);
  process.exitCode = 1;
});
