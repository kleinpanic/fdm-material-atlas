import type { MaterialId } from "./ids.ts";

const MAX_PUBLIC_ID_LENGTH = 160;
const MATERIAL_ID_PATTERN = /^material-[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** Match the build-time MaterialIdSchema without loading Zod in browser code. */
export function isMaterialIdValue(value: unknown): value is MaterialId {
  return (
    typeof value === "string" &&
    value.length <= MAX_PUBLIC_ID_LENGTH &&
    MATERIAL_ID_PATTERN.test(value)
  );
}
