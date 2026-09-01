import ExcelJS from "exceljs";
import type { ExcelData } from "./mapping.ts";

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

// ── Header-row detection ──────────────────────────────────────────────────────
// Files often carry title / preamble lines above the real column-header row
// (e.g. "Aging Report", a date, a blank line). Those lines have few non-empty
// cells and/or repeated values. The real header is the row whose non-empty cells
// are all distinct strings. We pick the earliest row (within the first several)
// that maximizes the count of distinct non-empty cells. Returns the index into
// `rows`; 0 when nothing better is found (clean files are unchanged).
//
// Leading columns that carry extraneous info are intentionally NOT trimmed —
// column positions are preserved so they can be fixed via the indexes in the
// DSP field mapping, and any stray rows are voided at runtime by the
// empty-key (ACCOUNTNUMBER/NAME) filter in the generated provider.
export function findHeaderRow(rows: string[][]): number {
  const scan = Math.min(rows.length, 25);
  let bestIdx = 0;
  let bestScore = 0;
  for (let i = 0; i < scan; i++) {
    const cells = rows[i].map((c) => (c ?? "").trim());
    const nonEmpty = cells.filter((c) => c !== "");
    if (nonEmpty.length < 2) continue; // skip title / single-value preamble rows
    const distinct = new Set(nonEmpty).size;
    // strictly greater → earliest row wins ties (header precedes data rows)
    if (distinct > bestScore) {
      bestScore = distinct;
      bestIdx = i;
    }
  }
  return bestIdx;
}

// Build the sampled ExcelData used for matching/preview (first 10 + up to 90 random)
export function buildExcelData(allRows: string[][], totalRows: number): ExcelData {
  // Guard against sparse-array holes / nullish cells in the header row.
  const headers = Array.from(allRows[0] ?? [], (c) => (c == null ? "" : String(c)));
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

// ── Sheet selection ───────────────────────────────────────────────────────────
// A workbook can hold several sheets; the user picks which one to map. The choice
// is carried as File → sheet name so it survives re-reads (e.g. sample-size changes).
export interface SheetInfo {
  name: string;
  rowCount: number;
  colCount: number;
}

export type SheetSelection = Map<File, string>;

const TEXT_FILE = /\.(csv|txt|tsv)$/i;

// Listing sheets and then reading one would parse the workbook twice, so the
// listing pass caches its parse for parseFile() to reuse. parseFile() drops the
// entry afterwards — keeping workbooks around would double the memory of every
// upload on top of the row arrays the stores already hold.
const workbookCache = new WeakMap<File, ExcelJS.Workbook>();

async function loadWorkbook(file: File): Promise<ExcelJS.Workbook> {
  const cached = workbookCache.get(file);
  if (cached) return cached;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  workbookCache.set(file, workbook);
  return workbook;
}

// Sheets available in an uploaded file. Empty sheets are dropped (nothing to
// map) and text files have no sheets at all, so both yield [] — meaning "don't
// ask, there's only one thing to read".
export async function listSheets(file: File): Promise<SheetInfo[]> {
  if (TEXT_FILE.test(file.name)) return [];
  let workbook: ExcelJS.Workbook;
  try {
    workbook = await loadWorkbook(file);
  } catch {
    return []; // unreadable (e.g. legacy .xls) — let parseFile report it
  }
  return workbook.worksheets
    .filter((ws) => ws.rowCount > 0)
    .map((ws) => ({ name: ws.name, rowCount: ws.rowCount, colCount: ws.columnCount }));
}

export interface ParsedFile {
  data: ExcelData;
  fileName: string;
  // Sheet the rows came from — set only when the workbook held more than one,
  // i.e. when which sheet this is actually tells the user something.
  sheetName?: string;
  // Full header + data rows (header at index 0), used for export.
  allRows: string[][];
}

// Parse an uploaded .csv / .xlsx / .xls into sampled ExcelData + full rows.
// `sheetName` picks a sheet in a multi-sheet workbook; without it the first
// non-empty sheet is used.
export async function parseFile(
  file: File,
  sheetName?: string
): Promise<ParsedFile | null> {
  const fileName = file.name.replace(/\.[^.]+$/, "");
  const isCSV = file.name.toLowerCase().endsWith(".csv");

  let allRows: string[][];
  let usedSheet: string | undefined;
  if (isCSV) {
    const text = await file.text();
    allRows = parseCSV(text);
  } else {
    const workbook = await loadWorkbook(file);
    workbookCache.delete(file);
    const nonEmpty = workbook.worksheets.filter((ws) => ws.rowCount > 0);
    const worksheet =
      (sheetName ? workbook.worksheets.find((ws) => ws.name === sheetName) : undefined) ??
      nonEmpty[0] ??
      workbook.worksheets[0];
    if (!worksheet) return null;
    if (nonEmpty.length > 1) usedSheet = worksheet.name;

    allRows = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const cells = (row.values as ExcelJS.CellValue[]).slice(1); // index 0 is empty in ExcelJS
      // row.values is a SPARSE array when cells are blank; Array.from fills the
      // holes (Array.prototype.map would skip them, leaving undefined entries).
      allRows.push(Array.from({ length: cells.length }, (_, i) => cellToString(cells[i])));
    });
  }

  if (allRows.length < 2) return null;

  // Drop preamble / extra header lines: start at the detected header row.
  const headerIdx = findHeaderRow(allRows);
  const fromHeader = headerIdx > 0 ? allRows.slice(headerIdx) : allRows;

  // Normalize row width to the header for the full export rows too.
  const headers = fromHeader[0];
  const normalized = fromHeader.map((r) => {
    const copy = [...r];
    while (copy.length < headers.length) copy.push("");
    return copy;
  });

  return {
    data: buildExcelData(normalized, normalized.length - 1),
    fileName,
    sheetName: usedSheet,
    allRows: normalized,
  };
}
