import * as z from "zod";

import {
  ClaimIdSchema,
  DecisionLaneIdSchema,
  MaterialIdSchema,
  ProcessGateIdSchema,
  SelectorCriterionIdSchema,
  VisualizationIdSchema,
} from "./ids.ts";

export const MaterialRouteSlugSchema = z
  .string()
  .min(1, "ROUTE_SLUG_EMPTY")
  .max(120, "ROUTE_SLUG_TOO_LONG")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, "ROUTE_SLUG_INVALID");

export const VisualizationKindSchema = z.enum([
  "decision-path",
  "polymer-family-relationship",
  "property-space",
  "thermal-range",
  "impact-flex",
  "heat-process-difficulty",
  "chemical-outdoor",
  "equipment-gate",
  "process-requirement-flow",
  "dimensional-stability-cooling",
  "material-similarity",
]);

export const VisualizationTargetRefSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("material-id"), materialId: MaterialIdSchema }),
  z.strictObject({ kind: z.literal("claim-id"), claimId: ClaimIdSchema }),
  z.strictObject({ kind: z.literal("decision-lane-id"), decisionLaneId: DecisionLaneIdSchema }),
  z.strictObject({
    kind: z.literal("selector-criterion-id"),
    selectorCriterionId: SelectorCriterionIdSchema,
  }),
  z.strictObject({ kind: z.literal("process-gate-id"), processGateId: ProcessGateIdSchema }),
  z.strictObject({ kind: z.literal("material-route"), slug: MaterialRouteSlugSchema }),
]);

export const VisualizationReferenceRecordSchema = z.strictObject({
  id: VisualizationIdSchema,
  kind: VisualizationKindSchema,
  subject: VisualizationTargetRefSchema,
  related: z.array(VisualizationTargetRefSchema),
});

export const VisualizationReferenceRegistrySchema = z.array(VisualizationReferenceRecordSchema);

export type MaterialRouteSlug = z.infer<typeof MaterialRouteSlugSchema>;
export type VisualizationKind = z.infer<typeof VisualizationKindSchema>;
export type VisualizationTargetRef = z.infer<typeof VisualizationTargetRefSchema>;
export type VisualizationReferenceRecord = z.infer<typeof VisualizationReferenceRecordSchema>;

