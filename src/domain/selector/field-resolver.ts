import type { VocabularyDefinition } from "../../data/schema/atlas.ts";
import type { FactState } from "../../data/schema/fact-state.ts";
import type { VocabularyId } from "../../data/schema/ids.ts";
import type { Material } from "../../data/schema/material.ts";
import type { SelectorField } from "../../data/schema/selector.ts";
import type {
  ProjectedSelectorFieldRecord,
  ProjectedSelectorMaterial,
  ProjectedSelectorValue,
} from "./types.ts";

export type OrderedSelectorField = Extract<SelectorField, `${string}.order`>;

const vocabularyId = (value: string): VocabularyId => value as VocabularyId;

/** Every ordered selector field is bound to one dimension-specific vocabulary. */
export const ORDERED_SELECTOR_FIELD_VOCABULARY = {
  "properties.wearAbrasion.order": vocabularyId("vocabulary-wear-abrasion"),
  "properties.impactResistance.order": vocabularyId("vocabulary-impact-resistance"),
  "properties.creepSustainedLoad.order": vocabularyId("vocabulary-creep-sustained-load"),
  "properties.outdoorUv.order": vocabularyId("vocabulary-outdoor-uv"),
  "properties.moistureSensitivity.order": vocabularyId("vocabulary-moisture-sensitivity"),
  "properties.warpTendency.order": vocabularyId("vocabulary-warp-tendency"),
  "properties.flexibility.order": vocabularyId("vocabulary-flexibility"),
  "properties.chemicalResistance.order": vocabularyId("vocabulary-chemical-resistance"),
  "properties.coolingShrinkRisk.order": vocabularyId("vocabulary-cooling-shrink-risk"),
  "properties.dimensionalStability.order": vocabularyId("vocabulary-dimensional-stability"),
  "process.printDifficulty.order": vocabularyId("vocabulary-print-difficulty"),
  "process.enclosure.order": vocabularyId("vocabulary-enclosure-requirement"),
  "process.hardenedNozzle.order": vocabularyId("vocabulary-hardened-nozzle-requirement"),
  "process.dryingPriority.order": vocabularyId("vocabulary-drying-priority"),
  "process.ventilation.order": vocabularyId("vocabulary-ventilation-category"),
  "costTier.order": vocabularyId("vocabulary-cost-tier"),
} as const satisfies Record<OrderedSelectorField, VocabularyId>;

export type SelectorFieldConfigurationCode =
  | "SELECTOR_PROJECTED_FIELD_DUPLICATE"
  | "SELECTOR_VOCABULARY_MISSING"
  | "SELECTOR_VOCABULARY_UNORDERED"
  | "SELECTOR_VOCABULARY_VALUE_DUPLICATE"
  | "SELECTOR_VOCABULARY_ORDER_DUPLICATE"
  | "SELECTOR_VOCABULARY_VALUE_MISSING"
  | "SELECTOR_VOCABULARY_ORDER_INVALID";

/** Configuration failures expose a stable code and no source value or path. */
export class SelectorFieldConfigurationError extends Error {
  readonly code: SelectorFieldConfigurationCode;

  constructor(code: SelectorFieldConfigurationCode) {
    super(code);
    this.name = "SelectorFieldConfigurationError";
    this.code = code;
  }
}

function indeterminate(
  field: SelectorField,
  reason: Exclude<FactState<unknown>["state"], "known">,
): ProjectedSelectorFieldRecord {
  return { field, state: "indeterminate", reason };
}

function resolved(
  field: SelectorField,
  value: ProjectedSelectorValue,
): ProjectedSelectorFieldRecord {
  return { field, state: "resolved", value };
}

function resolveKnown<T>(
  field: SelectorField,
  fact: FactState<T>,
  project: (value: T) => ProjectedSelectorValue,
): ProjectedSelectorFieldRecord {
  if (fact.state !== "known") return indeterminate(field, fact.state);
  return resolved(field, project(fact.value));
}

function normalizeText(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase("en-US");
}

function normalizeTextList(values: readonly string[]): readonly string[] {
  return values.map(normalizeText);
}

function resolveServiceBound(
  material: Material,
  field: "serviceTemperature.minimum" | "serviceTemperature.maximum",
): ProjectedSelectorFieldRecord {
  return resolveKnown(field, material.serviceTemperature.value, (measurement) => {
    if (measurement.shape === "exact") return measurement.value;
    return field === "serviceTemperature.minimum" ? measurement.min : measurement.max;
  });
}

function configuredOrder(
  field: OrderedSelectorField,
  value: string,
  vocabularies: readonly VocabularyDefinition[] | undefined,
): number {
  const requiredId = ORDERED_SELECTOR_FIELD_VOCABULARY[field];
  const matches = vocabularies?.filter(({ id }) => id === requiredId) ?? [];
  if (matches.length !== 1) {
    throw new SelectorFieldConfigurationError("SELECTOR_VOCABULARY_MISSING");
  }

  const vocabulary = matches[0]!;
  if (!vocabulary.ordered) {
    throw new SelectorFieldConfigurationError("SELECTOR_VOCABULARY_UNORDERED");
  }

  const values = new Set<string>();
  const orders = new Set<number>();
  for (const term of vocabulary.terms) {
    if (values.has(term.value)) {
      throw new SelectorFieldConfigurationError("SELECTOR_VOCABULARY_VALUE_DUPLICATE");
    }
    values.add(term.value);

    if (typeof term.order !== "number" || !Number.isFinite(term.order)) {
      throw new SelectorFieldConfigurationError("SELECTOR_VOCABULARY_ORDER_INVALID");
    }
    if (orders.has(term.order)) {
      throw new SelectorFieldConfigurationError("SELECTOR_VOCABULARY_ORDER_DUPLICATE");
    }
    orders.add(term.order);
  }

  const term = vocabulary.terms.find((candidate) => candidate.value === value);
  if (!term) {
    throw new SelectorFieldConfigurationError("SELECTOR_VOCABULARY_VALUE_MISSING");
  }
  return term.order!;
}

function resolveOrderedFact<T extends string>(
  field: OrderedSelectorField,
  fact: FactState<T>,
  vocabularies: readonly VocabularyDefinition[] | undefined,
): ProjectedSelectorFieldRecord {
  return resolveKnown(field, fact, (value) => configuredOrder(field, value, vocabularies));
}

function resolveCanonicalField(
  material: Material,
  field: SelectorField,
  vocabularies: readonly VocabularyDefinition[] | undefined,
): ProjectedSelectorFieldRecord {
  switch (field) {
    case "serviceTemperature.minimum":
    case "serviceTemperature.maximum":
      return resolveServiceBound(material, field);
    case "properties.wearAbrasion":
      return resolveKnown(field, material.properties.wearAbrasion.value, (value) => value);
    case "properties.wearAbrasion.order":
      return resolveOrderedFact(field, material.properties.wearAbrasion.value, vocabularies);
    case "properties.impactResistance":
      return resolveKnown(field, material.properties.impactResistance.value, (value) => value);
    case "properties.impactResistance.order":
      return resolveOrderedFact(field, material.properties.impactResistance.value, vocabularies);
    case "properties.creepSustainedLoad":
      return resolveKnown(field, material.properties.creepSustainedLoad.value, (value) => value);
    case "properties.creepSustainedLoad.order":
      return resolveOrderedFact(field, material.properties.creepSustainedLoad.value, vocabularies);
    case "properties.outdoorUv":
      return resolveKnown(field, material.properties.outdoorUv.value, (value) => value);
    case "properties.outdoorUv.order":
      return resolveOrderedFact(field, material.properties.outdoorUv.value, vocabularies);
    case "properties.moistureSensitivity":
      return resolveKnown(field, material.properties.moistureSensitivity.value, (value) => value);
    case "properties.moistureSensitivity.order":
      return resolveOrderedFact(field, material.properties.moistureSensitivity.value, vocabularies);
    case "properties.warpTendency":
      return resolveKnown(field, material.properties.warpTendency.value, (value) => value);
    case "properties.warpTendency.order":
      return resolveOrderedFact(field, material.properties.warpTendency.value, vocabularies);
    case "properties.flexibility":
      return resolveKnown(field, material.properties.flexibility.value, (value) => value);
    case "properties.flexibility.order":
      return resolveOrderedFact(field, material.properties.flexibility.value, vocabularies);
    case "properties.chemicalResistance":
      return resolveKnown(field, material.properties.chemicalResistance.value, (value) => value);
    case "properties.chemicalResistance.order":
      return resolveOrderedFact(field, material.properties.chemicalResistance.value, vocabularies);
    case "properties.coolingShrinkRisk":
      return resolveKnown(field, material.properties.coolingShrinkRisk.value, (value) => value);
    case "properties.coolingShrinkRisk.order":
      return resolveOrderedFact(field, material.properties.coolingShrinkRisk.value, vocabularies);
    case "properties.dimensionalStability":
      return resolveKnown(field, material.properties.dimensionalStability.value, (value) => value);
    case "properties.dimensionalStability.order":
      return resolveOrderedFact(
        field,
        material.properties.dimensionalStability.value,
        vocabularies,
      );
    case "process.printDifficulty":
      return resolveKnown(field, material.process.printDifficulty.value, (value) => value);
    case "process.printDifficulty.order":
      return resolveOrderedFact(field, material.process.printDifficulty.value, vocabularies);
    case "process.enclosure":
      return resolveKnown(field, material.process.enclosure.value, (value) => value);
    case "process.enclosure.order":
      return resolveOrderedFact(field, material.process.enclosure.value, vocabularies);
    case "process.hardenedNozzle":
      return resolveKnown(field, material.process.hardenedNozzle.value, (value) => value);
    case "process.hardenedNozzle.order":
      return resolveOrderedFact(field, material.process.hardenedNozzle.value, vocabularies);
    case "process.dryingPriority":
      return resolveKnown(field, material.process.dryingPriority.value, (value) => value);
    case "process.dryingPriority.order":
      return resolveOrderedFact(field, material.process.dryingPriority.value, vocabularies);
    case "process.ventilation":
      return resolveKnown(field, material.process.ventilation.value, (value) => value);
    case "process.ventilation.order":
      return resolveOrderedFact(field, material.process.ventilation.value, vocabularies);
    case "costTier":
      return resolveKnown(field, material.costTier.value, (value) => value);
    case "costTier.order":
      return resolveOrderedFact(field, material.costTier.value, vocabularies);
    case "guidance.bestSuitedFor":
      return resolveKnown(field, material.guidance.bestSuitedFor.value, normalizeTextList);
    case "guidance.tradeoffs":
      return resolveKnown(field, material.guidance.tradeoffs.value, normalizeTextList);
    default: {
      const exhaustive: never = field;
      return exhaustive;
    }
  }
}

function resolveProjectedField(
  material: ProjectedSelectorMaterial,
  field: SelectorField,
): ProjectedSelectorFieldRecord {
  const matches = material.fields.filter((record) => record.field === field);
  if (matches.length === 0) return indeterminate(field, "missing");
  if (matches.length > 1) {
    throw new SelectorFieldConfigurationError("SELECTOR_PROJECTED_FIELD_DUPLICATE");
  }

  const record = matches[0]!;
  if (record.state === "indeterminate") return record;
  if (Array.isArray(record.value)) return resolved(field, normalizeTextList(record.value));
  return record;
}

/**
 * Resolve one allow-listed selector field from a canonical or compact subject.
 * The caller supplies an already validated SelectorField; no dotted path is walked.
 */
export function resolveSelectorField(
  subject: Material | ProjectedSelectorMaterial,
  field: SelectorField,
  vocabularies?: readonly VocabularyDefinition[],
): ProjectedSelectorFieldRecord {
  return "fields" in subject
    ? resolveProjectedField(subject, field)
    : resolveCanonicalField(subject, field, vocabularies);
}

/** Case-normalized, literal substring matching for resolved guidance lists. */
export function containsNormalizedSelectorLiteral(
  resolution: ProjectedSelectorFieldRecord,
  candidates: readonly string[],
): boolean {
  if (resolution.state !== "resolved" || !Array.isArray(resolution.value)) return false;
  const normalizedCandidates = candidates.map(normalizeText);
  return resolution.value.some((text) =>
    normalizedCandidates.some((candidate) => text.includes(candidate)),
  );
}
