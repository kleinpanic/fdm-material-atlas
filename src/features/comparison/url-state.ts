import type { MaterialId } from "../../data/schema/ids.ts";
import { isMaterialIdValue } from "../../data/schema/public-id-values.ts";
import { internalHref } from "../../lib/routes.ts";

const MATERIAL_KEY = "material";
const MIN_MATERIALS = 2;
const MAX_MATERIALS = 4;
const MAX_SEARCH_LENGTH = 4_096;

export type CompareUrlErrorCode =
  | "COMPARE_URL_INPUT_INVALID"
  | "COMPARE_URL_TOO_LONG"
  | "COMPARE_URL_KEYS_INVALID"
  | "COMPARE_URL_COUNT_INVALID"
  | "COMPARE_URL_MATERIAL_INVALID"
  | "COMPARE_URL_DUPLICATE"
  | "COMPARE_URL_CONTEXT_INVALID";

export type DecodedCompareUrlState =
  | Readonly<{ kind: "empty" }>
  | Readonly<{ kind: "valid"; materialIds: readonly MaterialId[] }>
  | Readonly<{ kind: "invalid"; code: CompareUrlErrorCode }>;

export type EncodedCompareUrlState =
  | Readonly<{ kind: "valid"; materialIds: readonly MaterialId[]; href: string }>
  | Readonly<{ kind: "invalid"; code: CompareUrlErrorCode }>;

const invalid = (code: CompareUrlErrorCode) => Object.freeze({ kind: "invalid" as const, code });

function knownMaterialSet(
  knownMaterialIds: readonly MaterialId[],
): ReadonlySet<MaterialId> | undefined {
  if (!Array.isArray(knownMaterialIds) || knownMaterialIds.length === 0) return undefined;
  const parsed: MaterialId[] = [];
  for (const value of knownMaterialIds) {
    if (!isMaterialIdValue(value)) return undefined;
    parsed.push(value);
  }
  const set = new Set(parsed);
  return set.size === parsed.length ? set : undefined;
}

function validateSelection(
  input: unknown,
  knownMaterialIds: readonly MaterialId[],
): readonly MaterialId[] | CompareUrlErrorCode {
  if (!Array.isArray(input)) return "COMPARE_URL_INPUT_INVALID";
  if (input.length < MIN_MATERIALS || input.length > MAX_MATERIALS) {
    return "COMPARE_URL_COUNT_INVALID";
  }

  const known = knownMaterialSet(knownMaterialIds);
  if (known === undefined) return "COMPARE_URL_CONTEXT_INVALID";

  const selected: MaterialId[] = [];
  const unique = new Set<MaterialId>();
  for (const candidate of input) {
    if (!isMaterialIdValue(candidate) || !known.has(candidate))
      return "COMPARE_URL_MATERIAL_INVALID";
    if (unique.has(candidate)) return "COMPARE_URL_DUPLICATE";
    unique.add(candidate);
    selected.push(candidate);
  }
  return Object.freeze(selected);
}

/** Decode only a bounded repeated-material search string; malformed sets never partially apply. */
export function decodeCompareUrlState(
  search: unknown,
  knownMaterialIds: readonly MaterialId[],
): DecodedCompareUrlState {
  if (typeof search !== "string") return invalid("COMPARE_URL_INPUT_INVALID");
  if (search === "" || search === "?") return Object.freeze({ kind: "empty" });
  if (search.length > MAX_SEARCH_LENGTH) return invalid("COMPARE_URL_TOO_LONG");
  if (!search.startsWith("?")) return invalid("COMPARE_URL_INPUT_INVALID");

  const parameters = new URLSearchParams(search.slice(1));
  for (const key of parameters.keys()) {
    if (key !== MATERIAL_KEY) return invalid("COMPARE_URL_KEYS_INVALID");
  }

  const selected = validateSelection(parameters.getAll(MATERIAL_KEY), knownMaterialIds);
  if (typeof selected === "string") return invalid(selected);
  return Object.freeze({ kind: "valid", materialIds: selected });
}

/** Encode an ordered complete set into one same-origin, base-aware compare path. */
export function encodeCompareUrlState(
  input: unknown,
  knownMaterialIds: readonly MaterialId[],
  base: string | undefined,
  documentUrl: unknown,
): EncodedCompareUrlState {
  const selected = validateSelection(input, knownMaterialIds);
  if (typeof selected === "string") return invalid(selected);
  if (typeof documentUrl !== "string") return invalid("COMPARE_URL_CONTEXT_INVALID");

  try {
    const current = new URL(documentUrl);
    if (
      (current.protocol !== "https:" && current.protocol !== "http:") ||
      current.username !== "" ||
      current.password !== "" ||
      current.origin === "null"
    ) {
      return invalid("COMPARE_URL_CONTEXT_INVALID");
    }

    const target = new URL(internalHref(base, { id: "compare" }), current.origin);
    if (target.origin !== current.origin) return invalid("COMPARE_URL_CONTEXT_INVALID");
    target.search = "";
    target.hash = "";
    for (const materialId of selected) target.searchParams.append(MATERIAL_KEY, materialId);

    return Object.freeze({
      kind: "valid",
      materialIds: selected,
      href: `${target.pathname}${target.search}`,
    });
  } catch {
    return invalid("COMPARE_URL_CONTEXT_INVALID");
  }
}
