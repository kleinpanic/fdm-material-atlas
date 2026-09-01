import type { AtlasV1 } from "../../data/schema/atlas.ts";
import type { EvidenceScope } from "../../data/schema/evidence.ts";
import type { FactState } from "../../data/schema/fact-state.ts";
import type { MaterialId } from "../../data/schema/ids.ts";
import type { Material, ThermalMetricKind } from "../../data/schema/material.ts";
import { EVIDENCE_SCOPE_ORDER } from "../../lib/presentation/labels.ts";
import { buildComparisonModel } from "../comparison/model.ts";
import type {
  ComparisonEvidenceAction,
  ComparisonThermalMember,
  ComparisonValueCell,
} from "../comparison/contracts.ts";
import { DATA_ATTRIBUTE_GROUPS, DATA_ATTRIBUTE_REGISTRY } from "./attribute-registry.ts";
import type {
  DataAttributeDescriptor,
  DataAttributeGroupKey,
  DataAttributeSortPolicy,
  DataAttributeValueKind,
} from "./contracts.ts";
import type { MaterialSemanticKey } from "../materials/claim-registry.ts";

export type ExplorerFactState = FactState<unknown>["state"];

export type ExplorerEvidenceAction = ComparisonEvidenceAction;

export type ExplorerField = Readonly<{
  key: MaterialSemanticKey;
  label: string;
  group: DataAttributeGroupKey;
  valueKind: DataAttributeValueKind;
  sort: DataAttributeSortPolicy;
  help: string;
  caution?: string | undefined;
}>;

export type ExplorerGroup = Readonly<{
  key: DataAttributeGroupKey;
  label: string;
  fieldKeys: readonly MaterialSemanticKey[];
}>;

export type ExplorerSortKey = Readonly<{
  kind: "canonical" | "label" | "vocabulary" | "number" | "none";
  state: ExplorerFactState | "identity";
  value?: string | number | undefined;
}>;

export type ExplorerThermalMember = Readonly<{
  groupId: string;
  metric: ThermalMetricKind;
  metricLabel: string;
  methodLabel: string;
  state: ExplorerFactState;
  display: readonly string[];
  qualification: string;
  scopes: readonly EvidenceScope[];
  scopeLabels: readonly string[];
  evidence: readonly ExplorerEvidenceAction[];
}>;

export type ExplorerValueCell = Readonly<{
  kind: "value";
  key: MaterialSemanticKey;
  display: readonly string[];
  qualification?: string | undefined;
  states: readonly ExplorerFactState[];
  scopes: readonly EvidenceScope[];
  scopeLabels: readonly string[];
  evidence: readonly ExplorerEvidenceAction[];
  searchText: readonly string[];
  sortKey: ExplorerSortKey;
}>;

export type ExplorerThermalCell = Readonly<{
  kind: "thermal";
  key: "thermal-metric" | "thermal-value";
  members: readonly ExplorerThermalMember[];
  states: readonly ExplorerFactState[];
  scopes: readonly EvidenceScope[];
  searchText: readonly string[];
  sortKey: ExplorerSortKey;
}>;

export type ExplorerCell = ExplorerValueCell | ExplorerThermalCell;

export type ExplorerMaterial = Readonly<{
  id: MaterialId;
  name: string;
  family: string;
  familyQualifier?: string | undefined;
  href: string;
  cells: readonly ExplorerCell[];
}>;

export type ExplorerThermalMetricOption = Readonly<{
  id: string;
  metric: ThermalMetricKind;
  label: string;
  methodLabel: string;
}>;

export type DataExplorerModel = Readonly<{
  groups: readonly ExplorerGroup[];
  fields: readonly ExplorerField[];
  thermalMetrics: readonly ExplorerThermalMetricOption[];
  materials: readonly ExplorerMaterial[];
}>;

type DataExplorerModelErrorCode =
  | "DATA_EXPLORER_MATERIALS_EMPTY"
  | "DATA_EXPLORER_MATERIAL_DUPLICATE"
  | "DATA_EXPLORER_REGISTRY_INVALID"
  | "DATA_EXPLORER_CELL_MISSING"
  | "DATA_EXPLORER_VALUE_INVALID";

function fail(code: DataExplorerModelErrorCode): never {
  throw new Error(code);
}

function normalizeSearch(text: string): string {
  return text.normalize("NFC").toLocaleLowerCase("en-US");
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function uniqueStates(states: readonly ExplorerFactState[]): readonly ExplorerFactState[] {
  return [...new Set(states)];
}

function uniqueScopes(scopes: readonly EvidenceScope[]): readonly EvidenceScope[] {
  return [...new Set(scopes)].sort(
    (left, right) => EVIDENCE_SCOPE_ORDER.indexOf(left) - EVIDENCE_SCOPE_ORDER.indexOf(right),
  );
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Object.is(value, -0) ? 0 : value;
  if (typeof value !== "object" || value === null || !("shape" in value)) return undefined;
  const measurement = value as Record<string, unknown>;
  if (measurement.shape === "exact" && typeof measurement.value === "number") return measurement.value;
  if (measurement.shape === "range" && typeof measurement.min === "number" && typeof measurement.max === "number") {
    return (measurement.min + measurement.max) / 2;
  }
  return undefined;
}

function knownValue(descriptor: DataAttributeDescriptor, material: Material): unknown {
  const result = descriptor.read(material);
  if (result.kind === "identity") return result.value;
  if (result.kind === "fact" || result.kind === "service-endpoint") {
    return result.fact.state === "known" ? result.fact.value : undefined;
  }
  if (result.kind === "thermal-metric") return result.observations[0]?.metricLabel;
  return undefined;
}

function vocabularyOrder(atlas: AtlasV1): ReadonlyMap<string, number> {
  const order = new Map<string, number>();
  for (const vocabulary of [...atlas.vocabularies].sort((a, b) => a.id.localeCompare(b.id, "en"))) {
    for (const term of [...vocabulary.terms].sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || a.value.localeCompare(b.value, "en"))) {
      if (term.order !== undefined && !order.has(term.value)) order.set(term.value, term.order);
    }
  }
  return order;
}

function sortKey(
  descriptor: DataAttributeDescriptor,
  material: Material,
  comparisonCell: ComparisonValueCell,
  vocabulary: ReadonlyMap<string, number>,
): ExplorerSortKey {
  const state = comparisonCell.state;
  if (descriptor.sort === "none") return { kind: "none", state };
  if (descriptor.sort === "canonical") return { kind: "canonical", state: "identity", value: material.displayOrder };
  const value = knownValue(descriptor, material);
  if (descriptor.sort === "number") return {
    kind: "number",
    state,
    ...(numericValue(value) === undefined ? {} : { value: numericValue(value) }),
  };
  if (descriptor.sort === "vocabulary") {
    const ordered = typeof value === "string" ? vocabulary.get(value) : undefined;
    return { kind: "vocabulary", state, ...(ordered === undefined ? {} : { value: ordered }) };
  }
  const label = comparisonCell.display[0];
  return { kind: "label", state, ...(label === undefined ? {} : { value: normalizeSearch(label) }) };
}

function projectValueCell(
  descriptor: DataAttributeDescriptor,
  material: Material,
  cell: ComparisonValueCell,
  vocabulary: ReadonlyMap<string, number>,
): ExplorerValueCell {
  const scopes = uniqueScopes(cell.evidence.map(({ scope }) => scope));
  const searchText = [
    ...cell.display,
    ...(cell.qualification === undefined ? [] : [cell.qualification]),
    ...cell.scopeLabels,
  ];
  return {
    kind: "value",
    key: descriptor.key,
    display: cell.display,
    ...(cell.qualification === undefined ? {} : { qualification: cell.qualification }),
    states: cell.state === "identity" ? [] : [cell.state],
    scopes,
    scopeLabels: cell.scopeLabels,
    evidence: cell.evidence,
    searchText,
    sortKey: sortKey(descriptor, material, cell, vocabulary),
  };
}

function projectThermalMember(member: ComparisonThermalMember): ExplorerThermalMember {
  return {
    groupId: member.groupId,
    metric: member.metric,
    metricLabel: member.metricLabel,
    methodLabel: member.methodLabel,
    state: member.state,
    display: member.display,
    qualification: member.qualification,
    scopes: uniqueScopes(member.evidence.map(({ scope }) => scope)),
    scopeLabels: member.scopeLabels,
    evidence: member.evidence,
  };
}

/** Compile the validated public Atlas into a compact, display-ready explorer projection. */
export function buildDataExplorerModel(atlas: AtlasV1, base: string | undefined): DataExplorerModel {
  if (atlas.materials.length === 0) fail("DATA_EXPLORER_MATERIALS_EMPTY");
  const ids = new Set(atlas.materials.map(({ id }) => id));
  const slugs = new Set(atlas.materials.map(({ slug }) => slug));
  if (ids.size !== atlas.materials.length || slugs.size !== atlas.materials.length) {
    fail("DATA_EXPLORER_MATERIAL_DUPLICATE");
  }
  if (DATA_ATTRIBUTE_REGISTRY.length !== 32 || DATA_ATTRIBUTE_GROUPS.length !== 8) {
    fail("DATA_EXPLORER_REGISTRY_INVALID");
  }

  const comparison = buildComparisonModel(atlas, base);
  const canonicalById = new Map(atlas.materials.map((material) => [material.id, material]));
  const vocabulary = vocabularyOrder(atlas);
  const fields: ExplorerField[] = DATA_ATTRIBUTE_REGISTRY.map((field) => ({
    key: field.key,
    label: field.label,
    group: field.group,
    valueKind: field.valueKind,
    sort: field.sort,
    help: field.help,
    ...(field.caution === undefined ? {} : { caution: field.caution }),
  }));
  const groups: ExplorerGroup[] = DATA_ATTRIBUTE_GROUPS.map(({ key, label, fields: groupFields }) => ({
    key,
    label,
    fieldKeys: groupFields.map(({ key: fieldKey }) => fieldKey),
  }));

  const materials: ExplorerMaterial[] = comparison.materials.map((projected) => {
    const material = canonicalById.get(projected.id) ?? fail("DATA_EXPLORER_CELL_MISSING");
    const cells = DATA_ATTRIBUTE_REGISTRY.map((descriptor, index): ExplorerCell => {
      const comparisonCell = projected.cells[index] ?? fail("DATA_EXPLORER_CELL_MISSING");
      if (comparisonCell.key !== descriptor.key) fail("DATA_EXPLORER_REGISTRY_INVALID");
      if (comparisonCell.kind === "value") {
        return projectValueCell(descriptor, material, comparisonCell, vocabulary);
      }
      const members = comparisonCell.members.map(projectThermalMember);
      const searchText = members.flatMap(({ metricLabel, methodLabel, display, qualification, scopeLabels }) =>
        [metricLabel, methodLabel, ...display, qualification, ...scopeLabels]
      );
      return {
        kind: "thermal",
        key: comparisonCell.key,
        members,
        states: uniqueStates(members.map(({ state }) => state)),
        scopes: uniqueScopes(members.flatMap(({ scopes }) => scopes)),
        searchText,
        sortKey: comparisonCell.key === "thermal-value"
          ? { kind: "none", state: members[0]?.state ?? "missing" }
          : {
              kind: "label",
              state: members[0]?.state ?? "missing",
              ...(members[0] === undefined ? {} : { value: normalizeSearch(members[0].metricLabel) }),
            },
      };
    });
    const familyCell = cells.find(({ key }) => key === "family-or-fill");
    const familyFact = material.familyOrFill.value;
    const family = familyFact.state === "known" || (familyFact.state === "conditional" && familyFact.value !== undefined)
      ? familyFact.value
      : familyCell?.kind === "value"
        ? familyCell.display[0]
        : undefined;
    if (family === undefined || cells.length !== 32) fail("DATA_EXPLORER_VALUE_INVALID");
    const familyQualifier = familyFact.state === "conditional"
      ? `Conditional — ${familyFact.condition}`
      : undefined;
    return {
      id: projected.id,
      name: projected.name,
      family,
      ...(familyQualifier === undefined ? {} : { familyQualifier }),
      href: projected.href,
      cells,
    };
  });

  const thermalMetrics: ExplorerThermalMetricOption[] = comparison.thermalGroups.map((group) => ({
    id: group.id,
    metric: group.metric,
    label: group.metricLabel,
    methodLabel: group.methodLabel,
  }));
  return deepFreeze({ groups, fields, thermalMetrics, materials });
}
