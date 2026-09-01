import * as z from "zod";

import { NormalizedTextSchema } from "./fact-state.ts";
import { ProcessGateIdSchema, SelectorOptionIdSchema } from "./ids.ts";
import { selectorFieldValues, type SelectorFieldValue } from "./selector-field-values.ts";

export { selectorFieldValues } from "./selector-field-values.ts";

export const selectorCriterionIds = [
  "selector-primary-goal",
  "selector-max-print-difficulty",
  "selector-enclosure-capability",
  "selector-hardened-nozzle-capability",
  "selector-dryer-capability",
  "selector-cooling-shrink-tolerance",
  "selector-ventilation-capability",
] as const;

export const SelectorCriterionIdValueSchema = z.enum(selectorCriterionIds);

export const SelectorFieldSchema = z.enum(selectorFieldValues);
export const SelectorTextFieldSchema = z.enum(["guidance.bestSuitedFor", "guidance.tradeoffs"]);

const PredicateScalarSchema = z.union([z.string(), z.number().finite(), z.boolean()]);

export type Predicate =
  | { op: "equals"; field: z.infer<typeof SelectorFieldSchema>; value: string | number | boolean }
  | {
      op: "one-of";
      field: z.infer<typeof SelectorFieldSchema>;
      values: readonly (string | number | boolean)[];
    }
  | { op: "at-least" | "at-most"; field: z.infer<typeof SelectorFieldSchema>; value: number }
  | {
      op: "contains-any";
      field: z.infer<typeof SelectorTextFieldSchema>;
      values: readonly string[];
    }
  | { op: "all" | "any"; rules: readonly Predicate[] }
  | { op: "not"; rule: Predicate };

export const permittedPredicateOperators = [
  "equals",
  "one-of",
  "at-least",
  "at-most",
  "contains-any",
  "all",
  "any",
  "not",
] as const;

export const PredicateSchema: z.ZodType<Predicate> = z.lazy(() =>
  z.discriminatedUnion("op", [
    z.strictObject({
      op: z.literal("equals"),
      field: SelectorFieldSchema,
      value: PredicateScalarSchema,
    }),
    z.strictObject({
      op: z.literal("one-of"),
      field: SelectorFieldSchema,
      values: z.array(PredicateScalarSchema).min(1, "PREDICATE_VALUES_REQUIRED").max(50),
    }),
    z.strictObject({
      op: z.literal("at-least"),
      field: SelectorFieldSchema,
      value: z.number().finite(),
    }),
    z.strictObject({
      op: z.literal("at-most"),
      field: SelectorFieldSchema,
      value: z.number().finite(),
    }),
    z.strictObject({
      op: z.literal("contains-any"),
      field: SelectorTextFieldSchema,
      values: z.array(NormalizedTextSchema).min(1, "PREDICATE_VALUES_REQUIRED").max(50),
    }),
    z.strictObject({
      op: z.literal("all"),
      rules: z.array(PredicateSchema).min(1, "PREDICATE_RULES_REQUIRED").max(50),
    }),
    z.strictObject({
      op: z.literal("any"),
      rules: z.array(PredicateSchema).min(1, "PREDICATE_RULES_REQUIRED").max(50),
    }),
    z.strictObject({ op: z.literal("not"), rule: PredicateSchema }),
  ]),
);

export const HardGateRuleSchema = z.strictObject({
  reasonId: z.string().regex(/^reason-[a-z0-9]+(?:-[a-z0-9]+)*$/u, "REASON_ID_INVALID"),
  processGateId: ProcessGateIdSchema,
  incompatibleWhen: PredicateSchema,
});

export const SelectorOptionSchema = z.strictObject({
  id: SelectorOptionIdSchema,
  label: NormalizedTextSchema,
  displayOrder: z.number().int().nonnegative(),
  preferenceRule: PredicateSchema.optional(),
  hardGates: z.array(HardGateRuleSchema),
});

const CriterionBaseSchema = z.strictObject({
  id: SelectorCriterionIdValueSchema,
  label: NormalizedTextSchema,
  displayOrder: z.number().int().nonnegative(),
  defaultOptionId: SelectorOptionIdSchema,
  options: z.array(SelectorOptionSchema).min(1, "SELECTOR_OPTIONS_REQUIRED"),
});

export const SelectorCriterionSchema = z
  .discriminatedUnion("role", [
    CriterionBaseSchema.extend({ role: z.literal("primary"), weight: z.literal(2) }),
    CriterionBaseSchema.extend({ role: z.literal("secondary"), weight: z.literal(1) }),
  ])
  .refine(
    ({ defaultOptionId, options }) => options.some(({ id }) => id === defaultOptionId),
    "SELECTOR_DEFAULT_UNRESOLVED",
  );

export const SelectorDefinitionSchema = z
  .strictObject({
    primaryWeight: z.literal(2),
    secondaryWeight: z.literal(1),
    stableOrder: z.literal("score-desc-material-asc"),
    criteria: z.array(SelectorCriterionSchema).length(7, "SELECTOR_CRITERIA_COUNT"),
  })
  .superRefine(({ criteria }, context) => {
    const ids = new Set(criteria.map(({ id }) => id));
    const complete = selectorCriterionIds.every((id) => ids.has(id));
    const primary = criteria.filter(({ role }) => role === "primary");
    if (!complete || ids.size !== selectorCriterionIds.length) {
      context.addIssue({ code: "custom", message: "SELECTOR_CRITERIA_SET" });
    }
    if (primary.length !== 1 || primary[0]?.id !== "selector-primary-goal") {
      context.addIssue({ code: "custom", message: "SELECTOR_PRIMARY_INVALID" });
    }
  });

export type SelectorField = SelectorFieldValue;
export type SelectorCriterion = z.infer<typeof SelectorCriterionSchema>;
export type SelectorDefinition = z.infer<typeof SelectorDefinitionSchema>;
