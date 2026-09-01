/** @jsxImportSource preact */
import type { ComponentType, JSX } from "preact";
import type { ExplorerSuccess, ExplorerSortableField } from "../../features/data-explorer/explore.ts";
import type { ExplorerCell } from "../../features/data-explorer/model.ts";

// The project intentionally narrows global JSX intrinsic tags. These typed aliases
// still emit the corresponding native elements without broadening that global surface.
const Table = "table" as unknown as ComponentType<JSX.HTMLAttributes<HTMLTableElement>>;
const Caption = "caption" as unknown as ComponentType<JSX.HTMLAttributes<HTMLTableCaptionElement>>;
const TableHead = "thead" as unknown as ComponentType<JSX.HTMLAttributes<HTMLTableSectionElement>>;
const TableBody = "tbody" as unknown as ComponentType<JSX.HTMLAttributes<HTMLTableSectionElement>>;
const TableRow = "tr" as unknown as ComponentType<JSX.HTMLAttributes<HTMLTableRowElement>>;
const TableHeader = "th" as unknown as ComponentType<JSX.HTMLAttributes<HTMLTableCellElement>>;
const TableData = "td" as unknown as ComponentType<JSX.HTMLAttributes<HTMLTableCellElement>>;

type CellProps = Readonly<{ cell: ExplorerCell }>;

function TextValues({ values }: Readonly<{ values: readonly string[] }>) {
  return values.length > 1
    ? <ul>{values.map((value, index) => <li key={`${index}-${value}`}>{value}</li>)}</ul>
    : <span>{values[0]}</span>;
}

function Evidence({ cell }: CellProps) {
  const evidence = cell.kind === "value" ? cell.evidence : cell.members.flatMap(({ evidence }) => evidence);
  if (evidence.length === 0) return null;
  return (
    <details class="data-cell-evidence">
      <summary>{evidence.length} evidence {evidence.length === 1 ? "action" : "actions"}</summary>
      <ul>{evidence.map((action, index) => <li key={`${index}-${action.href}`}><a href={action.href}>{action.label}</a><span>{action.scopeLabel}</span></li>)}</ul>
    </details>
  );
}

export function DataCell({ cell }: CellProps) {
  if (cell.kind === "thermal") {
    return (
      <div class="data-thermal-values">
        {cell.members.map((member) => (
          <section key={member.groupId} aria-label={`${member.metricLabel}, ${member.methodLabel}`}>
            <strong>{member.metricLabel}</strong>
            <span>{member.methodLabel}</span>
            <TextValues values={member.display} />
            <p>{member.qualification}</p>
            {member.scopeLabels.length > 0 && <p>Evidence scope: {member.scopeLabels.join(" · ")}</p>}
          </section>
        ))}
        <Evidence cell={cell} />
      </div>
    );
  }
  return (
    <div class="data-value">
      <TextValues values={cell.display} />
      {cell.qualification !== undefined && <p>{cell.qualification}</p>}
      {cell.scopeLabels.length > 0 && <p>Evidence scope: {cell.scopeLabels.join(" · ")}</p>}
      <Evidence cell={cell} />
    </div>
  );
}

type Props = Readonly<{
  result: ExplorerSuccess;
  onSort: (field: ExplorerSortableField) => void;
}>;

export function DataTable({ result, onSort }: Props) {
  return (
    <div class="data-table-overflow" role="region" aria-label={`${result.group.label} data table; scroll horizontally to inspect all fields`} tabIndex={0}>
      <Table>
        <Caption>{result.resultCount} materials · {result.group.label}</Caption>
        <TableHead><TableRow><TableHeader scope="col">Material</TableHeader>{result.fields.map((field) => {
          const active = result.state.sort.field === field.key;
          return (
            <TableHeader key={field.key} scope="col" {...(active ? { "aria-sort": result.state.sort.direction === "asc" ? "ascending" : "descending" } : {})}>
              {field.sort !== "none" ? <button type="button" onClick={() => onSort(field.key as ExplorerSortableField)}>{field.label}{active ? `, ${result.state.sort.direction}` : ""}</button> : field.label}
            </TableHeader>
          );
        })}</TableRow></TableHead>
        <TableBody>{result.materials.map((material) => <TableRow key={material.id}><TableHeader scope="row"><a href={material.href}>{material.name}</a><span>{material.family}</span>{material.familyQualifier !== undefined && <small>{material.familyQualifier}</small>}</TableHeader>{material.cells.map((cell) => <TableData key={cell.key}><DataCell cell={cell} /></TableData>)}</TableRow>)}</TableBody>
      </Table>
    </div>
  );
}
