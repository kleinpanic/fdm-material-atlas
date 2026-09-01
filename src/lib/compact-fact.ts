type FactRecord = Readonly<{
  state: string;
  value?: unknown;
  reason?: string | undefined;
  condition?: string | undefined;
}>;

const UNIT_LABELS: Readonly<Record<string, string>> = {
  degC: "°C",
  "g/cm3": "g/cm³",
  "mm/s": "mm/s",
  percent: "%",
};

function titleCase(value: string): string {
  return value
    .split("-")
    .map((part) => (part.length === 0 ? part : `${part[0]?.toUpperCase()}${part.slice(1)}`))
    .join(" ");
}

function formatKnown(value: unknown): string {
  if (typeof value === "string") return titleCase(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(formatKnown).join(", ");
  if (typeof value !== "object" || value === null) return "Not reported";

  const measurement = value as Record<string, unknown>;
  const unit =
    typeof measurement.unit === "string" ? (UNIT_LABELS[measurement.unit] ?? measurement.unit) : "";
  if (measurement.shape === "exact" && typeof measurement.value === "number") {
    return `${measurement.value}${unit === "%" ? "" : " "}${unit}`.trim();
  }
  if (
    measurement.shape === "range" &&
    typeof measurement.min === "number" &&
    typeof measurement.max === "number"
  ) {
    return `${measurement.min}–${measurement.max}${unit === "%" ? "" : " "}${unit}`.trim();
  }
  return "See material details";
}

export function compactFact(claim: Readonly<{ value: FactRecord }>): string {
  const fact = claim.value;
  if (fact.state === "known") return formatKnown(fact.value);
  if (fact.state === "conditional") {
    const value = fact.value === undefined ? "Conditional" : formatKnown(fact.value);
    return fact.condition === undefined ? value : `${value} — ${fact.condition}`;
  }
  if (fact.state === "not-applicable") return "Not applicable";
  if (fact.state === "unknown") return "Unknown — verify";
  return "Not reported";
}
