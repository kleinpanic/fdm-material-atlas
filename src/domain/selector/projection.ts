import type { AtlasV1 } from "../../data/schema/atlas.ts";
import type { ProcessGateId } from "../../data/schema/ids.ts";
import type { SelectorField } from "../../data/schema/selector.ts";
import { resolveSelectorField } from "./field-resolver.ts";
import { compilePredicateSet } from "./predicate.ts";
import type { CompiledPredicateSet } from "./predicate.ts";
import type {
  ProjectedHardGateRule,
  ProjectedSelectorCriterion,
  ProjectedSelectorFieldRecord,
  ProjectedSelectorMaterial,
  ProjectedSelectorOption,
  ReadonlyPredicate,
  SelectorProjectionV1,
} from "./types.ts";

export type SelectorProjectionConfigurationCode =
  "SELECTOR_PROJECTION_DUPLICATE_ID" | "SELECTOR_PROJECTION_REFERENCE_UNKNOWN";

/** A stable configuration failure that retains no rejected Atlas content. */
export class SelectorProjectionConfigurationError extends Error {
  readonly code: SelectorProjectionConfigurationCode;

  constructor(code: SelectorProjectionConfigurationCode) {
    super(code);
    this.name = "SelectorProjectionConfigurationError";
    this.code = code;
  }

  toJSON(): Readonly<{ code: SelectorProjectionConfigurationCode }> {
    return { code: this.code };
  }
}

type CompiledOption = Readonly<{
  source: AtlasV1["selector"]["criteria"][number]["options"][number];
  compiled: CompiledPredicateSet;
}>;

type CompiledCriterion = Readonly<{
  source: AtlasV1["selector"]["criteria"][number];
  options: readonly CompiledOption[];
}>;

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareDisplayOrderAndId(
  left: Readonly<{ displayOrder: number; id: string }>,
  right: Readonly<{ displayOrder: number; id: string }>,
): number {
  return left.displayOrder - right.displayOrder || compareAscii(left.id, right.id);
}

function fail(code: SelectorProjectionConfigurationCode): never {
  throw new SelectorProjectionConfigurationError(code);
}

function assertUnique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) fail("SELECTOR_PROJECTION_DUPLICATE_ID");
}

function collectFields(predicate: ReadonlyPredicate, fields: Set<SelectorField>): void {
  switch (predicate.op) {
    case "equals":
    case "one-of":
    case "at-least":
    case "at-most":
    case "contains-any":
      fields.add(predicate.field);
      return;
    case "all":
    case "any":
      predicate.rules.forEach((rule) => collectFields(rule, fields));
      return;
    case "not":
      collectFields(predicate.rule, fields);
  }
}

function copyFieldRecord(record: ProjectedSelectorFieldRecord): ProjectedSelectorFieldRecord {
  if (record.state === "indeterminate") {
    return Object.freeze({ field: record.field, state: record.state, reason: record.reason });
  }
  const value = Array.isArray(record.value) ? Object.freeze([...record.value]) : record.value;
  return Object.freeze({ field: record.field, state: record.state, value });
}

function projectOption(option: CompiledOption): ProjectedSelectorOption {
  const hardGates = [...option.compiled.hardGates]
    .sort(
      (left, right) =>
        compareAscii(left.reasonId, right.reasonId) ||
        compareAscii(left.processGateId, right.processGateId),
    )
    .map((gate): ProjectedHardGateRule =>
      Object.freeze({
        reasonId: gate.reasonId,
        processGateId: gate.processGateId,
        incompatibleWhen: gate.incompatibleWhen,
      }),
    );
  return Object.freeze({
    id: option.source.id,
    label: option.source.label,
    displayOrder: option.source.displayOrder,
    ...(option.compiled.preferenceRule === undefined
      ? {}
      : { preferenceRule: option.compiled.preferenceRule }),
    hardGates: Object.freeze(hardGates),
  });
}

function compileCriteria(atlas: AtlasV1): readonly CompiledCriterion[] {
  assertUnique(atlas.selector.criteria.map(({ id }) => id));
  return Object.freeze(
    [...atlas.selector.criteria]
      .sort(compareDisplayOrderAndId)
      .map((criterion): CompiledCriterion => {
        assertUnique(criterion.options.map(({ id }) => id));
        const options = [...criterion.options]
          .sort(compareDisplayOrderAndId)
          .map((option): CompiledOption =>
            Object.freeze({
              source: option,
              compiled: compilePredicateSet({
                ...(option.preferenceRule === undefined
                  ? {}
                  : { preferenceRule: option.preferenceRule }),
                hardGates: option.hardGates,
              }),
            }),
          );
        return Object.freeze({ source: criterion, options: Object.freeze(options) });
      }),
  );
}

function referencedProcessGates(criteria: readonly CompiledCriterion[]): readonly ProcessGateId[] {
  const gateIds = new Set<ProcessGateId>();
  criteria.forEach(({ options }) =>
    options.forEach(({ compiled }) =>
      compiled.hardGates.forEach(({ processGateId }) => gateIds.add(processGateId)),
    ),
  );
  return Object.freeze([...gateIds].sort(compareAscii));
}

function referencedFields(criteria: readonly CompiledCriterion[]): readonly SelectorField[] {
  const fields = new Set<SelectorField>();
  criteria.forEach(({ options }) =>
    options.forEach(({ compiled }) => {
      if (compiled.preferenceRule) collectFields(compiled.preferenceRule, fields);
      compiled.hardGates.forEach(({ incompatibleWhen }) => collectFields(incompatibleWhen, fields));
    }),
  );
  return Object.freeze([...fields].sort(compareAscii));
}

/** Compile the validated public Atlas into its deterministic browser-safe selector input. */
export function compileSelectorProjection(atlas: AtlasV1): SelectorProjectionV1 {
  const compiledCriteria = compileCriteria(atlas);
  const fields = referencedFields(compiledCriteria);
  const processGateIds = referencedProcessGates(compiledCriteria);

  assertUnique(atlas.materials.map(({ id }) => id));
  assertUnique(atlas.processGates.map(({ id }) => id));

  const processGates = processGateIds.map((id) => {
    const matches = atlas.processGates.filter((gate) => gate.id === id);
    if (matches.length !== 1) fail("SELECTOR_PROJECTION_REFERENCE_UNKNOWN");
    return Object.freeze({ id, label: matches[0]!.label });
  });

  const criteria = compiledCriteria.map(({ source, options }): ProjectedSelectorCriterion =>
    Object.freeze({
      id: source.id,
      label: source.label,
      displayOrder: source.displayOrder,
      defaultOptionId: source.defaultOptionId,
      role: source.role,
      weight: source.weight,
      options: Object.freeze(options.map(projectOption)),
    }),
  );

  const materials = [...atlas.materials]
    .sort((left, right) => compareAscii(left.id, right.id))
    .map((material): ProjectedSelectorMaterial =>
      Object.freeze({
        id: material.id,
        label: material.name,
        fields: Object.freeze(
          fields.map((field) =>
            copyFieldRecord(resolveSelectorField(material, field, atlas.vocabularies)),
          ),
        ),
      }),
    );

  return Object.freeze({
    kind: "selector-projection",
    schemaVersion: 1,
    projectionVersion: 1,
    stableOrder: "score-desc-material-asc",
    criteria: Object.freeze(criteria),
    processGates: Object.freeze(processGates),
    materials: Object.freeze(materials),
  });
}
