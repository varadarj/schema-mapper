import ExcelJS from "exceljs";
import type { ExcelData } from "./mapping";

// ── Cell coercion (shared by all file uploads) ───────────────────────────────
export function cellToString(value: ExcelJS.CellValue): string {
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

export function parseCSV(text: string): string[][] {
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

// Build the sampled ExcelData used for matching/preview (first 10 + up to 90 random)
export function buildExcelData(allRows: string[][], totalRows: number): ExcelData {
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

export interface ParsedFile {
  data: ExcelData;
  fileName: string;
  // Full header + data rows (header at index 0), used for export.
  allRows: string[][];
}

// Parse an uploaded .csv / .xlsx / .xls into sampled ExcelData + full rows.
export async function parseFile(file: File): Promise<ParsedFile | null> {
  const fileName = file.name.replace(/\.[^.]+$/, "");
  const isCSV = file.name.toLowerCase().endsWith(".csv");

  let allRows: string[][];
  if (isCSV) {
    const text = await file.text();
    allRows = parseCSV(text);
  } else {
    const buf = await file.arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buf);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) return null;

    allRows = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const cells = (row.values as ExcelJS.CellValue[]).slice(1); // index 0 is empty in ExcelJS
      allRows.push(cells.map(cellToString));
    });
  }

  if (allRows.length < 2) return null;

  // Normalize row width to the header for the full export rows too.
  const headers = allRows[0];
  const normalized = allRows.map((r) => {
    const copy = [...r];
    while (copy.length < headers.length) copy.push("");
    return copy;
  });

  return {
    data: buildExcelData(normalized, normalized.length - 1),
    fileName,
    allRows: normalized,
  };
}
