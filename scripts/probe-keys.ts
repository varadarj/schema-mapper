/**
 * probe-keys — find which source/target ID columns actually share values.
 *
 * Indexes the candidate ID columns on the source, then streams the target once,
 * counting how many values each target ID column shares with each source ID
 * column. Also prints example values so you can spot format mismatches.
 *
 * Run with --help for usage.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { canonicalValue } from "../src/lib/entityMatch.ts";

const USAGE = `probe-keys - find which source/target ID columns actually share values.

Usage:
  node scripts/probe-keys.ts --source <dir|glob|list> --target <file|dir|glob> [options]

Required:
  --source <spec>      source CSV: file, directory, glob, or comma-separated list
  --target <spec>      target CSV: file, directory, glob, or comma-separated list

Options:
  --sourceCols a,b     source ID columns to test (default: any header containing "id")
  --targetCols c,d     target ID columns to test (default: any header containing "id")
  --maxEntities <n>    source values to index per column (default 200000)
  --scan <n>           hard cap on rows read per side (default 3000000)
  --rows <n>           example values to print per column (default 5)
  --delimiter <char>   field delimiter (default ",")
  -h, --help           print this help and exit

Example:
  node scripts/probe-keys.ts --source "C:/data/part-*" --target "C:/data/location.csv"

Use the winning pair as st-map's --key srcCol=tgtCol.`;

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

function splitCsvLine(line: string, d: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
    } else if (ch === d && !q) { cells.push(cur.trim()); cur = ""; } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}
const stripBom = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

// Parse only fields 0..maxIdx (quote-aware), stopping early — fast on wide rows.
function fieldsUpTo(line: string, d: string, maxIdx: number): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
    } else if (ch === d && !q) {
      out.push(cur.trim());
      if (out.length > maxIdx) return out;
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

// Per-line streaming (no multi-line reassembly — fast; the ID columns we read
// are positional and before any multi-line text field).
async function streamLines(fp: string, onRec: (line: string, i: number) => boolean | void) {
  let idx = 0;
  const stream = fs.createReadStream(fp, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (line.length === 0) continue;
      if (onRec(line, idx++) === false) break;
    }
  } finally { rl.close(); stream.destroy(); }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help === "true") {
    console.log(USAGE);
    return;
  }

  const missing = (["source", "target"] as const).filter((k) => !args[k]);
  if (missing.length) {
    console.error(`Missing required argument(s): ${missing.map((k) => `--${k}`).join(", ")}\n`);
    console.error(USAGE);
    process.exit(1);
  }
  const d = args.delimiter ?? ",";
  const maxEntities = parseInt(args.maxEntities ?? "200000", 10) || 200000;
  const scan = parseInt(args.scan ?? "3000000", 10) || 3000000;
  const exN = parseInt(args.rows ?? "5", 10) || 5;
  const srcFiles = resolveFiles(args.source);
  const tgtFiles = resolveFiles(args.target);

  // ── source: candidate columns + value sets + examples ──
  let sHeaders: string[] = [];
  let sCand: number[] = [];
  let maxSCol = 0;
  let sSets: Set<string>[] = [];
  let sEx: string[][] = [];
  let sScanned = 0;
  for (const f of srcFiles) {
    if (sScanned >= maxEntities) break;
    await streamLines(f, (line, i) => {
      if (i === 0) {
        if (!sHeaders.length) {
          sHeaders = splitCsvLine(line, d).map((h, j) => (j === 0 ? stripBom(h) : h));
          sCand = args.sourceCols
            ? args.sourceCols.split(",").map((c) => sHeaders.indexOf(c.trim())).filter((x) => x >= 0)
            : sHeaders.map((h, j) => (/id/i.test(h) ? j : -1)).filter((x) => x >= 0);
          maxSCol = sCand.length ? Math.max(...sCand) : 0;
          sSets = sCand.map(() => new Set<string>());
          sEx = sCand.map(() => []);
        }
        return;
      }
      sScanned++;
      const cells = fieldsUpTo(line, d, maxSCol);
      sCand.forEach((col, k) => {
        const cv = canonicalValue(cells[col] ?? "");
        if (cv !== "") { sSets[k].add(cv); if (sEx[k].length < exN) sEx[k].push((cells[col] ?? "").trim()); }
      });
      if (sScanned % 100000 === 0) process.stdout.write(`\r  indexing source: ${sScanned.toLocaleString()} rows`);
      if (sScanned >= maxEntities) return false;
    });
  }
  process.stdout.write(`\r  indexed source from ${sScanned.toLocaleString()} rows.${" ".repeat(20)}\n`);

  const showEx = args.examples === "true";
  console.log(`\nSOURCE candidate ID columns (from ${sScanned.toLocaleString()} rows):`);
  sCand.forEach((col, k) =>
    console.log(`  ${sHeaders[col].padEnd(28)}${showEx ? ` e.g. ${sEx[k].join(", ") || "(empty)"}` : ""}`)
  );

  // ── target: candidate columns + examples + overlap tally ──
  let tHeaders: string[] = [];
  let tCand: number[] = [];
  let maxTCol = 0;
  let tEx: string[][] = [];
  let tScanned = 0;
  const tally: number[][] = []; // [tCandK][sCandK] = match count
  const tNonEmpty: number[] = [];
  for (const f of tgtFiles) {
    if (tScanned >= scan) break;
    await streamLines(f, (line, i) => {
      if (i === 0) {
        if (!tHeaders.length) {
          tHeaders = splitCsvLine(line, d).map((h, j) => (j === 0 ? stripBom(h) : h));
          tCand = args.targetCols
            ? args.targetCols.split(",").map((c) => tHeaders.indexOf(c.trim())).filter((x) => x >= 0)
            : tHeaders.map((h, j) => (/id/i.test(h) ? j : -1)).filter((x) => x >= 0);
          maxTCol = tCand.length ? Math.max(...tCand) : 0;
          tEx = tCand.map(() => []);
          tCand.forEach((_, k) => { tally[k] = sCand.map(() => 0); tNonEmpty[k] = 0; });
        }
        return;
      }
      tScanned++;
      const cells = fieldsUpTo(line, d, maxTCol);
      tCand.forEach((col, k) => {
        const cv = canonicalValue(cells[col] ?? "");
        if (cv === "") return;
        tNonEmpty[k]++;
        if (tEx[k].length < exN) tEx[k].push((cells[col] ?? "").trim());
        sSets.forEach((set, sk) => { if (set.has(cv)) tally[k][sk]++; });
      });
      if (tScanned % 50000 === 0) process.stdout.write(`\r  scanning target: ${tScanned.toLocaleString()} rows`);
      if (tScanned >= scan) return false;
    });
  }
  process.stdout.write(`\r  scanned ${tScanned.toLocaleString()} target rows.${" ".repeat(20)}\n`);

  console.log(`\nTARGET candidate ID columns:`);
  tCand.forEach((col, k) =>
    console.log(
      `  ${tHeaders[col].padEnd(28)} (${tNonEmpty[k].toLocaleString()} non-empty)${showEx ? ` e.g. ${tEx[k].join(", ") || "(empty)"}` : ""}`
    )
  );

  // ── ranked overlapping pairs ──
  const pairs: { s: string; t: string; n: number }[] = [];
  tCand.forEach((tcol, k) => sCand.forEach((scol, sk) => {
    if (tally[k][sk] > 0) pairs.push({ s: sHeaders[scol], t: tHeaders[tcol], n: tally[k][sk] });
  }));
  pairs.sort((a, b) => b.n - a.n);

  console.log(`\nShared-value pairs (source -> target : matches found in scan):`);
  if (!pairs.length) console.log("  NONE — no candidate ID columns shared values. Check formats above (prefixes, empties), raise --scan, or pass --sourceCols/--targetCols.");
  else pairs.slice(0, 15).forEach((p) => console.log(`  ${p.s.padEnd(24)} -> ${p.t.padEnd(24)} : ${p.n.toLocaleString()}`));
  if (pairs.length) console.log(`\nUse the top pair as your --key, e.g.  --key ${pairs[0].s}=${pairs[0].t}\n`);
}

main().catch((e) => { console.error("\nx probe failed:", e.message); process.exit(1); });
