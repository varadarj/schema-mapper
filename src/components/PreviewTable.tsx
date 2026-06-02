import type { PreviewData } from "../lib/mapping";

interface SideProps {
  title: string;
  headers: string[];
  rows: string[][];
}

function PreviewSide({ title, headers, rows }: SideProps) {
  return (
    <div className="flex-1 min-w-0 border rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-muted border-b text-xs font-medium text-muted-foreground">
        {title}
      </div>
      <div className="overflow-auto max-h-56">
        <table className="text-xs border-collapse w-max min-w-full">
          <thead className="bg-gray-300 sticky top-0">
            <tr>
              {headers.map((h, i) => (
                <th
                  key={i}
                  className="px-3 py-1.5 text-left font-medium text-muted-foreground whitespace-nowrap border-b bg-muted/50"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className="hover:bg-muted/30">
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className="px-3 py-1.5 font-mono whitespace-nowrap border-b border-border/50 max-w-[140px] truncate"
                    title={cell}
                  >
                    {cell || "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface PreviewTableProps {
  preview: PreviewData;
}

export function PreviewTable({ preview }: PreviewTableProps) {
  const { origHeaders, dspHeaders, rows } = preview;
  if (!rows.length) return null;

  return (
    <div className="flex gap-3 overflow-hidden">
      <PreviewSide
        title="Original (Excel)"
        headers={origHeaders}
        rows={rows.map((r) => r.orig)}
      />
      <PreviewSide
        title="Remapped (FixedRawData)"
        headers={dspHeaders}
        rows={rows.map((r) => r.remap)}
      />
    </div>
  );
}
