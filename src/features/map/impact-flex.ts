import type { AtlasV1, VocabularyDefinition } from "../../data/schema/atlas.ts";
import type { FactState } from "../../data/schema/fact-state.ts";
import type { MaterialId } from "../../data/schema/ids.ts";
import type { Material } from "../../data/schema/material.ts";
import {
  flexibilityRatingValues,
  impactResistanceRatingValues,
  printDifficultyValues,
  type FlexibilityRating,
  type ImpactResistanceRating,
  type PrintDifficulty,
} from "../../data/schema/vocabularies.ts";
import { FACT_STATE_PRESENTATION } from "../../lib/presentation/labels.ts";
import { internalHref } from "../../lib/routes.ts";
import type {
  MapDisplayFact,
  MapImpactFlexRecord,
  MapMaterialReference,
  MapOmissionCode,
  MapTransformResult,
} from "./contracts.ts";

export const IMPACT_FLEX_LIMITATION =
  "Impact resistance and flexibility are separate qualitative guidance dimensions. Category spacing is not a measured physical distance, and the plot does not rank overall material quality.";

export const PRINT_DIFFICULTY_SHAPES = {
  easy: "circle",
  moderate: "square",
  advanced: "diamond",
  expert: "triangle",
} as const satisfies Readonly<Record<PrintDifficulty, ImpactFlexShape>>;

export type ImpactFlexShape = "circle" | "square" | "diamond" | "triangle";

export type ImpactFlexAxisTerm<T extends string> = {
  readonly value: T;
  readonly label: string;
  readonly order: number;
};

export type ImpactFlexOmissionDetail = {
  readonly axis: "impact" | "flexibility";
  readonly code: Extract<
    MapOmissionCode,
    "unknown-value" | "conditional-without-value" | "not-applicable" | "not-reported"
  >;
  readonly reason: string;
};

export type ImpactFlexRecord = MapImpactFlexRecord & {
  readonly printDifficultyFact: MapDisplayFact;
  readonly omissionDetails: readonly ImpactFlexOmissionDetail[];
  readonly shape?: ImpactFlexShape;
};

export type ImpactFlexCell = {
  readonly impact: ImpactResistanceRating;
  readonly impactLabel: string;
  readonly flexibility: FlexibilityRating;
  readonly flexibilityLabel: string;
  readonly count: number;
  readonly records: readonly ImpactFlexRecord[];
};

export type ImpactFlexOptions = {
  readonly query?: string;
  readonly maximumDifficulty?: PrintDifficulty;
  readonly encodeDifficultyShapes?: boolean;
  readonly selectedMaterialId?: MaterialId;
};

export type ImpactFlexModel = {
  readonly limitation: typeof IMPACT_FLEX_LIMITATION;
  readonly impactAxis: readonly ImpactFlexAxisTerm<ImpactResistanceRating>[];
  readonly flexibilityAxis: readonly ImpactFlexAxisTerm<FlexibilityRating>[];
  readonly shapesEnabled: boolean;
  readonly shapeLegend: readonly (ImpactFlexAxisTerm<PrintDifficulty> & {
    readonly shape: ImpactFlexShape;
  })[];
  readonly records: MapTransformResult<ImpactFlexRecord>;
  readonly cells: readonly ImpactFlexCell[];
  readonly selected?: {
    readonly record: ImpactFlexRecord;
    readonly outsideFilter: boolean;
  };
};

type Axis = "impact" | "flexibility";
type QualitativeRating = ImpactResistanceRating | FlexibilityRating | PrintDifficulty;

function fail(code: string): never {
  throw new Error(code);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function materialReference(material: Material, base: string | undefined): MapMaterialReference {
  return {
    id: material.id,
    name: material.name,
    href: internalHref(base, {
      id: "material",
      slug: material.slug,
    }) as MapMaterialReference["href"],
    displayOrder: material.displayOrder,
  };
}

function orderedVocabulary<T extends QualitativeRating>(
  vocabularies: readonly VocabularyDefinition[],
  id: string,
  values: readonly T[],
): readonly ImpactFlexAxisTerm<T>[] {
  const matches = vocabularies.filter((vocabulary) => vocabulary.id === id);
  if (matches.length !== 1 || matches[0]!.ordered !== true) {
    return fail("IMPACT_FLEX_VOCABULARY_INVALID");
  }
  const vocabulary = matches[0]!;
  const terms = new Map(vocabulary.terms.map((term) => [term.value, term]));
  if (terms.size !== values.length || vocabulary.terms.length !== values.length) {
    return fail("IMPACT_FLEX_VOCABULARY_INVALID");
  }
  return values.map((value, order) => {
    const term = terms.get(value);
    if (term === undefined || term.order !== order) {
      return fail("IMPACT_FLEX_VOCABULARY_INVALID");
    }
    return { value, label: term.label, order };
  });
}

function labelMap<T extends string>(
  terms: readonly ImpactFlexAxisTerm<T>[],
): ReadonlyMap<T, string> {
  return new Map(terms.map(({ value, label }) => [value, label]));
}

function displayRatingFact<T extends string>(
  fact: FactState<T>,
  labels: ReadonlyMap<T, string>,
): MapDisplayFact {
  const valueLabel = (value: T): string =>
    labels.get(value) ?? fail("IMPACT_FLEX_VOCABULARY_INVALID");
  switch (fact.state) {
    case "known":
      return { state: "known", display: [valueLabel(fact.value)] };
    case "conditional":
      return {
        state: "conditional",
        display: [
          FACT_STATE_PRESENTATION.conditional.label,
          ...(fact.value === undefined ? [] : [valueLabel(fact.value)]),
          fact.condition,
        ],
        condition: fact.condition,
      };
    case "unknown":
      return {
        state: "unknown",
        display: [FACT_STATE_PRESENTATION.unknown.label, fact.reason],
        reason: fact.reason,
      };
    case "not-applicable":
      return {
        state: "not-applicable",
        display: [
          FACT_STATE_PRESENTATION["not-applicable"].label,
          ...(fact.reason === undefined ? [] : [fact.reason]),
        ],
        ...(fact.reason === undefined ? {} : { reason: fact.reason }),
      };
    case "missing":
      return {
        state: "missing",
        display: [FACT_STATE_PRESENTATION.missing.label, fact.reason],
        reason: fact.reason,
      };
  }
}

function resolvedValue<T>(fact: FactState<T>): T | undefined {
  if (fact.state === "known") return fact.value;
  if (fact.state === "conditional") return fact.value;
  return undefined;
}

function omissionDetail<T>(axis: Axis, fact: FactState<T>): ImpactFlexOmissionDetail | undefined {
  switch (fact.state) {
    case "known":
      return undefined;
    case "conditional":
      return fact.value === undefined
        ? { axis, code: "conditional-without-value", reason: fact.condition }
        : undefined;
    case "unknown":
      return { axis, code: "unknown-value", reason: fact.reason };
    case "not-applicable":
      return {
        axis,
        code: "not-applicable",
        reason:
          fact.reason ??
          `${axis === "impact" ? "Impact resistance" : "Flexibility"} is not applicable.`,
      };
    case "missing":
      return { axis, code: "not-reported", reason: fact.reason };
  }
}

function normalizedQuery(query: string | undefined): string {
  return (query ?? "").trim().normalize("NFC").toLocaleLowerCase("en-US");
}

function stableMaterialOrder(left: Material, right: Material): number {
  return left.displayOrder - right.displayOrder || compareText(left.id, right.id);
}

function partitionResult(all: readonly ImpactFlexRecord[]): MapTransformResult<ImpactFlexRecord> {
  return {
    all,
    plotted: all.filter(({ disposition }) => disposition.disposition === "plotted"),
    filtered: all.filter(({ disposition }) => disposition.disposition === "filtered"),
    omitted: all.filter(({ disposition }) => disposition.disposition === "omitted"),
  };
}

/**
 * Build a complete categorical impact-versus-flexibility view.
 *
 * Axis order is ordinal only. This transform intentionally computes no numeric
 * coordinates, distance, similarity, trend, connection, or material rank.
 */
export function buildImpactFlexModel(
  atlas: Pick<AtlasV1, "materials" | "vocabularies">,
  base?: string,
  options: ImpactFlexOptions = {},
): ImpactFlexModel {
  const impactAxis = orderedVocabulary(
    atlas.vocabularies,
    "vocabulary-impact-resistance",
    impactResistanceRatingValues,
  );
  const flexibilityAxis = orderedVocabulary(
    atlas.vocabularies,
    "vocabulary-flexibility",
    flexibilityRatingValues,
  );
  const difficultyAxis = orderedVocabulary(
    atlas.vocabularies,
    "vocabulary-print-difficulty",
    printDifficultyValues,
  );
  const impactLabels = labelMap(impactAxis);
  const flexibilityLabels = labelMap(flexibilityAxis);
  const difficultyLabels = labelMap(difficultyAxis);
  const impactOrder = new Map(impactAxis.map(({ value, order }) => [value, order]));
  const flexibilityOrder = new Map(flexibilityAxis.map(({ value, order }) => [value, order]));
  const difficultyOrder = new Map(difficultyAxis.map(({ value, order }) => [value, order]));
  const query = normalizedQuery(options.query);
  const maximumDifficulty = options.maximumDifficulty;
  if (maximumDifficulty !== undefined && !difficultyOrder.has(maximumDifficulty)) {
    return fail("IMPACT_FLEX_DIFFICULTY_INVALID");
  }

  const sortedMaterials = [...atlas.materials].sort(stableMaterialOrder);
  const materialIds = new Set<string>();
  for (const material of sortedMaterials) {
    if (materialIds.has(material.id)) return fail("IMPACT_FLEX_MATERIAL_DUPLICATE");
    materialIds.add(material.id);
  }

  const slots = new Map<string, number>();
  const slotCounts = new Map<string, number>();
  for (const material of sortedMaterials) {
    const impact = resolvedValue(material.properties.impactResistance.value);
    const flexibility = resolvedValue(material.properties.flexibility.value);
    if (impact === undefined || flexibility === undefined) continue;
    const key = `${impact}\u0000${flexibility}`;
    const slot = slotCounts.get(key) ?? 0;
    slots.set(material.id, slot);
    slotCounts.set(key, slot + 1);
  }

  const drafted = sortedMaterials.map((material): ImpactFlexRecord => {
    const impactFact = material.properties.impactResistance.value;
    const flexibilityFact = material.properties.flexibility.value;
    const difficultyFact = material.process.printDifficulty.value;
    const impact = resolvedValue(impactFact);
    const flexibility = resolvedValue(flexibilityFact);
    const printDifficulty = resolvedValue(difficultyFact);
    const omissionDetails = [
      omissionDetail("impact", impactFact),
      omissionDetail("flexibility", flexibilityFact),
    ].filter((detail): detail is ImpactFlexOmissionDetail => detail !== undefined);

    let disposition: ImpactFlexRecord["disposition"];
    if (omissionDetails.length > 0) {
      const first = omissionDetails[0]!;
      disposition = {
        disposition: "omitted",
        code:
          first.axis === "impact" ? "impact-value-unavailable" : "flexibility-value-unavailable",
        reason: `${first.axis === "impact" ? "Impact resistance" : "Flexibility"}: ${first.reason}`,
      };
    } else {
      const maximum =
        maximumDifficulty === undefined ? undefined : difficultyOrder.get(maximumDifficulty)!;
      const actualDifficulty =
        printDifficulty === undefined ? undefined : difficultyOrder.get(printDifficulty);
      const outsideDifficulty =
        maximum !== undefined && (actualDifficulty === undefined || actualDifficulty > maximum);
      const searchText = `${material.name}\u0000${material.id}\u0000${material.slug}`
        .normalize("NFC")
        .toLocaleLowerCase("en-US");
      if (outsideDifficulty) {
        disposition = {
          disposition: "filtered",
          filter: { kind: "maximum-difficulty", value: maximumDifficulty! },
        };
      } else if (query !== "" && !searchText.includes(query)) {
        disposition = {
          disposition: "filtered",
          filter: { kind: "search", target: "impact-flex", query },
        };
      } else {
        disposition = { disposition: "plotted" };
      }
    }

    return {
      material: materialReference(material, base),
      ...(impact === undefined ? {} : { impact }),
      ...(flexibility === undefined ? {} : { flexibility }),
      ...(printDifficulty === undefined ? {} : { printDifficulty }),
      impactFact: displayRatingFact(impactFact, impactLabels),
      flexibilityFact: displayRatingFact(flexibilityFact, flexibilityLabels),
      printDifficultyFact: displayRatingFact(difficultyFact, difficultyLabels),
      disposition,
      ...(slots.get(material.id) === undefined ? {} : { slot: slots.get(material.id)! }),
      omissionDetails,
      ...(options.encodeDifficultyShapes === true && printDifficulty !== undefined
        ? { shape: PRINT_DIFFICULTY_SHAPES[printDifficulty] }
        : {}),
    };
  });

  drafted.sort((left, right) => {
    const flexibilityComparison =
      (flexibilityOrder.get(left.flexibility!) ?? flexibilityAxis.length) -
      (flexibilityOrder.get(right.flexibility!) ?? flexibilityAxis.length);
    if (flexibilityComparison !== 0) return flexibilityComparison;
    const impactComparison =
      (impactOrder.get(left.impact!) ?? impactAxis.length) -
      (impactOrder.get(right.impact!) ?? impactAxis.length);
    if (impactComparison !== 0) return impactComparison;
    return (
      left.material.displayOrder - right.material.displayOrder ||
      compareText(left.material.id, right.material.id)
    );
  });

  const records = partitionResult(drafted);
  const cells = flexibilityAxis.flatMap((flexibilityTerm) =>
    impactAxis.flatMap((impactTerm) => {
      const cellRecords = records.plotted
        .filter(
          ({ impact, flexibility }) =>
            impact === impactTerm.value && flexibility === flexibilityTerm.value,
        )
        .sort((left, right) => (left.slot ?? 0) - (right.slot ?? 0));
      return cellRecords.length === 0
        ? []
        : [
            {
              impact: impactTerm.value,
              impactLabel: impactTerm.label,
              flexibility: flexibilityTerm.value,
              flexibilityLabel: flexibilityTerm.label,
              count: cellRecords.length,
              records: cellRecords,
            } satisfies ImpactFlexCell,
          ];
    }),
  );
  const selectedRecord =
    options.selectedMaterialId === undefined
      ? undefined
      : records.all.find(({ material }) => material.id === options.selectedMaterialId);

  return deepFreeze({
    limitation: IMPACT_FLEX_LIMITATION,
    impactAxis,
    flexibilityAxis,
    shapesEnabled: options.encodeDifficultyShapes === true,
    shapeLegend:
      options.encodeDifficultyShapes === true
        ? difficultyAxis.map((term) => ({ ...term, shape: PRINT_DIFFICULTY_SHAPES[term.value] }))
        : [],
    records,
    cells,
    ...(selectedRecord === undefined
      ? {}
      : {
          selected: {
            record: selectedRecord,
            outsideFilter: selectedRecord.disposition.disposition === "filtered",
          },
        }),
  });
}
