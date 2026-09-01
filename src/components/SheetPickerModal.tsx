import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SheetInfo } from "../lib/fileParse";

export interface SheetPickerItem {
  file: File;
  sheets: SheetInfo[];
}

interface SheetPickerModalProps {
  items: SheetPickerItem[];
  // One chosen sheet name per item, aligned by index.
  onConfirm: (choices: string[]) => void;
  onCancel: () => void;
}

export function SheetPickerModal({ items, onConfirm, onCancel }: SheetPickerModalProps) {
  const [choices, setChoices] = useState<string[]>(() =>
    items.map((it) => it.sheets[0].name)
  );

  const setChoice = (i: number, name: string) =>
    setChoices((c) => c.map((v, j) => (j === i ? name : v)));

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-md bg-white">
        <DialogHeader>
          <DialogTitle>
            {items.length === 1 ? "Choose a sheet" : "Choose a sheet per file"}
          </DialogTitle>
          <DialogDescription>
            {items.length === 1
              ? "This workbook has more than one sheet. Pick the one to map."
              : "These workbooks have more than one sheet. Pick the one to map in each."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {items.map((it, i) => {
            const chosen = it.sheets.find((s) => s.name === choices[i]);
            return (
              <div key={it.file.name + i} className="space-y-2">
                <Label
                  htmlFor={`sheet-${i}`}
                  className="text-xs uppercase tracking-widest text-muted-foreground"
                >
                  {it.file.name}
                </Label>
                <Select value={choices[i]} onValueChange={(v) => setChoice(i, v)}>
                  <SelectTrigger id={`sheet-${i}`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {it.sheets.map((s) => (
                      <SelectItem key={s.name} value={s.name}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {chosen && (
                  <p className="text-xs text-muted-foreground">
                    {chosen.rowCount.toLocaleString()} rows ·{" "}
                    {chosen.colCount.toLocaleString()} columns
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(choices)}>
            {items.length === 1 ? "Use this sheet" : "Use these sheets"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
