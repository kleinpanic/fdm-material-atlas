import type { MaterialId, ProcessGateId, SelectorOptionId } from "../../data/schema/ids.ts";
import type { Predicate, SelectorCriterion, SelectorField } from "../../data/schema/selector.ts";

/** Untrusted URL or client state enters the selector only through this boundary. */
export type SelectorSelectionInput = Readonly<Record<string, unknown>>;

export type SelectorCriterionId = SelectorCriterion["id"];
export type SelectorCriterionRole = SelectorCriterion["role"];
export type SelectorWeight = SelectorCriterion["weight"];

export type NormalizedSelectionEntry = Readonly<{
  criterionId: SelectorCriterionId;
  optionId: SelectorOptionId;
  role: SelectorCriterionRole;
  weight: SelectorWeight;
}>;

export type NormalizedSelectorSelection = readonly NormalizedSelectionEntry[];

export type PredicateOutcome = "match" | "no-match" | "indeterminate";
export type ExclusionOutcome = "incompatible" | "indeterminate";

export type ContributionExplanationToken = Readonly<{
  kind: "contribution";
  criterionId: SelectorCriterionId;
  optionId: SelectorOptionId;
  role: SelectorCriterionRole;
  outcome: PredicateOutcome;
  possiblePoints: SelectorWeight;
  awardedPoints: 0 | 1 | 2;
}>;

export type ExclusionExplanationToken = Readonly<{
  kind: "exclusion";
  criterionId: SelectorCriterionId;
  optionId: SelectorOptionId;
  reasonId: string;
  processGateId: ProcessGateId;
  outcome: ExclusionOutcome;
}>;

export type AlignmentSummaryExplanationToken = Readonly<{
  kind: "alignment-summary";
  score: number;
  applicableMaximum: number;
}>;

export type NoCompatibleExplanationToken = Readonly<{
  kind: "no-compatible";
  selectedCriterionIds: readonly SelectorCriterionId[];
  eliminatedCount: number;
}>;

export type ExplanationToken =
  | ContributionExplanationToken
  | ExclusionExplanationToken
  | AlignmentSummaryExplanationToken
  | NoCompatibleExplanationToken;

export type ContributionRecord = Readonly<{
  kind: "preference";
  criterionId: SelectorCriterionId;
  optionId: SelectorOptionId;
  role: SelectorCriterionRole;
  outcome: PredicateOutcome;
  possiblePoints: SelectorWeight;
  awardedPoints: 0 | 1 | 2;
  explanationToken: ContributionExplanationToken;
}>;

export type ExclusionRecord = Readonly<{
  kind: "hard-constraint";
  criterionId: SelectorCriterionId;
  optionId: SelectorOptionId;
  reasonId: string;
  processGateId: ProcessGateId;
  outcome: ExclusionOutcome;
  explanationToken: ExclusionExplanationToken;
}>;

export type CompatibleMaterialResult = Readonly<{
  kind: "compatible";
  materialId: MaterialId;
  materialLabel: string;
  tieKey: MaterialId;
  rank: number;
  score: number;
  applicableMaximum: number;
  contributions: readonly ContributionRecord[];
  exclusions: readonly [];
  explanationTokens: readonly (ContributionExplanationToken | AlignmentSummaryExplanationToken)[];
}>;

export type EliminatedMaterialResult = Readonly<{
  kind: "eliminated";
  materialId: MaterialId;
  materialLabel: string;
  tieKey: MaterialId;
  applicableMaximum: number;
  exclusions: readonly ExclusionRecord[];
  explanationTokens: readonly ExclusionExplanationToken[];
}>;

export type SelectorIssueCode =
  | "SELECTOR_INPUT_NOT_RECORD"
  | "SELECTOR_CRITERION_UNKNOWN"
  | "SELECTOR_OPTION_UNKNOWN"
  | "SELECTOR_PROJECTION_INVALID";

/** Issues never retain rejected keys or values from the untrusted input. */
export type SelectorIssue = Readonly<{
  code: SelectorIssueCode;
  criterionId?: SelectorCriterionId;
}>;

export type RankedSelectorOutcome = Readonly<{
  kind: "ranked";
  selection: NormalizedSelectorSelection;
  applicableMaximum: number;
  compatible: readonly CompatibleMaterialResult[];
  eliminated: readonly EliminatedMaterialResult[];
}>;

export type NoCompatibleSelectorOutcome = Readonly<{
  kind: "no-compatible";
  selection: NormalizedSelectorSelection;
  applicableMaximum: number;
  compatible: readonly [];
  eliminated: readonly EliminatedMaterialResult[];
  explanationToken: NoCompatibleExplanationToken;
}>;

export type InvalidSelectionOutcome = Readonly<{
  kind: "invalid-selection";
  issues: readonly SelectorIssue[];
}>;

export type SelectorEngineOutcome =
  RankedSelectorOutcome | NoCompatibleSelectorOutcome | InvalidSelectionOutcome;

export type JsonScalar = string | number | boolean | null;
export type JsonValue = JsonScalar | readonly JsonValue[] | Readonly<{ [key: string]: JsonValue }>;

export type ProjectedSelectorValue = string | number | boolean | readonly string[];

export type ProjectedSelectorFieldRecord =
  | Readonly<{
      field: SelectorField;
      state: "resolved";
      value: ProjectedSelectorValue;
    }>
  | Readonly<{
      field: SelectorField;
      state: "indeterminate";
      reason: "unknown" | "conditional" | "not-applicable" | "missing";
    }>;

export type ReadonlyPredicate =
  | Readonly<{
      op: "equals";
      field: SelectorField;
      value: string | number | boolean;
    }>
  | Readonly<{
      op: "one-of";
      field: SelectorField;
      values: readonly (string | number | boolean)[];
    }>
  | Readonly<{
      op: "at-least" | "at-most";
      field: SelectorField;
      value: number;
    }>
  | Readonly<{
      op: "contains-any";
      field: Extract<Predicate, { op: "contains-any" }>["field"];
      values: readonly string[];
    }>
  | Readonly<{
      op: "all" | "any";
      rules: readonly ReadonlyPredicate[];
    }>
  | Readonly<{
      op: "not";
      rule: ReadonlyPredicate;
    }>;

export type ProjectedHardGateRule = Readonly<{
  reasonId: string;
  processGateId: ProcessGateId;
  incompatibleWhen: ReadonlyPredicate;
}>;

export type ProjectedSelectorOption = Readonly<{
  id: SelectorOptionId;
  label: string;
  displayOrder: number;
  preferenceRule?: ReadonlyPredicate;
  hardGates: readonly ProjectedHardGateRule[];
}>;

export type ProjectedSelectorCriterion = Readonly<{
  id: SelectorCriterionId;
  label: string;
  displayOrder: number;
  defaultOptionId: SelectorOptionId;
  role: SelectorCriterionRole;
  weight: SelectorWeight;
  options: readonly ProjectedSelectorOption[];
}>;

export type ProjectedProcessGateLabel = Readonly<{
  id: ProcessGateId;
  label: string;
}>;

export type ProjectedSelectorMaterial = Readonly<{
  id: MaterialId;
  label: string;
  fields: readonly ProjectedSelectorFieldRecord[];
}>;

/** The complete browser-safe input for the selector calculation. */
export type SelectorProjectionV1 = Readonly<{
  kind: "selector-projection";
  schemaVersion: 1;
  projectionVersion: 1;
  stableOrder: "score-desc-material-asc";
  criteria: readonly ProjectedSelectorCriterion[];
  processGates: readonly ProjectedProcessGateLabel[];
  materials: readonly ProjectedSelectorMaterial[];
}>;
