import * as z from "zod";

import { DecisionLaneRegistrySchema } from "./decision-lane.ts";
import { EvidenceSourceSchema, MethodRecordSchema } from "./evidence.ts";
import { NormalizedTextSchema } from "./fact-state.ts";
import { VocabularyIdSchema } from "./ids.ts";
import { MaterialSchema } from "./material.ts";
import { ProcessGateRegistrySchema } from "./process-gate.ts";
import { SelectorDefinitionSchema } from "./selector.ts";
import { VisualizationReferenceRegistrySchema } from "./visualization.ts";

export const VocabularyTermSchema = z.strictObject({
  value: NormalizedTextSchema,
  label: NormalizedTextSchema,
  order: z.number().int("VOCABULARY_ORDER_INVALID").nonnegative().optional(),
});

export const VocabularyDefinitionSchema = z.strictObject({
  id: VocabularyIdSchema,
  label: NormalizedTextSchema,
  ordered: z.boolean(),
  terms: z.array(VocabularyTermSchema).min(1, "VOCABULARY_TERMS_REQUIRED"),
});

export const VocabularyCatalogSchema = z.array(VocabularyDefinitionSchema);

/** The only public version-1 data envelope accepted by downstream consumers. */
export const AtlasV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  materials: z.array(MaterialSchema),
  sources: z.array(EvidenceSourceSchema),
  methods: z.array(MethodRecordSchema),
  selector: SelectorDefinitionSchema,
  processGates: ProcessGateRegistrySchema,
  decisionLanes: DecisionLaneRegistrySchema,
  visualizationReferences: VisualizationReferenceRegistrySchema,
  vocabularies: VocabularyCatalogSchema,
});

export type VocabularyTerm = z.infer<typeof VocabularyTermSchema>;
export type VocabularyDefinition = z.infer<typeof VocabularyDefinitionSchema>;
export type AtlasV1 = z.infer<typeof AtlasV1Schema>;

