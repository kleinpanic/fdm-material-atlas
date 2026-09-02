import { gzipSync } from "node:zlib";

import type { MaterialId } from "../../data/schema/ids.ts";
import type { ComparisonModel } from "./contracts.ts";

export type ComparisonIndex = readonly Readonly<{ id: MaterialId; name: string }>[];

export type ComparisonPayload = Readonly<{
  index: ComparisonIndex;
  gzipBase64: string;
}>;

/** Encode the full comparison projection without forcing the initial document to parse it. */
export function encodeComparisonPayload(model: ComparisonModel): ComparisonPayload {
  const json = JSON.stringify(model);
  return Object.freeze({
    index: Object.freeze(model.materials.map(({ id, name }) => Object.freeze({ id, name }))),
    gzipBase64: gzipSync(Buffer.from(json), { level: 9 }).toString("base64"),
  });
}
