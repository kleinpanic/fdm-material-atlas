export {
  selectMaterials,
  selectProjectedMaterials,
} from "./engine.ts";
export { resolveExplanationToken } from "./explanations.ts";
export { compileSelectorProjection } from "./projection.ts";

export type {
  AlignmentSummaryExplanationToken,
  CompatibleMaterialResult,
  ContributionExplanationToken,
  ContributionRecord,
  EliminatedMaterialResult,
  ExclusionExplanationToken,
  ExclusionRecord,
  ExplanationToken,
  InvalidSelectionOutcome,
  NoCompatibleExplanationToken,
  NoCompatibleSelectorOutcome,
  NormalizedSelectionEntry,
  NormalizedSelectorSelection,
  ProjectedHardGateRule,
  ProjectedProcessGateLabel,
  ProjectedSelectorCriterion,
  ProjectedSelectorFieldRecord,
  ProjectedSelectorMaterial,
  ProjectedSelectorOption,
  RankedSelectorOutcome,
  SelectorEngineOutcome,
  SelectorIssue,
  SelectorIssueCode,
  SelectorProjectionV1,
  SelectorSelectionInput,
} from "./types.ts";
