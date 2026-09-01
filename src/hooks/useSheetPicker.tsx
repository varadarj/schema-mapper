import { useCallback, useState } from "react";
import { listSheets } from "../lib/fileParse";
import type { SheetSelection } from "../lib/fileParse";
import { SheetPickerModal } from "../components/SheetPickerModal";
import type { SheetPickerItem } from "../components/SheetPickerModal";

interface PickRequest {
  items: SheetPickerItem[];
  resolve: (choices: string[] | null) => void;
}

// Asks the user which sheet to read from each freshly-picked multi-sheet workbook.
// `chooseSheets` resolves to the File → sheet map to hand to the parser (empty when
// nothing needed asking), or null if the user cancelled the upload. `preparing` is
// true while the workbooks are being opened to list their sheets. Render
// `sheetPicker` somewhere in the page for the dialog to appear.
export function useSheetPicker() {
  const [request, setRequest] = useState<PickRequest | null>(null);
  const [preparing, setPreparing] = useState(false);

  const chooseSheets = useCallback(
    async (files: File[]): Promise<SheetSelection | null> => {
      const items: SheetPickerItem[] = [];
      setPreparing(true);
      try {
        for (const file of files) {
          const sheets = await listSheets(file);
          if (sheets.length > 1) items.push({ file, sheets });
        }
      } finally {
        setPreparing(false);
      }
      if (!items.length) return new Map();

      const choices = await new Promise<string[] | null>((resolve) =>
        setRequest({ items, resolve })
      );
      setRequest(null);
      if (!choices) return null;
      return new Map(items.map((it, i) => [it.file, choices[i]]));
    },
    []
  );

  const sheetPicker = request ? (
    <SheetPickerModal
      items={request.items}
      onConfirm={request.resolve}
      onCancel={() => request.resolve(null)}
    />
  ) : null;

  return { chooseSheets, sheetPicker, preparing };
}
