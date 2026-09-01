/**
 * st-map — Source ↔ Target schema mapping for large, sharded CSV files.
 *
 * Streams the files (never loads a whole file into memory). During the scan it
 * reads ONLY the key column from each row and fully parses a row only when its
 * key matches a source entity — so wide files (100+ columns) scan fast.
 *
 * Matching: rows are joined on a key you specify, then each source column is
 * mapped to the target column the SAME entities agree with (per-entity
 * agreement). Value-set overlap is a secondary tiebreaker. Run once per target.
 *
 * Run with --help for usage.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { buildConfirmedMappings, canonicalValue, type MatchRow } from "../src/lib/entityMatch.ts";

const USAGE = `st-map - Source <-> Target schema mapping for large, sharded CSV files.

Usage:
  node scripts/st-map.ts --source <dir|glob|list> --target <file|dir|glob> --key srcCol=tgtCol [options]

Required:
  --source <spec>      source CSV: file, directory, glob, or comma-separated list
  --target <spec>      target CSV: file, directory, glob, or comma-separated list
  --key src=tgt        join key as sourceColumn=targetColumn (e.g. entityId=ECID)

Options:
  --out <file>         output mapping CSV (default ./schema-mapping.csv)
  --matches <n>        stop once this many entities are joined (default 300; a few hundred is plenty)
  --stall <n>          stop if this many rows are scanned with no new match (default 1000000)
  --maxEntities <n>    source keys to index (default 200000)
  --scan <n>           hard cap on rows read per side (default 20000000)
  --delimiter <char>   field delimiter (default ",")
  -h, --help           print this help and exit

Example:
  node scripts/st-map.ts --source "C:/data/part-*" --target "C:/data/location.csv" --key entityId=ECID --out map_location.csv

After writing --out, every map_*.csv sitting beside it is joined into
schema-mapping-combined.csv (one row per source column, one column per target file).`;

// Short flags, mapped onto their long names.
const SHORT_FLAGS: Record<string, string> = { h: "help" };

const isFlag = (s: string) => s.startsWith("--") || /^-[a-zA-Z]$/.test(s);

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!isFlag(a)) continue;
    const name = a.startsWith("--") ? a.slice(2) : SHORT_FLAGS[a.slice(1)] ?? a.slice(1);
    const next = argv[i + 1];
    if (next !== undefined && !isFlag(next)) {
      out[name] = next;
      i++;
    } else out[name] = "true";
  }
  return out;
}

function resolveFiles(spec: string): string[] {
  if (/[*?[\]]/.test(spec))
    return (fs.globSync(spec) as string[]).filter((f) => fs.statSync(f).isFile()).sort();
  if (spec.includes(",")) return spec.split(",").map((s) => s.trim()).filter(Boolean);
  if (fs.existsSync(spec) && fs.statSync(spec).isDirectory())
    return fs.readdirSync(spec).filter((f) => /\.(csv|txt|tsv)$/i.test(f)).map((f) => path.join(spec, f)).sort();
  return [spec];
}

const stripBom = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

function clean(s: string): string {
  let t = s.trim();
  if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') t = t.slice(1, -1).replace(/""/g, '"');
  return t;
}

// Extract ONLY the n-th field, stopping as soon as it's found (fast for early keys).
function nthField(line: string, delim: string, n: number): string {
  let field = 0;
  let start = 0;
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') i++;
      else inQ = !inQ;
    } else if (c === delim && !inQ) {
      if (field === n) return clean(line.slice(start, i));
      field++;
      start = i + 1;
    }
  }
  return field === n ? clean(line.slice(start)) : "";
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

// Stream records one physical line at a time. Each record exposes lazy `nth(i)`
// (cheap key read — stops at the key column) and `full()` (parse all columns), so
// callers only pay for what they use. We do NOT reassemble quoted fields that
// span multiple lines: that would force a full-line scan of every row (slow on
// wide, quote-heavy files). The key column is read positionally, so as long as
// the key is before any multi-line field (e.g. ECID is column 0) this is exact;
// a stray continuation line just yields a non-matching key and is skipped.
async function streamRecords(
  fp: string,
  delim: string,
  onRec: (r: { index: number; nth: (i: number) => string; full: () => string[] }) => boolean | void
): Promise<void> {
  let index = 0;
  const stream = fs.createReadStream(fp, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (line.length === 0) continue;
      const cur = line;
      const res = onRec({ index, nth: (i) => nthField(cur, delim, i), full: () => splitCsvLine(cur, delim) });
      index++;
      if (res === false) break;
    }
  } finally {
    rl.close();
    stream.destroy();
  }
}

const SET_CAP = 60000;
const COMBINED_NAME = "schema-mapping-combined.csv";

// Parse a (small) CSV we wrote earlier — handles quoted fields + BOM.
function parseCsvText(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\r") { /* skip */ }
    else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

// Join every map_*.csv in the folder into one combined mapping: a row per source
// column, a column per target file showing what it mapped to there.
function writeCombined(outDir: string): { dest: string; files: string[] } | null {
  const files = fs
    .readdirSync(outDir)
    .filter((f) => /^map_.*\.csv$/i.test(f) && f.toLowerCase() !== COMBINED_NAME)
    .sort();
  if (!files.length) return null;

  const order: string[] = [];
  const seen = new Set<string>();
  const perFile = files.map((f) => {
    const rows = parseCsvText(fs.readFileSync(path.join(outDir, f), "utf8"));
    const map = new Map<string, string>();
    for (const r of rows.slice(1)) {
      const src = (r[0] ?? "").trim();
      if (!src) continue; // skip NO_SOURCE_MATCH (target-only) rows
      const tgt = (r[1] ?? "").trim();
      map.set(src, tgt === "IGNORE" ? "" : tgt);
      if (!seen.has(src)) { seen.add(src); order.push(src); }
    }
    return { label: f.replace(/\.csv$/i, "").replace(/^map_/i, ""), map };
  });

  const header = ["Source Column", ...perFile.map((p) => p.label)];
  const body = order.map((src) => [src, ...perFile.map((p) => p.map.get(src) ?? "")]);
  const csvCell = (v: string) => (/[",\r\n]/.test(v ?? "") ? `"${(v ?? "").replace(/"/g, '""')}"` : v ?? "");
  const dest = path.join(outDir, COMBINED_NAME);
  fs.writeFileSync(dest, "﻿" + [header, ...body].map((r) => r.map(csvCell).join(",")).join("\r\n"), "utf8");
  return { dest, files };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help === "true") {
    console.log(USAGE);
    return;
  }

  const missing = (["source", "target", "key"] as const).filter((k) => !args[k]);
  if (missing.length) {
    console.error(`Missing required argument(s): ${missing.map((k) => `--${k}`).join(", ")}\n`);
    console.error(USAGE);
    process.exit(1);
  }

  const delimiter = args.delimiter ?? ",";
  const maxEntities = Math.max(10, parseInt(args.maxEntities ?? "200000", 10) || 200000);
  const maxScan = Math.max(1000, parseInt(args.scan ?? "20000000", 10) || 20000000);
  const matchTarget = Math.max(5, parseInt(args.matches ?? "300", 10) || 300);
  const stall = Math.max(10000, parseInt(args.stall ?? "1000000", 10) || 1000000);
  const outPath = args.out ?? "./schema-mapping.csv";

  const eq = args.key.indexOf("=");
  if (eq < 0) throw new Error(`--key must be "sourceCol=targetCol", got: ${args.key}`);
  const sKey = args.key.slice(0, eq).trim();
  const tKey = args.key.slice(eq + 1).trim();

  const sourceFiles = resolveFiles(args.source);
  const targetFiles = resolveFiles(args.target);
  if (!sourceFiles.length) throw new Error(`No source files matched: ${args.source}`);
  if (!targetFiles.length) throw new Error(`No target files matched: ${args.target}`);

  console.log(`\nSource (${sourceFiles.length} file(s)) · Target (${targetFiles.length} file(s)) · key ${sKey} = ${tKey}\n`);

  // ── SOURCE pass: index up to maxEntities rows by key (full-parse kept rows) ──
  let sourceHeaders: string[] = [];
  let sKeyIdx = -1;
  let sourceExamples: string[][] = [];
  const sourceByKey = new Map<string, string[]>();
  let sScanned = 0;
  for (const f of sourceFiles) {
    if (sourceByKey.size >= maxEntities || sScanned >= maxScan) break;
    await streamRecords(f, delimiter, (r) => {
      if (r.index === 0) {
        if (!sourceHeaders.length) {
          sourceHeaders = r.full().map((h, i) => (i === 0 ? stripBom(h) : h));
          sKeyIdx = sourceHeaders.indexOf(sKey);
          sourceExamples = sourceHeaders.map(() => []);
        }
        return;
      }
      if (sKeyIdx < 0) return false;
      sScanned++;
      const k = canonicalValue(r.nth(sKeyIdx));
      if (k !== "" && !sourceByKey.has(k)) {
        const cells = r.full();
        const row = cells.slice(0, sourceHeaders.length);
        while (row.length < sourceHeaders.length) row.push("");
        sourceByKey.set(k, row);
        for (let ci = 0; ci < sourceHeaders.length; ci++) {
          const v = (row[ci] ?? "").trim();
          if (v !== "" && sourceExamples[ci].length < 5) sourceExamples[ci].push(v);
        }
      }
      if (sScanned % 100000 === 0)
        process.stdout.write(`\r  source: ${sScanned.toLocaleString()} rows, ${sourceByKey.size.toLocaleString()} keys`);
      if (sourceByKey.size >= maxEntities || sScanned >= maxScan) return false;
    });
  }
  if (sKeyIdx < 0) throw new Error(`Source key "${sKey}" not found. Headers: ${sourceHeaders.join(", ")}`);
  process.stdout.write(`\r  source: indexed ${sourceByKey.size.toLocaleString()} entities from ${sScanned.toLocaleString()} rows.${" ".repeat(20)}\n`);

  // ── TARGET pass: read only the key per row; full-parse only on a match ──
  const targetHeaders: string[] = [];
  const unionIndex = new Map<string, number>();
  const targetColFiles = new Map<string, Set<string>>();
  const aligned: Array<[string[], string[]]> = [];
  let tScanned = 0;
  let tKeyIdxUnion = -1;
  let lastMatchRow = 0;
  let stopReason = "scan complete";
  let enough = false;

  for (const f of targetFiles) {
    if (enough || tScanned >= maxScan) break;
    const fileName = path.basename(f);
    let localToUnion: number[] = [];
    let tKeyLocal = -1;
    await streamRecords(f, delimiter, (r) => {
      if (r.index === 0) {
        const local = r.full().map((h, i) => (i === 0 ? stripBom(h) : h));
        localToUnion = local.map((h) => {
          if (!unionIndex.has(h)) {
            unionIndex.set(h, targetHeaders.length);
            targetHeaders.push(h);
          }
          if (!targetColFiles.has(h)) targetColFiles.set(h, new Set());
          targetColFiles.get(h)!.add(fileName);
          return unionIndex.get(h)!;
        });
        tKeyLocal = local.indexOf(tKey);
        if (tKeyLocal >= 0) tKeyIdxUnion = unionIndex.get(tKey)!;
        return;
      }
      if (tKeyLocal < 0) return false; // this file lacks the key column
      tScanned++;
      const k = canonicalValue(r.nth(tKeyLocal));
      if (k !== "" && aligned.length < maxEntities) {
        const srow = sourceByKey.get(k);
        if (srow) {
          const cells = r.full();
          const trow = new Array(targetHeaders.length).fill("");
          cells.forEach((v, li) => {
            const ui = localToUnion[li];
            if (ui !== undefined) trow[ui] = v ?? "";
          });
          aligned.push([srow, trow]);
          lastMatchRow = tScanned;
        }
      }
      if (tScanned % 50000 === 0)
        process.stdout.write(`\r  target: ${tScanned.toLocaleString()} rows, ${aligned.length.toLocaleString()} matched`);

      if (aligned.length >= matchTarget) { stopReason = `reached ${matchTarget} matches`; enough = true; return false; }
      if (tScanned - lastMatchRow >= stall) { stopReason = `no new match in ${stall.toLocaleString()} rows (matches dried up)`; enough = true; return false; }
      if (tScanned >= maxScan) { stopReason = `hit scan limit (${maxScan.toLocaleString()} rows)`; enough = true; return false; }
    });
  }
  if (tKeyIdxUnion < 0) throw new Error(`Target key "${tKey}" not found. Headers: ${targetHeaders.join(", ")}`);
  process.stdout.write(`\r  target: scanned ${tScanned.toLocaleString()} rows, ${aligned.length.toLocaleString()} entities joined — stopped: ${stopReason}.${" ".repeat(20)}\n`);

  if (aligned.length < 5)
    console.warn(`\n!  Only ${aligned.length} entities joined — values in ${sKey}/${tKey} barely overlap. Likely the wrong key (different ID systems) or the matching rows are deeper than --scan. Try another --key.\n`);

  // ── Value-set overlap from the joined entities (secondary signal) ──
  const sourceSets = sourceHeaders.map(() => new Set<string>());
  const targetSets = targetHeaders.map(() => new Set<string>());
  for (const [srow, trow] of aligned) {
    for (let ci = 0; ci < sourceHeaders.length; ci++) {
      const cv = canonicalValue(srow[ci] ?? "");
      if (cv !== "" && sourceSets[ci].size < SET_CAP) sourceSets[ci].add(cv);
    }
    for (let ci = 0; ci < targetHeaders.length; ci++) {
      const cv = canonicalValue(trow[ci] ?? "");
      if (cv !== "" && targetSets[ci].size < SET_CAP) targetSets[ci].add(cv);
    }
  }

  const rows: MatchRow[] = buildConfirmedMappings({
    sourceHeaders, targetHeaders, sourceSets, targetSets, aligned,
    keySourceIdx: sKeyIdx, keyTargetIdx: tKeyIdxUnion, sourceExamples,
  });

  // ── Output CSV ──
  const csvCell = (v: string) => (/[",\r\n]/.test(v ?? "") ? `"${(v ?? "").replace(/"/g, '""')}"` : v ?? "");
  const filesOf = (col: string) => [...(targetColFiles.get(col) ?? [])].join("; ");
  const pct = (n: number | null) => (n === null ? "" : `${Math.round(n * 100)}%`);
  const used = new Set(rows.filter((r) => r.target).map((r) => r.target as string));
  const outRows: string[][] = [
    ["Source Column", "Target Column", "Target File(s)", "Value Overlap", "Entity Agreement", "Confidence", "Reason"],
  ];
  for (const r of rows)
    outRows.push([r.sourceHeader, r.target ?? "IGNORE", r.target ? filesOf(r.target) : "", pct(r.valueOverlap), pct(r.agreement), r.confidence, r.reason]);
  for (const col of targetHeaders) if (!used.has(col)) outRows.push(["", col, filesOf(col), "", "", "NO_SOURCE_MATCH", ""]);
  fs.writeFileSync(outPath, "﻿" + outRows.map((r) => r.map(csvCell).join(",")).join("\r\n"), "utf8");

  const mapped = rows.filter((r) => r.target);
  console.log(`\nEntities joined: ${aligned.length.toLocaleString()} | Mapped: ${mapped.length} | Unmapped: ${rows.length - mapped.length}`);
  console.log(`Mapping written to: ${path.resolve(outPath)}`);

  // Join with any sibling map_*.csv into one combined mapping.
  const combined = writeCombined(path.dirname(path.resolve(outPath)));
  if (combined)
    console.log(`Combined mapping (${combined.files.join(", ")}) written to: ${path.resolve(combined.dest)}`);
  console.log("");
  console.log("Source -> Target:");
  for (const r of rows)
    console.log(`  ${r.sourceHeader.padEnd(34)} ${r.target ? `-> ${r.target}` : "-> (unmapped)"}  [${r.confidence}] ${r.reason}`);
}

main().catch((err) => {
  console.error("\nx st-map failed:", err.message);
  process.exit(1);
});
