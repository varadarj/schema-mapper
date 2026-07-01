import type { ExcelData } from "./mapping.ts";
import { parseFile } from "./fileParse.ts";

// ── Browser streaming sampler ────────────────────────────────────────────────
// Reads only the header + the first `maxRows` data rows from each file using a
// streaming reader, then cancels — so multi-GB files never get fully loaded into
// the tab. (For .xlsx, falls back to the whole-file parser, which is fine for the
// smaller spreadsheets people actually open in a browser.)

const DEFAULT_SAMPLE_PER_SIDE = 3000;

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function splitCsvLine(line: string, delim: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
    } else if (ch === delim && !q) { cells.push(cur.trim()); cur = ""; } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

interface FileSample {
  fileName: string;
  headers: string[];
  rows: string[][];
}

async function streamSampleFile(file: File, maxRows: number, delimiter = ","): Promise<FileSample> {
  const fileName = file.name.replace(/\.[^.]+$/, "");
  const isText = /\.(csv|txt|tsv)$/i.test(file.name);

  // Non-text (xlsx/xls): use the whole-file parser, then take a sample.
  if (!isText) {
    const parsed = await parseFile(file);
    if (!parsed) return { fileName, headers: [], rows: [] };
    return {
      fileName,
      headers: parsed.data.headers,
      rows: parsed.data.sampleRows.slice(0, maxRows).map((r) => r.map((c) => String(c ?? ""))),
    };
  }

  let headers: string[] | null = null;
  const rows: string[][] = [];
  let leftover = "";
  let stop = false;
  const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
  const take = (line: string) => {
    if (line.length === 0) return;
    const cells = splitCsvLine(line, delimiter);
    if (!headers) {
      headers = cells.map((h, i) => (i === 0 ? stripBom(h) : h));
    } else if (rows.length < maxRows) {
      const r = cells.slice(0, headers.length);
      while (r.length < headers.length) r.push("");
      rows.push(r);
    }
  };
  try {
    while (!stop) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = leftover + value;
      const lines = text.split(/\r\n|\r|\n/);
      leftover = lines.pop() ?? ""; // last element is an incomplete line
      for (const line of lines) {
        take(line);
        if (headers && rows.length >= maxRows) { stop = true; break; }
      }
    }
    if (!stop && leftover) take(leftover);
  } finally {
    await reader.cancel().catch(() => {});
  }
  return { fileName, headers: headers ?? [], rows };
}

export interface SourceSampleResult {
  data: ExcelData;
  fileNames: string[];
  rows: string[][]; // header + sampled rows (for export)
  warnings: string[];
}

export interface TargetSampleResult {
  data: ExcelData;
  fileNames: string[];
  rows: string[][];
  colFiles: Map<string, string[]>; // target column → file name(s) it appeared in
}

// SOURCE files share one schema (row-split) → merge into one dataset.
export async function sampleSourceFiles(
  files: File[],
  total = DEFAULT_SAMPLE_PER_SIDE
): Promise<SourceSampleResult> {
  const per = Math.ceil(total / Math.max(1, files.length));
  const samples: FileSample[] = [];
  for (const f of files) samples.push(await streamSampleFile(f, per));

  const warnings: string[] = [];
  let headers: string[] = [];
  const rows: string[][] = [];
  for (const s of samples) {
    if (!headers.length) headers = s.headers;
    else if (s.headers.join("") !== headers.join(""))
      warnings.push(`"${s.fileName}" has a different header — using the first file's columns.`);
    rows.push(...s.rows);
  }
  return {
    data: { headers, sampleRows: rows, totalRows: rows.length },
    fileNames: samples.map((s) => s.fileName),
    rows: [headers, ...rows],
    warnings,
  };
}

// TARGET files may have different schemas → combine into one UNION schema.
export async function sampleTargetFiles(
  files: File[],
  total = DEFAULT_SAMPLE_PER_SIDE
): Promise<TargetSampleResult> {
  const per = Math.ceil(total / Math.max(1, files.length));
  const samples: FileSample[] = [];
  for (const f of files) samples.push(await streamSampleFile(f, per));

  const unionHeaders: string[] = [];
  const idx = new Map<string, number>();
  const colFilesSet = new Map<string, Set<string>>();
  const rows: string[][] = [];
  for (const s of samples) {
    const localToUnion = s.headers.map((h) => {
      if (!idx.has(h)) {
        idx.set(h, unionHeaders.length);
        unionHeaders.push(h);
      }
      if (!colFilesSet.has(h)) colFilesSet.set(h, new Set());
      colFilesSet.get(h)!.add(s.fileName);
      return idx.get(h)!;
    });
    for (const row of s.rows) {
      const u = new Array(unionHeaders.length).fill("");
      row.forEach((v, li) => {
        u[localToUnion[li]] = v;
      });
      rows.push(u);
    }
  }
  for (const r of rows) while (r.length < unionHeaders.length) r.push("");
  const colFiles = new Map<string, string[]>();
  for (const [h, set] of colFilesSet) colFiles.set(h, [...set]);
  return {
    data: { headers: unionHeaders, sampleRows: rows, totalRows: rows.length },
    fileNames: samples.map((s) => s.fileName),
    rows: [unionHeaders, ...rows],
    colFiles,
  };
}
