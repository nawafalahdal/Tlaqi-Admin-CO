import type { ReactNode } from "react";
import { Card } from "./ui";

export type DataColumn = {
  key: string;
  label: string;
  /** العمود الأساسي: يظهر كعنوان البطاقة على الجوال بدل سطر "تسمية: قيمة" */
  primary?: boolean;
};

export type DataRow = { id: string; cells: Record<string, ReactNode> };

/** جدول بيانات موجّه للجوال أولاً: على الشاشات الصغيرة يتحوّل كل سطر إلى
 *  بطاقة مستقلة (بلا تمرير أفقي ولا نص مقصوص)، ومن sm وأعلى يصبح جدولاً. */
export function DataTable({
  columns,
  rows,
  emptyLabel,
}: {
  columns: DataColumn[];
  rows: DataRow[];
  emptyLabel: string;
}) {
  if (rows.length === 0) {
    return <Card className="p-8 text-center text-sm text-black/40">{emptyLabel}</Card>;
  }

  const primary = columns.find((c) => c.primary) ?? columns[0];
  const rest = columns.filter((c) => c.key !== primary.key);

  return (
    <>
      {/* الجوال */}
      <div className="flex flex-col gap-3 sm:hidden">
        {rows.map((row) => (
          <Card key={row.id} className="p-4">
            <p className="text-sm font-bold leading-relaxed">{row.cells[primary.key]}</p>
            <dl className="mt-3 flex flex-col gap-2">
              {rest.map((c) => (
                <div key={c.key} className="flex items-start justify-between gap-3">
                  <dt className="shrink-0 text-xs text-black/40">{c.label}</dt>
                  <dd className="min-w-0 text-end text-sm text-black/70">{row.cells[c.key]}</dd>
                </div>
              ))}
            </dl>
          </Card>
        ))}
      </div>

      {/* سطح المكتب */}
      <Card className="hidden overflow-hidden sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/5 text-start text-xs text-black/40">
              {columns.map((c) => (
                <th key={c.key} className="px-4 py-3 text-start font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-black/5 last:border-0">
                {columns.map((c) => (
                  <td key={c.key} className="px-4 py-3 align-middle">
                    {row.cells[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
