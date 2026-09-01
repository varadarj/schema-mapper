import { useRef, useState } from "react";
import { useMappingStore } from "../store/useMappingStore";
import { parseFile } from "../lib/fileParse";
import type { ParsedFile } from "../lib/fileParse";
import { useSheetPicker } from "./useSheetPicker";

export function useExcelFile() {
  const inputRef = useRef<HTMLInputElement>(null);
  const { files, addFiles } = useMappingStore();
  const { chooseSheets, sheetPicker, preparing } = useSheetPicker();
  const [parsing, setParsing] = useState(false);

  async function handleFiles(fileList: File[]) {
    const sheets = await chooseSheets(fileList);
    if (!sheets) return; // upload cancelled at the sheet picker
    setParsing(true);
    let parsed: (ParsedFile | null)[];
    try {
      parsed = await Promise.all(fileList.map((f) => parseFile(f, sheets.get(f))));
    } finally {
      setParsing(false);
    }
    const ok = parsed.filter((p): p is ParsedFile => p !== null);
    const emptyCount = parsed.length - ok.length;
    if (emptyCount > 0) {
      alert(
        emptyCount === parsed.length
          ? "File(s) appear empty."
          : `${emptyCount} file(s) appeared empty and were skipped.`
      );
    }
    if (ok.length) addFiles(ok);
  }

  function openPicker() {
    inputRef.current?.click();
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length) handleFiles(picked);
    e.target.value = "";
  }

  return {
    inputRef,
    onChange,
    openPicker,
    sheetPicker,
    loading: preparing || parsing,
    loaded: files.length > 0,
    count: files.length,
  };
}
