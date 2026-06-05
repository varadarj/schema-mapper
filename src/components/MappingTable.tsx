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
}

export function MappingTable({
  mappings,
  allOptions,
  onMappingChange,
}: MappingTableProps) {
  return (
    <div className="rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">#</TableHead>
            <TableHead>Excel column</TableHead>
            <TableHead className="w-40">Sample values</TableHead>
            <TableHead className="w-14">Score</TableHead>
            <TableHead className="w-28">Confidence</TableHead>
            <TableHead className="w-52">Mapped to</TableHead>
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
                <TableCell>
                  <span className="font-mono text-xs">{m.excelHeader}</span>
                  {tag && (
                    <span className="text-[10px] text-muted-foreground ml-1.5">
                      {tag}
                    </span>
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
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
