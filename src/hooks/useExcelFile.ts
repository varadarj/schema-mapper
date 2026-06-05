import { useRef } from "react";
import { useMappingStore } from "../store/useMappingStore";
import { parseFile } from "../lib/fileParse";

export function useExcelFile() {
  const inputRef = useRef<HTMLInputElement>(null);
  const { excelData, fileName, setExcelData } = useMappingStore();

  async function handleFile(file: File) {
    const parsed = await parseFile(file);
    if (!parsed) {
      alert("File appears empty.");
      return;
    }
    setExcelData(parsed.data, parsed.fileName);
  }

  function openPicker() {
    inputRef.current?.click();
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }

  return { inputRef, onChange, openPicker, loaded: !!excelData, fileName };
}