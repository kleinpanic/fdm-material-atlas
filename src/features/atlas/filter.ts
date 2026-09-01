import type { AtlasFilterDefinition, AtlasPageModel, AtlasRow } from "./model.ts";

export type AtlasFilterState = Readonly<{
  search: string;
  selections: Readonly<Record<string, string | undefined>>;
}>;

export type AtlasFilterMatch = Readonly<{ row: AtlasRow }>;
export type AtlasFilterVerification = Readonly<{
  row: AtlasRow;
  unresolvedDimensions: readonly string[];
}>;
export type AtlasFilterOutside = Readonly<{ row: AtlasRow; firstMismatch: string }>;

export type AtlasFilterResult = Readonly<{
  matches: readonly AtlasFilterMatch[];
  needsVerification: readonly AtlasFilterVerification[];
  outside: readonly AtlasFilterOutside[];
  activeFilters: readonly Readonly<{ id: string; label: string; valueLabel: string }>[];
  counts: Readonly<{ matches: number; needsVerification: number; outside: number; total: number }>;
}>;

function fail(): never {
  throw new Error("ATLAS_FILTER_INVALID");
}
function normalize(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en");
}
function compareRows(a: AtlasRow, b: AtlasRow): number {
  return a.displayOrder - b.displayOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

type ActiveDefinition = Readonly<{
  definition: AtlasFilterDefinition;
  option: AtlasFilterDefinition["options"][number];
}>;

/** Apply exact search and fact-state-aware structured filters without ranking. */
export function filterAtlas(model: AtlasPageModel, state: AtlasFilterState): AtlasFilterResult {
  if (
    typeof state.search !== "string" ||
    state.search.length > 500 ||
    typeof state.selections !== "object" ||
    state.selections === null
  )
    fail();
  const definitionById = new Map(model.filters.map((definition) => [definition.id, definition]));
  const active: ActiveDefinition[] = [];
  for (const [id, optionId] of Object.entries(state.selections)) {
    if (optionId === undefined || optionId === "") continue;
    const definition = definitionById.get(id);
    const option = definition?.options.find(({ id: candidate }) => candidate === optionId);
    if (!definition || !option) fail();
    active.push({ definition, option });
  }
  active.sort(
    (left, right) =>
      model.filters.indexOf(left.definition) - model.filters.indexOf(right.definition),
  );

  const query = normalize(state.search);
  const activeFilters = [
    ...(query
      ? [
          {
            id: "search",
            label: "Search",
            valueLabel: state.search.normalize("NFKC").trim().replace(/\s+/gu, " "),
          },
        ]
      : []),
    ...active.map(({ definition, option }) => ({
      id: definition.id,
      label: definition.label,
      valueLabel: option.label,
    })),
  ];
  const matches: AtlasFilterMatch[] = [];
  const needsVerification: AtlasFilterVerification[] = [];
  const outside: AtlasFilterOutside[] = [];

  for (const row of [...model.rows].sort(compareRows)) {
    const family = row.family.valueLabel ?? row.family.value ?? "";
    if (query && !normalize(row.name).includes(query) && !normalize(family).includes(query)) {
      outside.push({ row, firstMismatch: "Search" });
      continue;
    }
    let firstMismatch: string | undefined;
    const unresolved: string[] = [];
    for (const { definition, option } of active) {
      const fact = row.facts[definition.id];
      if (!fact) fail();
      if (option.kind === "state") {
        const selectedState = option.id.startsWith("state:") ? option.id.slice(6) : fail();
        if (fact.state !== selectedState) firstMismatch ??= definition.label;
      } else if (fact.state === "known") {
        if (fact.value !== option.id) firstMismatch ??= definition.label;
      } else if (
        fact.state === "unknown" ||
        fact.state === "conditional" ||
        fact.state === "missing"
      ) {
        unresolved.push(definition.label);
      } else {
        firstMismatch ??= definition.label;
      }
    }
    if (firstMismatch) outside.push({ row, firstMismatch });
    else if (unresolved.length > 0)
      needsVerification.push({ row, unresolvedDimensions: unresolved });
    else matches.push({ row });
  }

  return deepFreeze({
    matches,
    needsVerification,
    outside,
    activeFilters,
    counts: {
      matches: matches.length,
      needsVerification: needsVerification.length,
      outside: outside.length,
      total: model.rows.length,
    },
  });
}
