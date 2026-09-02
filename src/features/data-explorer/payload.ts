import { gzipSync } from "node:zlib";

import type { MaterialId } from "../../data/schema/ids.ts";
import type { DataExplorerModel } from "./model.ts";

export type DataExplorerPayload = Readonly<{
  index: readonly Readonly<{ id: MaterialId; name: string }>[];
  groups: readonly Readonly<{ key: string; label: string; fieldCount: number }>[];
  gzipBase64: string;
}>;

/** Encode the canonical explorer projection without making the browser parse it from HTML. */
export function encodeDataExplorerPayload(model: DataExplorerModel): DataExplorerPayload {
  return Object.freeze({
    index: Object.freeze(model.materials.map(({ id, name }) => Object.freeze({ id, name }))),
    groups: Object.freeze(
      model.groups.map(({ key, label, fieldKeys }) =>
        Object.freeze({ key, label, fieldCount: fieldKeys.length }),
      ),
    ),
    gzipBase64: gzipSync(Buffer.from(JSON.stringify(model)), { level: 9 }).toString("base64"),
  });
}
