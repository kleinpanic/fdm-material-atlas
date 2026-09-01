import type { ProcessGateId } from "../../data/schema/ids.ts";
import {
  SelectorFieldSchema,
  selectorFieldValues,
  type SelectorField,
} from "../../data/schema/selector.ts";
import type {
  ExclusionOutcome,
  PredicateOutcome,
  ProjectedHardGateRule,
  ProjectedSelectorFieldRecord,
  ReadonlyPredicate,
} from "./types.ts";

export const PREDICATE_MAX_DEPTH = 32;
export const PREDICATE_MAX_NODES = 512;

export type PredicateConfigurationCode =
  | "PREDICATE_COMPILED_INVALID"
  | "PREDICATE_DEPTH_EXCEEDED"
  | "PREDICATE_FIELD_INVALID"
  | "PREDICATE_NODE_INVALID"
  | "PREDICATE_NODE_LIMIT_EXCEEDED"
  | "PREDICATE_OPERAND_INVALID"
  | "PREDICATE_OPERATOR_INVALID"
  | "PREDICATE_REASON_DUPLICATE";

/** A controlled configuration failure that never includes rejected values. */
export class PredicateConfigurationError extends Error {
  readonly code: PredicateConfigurationCode;

  constructor(code: PredicateConfigurationCode) {
    super(code);
    this.name = "PredicateConfigurationError";
    this.code = code;
  }
}

export type PredicateFieldResolver = (field: SelectorField) => ProjectedSelectorFieldRecord;

export type CompiledPredicateSet = Readonly<{
  preferenceRule?: ReadonlyPredicate;
  hardGates: readonly ProjectedHardGateRule[];
}>;

type UnknownRecord = Readonly<Record<string, unknown>>;
type CompilationState = { nodeCount: number };

const numericFields = new Set<SelectorField>([
  "serviceTemperature.minimum",
  "serviceTemperature.maximum",
  ...selectorFieldValues.filter((field) => field.endsWith(".order")),
]);

const textListFields = new Set<SelectorField>(["guidance.bestSuitedFor", "guidance.tradeoffs"]);

function configurationError(code: PredicateConfigurationCode): never {
  throw new PredicateConfigurationError(code);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(record: UnknownRecord, required: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const expected = [...required].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function fieldKind(field: SelectorField): "number" | "string" | "text-list" {
  if (numericFields.has(field)) return "number";
  if (textListFields.has(field)) return "text-list";
  return "string";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isCompatibleScalar(value: unknown, kind: "number" | "string"): value is number | string {
  return kind === "number" ? isFiniteNumber(value) : typeof value === "string";
}

function freezePredicate(predicate: ReadonlyPredicate): ReadonlyPredicate {
  return Object.freeze(predicate);
}

function compileNode(input: unknown, depth: number, state: CompilationState): ReadonlyPredicate {
  if (depth > PREDICATE_MAX_DEPTH) configurationError("PREDICATE_DEPTH_EXCEEDED");
  state.nodeCount += 1;
  if (state.nodeCount > PREDICATE_MAX_NODES) configurationError("PREDICATE_NODE_LIMIT_EXCEEDED");
  if (!isRecord(input)) configurationError("PREDICATE_NODE_INVALID");
  if (typeof input.op !== "string") configurationError("PREDICATE_OPERATOR_INVALID");

  switch (input.op) {
    case "equals": {
      if (!hasExactKeys(input, ["op", "field", "value"]))
        configurationError("PREDICATE_OPERAND_INVALID");
      const fieldResult = SelectorFieldSchema.safeParse(input.field);
      if (!fieldResult.success) configurationError("PREDICATE_FIELD_INVALID");
      const kind = fieldKind(fieldResult.data);
      if (kind === "text-list" || !isCompatibleScalar(input.value, kind)) {
        configurationError("PREDICATE_OPERAND_INVALID");
      }
      return freezePredicate({ op: "equals", field: fieldResult.data, value: input.value });
    }

    case "one-of": {
      if (!hasExactKeys(input, ["op", "field", "values"]))
        configurationError("PREDICATE_OPERAND_INVALID");
      const fieldResult = SelectorFieldSchema.safeParse(input.field);
      if (!fieldResult.success) configurationError("PREDICATE_FIELD_INVALID");
      const kind = fieldKind(fieldResult.data);
      if (
        kind === "text-list" ||
        !Array.isArray(input.values) ||
        input.values.length < 1 ||
        input.values.length > 50 ||
        !input.values.every((value) => isCompatibleScalar(value, kind))
      ) {
        configurationError("PREDICATE_OPERAND_INVALID");
      }
      return freezePredicate({
        op: "one-of",
        field: fieldResult.data,
        values: Object.freeze([...input.values]) as readonly (string | number | boolean)[],
      });
    }

    case "at-least":
    case "at-most": {
      if (!hasExactKeys(input, ["op", "field", "value"]))
        configurationError("PREDICATE_OPERAND_INVALID");
      const fieldResult = SelectorFieldSchema.safeParse(input.field);
      if (!fieldResult.success) configurationError("PREDICATE_FIELD_INVALID");
      if (fieldKind(fieldResult.data) !== "number" || !isFiniteNumber(input.value)) {
        configurationError("PREDICATE_OPERAND_INVALID");
      }
      return freezePredicate({ op: input.op, field: fieldResult.data, value: input.value });
    }

    case "contains-any": {
      if (!hasExactKeys(input, ["op", "field", "values"]))
        configurationError("PREDICATE_OPERAND_INVALID");
      const fieldResult = SelectorFieldSchema.safeParse(input.field);
      if (!fieldResult.success) configurationError("PREDICATE_FIELD_INVALID");
      if (
        fieldKind(fieldResult.data) !== "text-list" ||
        !Array.isArray(input.values) ||
        input.values.length < 1 ||
        input.values.length > 50 ||
        !input.values.every(
          (value) => typeof value === "string" && value.trim().length > 0 && value.length <= 500,
        )
      ) {
        configurationError("PREDICATE_OPERAND_INVALID");
      }
      return freezePredicate({
        op: "contains-any",
        field: fieldResult.data as Extract<ReadonlyPredicate, { op: "contains-any" }>["field"],
        values: Object.freeze([...input.values]) as readonly string[],
      });
    }

    case "all":
    case "any": {
      if (!hasExactKeys(input, ["op", "rules"])) configurationError("PREDICATE_OPERAND_INVALID");
      if (!Array.isArray(input.rules) || input.rules.length < 1 || input.rules.length > 50) {
        configurationError("PREDICATE_OPERAND_INVALID");
      }
      const rules = input.rules.map((rule) => compileNode(rule, depth + 1, state));
      return freezePredicate({ op: input.op, rules: Object.freeze(rules) });
    }

    case "not": {
      if (!hasExactKeys(input, ["op", "rule"])) configurationError("PREDICATE_OPERAND_INVALID");
      return freezePredicate({ op: "not", rule: compileNode(input.rule, depth + 1, state) });
    }

    default:
      return configurationError("PREDICATE_OPERATOR_INVALID");
  }
}

function normalizeLiteral(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase("en-US");
}

function resolveField(
  resolver: PredicateFieldResolver,
  field: SelectorField,
): ProjectedSelectorFieldRecord | undefined {
  try {
    const record = resolver(field);
    if (!isRecord(record) || record.field !== field) return undefined;
    if (record.state === "indeterminate") return record;
    if (record.state === "resolved") return record;
    return undefined;
  } catch {
    return undefined;
  }
}

function evaluateScalar(
  predicate: Extract<
    ReadonlyPredicate,
    { op: "equals" | "one-of" | "at-least" | "at-most" | "contains-any" }
  >,
  resolver: PredicateFieldResolver,
): PredicateOutcome {
  const record = resolveField(resolver, predicate.field);
  if (record === undefined || record.state === "indeterminate") return "indeterminate";

  switch (predicate.op) {
    case "equals": {
      const kind = fieldKind(predicate.field);
      if (kind === "text-list" || !isCompatibleScalar(record.value, kind)) return "indeterminate";
      return record.value === predicate.value ? "match" : "no-match";
    }
    case "one-of": {
      const kind = fieldKind(predicate.field);
      if (kind === "text-list" || !isCompatibleScalar(record.value, kind)) return "indeterminate";
      return predicate.values.some((value) => value === record.value) ? "match" : "no-match";
    }
    case "at-least":
      if (!isFiniteNumber(record.value)) return "indeterminate";
      return record.value >= predicate.value ? "match" : "no-match";
    case "at-most":
      if (!isFiniteNumber(record.value)) return "indeterminate";
      return record.value <= predicate.value ? "match" : "no-match";
    case "contains-any": {
      if (
        !Array.isArray(record.value) ||
        !record.value.every((value) => typeof value === "string")
      ) {
        return "indeterminate";
      }
      const values = record.value.map(normalizeLiteral);
      const candidates = predicate.values.map(normalizeLiteral);
      return candidates.some((candidate) => values.some((value) => value.includes(candidate)))
        ? "match"
        : "no-match";
    }
    default:
      return assertNever(predicate);
  }
}

function assertNever(value: never): never {
  void value;
  return configurationError("PREDICATE_COMPILED_INVALID");
}

/** Validate and deeply freeze one predicate before any material resolution occurs. */
export function compilePredicate(input: unknown): ReadonlyPredicate {
  try {
    return compileNode(input, 1, { nodeCount: 0 });
  } catch (error) {
    if (error instanceof PredicateConfigurationError) throw error;
    return configurationError("PREDICATE_NODE_INVALID");
  }
}

/** Validate all rules for one option under a shared node budget. */
export function compilePredicateSet(input: unknown): CompiledPredicateSet {
  try {
    if (!isRecord(input) || !Array.isArray(input.hardGates)) {
      configurationError("PREDICATE_OPERAND_INVALID");
    }
    const state: CompilationState = { nodeCount: 0 };
    const reasons = new Set<string>();
    const hardGates = input.hardGates.map((gate) => {
      if (!isRecord(gate)) configurationError("PREDICATE_OPERAND_INVALID");
      if (
        typeof gate.reasonId !== "string" ||
        !/^reason-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(gate.reasonId) ||
        typeof gate.processGateId !== "string" ||
        !/^gate-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(gate.processGateId) ||
        !("incompatibleWhen" in gate)
      ) {
        configurationError("PREDICATE_OPERAND_INVALID");
      }
      if (reasons.has(gate.reasonId)) configurationError("PREDICATE_REASON_DUPLICATE");
      reasons.add(gate.reasonId);
      return Object.freeze({
        reasonId: gate.reasonId,
        processGateId: gate.processGateId as ProcessGateId,
        incompatibleWhen: compileNode(gate.incompatibleWhen, 1, state),
      });
    });
    const preferenceRule =
      input.preferenceRule === undefined ? undefined : compileNode(input.preferenceRule, 1, state);
    return Object.freeze({
      ...(preferenceRule === undefined ? {} : { preferenceRule }),
      hardGates: Object.freeze(hardGates),
    });
  } catch (error) {
    if (error instanceof PredicateConfigurationError) throw error;
    return configurationError("PREDICATE_NODE_INVALID");
  }
}

/** Evaluate only an already validated predicate. */
export function evaluateCompiledPredicate(
  predicate: ReadonlyPredicate,
  resolver: PredicateFieldResolver,
): PredicateOutcome {
  switch (predicate.op) {
    case "equals":
    case "one-of":
    case "at-least":
    case "at-most":
    case "contains-any":
      return evaluateScalar(predicate, resolver);
    case "not": {
      const outcome = evaluateCompiledPredicate(predicate.rule, resolver);
      return outcome === "match" ? "no-match" : outcome === "no-match" ? "match" : "indeterminate";
    }
    case "all": {
      const outcomes = predicate.rules.map((rule) => evaluateCompiledPredicate(rule, resolver));
      if (outcomes.includes("no-match")) return "no-match";
      return outcomes.includes("indeterminate") ? "indeterminate" : "match";
    }
    case "any": {
      const outcomes = predicate.rules.map((rule) => evaluateCompiledPredicate(rule, resolver));
      if (outcomes.includes("match")) return "match";
      return outcomes.includes("indeterminate") ? "indeterminate" : "no-match";
    }
    default:
      return assertNever(predicate);
  }
}

/** Compile the complete tree, then evaluate it through the controlled field resolver. */
export function evaluatePredicate(
  predicate: unknown,
  resolver: PredicateFieldResolver,
): PredicateOutcome {
  return evaluateCompiledPredicate(compilePredicate(predicate), resolver);
}

/** A selected hard gate passes only when its incompatibility predicate is a definite no-match. */
export function evaluateHardGatePredicate(
  predicate: unknown,
  resolver: PredicateFieldResolver,
): ExclusionOutcome | null {
  const outcome = evaluatePredicate(predicate, resolver);
  return outcome === "match"
    ? "incompatible"
    : outcome === "indeterminate"
      ? "indeterminate"
      : null;
}
