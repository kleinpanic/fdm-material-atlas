import { createHash } from "node:crypto";

import { decisionLaneIds } from "../schema/decision-lane.ts";
import {
  permittedPredicateOperators,
  selectorCriterionIds,
} from "../schema/selector.ts";
import { MATERIAL_SEMANTIC_FIELDS } from "./semantic-fields.ts";
import { sourceLogicalRoles } from "./source-dto.ts";

/** Reviewed public-safe contract. It contains no source locator or runtime metadata. */
export const SOURCE_CONTRACT_DESCRIPTOR = Object.freeze({
  contractVersion: 1,
  logicalRoles: sourceLogicalRoles,
  semanticFields: MATERIAL_SEMANTIC_FIELDS,
  semanticChannels: Object.freeze({
    materials: ["value", "note", "link"] as const,
    selector: ["value", "validation", "formula-semantics"] as const,
    "evidence-method": ["value", "note", "link"] as const,
    "decision-map": ["value", "note", "formula-semantics"] as const,
  }),
  selectorCriterionIds,
  decisionLaneIds,
  expectedCounts: Object.freeze({
    materials: 23,
    publicSources: 22,
  }),
  selectorWeights: Object.freeze({
    primary: 2,
    secondary: 1,
  }),
  permittedPredicateOperators,
} as const);

/** Hash only the deterministic reviewed descriptor, never private or runtime state. */
export function digestSourceContractDescriptor(): string {
  return createHash("sha256")
    .update(JSON.stringify(SOURCE_CONTRACT_DESCRIPTOR), "utf8")
    .digest("hex");
}

