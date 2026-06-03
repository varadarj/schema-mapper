import { useRef } from "react";
import ExcelJS from "exceljs";
import { useMappingStore } from "../store/useMappingStore";
import type { ExcelData } from "../lib/mapping";

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    // RichText
    if ("richText" in value)
      return (value as ExcelJS.CellRichTextValue).richText
        .map((r) => r.text)
        .join("");
    // Formula — use result if available
    if ("result" in value) {
      const r = (value as ExcelJS.CellFormulaValue).result;
      return r !== undefined && r !== null ? String(r) : "";
    }
    // Hyperlink
    if ("text" in value)
      return String((value as ExcelJS.CellHyperlinkValue).text ?? "");
    // Date
    if (value instanceof Date) return value.toISOString().split("T")[0];
  }
  return String(value).trim();
}

function parseCSV(text: string): string[][] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  return lines
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const cells: string[] = [];
      let current = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (ch === "," && !inQuotes) {
          cells.push(current.trim());
          current = "";
        } else {
          current += ch;
        }
      }
      cells.push(current.trim());
      return cells;
    });
}

function buildExcelData(allRows: string[][], totalRows: number): ExcelData {
  const headers = allRows[0];
  const dataRows = allRows.slice(1).filter((r) => r.some((c) => c !== ""));

  const padded = dataRows.map((r) => {
    const copy = [...r];
    while (copy.length < headers.length) copy.push("");
    return copy;
  });

  const first10 = padded.slice(0, 10);
  const remaining = padded.slice(10);

  let sample90: string[][] = [];
  if (remaining.length <= 90) {
    sample90 = remaining;
  } else {
    const idxSet = new Set<number>();
    while (idxSet.size < 90)
      idxSet.add(Math.floor(Math.random() * remaining.length));
    sample90 = [...idxSet].map((i) => remaining[i]);
  }

  return {
    headers,
    sampleRows: [...first10, ...sample90],
    totalRows,
  };
}

export function useExcelFile() {
  const inputRef = useRef<HTMLInputElement>(null);
  const { excelData, fileName, setExcelData } = useMappingStore();

  async function handleFile(file: File) {
    const fn = file.name.replace(/\.[^.]+$/, "");
    const isCSV = file.name.toLowerCase().endsWith(".csv");

    if (isCSV) {
      const text = await file.text();
      const allRows = parseCSV(text);
      if (allRows.length < 2) { alert("File appears empty."); return; }
      const data = buildExcelData(allRows, allRows.length - 1);
      setExcelData(data, fn);
    } else {
      const buf = await file.arrayBuffer();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buf);

      const worksheet = workbook.worksheets[0];
      if (!worksheet) {
        alert("File appears empty.");
        return;
      }

      const allRows: string[][] = [];
      worksheet.eachRow({ includeEmpty: false }, (row) => {
        const cells = (row.values as ExcelJS.CellValue[]).slice(1); // index 0 is empty in ExcelJS
        allRows.push(cells.map(cellToString));
      });

      if (allRows.length < 2) {
        alert("File appears empty.");
        return;
      }

      const data = buildExcelData(allRows, allRows.length - 1);
      setExcelData(data, fn);
    }
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