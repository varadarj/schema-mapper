import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfidenceBadge } from "./ConfidenceBadge";
import type { ColumnMapping } from "../lib/mapping";
import { cn } from "@/lib/utils";

const METHOD_TAG: Record<string, string> = {
  pattern: "[aging]",
  address: "[addr]",
  heuristic: "[key]",
  ai: "[ai]",
  data: "[data]",
  fuzzy: "[fuzzy]",
};

interface MappingTableProps {
  mappings: ColumnMapping[];
  allOptions: string[];
  onMappingChange: (rowIdx: number, newField: string) => void;
  // Optional: which target file a target column came from (only set when there
  // are multiple target files).
  targetFileOf?: (target: string) => string | undefined;
}

export function MappingTable({
  mappings,
  allOptions,
  onMappingChange,
  targetFileOf,
}: MappingTableProps) {
  return (
    <div className="rounded-lg border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">#</TableHead>
            <TableHead className="w-36">Excel column</TableHead>
            <TableHead className="w-28">Sample values</TableHead>
            <TableHead className="w-12">Score</TableHead>
            <TableHead className="w-24">Confidence</TableHead>
            <TableHead className="w-44">Mapped to</TableHead>
            <TableHead className="w-72">Other potential mappings</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {mappings.map((m, i) => {
            const isRequiredMissing = m.required && m.mappedTo === "IGNORE";
            const sample = m.sampleVals.slice(0, 3).join(", ") || "—";
            const scoreStr =
              m.mappedTo === "IGNORE" ? "—" : `${(m.score * 100).toFixed(0)}%`;
            const tag = METHOD_TAG[m.method] ?? "";

            return (
              <TableRow
                key={i}
                className={cn(isRequiredMissing && "bg-red-50 dark:bg-red-950/20")}
              >
                <TableCell className="text-muted-foreground text-xs">
                  {m.excelIndex}
                </TableCell>
                <TableCell className="align-top">
                  <span
                    className="font-mono text-xs block truncate max-w-[140px]"
                    title={m.excelHeader}
                  >
                    {m.excelHeader}
                  </span>
                  {tag && (
                    <span className="text-[10px] text-muted-foreground">{tag}</span>
                  )}
                  {m.reason && (
                    <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                      {m.reason}
                    </div>
                  )}
                </TableCell>
                <TableCell
                  className="text-xs text-muted-foreground truncate max-w-[160px]"
                  title={sample}
                >
                  {sample}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {scoreStr}
                </TableCell>
                <TableCell>
                  <ConfidenceBadge confidence={m.confidence} />
                </TableCell>
                <TableCell>
                  <Select
                    value={m.mappedTo}
                    onValueChange={(val) => onMappingChange(i, val)}
                  >
                    <SelectTrigger className="h-8 text-xs bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-white">
                      {allOptions.map((o) => (
                        <SelectItem key={o} value={o} className="text-xs">
                          {o}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {m.mappedTo !== "IGNORE" && targetFileOf?.(m.mappedTo) && (
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      in {targetFileOf(m.mappedTo)}
                    </div>
                  )}
                </TableCell>
                <TableCell className="align-top">
                  {m.alternatives && m.alternatives.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      {m.alternatives.map((a) => (
                        <button
                          key={a.target}
                          type="button"
                          onClick={() => onMappingChange(i, a.target)}
                          title={`Use ${a.target} — score ${(a.score * 100).toFixed(0)}%, name ${(a.name * 100).toFixed(0)}%`}
                          className="text-left text-[11px] px-1.5 py-0.5 rounded bg-muted hover:bg-muted-foreground/20 transition-colors whitespace-normal break-words leading-tight"
                        >
                          <span className="font-mono">{a.target}</span>{" "}
                          <span className="text-muted-foreground">
                            {(a.score * 100).toFixed(0)}% · sem {(a.name * 100).toFixed(0)}%
                            {targetFileOf?.(a.target) ? ` · ${targetFileOf(a.target)}` : ""}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
