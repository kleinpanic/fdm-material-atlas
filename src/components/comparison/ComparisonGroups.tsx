/** @jsxImportSource preact */
import type {
  ComparedValue,
  ComparisonEvidenceAction,
  ComparisonRow,
  ComparisonSuccess,
} from "../../features/comparison/contracts.ts";

function EvidenceActions({ actions }: Readonly<{ actions: readonly ComparisonEvidenceAction[] }>) {
  if (actions.length === 0) return null;
  return (
    <ul class="comparison-value__evidence" aria-label="Evidence">
      {actions.map((action) => (
        <li key={`${action.href}:${action.scope}`}>
          <a href={action.href}>{action.label}</a> <span>({action.scopeLabel})</span>
        </li>
      ))}
    </ul>
  );
}

function ValueBody({ value }: Readonly<{ value: ComparedValue }>) {
  if (value.kind === "no-comparable-observation") {
    return <p><span aria-hidden="true">□</span> {value.label}</p>;
  }

  const record = value.kind === "value" ? value.cell : value.member;
  return (
    <div class="comparison-value__body">
      {value.kind === "thermal" ? (
        <p class="comparison-value__thermal-identity">
          <strong>{value.member.metricLabel}</strong> — {value.member.methodLabel}
        </p>
      ) : null}
      {record.display.map((line, index) => <p key={`${line}:${index}`}>{line}</p>)}
      {record.qualification ? <p>{record.qualification}</p> : null}
      {record.scopeLabels.length > 0 ? (
        <p class="comparison-value__scopes">Evidence scope: {record.scopeLabels.join(", ")}</p>
      ) : null}
      <EvidenceActions actions={record.evidence} />
    </div>
  );
}

function ComparisonProperty({ row }: Readonly<{ row: ComparisonRow }>) {
  return (
    <article class={`comparison-property${row.differs ? " comparison-property--different" : ""}`}>
      <div class="comparison-property__heading">
        <h3>{row.label}</h3>
        {row.differs ? <p class="comparison-property__marker">Difference</p> : null}
      </div>
      <dl>
        {row.values.map((value) => (
          <div class="comparison-property__material" key={value.materialId}>
            <dt>{value.materialName}</dt>
            <dd><ValueBody value={value} /></dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

export function ComparisonGroups({ result }: Readonly<{ result: ComparisonSuccess }>) {
  return (
    <div class="comparison-groups">
      {result.groups.map((group) => (
        <section class="comparison-group" aria-labelledby={`compare-group-${group.key}`} key={group.key}>
          <h2 id={`compare-group-${group.key}`}>{group.label}</h2>
          <p>{group.differenceCount} differences; {group.equalCount} values are the same.</p>
          {group.differing.length === 0 ? <p>No differences in this group.</p> : null}
          <div class="comparison-group__differences">
            {group.differing.map((row) => (
              <div key={`${row.key}:${row.thermalGroupId ?? "value"}`}>
                <ComparisonProperty row={row} />
              </div>
            ))}
          </div>
          {group.equal.length > 0 ? (
            <details class="comparison-group__equal">
              <summary>Same across selected materials ({group.equalCount})</summary>
              {group.equal.map((row) => (
                <div key={`${row.key}:${row.thermalGroupId ?? "value"}`}>
                  <ComparisonProperty row={row} />
                </div>
              ))}
            </details>
          ) : null}
        </section>
      ))}
    </div>
  );
}
