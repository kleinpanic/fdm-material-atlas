import type { AtlasV1 } from "../../data/schema/atlas.ts";
import type { SelectorOptionId } from "../../data/schema/ids.ts";
import type { SelectorField } from "../../data/schema/selector.ts";
import { resolveSelectorField } from "./field-resolver.ts";
import {
  compilePredicateSet,
  evaluateCompiledPredicate,
  type CompiledPredicateSet,
} from "./predicate.ts";
import { compileSelectorProjection } from "./projection.ts";
import type {
  CompatibleMaterialResult,
  ContributionExplanationToken,
  ContributionRecord,
  EliminatedMaterialResult,
  ExclusionExplanationToken,
  ExclusionOutcome,
  ExclusionRecord,
  NormalizedSelectionEntry,
  NormalizedSelectorSelection,
  ProjectedSelectorCriterion,
  ProjectedSelectorMaterial,
  ProjectedSelectorOption,
  SelectorEngineOutcome,
  SelectorIssue,
  SelectorProjectionV1,
  SelectorSelectionInput,
} from "./types.ts";

type PreparedOption = Readonly<{
  definition: ProjectedSelectorOption;
  compiled: CompiledPredicateSet;
}>;

type PreparedCriterion = Readonly<{
  definition: ProjectedSelectorCriterion;
  options: ReadonlyMap<SelectorOptionId, PreparedOption>;
}>;

type PreparedProjection = Readonly<{
  criteria: readonly PreparedCriterion[];
  materials: readonly ProjectedSelectorMaterial[];
}>;

type SelectedCriterion = Readonly<{
  selection: NormalizedSelectionEntry;
  option: PreparedOption;
}>;

type NormalizationResult =
  | Readonly<{ ok: true; selected: readonly SelectedCriterion[]; selection: NormalizedSelectorSelection }>
  | Readonly<{ ok: false; issues: readonly SelectorIssue[] }>;

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyFiniteNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function invalidProjection(): never {
  throw new Error("SELECTOR_PROJECTION_INVALID");
}

function validateMaterial(material: unknown): ProjectedSelectorMaterial {
  if (!isRecord(material) || typeof material.id !== "string" || typeof material.label !== "string"
    || !Array.isArray(material.fields)) invalidProjection();
  const fields = new Set<string>();
  for (const record of material.fields) {
    if (!isRecord(record) || typeof record.field !== "string" || fields.has(record.field)) {
      invalidProjection();
    }
    fields.add(record.field);
    if (record.state === "resolved") {
      const value = record.value;
      const validValue = typeof value === "string" || typeof value === "boolean"
        || (typeof value === "number" && Number.isFinite(value))
        || (Array.isArray(value) && value.every((item) => typeof item === "string"));
      if (!validValue) invalidProjection();
    } else if (record.state === "indeterminate") {
      if (!["unknown", "conditional", "not-applicable", "missing"].includes(String(record.reason))) {
        invalidProjection();
      }
    } else {
      invalidProjection();
    }
  }
  return material as unknown as ProjectedSelectorMaterial;
}

function prepareProjection(projection: SelectorProjectionV1): PreparedProjection {
  if (!isRecord(projection)
    || projection.kind !== "selector-projection"
    || projection.schemaVersion !== 1
    || projection.projectionVersion !== 1
    || projection.stableOrder !== "score-desc-material-asc"
    || !Array.isArray(projection.criteria)
    || !Array.isArray(projection.processGates)
    || !Array.isArray(projection.materials)) invalidProjection();

  const processGateIds = new Set<string>();
  for (const gate of projection.processGates) {
    if (!isRecord(gate) || typeof gate.id !== "string" || typeof gate.label !== "string"
      || processGateIds.has(gate.id)) invalidProjection();
    processGateIds.add(gate.id);
  }

  const criterionIds = new Set<string>();
  const criteria = [...projection.criteria]
    .sort((left, right) => left.displayOrder - right.displayOrder || compareAscii(left.id, right.id))
    .map((criterion): PreparedCriterion => {
      if (!isRecord(criterion) || typeof criterion.id !== "string" || criterionIds.has(criterion.id)
        || typeof criterion.label !== "string" || !hasOnlyFiniteNonnegativeInteger(criterion.displayOrder)
        || !Array.isArray(criterion.options)
        || (criterion.role !== "primary" && criterion.role !== "secondary")
        || criterion.weight !== (criterion.role === "primary" ? 2 : 1)) invalidProjection();
      criterionIds.add(criterion.id);

      const options = new Map<SelectorOptionId, PreparedOption>();
      for (const option of [...criterion.options]
        .sort((left, right) => left.displayOrder - right.displayOrder || compareAscii(left.id, right.id))) {
        if (!isRecord(option) || typeof option.id !== "string" || options.has(option.id as SelectorOptionId)
          || typeof option.label !== "string" || !hasOnlyFiniteNonnegativeInteger(option.displayOrder)
          || !Array.isArray(option.hardGates)) invalidProjection();
        const compiled = compilePredicateSet({
          ...(option.preferenceRule === undefined ? {} : { preferenceRule: option.preferenceRule }),
          hardGates: option.hardGates,
        });
        for (const gate of compiled.hardGates) {
          if (!processGateIds.has(gate.processGateId)) invalidProjection();
        }
        options.set(option.id as SelectorOptionId, Object.freeze({
          definition: option as unknown as ProjectedSelectorOption,
          compiled,
        }));
      }
      if (typeof criterion.defaultOptionId !== "string"
        || !options.has(criterion.defaultOptionId as SelectorOptionId)) {
        invalidProjection();
      }
      return Object.freeze({
        definition: criterion as unknown as ProjectedSelectorCriterion,
        options,
      });
    });

  const materialIds = new Set<string>();
  const materials = projection.materials.map(validateMaterial);
  for (const material of materials) {
    if (materialIds.has(material.id)) invalidProjection();
    materialIds.add(material.id);
  }
  return Object.freeze({ criteria: Object.freeze(criteria), materials: Object.freeze(materials) });
}

function inputKeys(input: SelectorSelectionInput): readonly PropertyKey[] {
  try {
    return Reflect.ownKeys(input);
  } catch {
    return [];
  }
}

function ownInputValue(input: SelectorSelectionInput, key: string): unknown {
  try {
    return Object.getOwnPropertyDescriptor(input, key)?.value;
  } catch {
    return undefined;
  }
}

function normalizeSelection(
  prepared: PreparedProjection,
  input: SelectorSelectionInput,
): NormalizationResult {
  if (!isRecord(input)) {
    return { ok: false, issues: Object.freeze([{ code: "SELECTOR_INPUT_NOT_RECORD" }]) };
  }

  const knownCriterionIds = new Set<string>(
    prepared.criteria.map(({ definition }) => definition.id),
  );
  const keys = inputKeys(input);
  const hasUnknownCriterion = keys.some((key) =>
    typeof key !== "string" || !knownCriterionIds.has(key));
  const issues: SelectorIssue[] = hasUnknownCriterion
    ? [{ code: "SELECTOR_CRITERION_UNKNOWN" }]
    : [];
  const selected: SelectedCriterion[] = [];

  for (const criterion of prepared.criteria) {
    const raw = keys.includes(criterion.definition.id)
      ? ownInputValue(input, criterion.definition.id)
      : criterion.definition.defaultOptionId;
    const option = typeof raw === "string"
      ? criterion.options.get(raw as SelectorOptionId)
      : undefined;
    if (!option) {
      issues.push({ code: "SELECTOR_OPTION_UNKNOWN", criterionId: criterion.definition.id });
      continue;
    }
    selected.push(Object.freeze({
      selection: Object.freeze({
        criterionId: criterion.definition.id,
        optionId: option.definition.id,
        role: criterion.definition.role,
        weight: criterion.definition.weight,
      }),
      option,
    }));
  }

  if (issues.length > 0) return { ok: false, issues: Object.freeze(issues) };
  return {
    ok: true,
    selected: Object.freeze(selected),
    selection: Object.freeze(selected.map(({ selection }) => selection)),
  };
}

function makeExclusion(
  selected: SelectedCriterion,
  gate: CompiledPredicateSet["hardGates"][number],
  outcome: ExclusionOutcome,
): ExclusionRecord {
  const token: ExclusionExplanationToken = Object.freeze({
    kind: "exclusion",
    criterionId: selected.selection.criterionId,
    optionId: selected.selection.optionId,
    reasonId: gate.reasonId,
    processGateId: gate.processGateId,
    outcome,
  });
  return Object.freeze({
    kind: "hard-constraint",
    criterionId: token.criterionId,
    optionId: token.optionId,
    reasonId: token.reasonId,
    processGateId: token.processGateId,
    outcome: token.outcome,
    explanationToken: token,
  });
}

function makeContribution(
  selected: SelectedCriterion,
  outcome: ContributionRecord["outcome"],
): ContributionRecord {
  const awardedPoints = outcome === "match" ? selected.selection.weight : 0;
  const token: ContributionExplanationToken = Object.freeze({
    kind: "contribution",
    criterionId: selected.selection.criterionId,
    optionId: selected.selection.optionId,
    role: selected.selection.role,
    outcome,
    possiblePoints: selected.selection.weight,
    awardedPoints,
  });
  return Object.freeze({
    kind: "preference",
    criterionId: token.criterionId,
    optionId: token.optionId,
    role: token.role,
    outcome: token.outcome,
    possiblePoints: token.possiblePoints,
    awardedPoints: token.awardedPoints,
    explanationToken: token,
  });
}

function finalApplicableMaximum(selected: readonly SelectedCriterion[]): number {
  return selected.reduce((sum, criterion) =>
    sum + (criterion.option.compiled.preferenceRule ? criterion.selection.weight : 0), 0);
}

function finalizeCompatible(
  material: ProjectedSelectorMaterial,
  contributions: readonly ContributionRecord[],
): Omit<CompatibleMaterialResult, "rank"> {
  const score = contributions.reduce((sum, record) => sum + record.awardedPoints, 0);
  const applicableMaximum = contributions.reduce((sum, record) => sum + record.possiblePoints, 0);
  return Object.freeze({
    kind: "compatible",
    materialId: material.id,
    materialLabel: material.label,
    tieKey: material.id,
    score,
    applicableMaximum,
    contributions: Object.freeze([...contributions]),
    exclusions: Object.freeze([]) as readonly [],
    explanationTokens: Object.freeze([
      ...contributions.map(({ explanationToken }) => explanationToken),
      Object.freeze({ kind: "alignment-summary" as const, score, applicableMaximum }),
    ]),
  });
}

function finalizeEliminated(
  material: ProjectedSelectorMaterial,
  applicableMaximum: number,
  exclusions: readonly ExclusionRecord[],
): EliminatedMaterialResult {
  const ordered = [...exclusions].sort((left, right) =>
    compareAscii(left.reasonId, right.reasonId)
    || compareAscii(left.processGateId, right.processGateId));
  return Object.freeze({
    kind: "eliminated",
    materialId: material.id,
    materialLabel: material.label,
    tieKey: material.id,
    applicableMaximum,
    exclusions: Object.freeze(ordered),
    explanationTokens: Object.freeze(ordered.map(({ explanationToken }) => explanationToken)),
  });
}

/** Evaluate untrusted selection state against the compact browser-safe projection. */
export function selectProjectedMaterials(
  projection: SelectorProjectionV1,
  input: SelectorSelectionInput,
): SelectorEngineOutcome {
  let prepared: PreparedProjection;
  try {
    prepared = prepareProjection(projection);
  } catch {
    const issues: readonly SelectorIssue[] = Object.freeze([
      { code: "SELECTOR_PROJECTION_INVALID" } satisfies SelectorIssue,
    ]);
    return Object.freeze({
      kind: "invalid-selection",
      issues,
    });
  }

  const normalized = normalizeSelection(prepared, input);
  if (!normalized.ok) {
    return Object.freeze({ kind: "invalid-selection", issues: normalized.issues });
  }

  const applicableMaximum = finalApplicableMaximum(normalized.selected);
  const compatible: Array<Omit<CompatibleMaterialResult, "rank">> = [];
  const eliminated: EliminatedMaterialResult[] = [];

  for (const material of prepared.materials) {
    const resolver = (field: SelectorField) => resolveSelectorField(material, field);
    const exclusions: ExclusionRecord[] = [];

    for (const selected of normalized.selected) {
      for (const gate of selected.option.compiled.hardGates) {
        const gateOutcome = evaluateCompiledPredicate(gate.incompatibleWhen, resolver);
        if (gateOutcome !== "no-match") {
          exclusions.push(makeExclusion(
            selected,
            gate,
            gateOutcome === "match" ? "incompatible" : "indeterminate",
          ));
        }
      }
    }

    if (exclusions.length > 0) {
      eliminated.push(finalizeEliminated(material, applicableMaximum, exclusions));
      continue;
    }

    const contributions = normalized.selected.flatMap((selected) => {
      const rule = selected.option.compiled.preferenceRule;
      return rule
        ? [makeContribution(selected, evaluateCompiledPredicate(rule, resolver))]
        : [];
    });
    compatible.push(finalizeCompatible(material, contributions));
  }

  const orderedEliminated = Object.freeze(
    [...eliminated].sort((left, right) => compareAscii(left.materialId, right.materialId)),
  );
  const orderedCompatible = Object.freeze(
    [...compatible]
      .sort((left, right) => right.score - left.score || compareAscii(left.materialId, right.materialId))
      .map((result, index): CompatibleMaterialResult =>
        Object.freeze({ ...result, rank: index + 1 })),
  );

  if (orderedCompatible.length === 0) {
    return Object.freeze({
      kind: "no-compatible",
      selection: normalized.selection,
      applicableMaximum,
      compatible: Object.freeze([]) as readonly [],
      eliminated: orderedEliminated,
      explanationToken: Object.freeze({
        kind: "no-compatible",
        selectedCriterionIds: Object.freeze(
          normalized.selection.map(({ criterionId }) => criterionId),
        ),
        eliminatedCount: orderedEliminated.length,
      }),
    });
  }

  return Object.freeze({
    kind: "ranked",
    selection: normalized.selection,
    applicableMaximum,
    compatible: orderedCompatible,
    eliminated: orderedEliminated,
  });
}

/** Server and test convenience adapter; all calculation remains projected. */
export function selectMaterials(
  atlas: AtlasV1,
  input: SelectorSelectionInput,
): SelectorEngineOutcome {
  return selectProjectedMaterials(compileSelectorProjection(atlas), input);
}
