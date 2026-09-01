import * as z from "zod";

const PUBLIC_ID_PATTERN = /^[a-z][a-z0-9]*-[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** A public ID always has an explicit namespace and lower-kebab-safe segments. */
export const PublicIdSchema = z
  .string()
  .min(1, "ID_EMPTY")
  .max(160, "ID_TOO_LONG")
  .regex(PUBLIC_ID_PATTERN, "ID_INVALID");

function namespacedIdSchema(namespace: string) {
  return PublicIdSchema.refine(
    (value) => value.startsWith(`${namespace}-`),
    "ID_NAMESPACE_INVALID",
  );
}

export const MaterialIdSchema = namespacedIdSchema("material").brand<"MaterialId">();
export const ClaimIdSchema = namespacedIdSchema("claim").brand<"ClaimId">();
export const SourceIdSchema = namespacedIdSchema("source").brand<"SourceId">();
export const MethodIdSchema = namespacedIdSchema("method").brand<"MethodId">();
export const DecisionLaneIdSchema = namespacedIdSchema("lane").brand<"DecisionLaneId">();
export const SelectorCriterionIdSchema =
  namespacedIdSchema("selector").brand<"SelectorCriterionId">();
export const SelectorOptionIdSchema = namespacedIdSchema("option").brand<"SelectorOptionId">();
export const ProcessGateIdSchema = namespacedIdSchema("gate").brand<"ProcessGateId">();
export const VisualizationIdSchema = namespacedIdSchema("visualization").brand<"VisualizationId">();
export const VocabularyIdSchema = namespacedIdSchema("vocabulary").brand<"VocabularyId">();

export type PublicId = z.infer<typeof PublicIdSchema>;
export type MaterialId = z.infer<typeof MaterialIdSchema>;
export type ClaimId = z.infer<typeof ClaimIdSchema>;
export type SourceId = z.infer<typeof SourceIdSchema>;
export type MethodId = z.infer<typeof MethodIdSchema>;
export type DecisionLaneId = z.infer<typeof DecisionLaneIdSchema>;
export type SelectorCriterionId = z.infer<typeof SelectorCriterionIdSchema>;
export type SelectorOptionId = z.infer<typeof SelectorOptionIdSchema>;
export type ProcessGateId = z.infer<typeof ProcessGateIdSchema>;
export type VisualizationId = z.infer<typeof VisualizationIdSchema>;
export type VocabularyId = z.infer<typeof VocabularyIdSchema>;
