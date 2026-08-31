import type * as z from "zod";

import { AtlasV1Schema, type AtlasV1 } from "./atlas.ts";
import { PublicIdSchema } from "./ids.ts";
import { validateAtlasInvariants } from "./invariants.ts";

export type AtlasIssueCode =
  | "BASELINE_COUNT_CHANGED"
  | "EVIDENCE_REQUIRED"
  | "EVIDENCE_SCOPE_INVALID"
  | "FACT_STATE_INVALID"
  | "FIELD_COVERAGE_MISSING"
  | "ID_DUPLICATE"
  | "LANE_CANDIDATE_EMBEDDED"
  | "RANGE_INVALID"
  | "REFERENCE_MISSING"
  | "SCHEMA_INVALID"
  | "SCHEMA_UNKNOWN_KEY"
  | "SCHEMA_VERSION_UNSUPPORTED"
  | "SERIALIZATION_DRIFT"
  | "THERMAL_METRIC_GENERIC"
  | "THERMAL_NOT_COMPARABLE"
  | "THERMAL_SERVICE_CONFLATION"
  | "UNIT_INVALID"
  | "URL_UNSAFE"
  | "VOCABULARY_INVALID";

export type AtlasIssue = {
  code: AtlasIssueCode;
  pointer: string;
  entityId?: string;
};

export type ParseAtlasResult =
  | { success: true; data: AtlasV1; issues: readonly [] }
  | { success: false; issues: readonly AtlasIssue[] };

function escapePointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function toJsonPointer(path: readonly PropertyKey[]): string {
  if (path.length === 0) return "/";
  return `/${path.map((part) => escapePointerSegment(String(part))).join("/")}`;
}

function structuralIssueCode(issue: z.core.$ZodIssue): AtlasIssueCode {
  const path = issue.path.map(String);
  if (path.length === 1 && path[0] === "schemaVersion") {
    return "SCHEMA_VERSION_UNSUPPORTED";
  }
  if (issue.code === "unrecognized_keys") {
    const keys = "keys" in issue && Array.isArray(issue.keys) ? issue.keys : [];
    return issue.path[0] === "decisionLanes" && keys.includes("candidateMaterialIds")
      ? "LANE_CANDIDATE_EMBEDDED"
      : "SCHEMA_UNKNOWN_KEY";
  }

  const controlledMessageCodes: Readonly<Record<string, AtlasIssueCode>> = {
    URL_UNSAFE: "URL_UNSAFE",
    STARTING_PROFILE_BASIS_INVALID: "EVIDENCE_SCOPE_INVALID",
    CLAIM_BASIS_REQUIRED: "EVIDENCE_REQUIRED",
    PROCESS_GATE_BASIS_REQUIRED: "EVIDENCE_REQUIRED",
    MEASUREMENT_RANGE_REVERSED: "RANGE_INVALID",
    NUMBER_NOT_FINITE: "RANGE_INVALID",
    NUMBER_BELOW_BOUND: "RANGE_INVALID",
    NUMBER_ABOVE_BOUND: "RANGE_INVALID",
    SELECTOR_CRITERIA_SET: "ID_DUPLICATE",
    DECISION_LANE_SET: "ID_DUPLICATE",
  };
  const mapped = controlledMessageCodes[issue.message];
  if (mapped) return mapped;

  const final = path.at(-1);
  if (final === "unit") return "UNIT_INVALID";
  if (final === "state" || final === "condition" || final === "reason") {
    return "FACT_STATE_INVALID";
  }
  if (path.some((part) => part === "properties" || part === "process" || part === "costTier")) {
    return "VOCABULARY_INVALID";
  }
  return "SCHEMA_INVALID";
}

function issuePointer(issue: z.core.$ZodIssue): string {
  // Unknown member names can themselves contain sensitive input. Point to the
  // containing object rather than reproducing Zod's rejected key list.
  return toJsonPointer(issue.path);
}

function ownValue(value: unknown, key: PropertyKey): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

function safeEntityId(input: unknown, path: readonly PropertyKey[]): string | undefined {
  let current: unknown = input;
  let nearest: string | undefined;
  const inspect = (candidate: unknown) => {
    const id = ownValue(candidate, "id");
    const parsed = PublicIdSchema.safeParse(id);
    if (parsed.success) nearest = parsed.data;
  };
  inspect(current);
  for (const segment of path) {
    current = ownValue(current, segment);
    inspect(current);
  }
  return nearest;
}

function mapStructuralIssues(input: unknown, issues: readonly z.core.$ZodIssue[]): AtlasIssue[] {
  const safe = issues.map((issue): AtlasIssue => {
    const entityId = safeEntityId(input, issue.path);
    return {
      code: structuralIssueCode(issue),
      pointer: issuePointer(issue),
      ...(entityId === undefined ? {} : { entityId }),
    };
  });
  return safe.sort((left, right) =>
    left.pointer.localeCompare(right.pointer) ||
    left.code.localeCompare(right.code) ||
    (left.entityId ?? "").localeCompare(right.entityId ?? ""),
  );
}

/** Parse unknown data into AtlasV1 without exposing rejected content. */
export function parseAtlas(input: unknown): ParseAtlasResult {
  const parsed = AtlasV1Schema.safeParse(input);
  if (!parsed.success) {
    return { success: false, issues: mapStructuralIssues(input, parsed.error.issues) };
  }
  const issues = validateAtlasInvariants(parsed.data);
  if (issues.length > 0) return { success: false, issues };
  return { success: true, data: parsed.data, issues: [] };
}
