/** @jsxImportSource preact */
import type { ExplorerSuccess } from "../../features/data-explorer/explore.ts";
import { DataCell } from "./DataTable.tsx";

type Props = Readonly<{ result: ExplorerSuccess }>;

export function DataRecords({ result }: Props) {
  const { materials, fields } = result;
  return (
    <section class="data-records" aria-label={`${result.group.label} material records`}>
      {materials.map((material) => (
        <article key={material.id}>
          <h2><a href={material.href}>{material.name}</a></h2>
          <p>{material.family}</p>
          <dl>{fields.map((field, index) => <div key={field.key}><dt>{field.label}</dt><dd><DataCell cell={material.cells[index]!} /></dd></div>)}</dl>
        </article>
      ))}
    </section>
  );
}
