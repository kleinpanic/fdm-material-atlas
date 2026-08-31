import * as z from "zod";

import { NormalizedTextSchema } from "./fact-state.ts";
import { ProcessGateIdSchema } from "./ids.ts";
import { PredicateSchema, SelectorFieldSchema } from "./selector.ts";

export const decisionLaneIds = [
  "lane-easy-prototypes",
  "lane-outdoor",
  "lane-impact-flex",
  "lane-chemical-exposure",
  "lane-high-heat-sustained-load",
  "lane-industrial",
  "lane-decorative-fills",
  "lane-support-materials",
] as const;

export const DecisionLaneIdValueSchema = z.enum(decisionLaneIds).brand<"DecisionLaneId">();

export const DecisionLaneRecordSchema = z.strictObject({
  id: DecisionLaneIdValueSchema,
  label: NormalizedTextSchema,
  need: NormalizedTextSchema,
  propertyChecks: z.array(SelectorFieldSchema).min(1, "LANE_PROPERTY_CHECK_REQUIRED"),
  candidateRule: PredicateSchema,
  verification: z.array(NormalizedTextSchema).min(1, "LANE_VERIFICATION_REQUIRED"),
  processGateIds: z.array(ProcessGateIdSchema),
});

export const DecisionLaneRegistrySchema = z
  .array(DecisionLaneRecordSchema)
  .length(8, "DECISION_LANE_COUNT")
  .superRefine((lanes, context) => {
    const ids = new Set<string>(lanes.map(({ id }) => id));
    if (ids.size !== decisionLaneIds.length || !decisionLaneIds.every((id) => ids.has(id))) {
      context.addIssue({ code: "custom", message: "DECISION_LANE_SET" });
    }
  });

export type DecisionLaneRecord = z.infer<typeof DecisionLaneRecordSchema>;
