import * as z from "zod";

import { PublicHttpsUrlSchema } from "../schema/evidence.ts";
import { NormalizedTextSchema } from "../schema/fact-state.ts";
import { PublicIdSchema } from "../schema/ids.ts";
import { decisionLaneIds } from "../schema/decision-lane.ts";
import { selectorCriterionIds } from "../schema/selector.ts";
import { MaterialSemanticFieldPathSchema } from "./semantic-fields.ts";

export const sourceLogicalRoles = [
  "materials",
  "selector",
  "evidence-method",
  "decision-map",
] as const;

const NormalizedScalarSchema = z.union([
  NormalizedTextSchema,
  z.number().finite(),
  z.boolean(),
]);

export const NormalizedSourceValueSchema = z.union([
  NormalizedScalarSchema,
  z.array(NormalizedScalarSchema).max(100, "SOURCE_VALUE_ARRAY_EXCESSIVE"),
]);

const OneOfValidationSchema = z.strictObject({
  kind: z.literal("one-of"),
  options: z.array(NormalizedTextSchema).min(1, "SOURCE_VALIDATION_OPTIONS_REQUIRED").max(100),
});

const RangeValidationSchema = z
  .strictObject({
    kind: z.literal("range"),
    min: z.number().finite(),
    max: z.number().finite(),
  })
  .refine(({ min, max }) => min <= max, "SOURCE_VALIDATION_RANGE_REVERSED");

export const SourceValidationSchema = z.discriminatedUnion("kind", [
  OneOfValidationSchema,
  RangeValidationSchema,
]);

export const FormulaSemanticsSchema = z.enum([
  "preference-match",
  "hard-constraint",
  "rank-order",
  "candidate-derivation",
  "navigation",
]);

export const SourceSemanticChannelsSchema = z.strictObject({
  value: NormalizedSourceValueSchema,
  note: NormalizedTextSchema.optional(),
  link: PublicHttpsUrlSchema.optional(),
  validation: SourceValidationSchema.optional(),
  formulaSemantics: FormulaSemanticsSchema.optional(),
});

function logicalRecordSchema<T extends z.ZodType>(semanticKeySchema: T) {
  return z.strictObject({
    logicalRecordId: PublicIdSchema,
    semanticKey: semanticKeySchema,
    channels: SourceSemanticChannelsSchema,
  });
}

const MaterialSourceRecordSchema = logicalRecordSchema(MaterialSemanticFieldPathSchema);
const SelectorSourceRecordSchema = logicalRecordSchema(z.enum(selectorCriterionIds));
const EvidenceMethodSourceRecordSchema = logicalRecordSchema(
  z.enum(["source-record", "method-record", "definition", "limitation"]),
);
const DecisionMapSourceRecordSchema = logicalRecordSchema(z.enum(decisionLaneIds));

export const SourceWorkbookDtoSchema = z.strictObject({
  contractVersion: z.literal(1),
  surfaces: z.strictObject({
    materials: z.strictObject({ records: z.array(MaterialSourceRecordSchema) }),
    selector: z.strictObject({ records: z.array(SelectorSourceRecordSchema) }),
    "evidence-method": z.strictObject({ records: z.array(EvidenceMethodSourceRecordSchema) }),
    "decision-map": z.strictObject({ records: z.array(DecisionMapSourceRecordSchema) }),
  }),
});

export type SourceWorkbookDto = z.infer<typeof SourceWorkbookDtoSchema>;

