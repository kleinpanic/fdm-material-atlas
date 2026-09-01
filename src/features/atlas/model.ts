import type { AtlasV1, VocabularyDefinition } from "../../data/schema/atlas.ts";
import type { FactState } from "../../data/schema/fact-state.ts";
import type { TemperatureMeasurement } from "../../data/schema/measurements.ts";
import type { Material } from "../../data/schema/material.ts";
import type { EvidenceScope } from "../../data/schema/evidence.ts";
import { internalHref } from "../../lib/routes.ts";
import {
  FACT_STATE_PRESENTATION,
  THERMAL_KIND_PRESENTATION,
} from "../../lib/presentation/labels.ts";
import { buildEvidenceIndex, buildMaterialEvidenceModel } from "../materials/evidence-model.ts";

export type AtlasFact = Readonly<{
  state: FactState<unknown>["state"];
  stateLabel: string;
  value?: string;
  valueLabel?: string;
  reason?: string;
  condition?: string;
}>;

export type AtlasFilterDefinition = Readonly<{
  id: string;
  label: string;
  options: readonly Readonly<{ id: string; label: string; kind: "value" | "state" }>[];
}>;

export type AtlasRow = Readonly<{
  id: string;
  slug: string;
  displayOrder: number;
  name: string;
  href: string;
  family: AtlasFact;
  serviceTemperature: AtlasFact & Readonly<{ qualification?: string }>;
  thermalObservations: readonly Readonly<{
    metricLabel: string;
    measurement: AtlasFact;
    qualification: string;
  }>[];
  facts: Readonly<Record<string, AtlasFact>>;
  uses: readonly string[];
  evidence: Readonly<{ recordCount: number; scopes: readonly EvidenceScope[] }>;
}>;

export type AtlasPageModel = Readonly<{
  filters: readonly AtlasFilterDefinition[];
  rows: readonly AtlasRow[];
}>;

const FILTERS = [
  [
    "print-difficulty",
    "Print difficulty",
    "vocabulary-print-difficulty",
    (m: Material) => m.process.printDifficulty.value,
  ],
  [
    "enclosure",
    "Enclosure requirement",
    "vocabulary-enclosure-requirement",
    (m: Material) => m.process.enclosure.value,
  ],
  [
    "hardened-nozzle",
    "Wear-resistant nozzle requirement",
    "vocabulary-hardened-nozzle-requirement",
    (m: Material) => m.process.hardenedNozzle.value,
  ],
  [
    "drying-priority",
    "Drying priority",
    "vocabulary-drying-priority",
    (m: Material) => m.process.dryingPriority.value,
  ],
  [
    "ventilation",
    "Ventilation category",
    "vocabulary-ventilation-category",
    (m: Material) => m.process.ventilation.value,
  ],
  ["cost-tier", "Relative cost tier", "vocabulary-cost-tier", (m: Material) => m.costTier.value],
  [
    "outdoor-uv",
    "Outdoor and UV behavior",
    "vocabulary-outdoor-uv",
    (m: Material) => m.properties.outdoorUv.value,
  ],
  [
    "impact-resistance",
    "Impact resistance",
    "vocabulary-impact-resistance",
    (m: Material) => m.properties.impactResistance.value,
  ],
  [
    "flexibility",
    "Flexibility",
    "vocabulary-flexibility",
    (m: Material) => m.properties.flexibility.value,
  ],
  [
    "chemical-resistance",
    "Chemical resistance",
    "vocabulary-chemical-resistance",
    (m: Material) => m.properties.chemicalResistance.value,
  ],
  [
    "cooling-shrink-risk",
    "Cooling-shrink risk",
    "vocabulary-cooling-shrink-risk",
    (m: Material) => m.properties.coolingShrinkRisk.value,
  ],
  [
    "dimensional-stability",
    "Dimensional stability",
    "vocabulary-dimensional-stability",
    (m: Material) => m.properties.dimensionalStability.value,
  ],
] as const;

type ErrorCode =
  | "ATLAS_PAGE_EMPTY"
  | "ATLAS_PAGE_MATERIAL_DUPLICATE"
  | "ATLAS_PAGE_SLUG_DUPLICATE"
  | "ATLAS_PAGE_VOCABULARY_INVALID"
  | "ATLAS_PAGE_OUTPUT_OVERSIZED";
function fail(code: ErrorCode): never {
  throw new Error(code);
}
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function measurementLabel(value: TemperatureMeasurement): string {
  return value.shape === "exact" ? `${value.value} °C` : `${value.min}–${value.max} °C`;
}

function projectFact<T>(
  fact: FactState<T>,
  labels?: ReadonlyMap<string, string>,
  format: (value: T) => string = String,
): AtlasFact {
  const base = {
    state: fact.state,
    stateLabel: FACT_STATE_PRESENTATION[fact.state].label,
  } as const;
  if (fact.state === "known") {
    const value = format(fact.value);
    const valueLabel = labels?.get(value) ?? value;
    if (labels && !labels.has(value)) fail("ATLAS_PAGE_VOCABULARY_INVALID");
    return { ...base, value, valueLabel };
  }
  if (fact.state === "conditional") {
    const projected =
      fact.value === undefined
        ? {}
        : (() => {
            const value = format(fact.value);
            if (labels && !labels.has(value)) fail("ATLAS_PAGE_VOCABULARY_INVALID");
            return { value, valueLabel: labels?.get(value) ?? value };
          })();
    return { ...base, condition: fact.condition, ...projected };
  }
  if (fact.state === "not-applicable")
    return { ...base, ...(fact.reason ? { reason: fact.reason } : {}) };
  return { ...base, reason: fact.reason };
}

function vocabularyMap(vocabulary: VocabularyDefinition): ReadonlyMap<string, string> {
  return new Map(vocabulary.terms.map(({ value, label }) => [value, label]));
}

/** Compile the only compact allow-listed model supplied to the atlas island. */
export function buildAtlasPageModel(atlas: AtlasV1, base: string | undefined): AtlasPageModel {
  if (atlas.materials.length === 0) fail("ATLAS_PAGE_EMPTY");
  const ids = new Set<string>();
  const slugs = new Set<string>();
  for (const material of atlas.materials) {
    if (ids.has(material.id)) fail("ATLAS_PAGE_MATERIAL_DUPLICATE");
    if (slugs.has(material.slug)) fail("ATLAS_PAGE_SLUG_DUPLICATE");
    ids.add(material.id);
    slugs.add(material.slug);
  }
  const vocabularyById = new Map<string, AtlasV1["vocabularies"][number]>(
    atlas.vocabularies.map((vocabulary) => [vocabulary.id, vocabulary]),
  );
  const definitions = FILTERS.map(([id, label, vocabularyId]) => {
    const vocabulary = vocabularyById.get(vocabularyId);
    if (!vocabulary) fail("ATLAS_PAGE_VOCABULARY_INVALID");
    return {
      id,
      label,
      options: vocabulary.terms.map((term) => ({
        id: term.value,
        label: term.label,
        kind: "value" as const,
      })),
    };
  });
  const evidenceIndex = buildEvidenceIndex(atlas);
  const rows = [...atlas.materials]
    .sort((a, b) => a.displayOrder - b.displayOrder || compareText(a.id, b.id))
    .map((material): AtlasRow => {
      const facts = Object.fromEntries(
        FILTERS.map(([id, , vocabularyId, read]) => {
          const vocabulary = vocabularyById.get(vocabularyId);
          if (!vocabulary) fail("ATLAS_PAGE_VOCABULARY_INVALID");
          return [id, projectFact(read(material), vocabularyMap(vocabulary))];
        }),
      );
      const evidence = buildMaterialEvidenceModel(atlas, material, evidenceIndex);
      const service = projectFact(material.serviceTemperature.value, undefined, measurementLabel);
      return {
        id: material.id,
        slug: material.slug,
        displayOrder: material.displayOrder,
        name: material.name,
        href: internalHref(base, { id: "material", slug: material.slug }),
        family: projectFact(material.familyOrFill.value),
        serviceTemperature: {
          ...service,
          ...(material.serviceTemperature.qualification
            ? { qualification: material.serviceTemperature.qualification }
            : {}),
        },
        thermalObservations: material.thermalObservations.map((observation) => ({
          metricLabel:
            THERMAL_KIND_PRESENTATION[observation.metric].label === "Other named metric"
              ? observation.metricLabel
              : THERMAL_KIND_PRESENTATION[observation.metric].label,
          measurement: projectFact(observation.measurement, undefined, measurementLabel),
          qualification: observation.qualification,
        })),
        facts,
        uses:
          material.guidance.bestSuitedFor.value.state === "known"
            ? material.guidance.bestSuitedFor.value.value.slice(0, 3)
            : [],
        evidence: { recordCount: evidence.records.length, scopes: evidence.scopes },
      };
    });
  const model = deepFreeze({ filters: definitions, rows });
  if (JSON.stringify(model).length > 512 * 1024) fail("ATLAS_PAGE_OUTPUT_OVERSIZED");
  return model;
}
