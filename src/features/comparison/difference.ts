import type { MaterialId } from "../../data/schema/ids.ts";
import type { MaterialSemanticKey } from "../materials/claim-registry.ts";
import type {
  ComparedValue,
  ComparisonCell,
  ComparisonInvalid,
  ComparisonMaterial,
  ComparisonModel,
  ComparisonResultGroup,
  ComparisonRow,
  ComparisonSuccess,
  ComparisonThermalCell,
  SemanticAtom,
  SemanticTuple,
} from "./contracts.ts";

const ABSENCE_LABEL = "No comparable observation in this metric and method group" as const;

function invalid(): ComparisonInvalid {
  return Object.freeze({ kind: "invalid", code: "COMPARISON_SELECTION_INVALID" });
}

function tupleItemEqual(
  left: SemanticAtom | SemanticTuple,
  right: SemanticAtom | SemanticTuple,
): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => tupleItemEqual(value, right[index]!));
  }
  return Object.is(left, right);
}

export function semanticTuplesEqual(left: SemanticTuple, right: SemanticTuple): boolean {
  return tupleItemEqual(left, right);
}

function selectedMaterials(
  model: ComparisonModel,
  input: unknown,
): readonly ComparisonMaterial[] | undefined {
  if (!Array.isArray(input) || input.length < 2 || input.length > 4) return undefined;
  const byId = new Map(model.materials.map((material) => [material.id, material]));
  const selected: ComparisonMaterial[] = [];
  const seen = new Set<MaterialId>();
  for (const value of input) {
    if (typeof value !== "string") return undefined;
    const material = byId.get(value as MaterialId);
    if (material === undefined || seen.has(material.id)) return undefined;
    seen.add(material.id);
    selected.push(material);
  }
  return selected;
}

function oneCell(material: ComparisonMaterial, key: MaterialSemanticKey): ComparisonCell {
  const matches = material.cells.filter((cell) => cell.key === key);
  if (matches.length !== 1) throw new Error("COMPARISON_MODEL_INVALID");
  return matches[0]!;
}

function equalAcross(tuples: readonly SemanticTuple[]): boolean {
  const first = tuples[0];
  return first !== undefined && tuples.slice(1).every((tuple) => semanticTuplesEqual(first, tuple));
}

function valueRow(
  key: MaterialSemanticKey,
  label: string,
  materials: readonly ComparisonMaterial[],
): ComparisonRow {
  const cells = materials.map((material) => oneCell(material, key));
  if (cells.some(({ kind }) => kind !== "value")) throw new Error("COMPARISON_MODEL_INVALID");
  const valueCells = cells.map((cell) => {
    if (cell.kind !== "value") throw new Error("COMPARISON_MODEL_INVALID");
    return cell;
  });
  const differs = !equalAcross(valueCells.map(({ equality }) => equality));
  return {
    key,
    label,
    differs,
    values: materials.map((material, index): ComparedValue => ({
      kind: "value",
      materialId: material.id,
      materialName: material.name,
      cell: valueCells[index]!,
    })),
  };
}

function thermalRows(
  model: ComparisonModel,
  key: "thermal-metric" | "thermal-value",
  label: string,
  materials: readonly ComparisonMaterial[],
): readonly ComparisonRow[] {
  const cells = materials.map((material) => oneCell(material, key));
  if (cells.some(({ kind }) => kind !== "thermal")) throw new Error("COMPARISON_MODEL_INVALID");
  const thermalCells = cells as readonly ComparisonThermalCell[];
  const present = new Set(
    thermalCells.flatMap(({ members }) => members.map(({ groupId }) => groupId)),
  );
  const orderedGroups = model.thermalGroups.filter(({ id }) => present.has(id));
  if (orderedGroups.length !== present.size) throw new Error("COMPARISON_MODEL_INVALID");

  return orderedGroups.map((group): ComparisonRow => {
    const tuples: SemanticTuple[] = [];
    const values = materials.map((material, index): ComparedValue => {
      const member = thermalCells[index]!.members.find(({ groupId }) => groupId === group.id);
      if (member === undefined) {
        tuples.push(["no-comparable-observation", group.id]);
        return {
          kind: "no-comparable-observation",
          materialId: material.id,
          materialName: material.name,
          groupId: group.id,
          label: ABSENCE_LABEL,
        };
      }
      tuples.push(member.equality);
      return {
        kind: "thermal",
        materialId: material.id,
        materialName: material.name,
        member,
      };
    });
    return {
      key,
      label,
      thermalGroupId: group.id,
      differs: !equalAcross(tuples),
      values,
    };
  });
}

/** Compare only precompiled semantic tuples while retaining selected and registry order. */
export function compareSelection(
  model: ComparisonModel,
  input: unknown,
): ComparisonSuccess | ComparisonInvalid {
  const materials = selectedMaterials(model, input);
  if (materials === undefined) return invalid();

  const groups: ComparisonResultGroup[] = model.groups.map((group) => {
    const rows = group.fields.flatMap((field): readonly ComparisonRow[] => {
      if (field.key === "thermal-metric" || field.key === "thermal-value") {
        return thermalRows(model, field.key, field.label, materials);
      }
      return [valueRow(field.key, field.label, materials)];
    });
    const differing = rows.filter(({ differs }) => differs);
    const equal = rows.filter(({ differs }) => !differs);
    return {
      key: group.key,
      label: group.label,
      differenceCount: differing.length,
      equalCount: equal.length,
      differing,
      equal,
    };
  });
  return Object.freeze({
    kind: "comparison",
    materials: materials.map(({ id, name, href }) => ({ id, name, href })),
    groups,
    differenceCount: groups.reduce((sum, group) => sum + group.differenceCount, 0),
    equalCount: groups.reduce((sum, group) => sum + group.equalCount, 0),
  });
}
