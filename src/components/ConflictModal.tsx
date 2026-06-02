import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import type { ColumnMapping } from "../lib/mapping";
import type { PendingConflict } from "../store/useMappingStore";

interface ConflictModalProps {
  conflict: PendingConflict;
  mappings: ColumnMapping[];
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConflictModal({
  conflict,
  mappings,
  onConfirm,
  onCancel,
}: ConflictModalProps) {
  const oldRow = mappings[conflict.oldIdx];
  const newRow = mappings[conflict.newIdx];

  const minI = Math.max(0, Math.min(conflict.oldIdx, conflict.newIdx) - 1);
  const maxI = Math.min(
    mappings.length - 1,
    Math.max(conflict.oldIdx, conflict.newIdx) + 1
  );
  const visible = mappings.slice(minI, maxI + 1);
  const visibleOffset = minI;

  const oldSample = (oldRow.sampleVals ?? []).slice(0, 2).join(", ") || "(no sample)";
  const newSample = (newRow.sampleVals ?? []).slice(0, 2).join(", ") || "(no sample)";

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
            Reassign mapping: {conflict.newField}
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          <strong>{conflict.newField}</strong> is currently assigned to{" "}
          <em>{oldRow.excelHeader}</em>. Reassigning it to{" "}
          <em>{newRow.excelHeader}</em> will unmap the old column.
        </p>

        {/* Field mapping preview */}
        <div className="rounded-md bg-muted px-4 py-3 font-mono text-xs leading-7">
          {visible.map((m, i) => {
            const absIdx = visibleOffset + i;
            const isOld = absIdx === conflict.oldIdx;
            const isNew = absIdx === conflict.newIdx;
            let dspLabel = m.mappedTo;
            let colorClass = "text-foreground";
            if (isOld) {
              dspLabel = `${conflict.newField} → UNMAPPED`;
              colorClass = "text-red-600 dark:text-red-400 font-semibold";
            }
            if (isNew) {
              dspLabel = `${m.mappedTo} → ${conflict.newField}`;
              colorClass = "text-green-600 dark:text-green-400 font-semibold";
            }
            return (
              <div key={i} className="flex items-center gap-1">
                <span className="text-muted-foreground w-44 truncate shrink-0">
                  {m.excelHeader}
                </span>
                <span className="text-muted-foreground mx-1">=</span>
                <span className={colorClass}>{dspLabel}</span>
              </div>
            );
          })}
        </div>

        {/* Sample comparison */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: `Old — ${oldRow.excelHeader}`, val: oldSample },
            { label: `New — ${newRow.excelHeader}`, val: newSample },
          ].map((s, i) => (
            <div key={i} className="rounded-md bg-muted p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                {s.label}
              </p>
              <p className="text-xs font-mono break-all">{s.val}</p>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Keep existing
          </Button>
          <Button onClick={onConfirm}>Confirm reassignment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
