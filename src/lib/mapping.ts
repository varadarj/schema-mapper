import { bestMatch, AGING_FIELDS, AR_UNIQUE } from "./matchers";

export type Confidence = "HIGH" | "MEDIUM" | "LOW" | "NONE";
export type MatchMethod = "pattern" | "address" | "heuristic" | "fuzzy" | "ai" | "data";

export interface ColumnMapping {
  excelIndex: number;
  excelHeader: string;
  sampleVals: string[];
  mappedTo: string;
  score: number;
  confidence: Confidence;
  method: MatchMethod;
  required: boolean;
}

export interface ExcelData {
  headers: string[];
  sampleRows: (string | number | null)[][];
  totalRows: number;
}

export const REQUIRED_FIELDS = ["NAME", "ADDRESS1"] as const;

export function confidenceFromScore(field: string, score: number): Confidence {
  if (field === "IGNORE") return "NONE";
  if (score >= 0.85) return "HIGH";
  if (score >= 0.55) return "MEDIUM";
  return "LOW";
}

// ── Build initial mappings ───────────────────────────────────────────────────
export function buildMappings(
  excelData: ExcelData,
  candidates: string[]
): ColumnMapping[] {
  let mappings: ColumnMapping[] = excelData.headers.map((header, i) => {
    const { field, score, method } = bestMatch(header, candidates);
    // If the matched field isn't in the candidate list, fall back to IGNORE
    const resolvedField =
      field !== "IGNORE" && candidates.length > 0 && !candidates.includes(field)
        ? "IGNORE"
        : field;
    const sampleVals = excelData.sampleRows
      .slice(0, 5)
      .map((r) => String(r[i] ?? ""))
      .filter((v) => v !== "");
    return {
      excelIndex: i,
      excelHeader: header,
      sampleVals,
      mappedTo: resolvedField,
      score: resolvedField === "IGNORE" && field !== "IGNORE" ? 0 : score,
      confidence: confidenceFromScore(resolvedField, resolvedField === "IGNORE" && field !== "IGNORE" ? 0 : score),
      method,
      required: (REQUIRED_FIELDS as readonly string[]).includes(resolvedField),
    };
  });

  mappings = enforceArUniqueness(mappings);
  mappings = fixAddressOrder(mappings);
  return mappings;
}

// ── Enforce AR uniqueness (DEBT91PLUS is exempt) ─────────────────────────────
export function enforceArUniqueness(mappings: ColumnMapping[]): ColumnMapping[] {
  const result = mappings.map((m) => ({ ...m }));
  for (const field of AR_UNIQUE) {
    const hits = result
      .map((m, i) => ({ i, m }))
      .filter(({ m }) => m.mappedTo === field);
    if (hits.length > 1) {
      hits.sort((a, b) => b.m.score - a.m.score);
      for (let k = 1; k < hits.length; k++) {
        result[hits[k].i].mappedTo = "IGNORE";
        result[hits[k].i].confidence = "NONE";
        result[hits[k].i].score = 0;
      }
    }
  }
  return result;
}

// ── Fix address ordering — lower-numbered address field must come first ───────
// Compares all address field pairs and swaps DSP assignments if needed
export function fixAddressOrder(mappings: ColumnMapping[]): ColumnMapping[] {
  const result = mappings.map((m) => ({ ...m }));
  const addrFields = ["ADDRESS1", "ADDRESS2", "CITY", "REGION"];

  for (let i = 0; i < addrFields.length - 1; i++) {
    for (let j = i + 1; j < addrFields.length; j++) {
      const fi = result.findIndex((m) => m.mappedTo === addrFields[i]);
      const fj = result.findIndex((m) => m.mappedTo === addrFields[j]);
      // If both found and the "later" address appears at an earlier Excel column index, swap
      if (fi > -1 && fj > -1 && fj < fi) {
        result[fi].mappedTo = addrFields[j];
        result[fj].mappedTo = addrFields[i];
      }
    }
  }
  return result;
}

// ── Cascade aging fields forward after a DA change ──────────────────────────
export function cascadeAging(
  mappings: ColumnMapping[],
  changedIdx: number,
  newField: string
): ColumnMapping[] {
  const result = mappings.map((m) => ({ ...m }));
  const agIdx = AGING_FIELDS.indexOf(newField as (typeof AGING_FIELDS)[number]);
  if (agIdx < 0) return result;

  let next = agIdx + 1;
  for (
    let r = changedIdx + 1;
    r < result.length && next < AGING_FIELDS.length;
    r++
  ) {
    const m = result[r];
    const eligible =
      m.mappedTo === "IGNORE" || (AGING_FIELDS as readonly string[]).includes(m.mappedTo);
    if (!eligible) break;

    const looksNumeric = m.sampleVals.some((v) =>
      /^-?[\d,\. ]+$/.test(String(v).trim())
    );
    if (!looksNumeric) break;

    const targetField = AGING_FIELDS[next];
    if (AR_UNIQUE.has(targetField)) {
      const alreadyTaken = result.some(
        (mm, ii) => ii !== r && mm.mappedTo === targetField
      );
      if (alreadyTaken) { next++; continue; }
    }

    result[r] = {
      ...result[r],
      mappedTo: targetField,
      confidence: "MEDIUM",
      score: 0.75,
    };
    next++;
  }
  return result;
}

// ── Find conflict (returns index of conflicting row, or -1) ──────────────────
// DEBT91PLUS never conflicts — multiple columns can map to it
export function findConflict(
  mappings: ColumnMapping[],
  newField: string,
  rowIdx: number
): number {
  if (newField === "IGNORE" || newField === "DEBT91PLUS") return -1;
  return mappings.findIndex((m, i) => i !== rowIdx && m.mappedTo === newField);
}

// ── Apply a single mapping change and cascade ────────────────────────────────
export function applyMappingChange(
  mappings: ColumnMapping[],
  rowIdx: number,
  newField: string
): ColumnMapping[] {
  let result = mappings.map((m) => ({ ...m }));
  result[rowIdx] = {
    ...result[rowIdx],
    mappedTo: newField,
    confidence: newField === "IGNORE" ? "NONE" : "HIGH",
    score: newField === "IGNORE" ? 0 : 1,
    required: (REQUIRED_FIELDS as readonly string[]).includes(newField),
  };
  result = cascadeAging(result, rowIdx, newField);
  return result;
}

// ── Build preview rows for side-by-side comparison ──────────────────────────
export interface PreviewData {
  origHeaders: string[];
  dspHeaders: string[];
  rows: Array<{ orig: string[]; remap: string[] }>;
}

export function buildPreviewRows(
  excelData: ExcelData,
  mappings: ColumnMapping[],
  count = 50
): PreviewData {
  const mapped = mappings.filter((m) => m.mappedTo !== "IGNORE");
  const pool = excelData.sampleRows.filter((r) => r.some((c) => c !== ""));

  const picks: (string | number | null)[][] = [];
  if (pool.length <= count) {
    picks.push(...pool);
  } else {
    const idxSet = new Set<number>();
    while (idxSet.size < count)
      idxSet.add(Math.floor(Math.random() * pool.length));
    [...idxSet].forEach((i) => picks.push(pool[i]));
  }

  const origHeaders = mapped.map((m) => m.excelHeader);
  const dspHeaders = mapped.map((m) => m.mappedTo);
  const rows = picks.map((row) => ({
    orig: mapped.map((m) => String(row[m.excelIndex] ?? "")),
    remap: mapped.map((m) => String(row[m.excelIndex] ?? "")),
  }));

  return { origHeaders, dspHeaders, rows };
}