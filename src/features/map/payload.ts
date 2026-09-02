import { gzipSync } from "node:zlib";

import type { MapProjection } from "./contracts.ts";

export type MapProjectionPayload = Readonly<{
  gzipBase64: string;
}>;

/** Encode the public map projection without making Astro parse its full object graph. */
export function encodeMapProjectionPayload(projection: MapProjection): MapProjectionPayload {
  return Object.freeze({
    gzipBase64: gzipSync(Buffer.from(JSON.stringify(projection)), { level: 9 }).toString("base64"),
  });
}
