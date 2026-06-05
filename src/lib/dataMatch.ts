import type { ColumnMapping, ExcelData } from "./mapping";
import { confidenceFromScore } from "./mapping";
import { stringSimilarity } from "./fuzzy";

// ── Source ↔ Target matching by DATA overlap ─────────────────────────────────
// Each source column is matched to the target column whose VALUES overlap most,
// with header-name similarity used only as a tiebreaker boost. Handles renamed
// fields like source "entity_id" → target "ECID" when they carry the same data.

const VALUE_WEIGHT = 0.85;
const HEADER_WEIGHT = 0.15;
const MIN_SCORE = 0.3; // below this → IGNORE

function normalizeValue(v: string): string {
  return v.toLowerCase().trim();
}

// Build the set of distinct, non-empty, normalized values for one column.
function columnValueSet(data: ExcelData, colIndex: number): Set<string> {
  const set = new Set<string>();
  for (const row of data.sampleRows) {
    const raw = row[colIndex];
    if (raw === null || raw === undefined) continue;
    const v = normalizeValue(String(raw));
    if (v !== "") set.add(v);
  }
  return set;
}

// Overlap coefficient: |A ∩ B| / min(|A|, |B|).
// Returns 1.0 when one column's values are a subset of the other's — exactly the
// "same data, possibly with extras mixed in" case from the spec.
function overlapCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const v of small) if (large.has(v)) inter++;
  return inter / small.size;
}

function sampleValsFor(data: ExcelData, colIndex: number): string[] {
  return data.sampleRows
    .slice(0, 5)
    .map((r) => String(r[colIndex] ?? ""))
    .filter((v) => v !== "");
}

interface Candidate {
  sourceIdx: number;
  targetIdx: number;
  targetHeader: string;
  score: number;
}

// Build source→target mappings. Each target column is assigned to at most one
// source column (greedy by descending score); unmatched source columns → IGNORE.
export function buildDataMappings(
  source: ExcelData,
  target: ExcelData
): ColumnMapping[] {
  const sourceSets = source.headers.map((_, i) => columnValueSet(source, i));
  const targetSets = target.headers.map((_, i) => columnValueSet(target, i));

  // Score every source/target pair.
  const candidates: Candidate[] = [];
  source.headers.forEach((sHeader, si) => {
    target.headers.forEach((tHeader, ti) => {
      const valueScore = overlapCoefficient(sourceSets[si], targetSets[ti]);
      const headerScore = stringSimilarity(sHeader, tHeader);
      const score = VALUE_WEIGHT * valueScore + HEADER_WEIGHT * headerScore;
      candidates.push({ sourceIdx: si, targetIdx: ti, targetHeader: tHeader, score });
    });
  });

  candidates.sort((a, b) => b.score - a.score);

  const sourceTaken = new Set<number>();
  const targetTaken = new Set<number>();
  const chosen = new Map<number, Candidate>(); // sourceIdx → best candidate

  for (const c of candidates) {
    if (c.score < MIN_SCORE) break;
    if (sourceTaken.has(c.sourceIdx) || targetTaken.has(c.targetIdx)) continue;
    chosen.set(c.sourceIdx, c);
    sourceTaken.add(c.sourceIdx);
    targetTaken.add(c.targetIdx);
  }

  return source.headers.map((header, i) => {
    const c = chosen.get(i);
    const mappedTo = c ? c.targetHeader : "IGNORE";
    const score = c ? c.score : 0;
    return {
      excelIndex: i,
      excelHeader: header,
      sampleVals: sampleValsFor(source, i),
      mappedTo,
      score,
      confidence: confidenceFromScore(mappedTo, score),
      method: "data" as const,
      required: false,
    };
  });
}

// ── Generic conflict handling (no DSP aging/address rules) ───────────────────
export function findDataConflict(
  mappings: ColumnMapping[],
  newField: string,
  rowIdx: number
): number {
  if (newField === "IGNORE") return -1;
  return mappings.findIndex((m, i) => i !== rowIdx && m.mappedTo === newField);
}

export function applyDataMappingChange(
  mappings: ColumnMapping[],
  rowIdx: number,
  newField: string
): ColumnMapping[] {
  const result = mappings.map((m) => ({ ...m }));
  result[rowIdx] = {
    ...result[rowIdx],
    mappedTo: newField,
    confidence: newField === "IGNORE" ? "NONE" : "HIGH",
    score: newField === "IGNORE" ? 0 : 1,
  };
  return result;
}
