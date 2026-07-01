import { useRef } from "react";
import { useMappingStore } from "../store/useMappingStore";
import { parseFile } from "../lib/fileParse";
import type { ParsedFile } from "../lib/fileParse";

export function useExcelFile() {
  const inputRef = useRef<HTMLInputElement>(null);
  const { files, addFiles } = useMappingStore();

  async function handleFiles(fileList: File[]) {
    const parsed = await Promise.all(fileList.map((f) => parseFile(f)));
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

  return { inputRef, onChange, openPicker, loaded: files.length > 0, count: files.length };
}
