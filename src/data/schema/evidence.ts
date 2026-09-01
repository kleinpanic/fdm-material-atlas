import * as z from "zod";

import { factStateSchema, NormalizedTextSchema, type FactState } from "./fact-state.ts";
import { ClaimIdSchema, MethodIdSchema, SourceIdSchema, type ClaimId } from "./ids.ts";

const LOCAL_DNS_SUFFIXES = [
  "localhost",
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home",
  ".home.arpa",
  ".invalid",
  ".test",
] as const;

function parseIpv4(host: string): readonly number[] | undefined {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/u.test(part))) return undefined;
  const bytes = parts.map(Number);
  if (bytes.some((byte) => byte < 0 || byte > 255)) return undefined;
  return bytes;
}

function isPublicIpv4(bytes: readonly number[]): boolean {
  const [a = -1, b = -1, c = -1] = bytes;
  if (a <= 0 || a >= 224) return false;
  if (a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function parseIpv6(host: string): readonly number[] | undefined {
  const unwrapped = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (unwrapped.includes("%") || !unwrapped.includes(":")) return undefined;
  const halves = unwrapped.split("::");
  if (halves.length > 2) return undefined;

  const parseHalf = (half: string): number[] | undefined => {
    if (half === "") return [];
    const segments = half.split(":");
    const parsed: number[] = [];
    for (const segment of segments) {
      const ipv4 = parseIpv4(segment);
      if (ipv4) {
        if (segment !== segments.at(-1)) return undefined;
        parsed.push((ipv4[0]! << 8) + ipv4[1]!, (ipv4[2]! << 8) + ipv4[3]!);
      } else if (/^[\da-f]{1,4}$/iu.test(segment)) {
        parsed.push(Number.parseInt(segment, 16));
      } else {
        return undefined;
      }
    }
    return parsed;
  };

  const left = parseHalf(halves[0] ?? "");
  const right = parseHalf(halves[1] ?? "");
  if (!left || !right) return undefined;
  if (halves.length === 1) return left.length === 8 ? left : undefined;
  const missing = 8 - left.length - right.length;
  if (missing < 1) return undefined;
  return [...left, ...Array<number>(missing).fill(0), ...right];
}

function isPublicIpv6(words: readonly number[]): boolean {
  if (words.length !== 8) return false;
  const [first = 0, second = 0] = words;
  const allZeroExceptLast = words.slice(0, 7).every((word) => word === 0);
  if (words.every((word) => word === 0) || (allZeroExceptLast && words[7] === 1)) return false;
  if ((first & 0xfe00) === 0xfc00) return false;
  if ((first & 0xffc0) === 0xfe80) return false;
  if ((first & 0xff00) === 0xff00) return false;
  if (first === 0x2001 && second === 0x0db8) return false;
  if (first === 0x2002) return false;

  const ipv4Mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  if (ipv4Mapped) {
    const high = words[6]!;
    const low = words[7]!;
    return isPublicIpv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
  }
  return first >= 0x2000 && first <= 0x3fff;
}

function isPublicHttpsUrl(value: string): boolean {
  if (value.length === 0 || value.length > 2_048 || !value.startsWith("https://")) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return false;
    const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
    if (hostname === "" || LOCAL_DNS_SUFFIXES.some((suffix) => hostname.endsWith(suffix)))
      return false;

    const ipv4 = parseIpv4(hostname);
    if (ipv4) return isPublicIpv4(ipv4);
    const ipv6 = parseIpv6(hostname);
    if (ipv6) return isPublicIpv6(ipv6);
    return hostname.includes(".") && /^[a-z\d.-]+$/u.test(hostname);
  } catch {
    return false;
  }
}

export const PublicHttpsUrlSchema = z.string().refine(isPublicHttpsUrl, "URL_UNSAFE");

export const EvidenceScopeSchema = z.enum([
  "product-specific",
  "representative-product",
  "family-guidance",
  "qualitative-heuristic",
  "starting-profile-guidance",
  "derived-selector-logic",
]);

export const EvidenceSourceKindSchema = z.enum([
  "manufacturer-guide",
  "technical-data-sheet",
  "safety-data-sheet",
  "product-data",
  "process-guidance",
]);

export const EvidenceSourceSchema = z.strictObject({
  id: SourceIdSchema,
  title: NormalizedTextSchema,
  publisher: NormalizedTextSchema,
  kind: EvidenceSourceKindSchema,
  url: PublicHttpsUrlSchema,
});

export const MethodRecordSchema = z.strictObject({
  id: MethodIdSchema,
  name: NormalizedTextSchema,
  description: NormalizedTextSchema,
  limitations: z.array(NormalizedTextSchema).max(50, "METHOD_LIMITATIONS_EXCESSIVE"),
});

const SourceBasisRefSchema = z.strictObject({
  kind: z.literal("source"),
  sourceId: SourceIdSchema,
  scope: EvidenceScopeSchema,
  note: NormalizedTextSchema.optional(),
});

const MethodBasisRefSchema = z.strictObject({
  kind: z.literal("method"),
  methodId: MethodIdSchema,
  scope: EvidenceScopeSchema,
  note: NormalizedTextSchema.optional(),
});

export const BasisRefSchema = z.discriminatedUnion("kind", [
  SourceBasisRefSchema,
  MethodBasisRefSchema,
]);

export type EvidenceScope = z.infer<typeof EvidenceScopeSchema>;
export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;
export type MethodRecord = z.infer<typeof MethodRecordSchema>;
export type BasisRef = z.infer<typeof BasisRefSchema>;

export type Claim<T> = {
  id: ClaimId;
  value: FactState<T>;
  qualification?: string | undefined;
  basis: BasisRef[];
};

/** Claims carry their evidence scope at every source or method relationship. */
export function claimSchema<T extends z.ZodType>(valueSchema: T) {
  return z.strictObject({
    id: ClaimIdSchema,
    value: factStateSchema(valueSchema),
    qualification: NormalizedTextSchema.optional(),
    basis: z.array(BasisRefSchema).min(1, "CLAIM_BASIS_REQUIRED"),
  });
}
