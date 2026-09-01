import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { parseAtlas } from "../src/data/schema/parse-atlas.ts";
import { serializeAtlas } from "../src/data/serialization/stable-json.ts";

const TOOL_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(TOOL_DIRECTORY, "..");
const CANONICAL_RELATIVE_PATH = "src/data/public/atlas.v1.json";
const CANONICAL_PATH = resolve(PROJECT_ROOT, CANONICAL_RELATIVE_PATH);
const MAX_INPUT_BYTES = 1_000_000;
const DEFAULT_IDENTIFIER_LIMIT = 8;
const MAX_IDENTIFIER_LIMIT = 20;
const BASE_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u;

const COUNT_COLLECTIONS = Object.freeze({
  materials: (atlas) => atlas.materials.length,
  sources: (atlas) => atlas.sources.length,
  methods: (atlas) => atlas.methods.length,
  selectorCriteria: (atlas) => atlas.selector.criteria.length,
  selectorOptions: (atlas) =>
    atlas.selector.criteria.reduce((total, criterion) => total + criterion.options.length, 0),
  processGates: (atlas) => atlas.processGates.length,
  decisionLanes: (atlas) => atlas.decisionLanes.length,
  visualizationReferences: (atlas) => atlas.visualizationReferences.length,
  vocabularies: (atlas) => atlas.vocabularies.length,
  evidenceReferences: evidenceReferenceCount,
});

const IDENTIFIER_COLLECTIONS = Object.freeze({
  materials: (atlas) => atlas.materials.map(({ id }) => id),
  sources: (atlas) => atlas.sources.map(({ id }) => id),
  methods: (atlas) => atlas.methods.map(({ id }) => id),
  selectorCriteria: (atlas) => atlas.selector.criteria.map(({ id }) => id),
  selectorOptions: (atlas) =>
    atlas.selector.criteria.flatMap(({ options }) => options.map(({ id }) => id)),
  processGates: (atlas) => atlas.processGates.map(({ id }) => id),
  decisionLanes: (atlas) => atlas.decisionLanes.map(({ id }) => id),
  visualizationReferences: (atlas) => atlas.visualizationReferences.map(({ id }) => id),
  vocabularies: (atlas) => atlas.vocabularies.map(({ id }) => id),
});

const MATERIAL_GROUPS = Object.freeze({
  identity: (material) => ({
    slug: material.slug,
    displayOrder: material.displayOrder,
    name: material.name,
  }),
  family: (material) => withoutBasis(material.familyOrFill),
  thermal: (material) => ({
    serviceTemperature: withoutBasis(material.serviceTemperature),
    thermalObservations: material.thermalObservations.map(withoutBasis),
  }),
  properties: (material) => withoutBasis(material.properties),
  process: (material) => withoutBasis(material.process),
  guidance: (material) => withoutBasis(material.guidance),
  cost: (material) => withoutBasis(material.costTier),
  startingProfile: (material) => withoutBasis(material.startingProfile),
  evidence: materialEvidence,
});

export class PublicDataSummaryError extends Error {
  constructor(code) {
    super(code);
    this.name = "PublicDataSummaryError";
    this.code = code;
  }
}

function fail(code) {
  throw new PublicDataSummaryError(code);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort(compareText)
      .map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function withoutBasis(value) {
  if (Array.isArray(value)) return value.map(withoutBasis);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "basis")
      .map(([key, child]) => [key, withoutBasis(child)]),
  );
}

function materialClaims(material) {
  return [
    material.familyOrFill,
    material.serviceTemperature,
    ...material.thermalObservations,
    ...Object.values(material.properties),
    ...Object.values(material.process),
    ...Object.values(material.guidance),
    material.costTier,
    material.startingProfile.printSpeed,
    material.startingProfile.partCoolingFan,
    material.startingProfile.bridgeSpeed,
    material.startingProfile.bridgeFan,
  ];
}

function materialEvidence(material) {
  return materialClaims(material).map(({ basis }) => basis);
}

function evidenceReferenceCount(atlas) {
  const materialReferences = atlas.materials.reduce(
    (total, material) =>
      total + materialClaims(material).reduce((count, claim) => count + claim.basis.length, 0),
    0,
  );
  const gateReferences = atlas.processGates.reduce((total, gate) => total + gate.basis.length, 0);
  return materialReferences + gateReferences;
}

function parseCanonicalBytes(bytes) {
  let input;
  try {
    input = JSON.parse(bytes);
  } catch {
    return fail("SUMMARY_INPUT_INVALID");
  }
  const parsed = parseAtlas(input);
  if (!parsed.success) return fail("SUMMARY_INPUT_INVALID");
  if (serializeAtlas(parsed.data) !== bytes) return fail("SUMMARY_INPUT_NONCANONICAL");
  return parsed.data;
}

function pathInside(parent, candidate) {
  const pathFromParent = relative(parent, candidate);
  return pathFromParent !== "" && pathFromParent !== ".." && !pathFromParent.startsWith(`..${sep}`);
}

/** Read a fixed canonical artifact or a regular fixture below the OS temporary directory. */
export function readCanonicalAtlasFile(inputPath) {
  if (typeof inputPath !== "string" || inputPath.length === 0) {
    return fail("SUMMARY_PATH_UNEXPECTED");
  }
  const absolutePath = resolve(inputPath);
  let metadata;
  try {
    metadata = lstatSync(absolutePath);
  } catch {
    return fail("SUMMARY_INPUT_UNREADABLE");
  }
  if (metadata.isSymbolicLink()) return fail("SUMMARY_INPUT_SYMLINK");
  if (!metadata.isFile()) return fail("SUMMARY_INPUT_NOT_FILE");

  let physicalPath;
  try {
    physicalPath = realpathSync(absolutePath);
  } catch {
    return fail("SUMMARY_INPUT_UNREADABLE");
  }
  const temporaryRoot = realpathSync(tmpdir());
  if (physicalPath !== realpathSync(CANONICAL_PATH) && !pathInside(temporaryRoot, physicalPath)) {
    return fail("SUMMARY_PATH_UNEXPECTED");
  }
  if (metadata.size > MAX_INPUT_BYTES) return fail("SUMMARY_INPUT_TOO_LARGE");

  let bytes;
  try {
    bytes = readFileSync(physicalPath, "utf8");
  } catch {
    return fail("SUMMARY_INPUT_UNREADABLE");
  }
  return parseCanonicalBytes(bytes);
}

/** Read canonical public data from a bounded Git object selected by a safe ref. */
export function readCanonicalAtlasAtBase(baseRef) {
  if (
    typeof baseRef !== "string" ||
    !BASE_REF_PATTERN.test(baseRef) ||
    baseRef.startsWith("-") ||
    baseRef.includes("..") ||
    baseRef.includes("//")
  ) {
    return fail("SUMMARY_GIT_BASE_INVALID");
  }
  let bytes;
  try {
    bytes = execFileSync("git", ["show", `${baseRef}:${CANONICAL_RELATIVE_PATH}`], {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      maxBuffer: MAX_INPUT_BYTES + 1,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return fail("SUMMARY_GIT_READ_FAILED");
  }
  if (Buffer.byteLength(bytes, "utf8") > MAX_INPUT_BYTES) {
    return fail("SUMMARY_INPUT_TOO_LARGE");
  }
  return parseCanonicalBytes(bytes);
}

function boundedIdentifiers(values, limit) {
  const identifiers = [...values].sort(compareText);
  return {
    identifiers: identifiers.slice(0, limit),
    omitted: Math.max(0, identifiers.length - limit),
  };
}

function identifierChanges(before, after, limit) {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const added = boundedIdentifiers(afterSet.difference(beforeSet), limit);
  const removed = boundedIdentifiers(beforeSet.difference(afterSet), limit);
  if (added.identifiers.length === 0 && removed.identifiers.length === 0) return undefined;
  return {
    added: added.identifiers,
    addedOmitted: added.omitted,
    removed: removed.identifiers,
    removedOmitted: removed.omitted,
  };
}

function changedMaterialGroups(before, after, limit) {
  const beforeById = new Map(before.materials.map((material) => [material.id, material]));
  const afterById = new Map(after.materials.map((material) => [material.id, material]));
  const sharedIds = [...beforeById.keys()].filter((id) => afterById.has(id)).sort(compareText);
  const result = {};
  for (const [group, select] of Object.entries(MATERIAL_GROUPS)) {
    const changed = sharedIds.filter(
      (id) => stableValue(select(beforeById.get(id))) !== stableValue(select(afterById.get(id))),
    );
    if (changed.length === 0) continue;
    const bounded = boundedIdentifiers(changed, limit);
    result[group] = {
      changed: changed.length,
      identifiers: bounded.identifiers,
      omitted: bounded.omitted,
    };
  }
  return result;
}

/** Summarize only controlled counts, public identifiers, and semantic group names. */
export function summarizePublicDataChange(before, after, options = {}) {
  const parsedBefore = parseAtlas(before);
  const parsedAfter = parseAtlas(after);
  if (!parsedBefore.success || !parsedAfter.success) return fail("SUMMARY_INPUT_INVALID");
  const identifierLimit = Math.min(
    MAX_IDENTIFIER_LIMIT,
    Math.max(
      1,
      Number.isInteger(options.identifierLimit)
        ? options.identifierLimit
        : DEFAULT_IDENTIFIER_LIMIT,
    ),
  );

  const counts = {};
  for (const [name, count] of Object.entries(COUNT_COLLECTIONS)) {
    const beforeCount = count(parsedBefore.data);
    const afterCount = count(parsedAfter.data);
    counts[name] = { before: beforeCount, after: afterCount, delta: afterCount - beforeCount };
  }

  const identifiers = {};
  for (const [name, collect] of Object.entries(IDENTIFIER_COLLECTIONS)) {
    const change = identifierChanges(
      collect(parsedBefore.data),
      collect(parsedAfter.data),
      identifierLimit,
    );
    if (change !== undefined) identifiers[name] = change;
  }
  const changedPropertyGroups = changedMaterialGroups(
    parsedBefore.data,
    parsedAfter.data,
    identifierLimit,
  );
  const canonicalChanged = serializeAtlas(parsedBefore.data) !== serializeAtlas(parsedAfter.data);

  return {
    schemaVersion: 1,
    status: canonicalChanged ? "changed" : "unchanged",
    counts,
    identifiers,
    changedPropertyGroups,
  };
}

function signed(value) {
  return value > 0 ? `+${value}` : String(value);
}

function identifierList(values, omitted) {
  const visible = values.length === 0 ? "none" : values.map((value) => `\`${value}\``).join(", ");
  return omitted === 0 ? visible : `${visible} (${omitted} more)`;
}

export function formatPublicDataSummary(summary, format = "markdown") {
  if (format === "json") return `${JSON.stringify(summary, null, 2)}\n`;
  if (format !== "markdown") return fail("SUMMARY_FORMAT_INVALID");
  const lines = [
    "## Public data change summary",
    "",
    `Status: **${summary.status}**`,
    "",
    "| Public collection | Before | After | Delta |",
    "|---|---:|---:|---:|",
  ];
  for (const [name, count] of Object.entries(summary.counts)) {
    lines.push(`| ${name} | ${count.before} | ${count.after} | ${signed(count.delta)} |`);
  }
  const identifierEntries = Object.entries(summary.identifiers);
  if (identifierEntries.length > 0) {
    lines.push("", "### Public identifiers");
    for (const [name, change] of identifierEntries) {
      lines.push(
        `- ${name}: added ${identifierList(change.added, change.addedOmitted)}; removed ${identifierList(change.removed, change.removedOmitted)}.`,
      );
    }
  }
  const groupEntries = Object.entries(summary.changedPropertyGroups);
  if (groupEntries.length > 0) {
    lines.push("", "### Changed material property groups");
    for (const [name, change] of groupEntries) {
      lines.push(
        `- ${name}: ${change.changed}; ${identifierList(change.identifiers, change.omitted)}.`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

function parseArguments(argv) {
  const options = { format: "markdown" };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (value === undefined) return fail("SUMMARY_USAGE_INVALID");
    if (flag === "--before-file") options.beforeFile = value;
    else if (flag === "--after-file") options.afterFile = value;
    else if (flag === "--base-ref") options.baseRef = value;
    else if (flag === "--format") options.format = value;
    else return fail("SUMMARY_USAGE_INVALID");
  }
  if ((options.beforeFile === undefined) === (options.baseRef === undefined)) {
    return fail("SUMMARY_USAGE_INVALID");
  }
  return options;
}

export function run(argv) {
  const options = parseArguments(argv);
  const before =
    options.beforeFile === undefined
      ? readCanonicalAtlasAtBase(options.baseRef)
      : readCanonicalAtlasFile(options.beforeFile);
  const after = readCanonicalAtlasFile(options.afterFile ?? CANONICAL_PATH);
  return formatPublicDataSummary(summarizePublicDataChange(before, after), options.format);
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(run(process.argv.slice(2)));
  } catch (error) {
    const code = error instanceof PublicDataSummaryError ? error.code : "SUMMARY_INTERNAL_ERROR";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }
}
