import { gzipSync } from "node:zlib";

import type { AtlasV1 } from "../../data/schema/atlas.ts";
import { internalHref, internalMapFragmentHref } from "../../lib/routes.ts";
import {
  MAP_MODES,
  type MapImpactFlexRecord,
  type MapInternalHref,
  type MapMode,
  type MapProjection,
} from "./contracts.ts";
import { buildDecisionPaths } from "./decision-path.ts";
import { buildImpactFlexModel } from "./impact-flex.ts";
import { buildProcessGateMap } from "./process-gates.ts";
import { buildNamedThermalModel, buildServiceGuidanceModel } from "./thermal.ts";

const EXPECTED_COUNTS = Object.freeze({
  materials: 23,
  lanes: 8,
  gates: 8,
  visualizationReferences: 54,
  thermalGroups: 8,
});

const MAX_PROJECTION_GZIP_BYTES = 8 * 1024;
const FAILURE_CODE = "MAP_PROJECTION_FAILED";

function fail(): never {
  throw new Error(FAILURE_CODE);
}

function uniqueIds(records: readonly { readonly id: string }[], expected: number): boolean {
  return records.length === expected && new Set(records.map(({ id }) => id)).size === expected;
}

function mapHref(value: string): MapInternalHref {
  if (!value.startsWith("/") || value.includes("\\") || /^\/\//u.test(value)) return fail();
  return value as MapInternalHref;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function validateCanonicalInventory(atlas: AtlasV1): void {
  if (!uniqueIds(atlas.materials, EXPECTED_COUNTS.materials)) return fail();
  if (!uniqueIds(atlas.decisionLanes, EXPECTED_COUNTS.lanes)) return fail();
  if (!uniqueIds(atlas.processGates, EXPECTED_COUNTS.gates)) return fail();
  if (!uniqueIds(atlas.visualizationReferences, EXPECTED_COUNTS.visualizationReferences)) return fail();
}

function compactImpactRecord(record: ReturnType<typeof buildImpactFlexModel>["records"]["all"][number]): MapImpactFlexRecord {
  return {
    material: record.material,
    ...(record.impact === undefined ? {} : { impact: record.impact }),
    ...(record.flexibility === undefined ? {} : { flexibility: record.flexibility }),
    ...(record.printDifficulty === undefined ? {} : { printDifficulty: record.printDifficulty }),
    impactFact: record.impactFact,
    flexibilityFact: record.flexibilityFact,
    disposition: record.disposition,
    ...(record.slot === undefined ? {} : { slot: record.slot }),
  };
}

function modeFragments(base: string | undefined): Readonly<Record<MapMode, MapInternalHref>> {
  return Object.fromEntries(
    MAP_MODES.map((mode) => [mode, mapHref(internalMapFragmentHref(base, mode))]),
  ) as Readonly<Record<MapMode, MapInternalHref>>;
}

function compile(atlas: AtlasV1, base: string | undefined): MapProjection {
  validateCanonicalInventory(atlas);

  const lanes = buildDecisionPaths(atlas, base);
  const service = buildServiceGuidanceModel(atlas.materials, base, { query: "", sort: "canonical" });
  const thermal = buildNamedThermalModel(atlas.materials, base);
  const processGates = buildProcessGateMap(atlas, base);
  const impact = buildImpactFlexModel(atlas, base);

  if (
    lanes.length !== EXPECTED_COUNTS.lanes
    || service.domain === undefined
    || service.records.all.length !== EXPECTED_COUNTS.materials
    || thermal.groups.length !== EXPECTED_COUNTS.thermalGroups
    || processGates.lanes.length !== EXPECTED_COUNTS.lanes
    || processGates.gates.length !== EXPECTED_COUNTS.gates
    || processGates.relationships.length !== EXPECTED_COUNTS.lanes * EXPECTED_COUNTS.gates
    || impact.records.all.length !== EXPECTED_COUNTS.materials
  ) return fail();

  const projection: MapProjection = {
    lanes,
    serviceGuidance: {
      domain: service.domain,
      records: service.records.all,
    },
    thermalGroups: thermal.groups,
    processGates,
    impactFlex: impact.records.all.map(compactImpactRecord),
    modeFragments: modeFragments(base),
    methodHref: mapHref(internalHref(base, { id: "method" })),
  };

  const frozen = deepFreeze(projection);
  if (gzipSync(JSON.stringify(frozen)).byteLength > MAX_PROJECTION_GZIP_BYTES) return fail();
  return frozen;
}

/** Compile the fixed public Atlas into the sole compact browser map contract. */
export function compileMapProjection(
  atlas: AtlasV1,
  base: string | undefined = "/",
): MapProjection {
  try {
    return compile(atlas, base);
  } catch {
    return fail();
  }
}

