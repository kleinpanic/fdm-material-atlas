import type { MaterialId, SelectorOptionId } from "../../data/schema/ids.ts";
import type { SelectorProjectionV1 } from "../../domain/selector/index.ts";
import type { SelectorRouteAvailability } from "../../lib/public-route-registry.ts";

type FamilyDisplay =
  Readonly<{ state: "known" | "conditional"; label: string }> | Readonly<{ state: "unavailable" }>;

export type SelectorMaterialDisplay = Readonly<{
  id: MaterialId;
  label: string;
  familyOrFill: FamilyDisplay;
}>;

export type SelectorRuntimePageModel = Readonly<{
  projection: SelectorProjectionV1;
  defaults: Readonly<Record<string, SelectorOptionId>>;
  display: Readonly<{ materials: readonly SelectorMaterialDisplay[] }>;
  routes: SelectorRouteAvailability;
}>;

type EncodedNode = readonly unknown[];
type ObjectNode = readonly [1, ...(readonly unknown[])];

/** Version, lexically sorted string dictionary, and encoded root object. */
export type SelectorClientModel = readonly [1, readonly string[], EncodedNode];

const INVALID = "SELECTOR_CLIENT_MODEL_INVALID";
const MAX_DICTIONARY = 16_384;
const MAX_STRING_LENGTH = 4_096;
const MAX_COLLECTION = 16_384;
const MAX_DEPTH = 64;
const MAX_NODES = 200_000;
const MAX_BYTES = 48 * 1024;

function fail(): never {
  throw new Error(INVALID);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function collectStrings(value: unknown, strings: Set<string>, depth = 0): void {
  if (depth > MAX_DEPTH) fail();
  if (typeof value === "string") {
    if (value.length > MAX_STRING_LENGTH) fail();
    strings.add(value);
    return;
  }
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail();
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_COLLECTION) fail();
    value.forEach((child) => collectStrings(child, strings, depth + 1));
    return;
  }
  if (!isRecord(value)) fail();
  const entries = Object.entries(value);
  if (entries.length > MAX_COLLECTION) fail();
  for (const [key, child] of entries) {
    if (key.length > MAX_STRING_LENGTH) fail();
    strings.add(key);
    collectStrings(child, strings, depth + 1);
  }
}

function encodeNode(value: unknown, indexes: ReadonlyMap<string, number>, depth = 0): EncodedNode {
  if (depth > MAX_DEPTH) fail();
  if (typeof value === "string") return [0, indexes.get(value) ?? fail()];
  if (typeof value === "number") return Number.isFinite(value) ? [3, value] : fail();
  if (typeof value === "boolean") return [4, value ? 1 : 0];
  if (value === null) return [5];
  if (Array.isArray(value))
    return [2, ...value.map((child) => encodeNode(child, indexes, depth + 1))];
  if (!isRecord(value)) fail();
  const tuple: (number | EncodedNode)[] = [1];
  for (const [key, child] of Object.entries(value).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    tuple.push(indexes.get(key) ?? fail(), encodeNode(child, indexes, depth + 1));
  }
  return tuple as unknown as ObjectNode;
}

function validateRuntimeModel(value: unknown): asserts value is SelectorRuntimePageModel {
  if (
    !isRecord(value) ||
    !isRecord(value.projection) ||
    !isRecord(value.defaults) ||
    !isRecord(value.display) ||
    !isRecord(value.routes)
  )
    fail();
  const projection = value.projection as Record<string, unknown>;
  if (
    projection.kind !== "selector-projection" ||
    projection.schemaVersion !== 1 ||
    projection.projectionVersion !== 1 ||
    !Array.isArray(projection.criteria) ||
    projection.criteria.length !== 7 ||
    !Array.isArray(projection.materials) ||
    projection.materials.length === 0 ||
    projection.materials.length > 512
  )
    fail();
  const ids = new Set<string>();
  for (const material of projection.materials) {
    if (!isRecord(material) || typeof material.id !== "string" || ids.has(material.id)) fail();
    ids.add(material.id);
  }
  const display = value.display as Record<string, unknown>;
  if (!Array.isArray(display.materials) || display.materials.length !== ids.size) fail();
  const displayIds = new Set(
    display.materials.map((material) => (isRecord(material) ? material.id : fail())),
  );
  if (displayIds.size !== ids.size || [...ids].some((id) => !displayIds.has(id))) fail();
  const routes = value.routes as Record<string, unknown>;
  if (!Array.isArray(routes.materials) || routes.materials.length !== ids.size) fail();
  for (const route of routes.materials) {
    if (!isRecord(route) || typeof route.materialId !== "string" || !ids.has(route.materialId))
      fail();
    for (const key of ["details", "startingProfile"] as const) validateRouteAction(route[key]);
    if (!Array.isArray(route.decisionMaps)) fail();
    route.decisionMaps.forEach((entry) => {
      if (!isRecord(entry) || typeof entry.laneId !== "string") fail();
      validateRouteAction(entry.action);
    });
  }
}

function validateRouteAction(value: unknown): void {
  if (!isRecord(value) || (value.kind !== "link" && value.kind !== "unavailable")) fail();
  if (value.kind === "link" && (typeof value.href !== "string" || !value.href.startsWith("/")))
    fail();
  if (value.kind === "unavailable" && "href" in value) fail();
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

export function encodeSelectorClientModel(model: SelectorRuntimePageModel): SelectorClientModel {
  try {
    validateRuntimeModel(model);
    const strings = new Set<string>();
    collectStrings(model, strings);
    const dictionary = [...strings].sort();
    if (dictionary.length > MAX_DICTIONARY) fail();
    const indexes = new Map(dictionary.map((value, index) => [value, index]));
    const encoded = [1, dictionary, encodeNode(model, indexes)] as const;
    if (JSON.stringify(encoded).length > MAX_BYTES) fail();
    return encoded;
  } catch {
    return fail();
  }
}

export function decodeSelectorClientModel(input: SelectorClientModel): SelectorRuntimePageModel {
  try {
    if (!Array.isArray(input) || input.length !== 3 || input[0] !== 1 || !Array.isArray(input[1]))
      fail();
    const dictionary = input[1];
    if (dictionary.length > MAX_DICTIONARY) fail();
    let previous: string | undefined;
    for (const entry of dictionary) {
      if (
        typeof entry !== "string" ||
        entry.length > MAX_STRING_LENGTH ||
        (previous !== undefined && entry <= previous)
      )
        fail();
      previous = entry;
    }
    let nodes = 0;
    const decodeNode = (node: unknown, depth = 0): unknown => {
      if (++nodes > MAX_NODES || depth > MAX_DEPTH || !Array.isArray(node) || node.length === 0)
        fail();
      const tag = node[0];
      if (tag === 0) {
        if (
          node.length !== 2 ||
          !Number.isInteger(node[1]) ||
          node[1] < 0 ||
          node[1] >= dictionary.length
        )
          fail();
        return dictionary[node[1] as number];
      }
      if (tag === 2) {
        if (node.length - 1 > MAX_COLLECTION) fail();
        return node.slice(1).map((child) => decodeNode(child, depth + 1));
      }
      if (tag === 3) {
        if (node.length !== 2 || typeof node[1] !== "number" || !Number.isFinite(node[1])) fail();
        return node[1];
      }
      if (tag === 4) {
        if (node.length !== 2 || (node[1] !== 0 && node[1] !== 1)) fail();
        return node[1] === 1;
      }
      if (tag === 5) {
        if (node.length !== 1) fail();
        return null;
      }
      if (tag !== 1 || (node.length - 1) % 2 !== 0 || (node.length - 1) / 2 > MAX_COLLECTION)
        fail();
      const result: Record<string, unknown> = Object.create(null);
      for (let index = 1; index < node.length; index += 2) {
        const keyIndex = node[index];
        if (
          !Number.isInteger(keyIndex) ||
          (keyIndex as number) < 0 ||
          (keyIndex as number) >= dictionary.length
        )
          fail();
        const key = dictionary[keyIndex as number]!;
        if (Object.hasOwn(result, key)) fail();
        result[key] = decodeNode(node[index + 1], depth + 1);
      }
      return result;
    };
    const decoded = decodeNode(input[2]);
    validateRuntimeModel(decoded);
    return deepFreeze(decoded);
  } catch {
    return fail();
  }
}
