import * as z from "zod";

import { BasisRefSchema } from "./evidence.ts";
import { NormalizedTextSchema } from "./fact-state.ts";
import { ProcessGateIdSchema } from "./ids.ts";

export const ProcessGateCapabilitySchema = z.enum([
  "enclosure",
  "hardened-nozzle",
  "drying",
  "ventilation",
  "temperature-capability",
  "flexible-feed-path",
  "soluble-support-process",
  "industrial-hardware",
]);

export const ProcessGateRecordSchema = z.strictObject({
  id: ProcessGateIdSchema,
  label: NormalizedTextSchema,
  capability: ProcessGateCapabilitySchema,
  requirement: NormalizedTextSchema,
  verification: NormalizedTextSchema,
  basis: z.array(BasisRefSchema).min(1, "PROCESS_GATE_BASIS_REQUIRED"),
});

export const ProcessGateRegistrySchema = z.array(ProcessGateRecordSchema);

export type ProcessGateCapability = z.infer<typeof ProcessGateCapabilitySchema>;
export type ProcessGateRecord = z.infer<typeof ProcessGateRecordSchema>;
