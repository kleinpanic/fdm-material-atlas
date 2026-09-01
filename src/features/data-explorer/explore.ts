import type { EvidenceScope } from "../../data/schema/evidence.ts";
import { EVIDENCE_SCOPE_ORDER } from "../../lib/presentation/labels.ts";
import type { MaterialSemanticKey } from "../materials/claim-registry.ts";
import type { DataAttributeGroupKey } from "./contracts.ts";
import type {
  DataExplorerModel,
  ExplorerCell,
  ExplorerFactState,
  ExplorerField,
  ExplorerMaterial,
  ExplorerSortKey,
  ExplorerThermalCell,
} from "./model.ts";

export type ExplorerView = "table" | "records";
export type ExplorerSortDirection = "asc" | "desc";
export type ExplorerSortableField = Exclude<MaterialSemanticKey, "thermal-value">;

export type ExplorerState = Readonly<{
  query: string;
  group: DataAttributeGroupKey;
  thermalMetric: "all" | string;
  factState: "all" | ExplorerFactState;
  evidenceScope: "all" | EvidenceScope;
  view: ExplorerView;
  sort: Readonly<{ field: ExplorerSortableField; direction: ExplorerSortDirection }>;
}>;

export type ExploredMaterial = Readonly<{
  id: ExplorerMaterial["id"];
  name: string;
  family: string;
  familyQualifier?: string | undefined;
  href: string;
  cells: readonly ExplorerCell[];
}>;

export type ExplorerSuccess = Readonly<{
  kind: "exploration";
  state: ExplorerState;
  group: Readonly<{ key: DataAttributeGroupKey; label: string }>;
  fields: readonly ExplorerField[];
  materials: readonly ExploredMaterial[];
  resultCount: number;
}>;

export type ExplorerFailure = Readonly<{
  kind: "failure";
  code: "EXPLORE_FAILED";
  state: ExplorerState;
  fields: readonly never[];
  materials: readonly never[];
  resultCount: 0;
}>;

type ExplorerStateErrorCode = "EXPLORER_STATE_INVALID" | "EXPLORER_MODEL_INVALID";

function fail(code: ExplorerStateErrorCode): never {
  throw new Error(code);
}

function normalizeSearch(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase("en-US");
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function defaultExplorerState(model: DataExplorerModel): ExplorerState {
  const group = model.groups[0] ?? fail("EXPLORER_MODEL_INVALID");
  const firstSortable =
    group.fieldKeys
      .map((key) => model.fields.find((field) => field.key === key))
      .find((field) => field !== undefined && field.sort !== "none") ??
    fail("EXPLORER_MODEL_INVALID");
  return deepFreeze({
    query: "",
    group: group.key,
    thermalMetric: "all",
    factState: "all",
    evidenceScope: "all",
    view: "table",
    sort: { field: firstSortable.key as ExplorerSortableField, direction: "asc" },
  });
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === [...expected].sort()[index])
  );
}

function validateState(model: DataExplorerModel, input: unknown): ExplorerState {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    fail("EXPLORER_STATE_INVALID");
  const state = input as Record<string, unknown>;
  if (
    !hasExactKeys(state, [
      "query",
      "group",
      "thermalMetric",
      "factState",
      "evidenceScope",
      "view",
      "sort",
    ])
  ) {
    fail("EXPLORER_STATE_INVALID");
  }
  if (typeof state.query !== "string" || state.query.length > 500) fail("EXPLORER_STATE_INVALID");
  const group =
    model.groups.find(({ key }) => key === state.group) ?? fail("EXPLORER_STATE_INVALID");
  if (
    state.thermalMetric !== "all" &&
    !model.thermalMetrics.some(({ id }) => id === state.thermalMetric)
  ) {
    fail("EXPLORER_STATE_INVALID");
  }
  if (
    state.factState !== "all" &&
    !["known", "conditional", "unknown", "missing", "not-applicable"].includes(
      String(state.factState),
    )
  ) {
    fail("EXPLORER_STATE_INVALID");
  }
  if (
    state.evidenceScope !== "all" &&
    !EVIDENCE_SCOPE_ORDER.includes(state.evidenceScope as EvidenceScope)
  ) {
    fail("EXPLORER_STATE_INVALID");
  }
  if (state.view !== "table" && state.view !== "records") fail("EXPLORER_STATE_INVALID");
  if (typeof state.sort !== "object" || state.sort === null || Array.isArray(state.sort))
    fail("EXPLORER_STATE_INVALID");
  const sort = state.sort as Record<string, unknown>;
  if (
    !hasExactKeys(sort, ["field", "direction"]) ||
    (sort.direction !== "asc" && sort.direction !== "desc")
  ) {
    fail("EXPLORER_STATE_INVALID");
  }
  const field = model.fields.find(({ key }) => key === sort.field);
  if (field === undefined || !group.fieldKeys.includes(field.key) || field.sort === "none")
    fail("EXPLORER_STATE_INVALID");
  return {
    query: normalizeSearch(state.query.trim()),
    group: group.key,
    thermalMetric: state.thermalMetric as ExplorerState["thermalMetric"],
    factState: state.factState as ExplorerState["factState"],
    evidenceScope: state.evidenceScope as ExplorerState["evidenceScope"],
    view: state.view,
    sort: { field: field.key as ExplorerSortableField, direction: sort.direction },
  };
}

function narrowThermal(cell: ExplorerThermalCell, groupId: string): ExplorerThermalCell {
  const members = cell.members.filter((member) => member.groupId === groupId);
  return {
    ...cell,
    members,
    states: [...new Set(members.map(({ state }) => state))],
    scopes: [...new Set(members.flatMap(({ scopes }) => scopes))].sort(
      (left, right) => EVIDENCE_SCOPE_ORDER.indexOf(left) - EVIDENCE_SCOPE_ORDER.indexOf(right),
    ),
    searchText: members.flatMap(
      ({ metricLabel, methodLabel, display, qualification, scopeLabels }) => [
        metricLabel,
        methodLabel,
        ...display,
        qualification,
        ...scopeLabels,
      ],
    ),
    sortKey:
      cell.key === "thermal-value"
        ? { kind: "none", state: members[0]?.state ?? "missing" }
        : {
            kind: "label",
            state: members[0]?.state ?? "missing",
            ...(members[0] === undefined ? {} : { value: normalizeSearch(members[0].metricLabel) }),
          },
  };
}

function stateRank(state: ExplorerSortKey["state"]): number {
  switch (state) {
    case "identity":
    case "known":
      return -1;
    case "conditional":
      return 0;
    case "unknown":
      return 1;
    case "missing":
      return 2;
    case "not-applicable":
      return 3;
  }
}

function compareValues(left: string | number, right: string | number): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), "en");
}

function compareRows(
  left: ExploredMaterial,
  right: ExploredMaterial,
  field: ExplorerSortableField,
  direction: ExplorerSortDirection,
): number {
  const leftCell = left.cells.find(({ key }) => key === field) ?? fail("EXPLORER_MODEL_INVALID");
  const rightCell = right.cells.find(({ key }) => key === field) ?? fail("EXPLORER_MODEL_INVALID");
  const leftKnown =
    (leftCell.sortKey.state === "known" || leftCell.sortKey.state === "identity") &&
    leftCell.sortKey.value !== undefined;
  const rightKnown =
    (rightCell.sortKey.state === "known" || rightCell.sortKey.state === "identity") &&
    rightCell.sortKey.value !== undefined;
  if (leftKnown !== rightKnown) return leftKnown ? -1 : 1;
  if (leftKnown && rightKnown) {
    const compared = compareValues(leftCell.sortKey.value!, rightCell.sortKey.value!);
    if (compared !== 0) return direction === "asc" ? compared : -compared;
  } else {
    const compared = stateRank(leftCell.sortKey.state) - stateRank(rightCell.sortKey.state);
    if (compared !== 0) return compared;
  }
  return left.id.localeCompare(right.id, "en");
}

/** Apply the closed explorer state without interpreting canonical material facts. */
export function exploreData(model: DataExplorerModel, input: unknown): ExplorerSuccess {
  const state = validateState(model, input);
  const group =
    model.groups.find(({ key }) => key === state.group) ?? fail("EXPLORER_MODEL_INVALID");
  const fields = group.fieldKeys.map(
    (key) => model.fields.find((field) => field.key === key) ?? fail("EXPLORER_MODEL_INVALID"),
  );

  const materials = model.materials
    .flatMap((material): readonly ExploredMaterial[] => {
      let cells = group.fieldKeys.map(
        (key) => material.cells.find((cell) => cell.key === key) ?? fail("EXPLORER_MODEL_INVALID"),
      );
      if (state.thermalMetric !== "all") {
        const hasMetric = cells.some(
          (cell) =>
            cell.kind === "thermal" &&
            cell.members.some(({ groupId }) => groupId === state.thermalMetric),
        );
        if (!hasMetric) return [];
        cells = cells.map((cell) =>
          cell.kind === "thermal" ? narrowThermal(cell, state.thermalMetric) : cell,
        );
      }
      if (state.query !== "") {
        const searchable = [
          material.name,
          material.family,
          ...cells.flatMap(({ searchText }) => searchText),
        ]
          .map(normalizeSearch)
          .join("\u0000");
        if (!searchable.includes(state.query)) return [];
      }
      if (
        state.factState !== "all" &&
        !cells.some(({ states }) => states.includes(state.factState as ExplorerFactState))
      )
        return [];
      if (
        state.evidenceScope !== "all" &&
        !cells.some(({ scopes }) => scopes.includes(state.evidenceScope as EvidenceScope))
      )
        return [];
      return [
        {
          id: material.id,
          name: material.name,
          family: material.family,
          ...(material.familyQualifier === undefined
            ? {}
            : { familyQualifier: material.familyQualifier }),
          href: material.href,
          cells,
        },
      ];
    })
    .sort((left, right) => compareRows(left, right, state.sort.field, state.sort.direction));

  return deepFreeze({
    kind: "exploration",
    state,
    group: { key: group.key, label: group.label },
    fields,
    materials,
    resultCount: materials.length,
  });
}
