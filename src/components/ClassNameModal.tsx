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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ClassNameModalProps {
  defaultName: string;
  onConfirm: (className: string) => void;
  onCancel: () => void;
}

export function ClassNameModal({
  defaultName,
  onConfirm,
  onCancel,
}: ClassNameModalProps) {
  const [value, setValue] = useState(defaultName);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setValue(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""));
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && value.trim()) onConfirm(value.trim());
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-sm bg-white">
        <DialogHeader>
          <DialogTitle>Provider class name</DialogTitle>
          <DialogDescription>
            Enter the C# class name for this provider. Only letters, numbers,
            and underscores are allowed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="classname">Class name</Label>
          <Input
            id="classname"
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            className="font-mono"
            autoFocus
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={!value.trim()}
            onClick={() => onConfirm(value.trim())}
          >
            Generate C#
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
