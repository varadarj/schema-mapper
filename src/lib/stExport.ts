import ExcelJS from "exceljs";
import type { ColumnMapping } from "./mapping";

// ── Download helpers for the source ↔ target field mapping ───────────────────

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Quote a CSV field if it contains a comma, quote, or newline.
function csvCell(value: string): string {
  const v = value ?? "";
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// Excel sheet names: max 31 chars, cannot contain : \ / ? * [ ]
function sanitizeSheetName(name: string, fallback: string): string {
  const cleaned = (name || fallback).replace(/[:\\/?*[\]]/g, " ").trim();
  return (cleaned || fallback).slice(0, 31);
}

function altsText(m: ColumnMapping): string {
  return (m.alternatives ?? [])
    .map((a) => `${a.target} (${(a.score * 100).toFixed(0)}%, sem ${(a.name * 100).toFixed(0)}%)`)
    .join("; ");
}

// Mapping rows shared by the CSV and the workbook sheet. `fileOf` (optional)
// adds a "Target File(s)" column showing which target file each column came from.
function mappingRows(
  mappings: ColumnMapping[],
  fileOf?: (target: string) => string | undefined
): string[][] {
  const header = ["Source Column", "Target Column"];
  if (fileOf) header.push("Target File(s)");
  header.push("Confidence", "Score", "Other Potential Mappings");
  return [
    header,
    ...mappings.map((m) => {
      const mapped = m.mappedTo !== "IGNORE";
      const row = [m.excelHeader, mapped ? m.mappedTo : ""];
      if (fileOf) row.push(mapped ? fileOf(m.mappedTo) ?? "" : "");
      row.push(mapped ? m.confidence : "", mapped ? `${(m.score * 100).toFixed(0)}%` : "", altsText(m));
      return row;
    }),
  ];
}

// File 1 — the mapping CSV (source → target, confidence, score, and the other
// near-tie candidates), UTF-8 with BOM + CRLF so Excel opens it cleanly.
export function downloadMappingCsv(
  mappings: ColumnMapping[],
  baseName: string,
  fileOf?: (target: string) => string | undefined
) {
  const body = mappingRows(mappings, fileOf).map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + body], { type: "text/csv;charset=utf-8;" });
  triggerDownload(blob, `${baseName}.csv`);
}

function writeSheet(
  ws: ExcelJS.Worksheet,
  rows: string[][]
) {
  rows.forEach((row) => ws.addRow(row));
  if (rows.length > 0) ws.getRow(1).font = { bold: true };
}

// File 2 — a workbook with three sheets:
//   1) the full source file (sheet named after the source file)
//   2) the full target file (sheet named after the target file)
//   3) "schema mapping" — the source→target column pairs
export async function downloadMappingWorkbook(opts: {
  sourceRows: string[][];
  targetRows: string[][];
  sourceName: string;
  targetName: string;
  mappings: ColumnMapping[];
  fileName: string;
  fileOf?: (target: string) => string | undefined;
}) {
  const { sourceRows, targetRows, sourceName, targetName, mappings, fileName, fileOf } = opts;
  const wb = new ExcelJS.Workbook();

  const srcSheetName = sanitizeSheetName(sourceName, "Source");
  let tgtSheetName = sanitizeSheetName(targetName, "Target");
  // Excel disallows two sheets with the same (case-insensitive) name.
  if (tgtSheetName.toLowerCase() === srcSheetName.toLowerCase()) {
    tgtSheetName = sanitizeSheetName(tgtSheetName + " (target)", "Target");
  }

  writeSheet(wb.addWorksheet(srcSheetName), sourceRows);
  writeSheet(wb.addWorksheet(tgtSheetName), targetRows);
  writeSheet(wb.addWorksheet("Schema Mapping"), mappingRows(mappings, fileOf));

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  triggerDownload(blob, `${fileName}.xlsx`);
}
