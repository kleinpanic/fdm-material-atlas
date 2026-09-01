import {
  decodeSelectorClientModel,
  type SelectorClientModel,
  type SelectorRuntimePageModel,
} from "./client-model.ts";

export const SELECTOR_PAYLOAD_ID = "selector-client-model";
const MAX_PAYLOAD_BYTES = 64 * 1024;
const INVALID = "SELECTOR_DEFERRED_PAYLOAD_INVALID";

type PayloadElement = Readonly<{ tagName?: string; textContent?: string | null }>;
type PayloadDocument = Readonly<{
  querySelectorAll(selector: string): ArrayLike<PayloadElement>;
}>;

function fail(): never {
  throw new Error(INVALID);
}

/** Serialize validated public selector data as JSON-safe script text, never executable HTML. */
export function serializeSelectorDeferredPayload(pageModel: SelectorClientModel): string {
  try {
    const serialized = JSON.stringify(pageModel)
      .replaceAll("&", "\\u0026")
      .replaceAll("<", "\\u003c")
      .replaceAll(">", "\\u003e")
      .replaceAll("\u2028", "\\u2028")
      .replaceAll("\u2029", "\\u2029");
    if (serialized.length === 0 || serialized.length > MAX_PAYLOAD_BYTES) fail();
    return serialized;
  } catch {
    return fail();
  }
}

/** Read exactly one fixed same-document record, then run the existing closed model decoder. */
export function decodeSelectorDeferredPayload(root: PayloadDocument): SelectorRuntimePageModel {
  try {
    const matches = Array.from(
      root.querySelectorAll(`script#${SELECTOR_PAYLOAD_ID}[type="application/json"]`),
    );
    if (matches.length !== 1 || matches[0]?.tagName?.toUpperCase() !== "SCRIPT") fail();
    const serialized = matches[0].textContent;
    if (
      typeof serialized !== "string" ||
      serialized.length === 0 ||
      serialized.length > MAX_PAYLOAD_BYTES
    )
      fail();
    return decodeSelectorClientModel(JSON.parse(serialized) as SelectorClientModel);
  } catch {
    return fail();
  }
}
