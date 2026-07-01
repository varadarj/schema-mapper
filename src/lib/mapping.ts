import { bestMatch, AGING_FIELDS, AR_UNIQUE } from "./matchers.ts";

export type Confidence = "HIGH" | "MEDIUM" | "LOW" | "NONE";
export type MatchMethod = "pattern" | "address" | "heuristic" | "fuzzy" | "ai" | "data";

export interface MatchAlternative {
  target: string;
  score: number; // combined score 0..1
  name: number; // semantic-name score 0..1
}

export interface ColumnMapping {
  excelIndex: number;
  excelHeader: string;
  sampleVals: string[];
  mappedTo: string;
  score: number;
  confidence: Confidence;
  method: MatchMethod;
  required: boolean;
  reason?: string; // optional explanation (used by the source↔target data matcher)
  alternatives?: MatchAlternative[]; // other plausible targets (near-ties), best first
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
  let mappings: ColumnMapping[] = excelData.headers.map((rawHeader, i) => {
    const header = rawHeader == null ? "" : String(rawHeader);
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

  mappings = enforceUniqueMapping(mappings);
  mappings = fixAddressOrder(mappings);
  return mappings;
}

// ── Enforce ONE-to-ONE mapping ───────────────────────────────────────────────
// Each DSP field may be claimed by at most one column — the highest-scoring one
// (earliest column wins ties). Every other column that resolved to the same
// field is reset to IGNORE. DEBT91PLUS is the sole exception: multiple columns
// may map to it (they are summed, and even processed as distinct fields).
export function enforceUniqueMapping(mappings: ColumnMapping[]): ColumnMapping[] {
  const result = mappings.map((m) => ({ ...m }));

  const byField = new Map<string, number[]>();
  result.forEach((m, i) => {
    if (m.mappedTo === "IGNORE" || m.mappedTo === "DEBT91PLUS") return;
    const idxs = byField.get(m.mappedTo) ?? [];
    idxs.push(i);
    byField.set(m.mappedTo, idxs);
  });

  for (const idxs of byField.values()) {
    if (idxs.length <= 1) continue;
    // Highest score first; ties broken by earliest column index.
    idxs.sort((a, b) => result[b].score - result[a].score || a - b);
    for (let k = 1; k < idxs.length; k++) {
      const j = idxs[k];
      result[j] = {
        ...result[j],
        mappedTo: "IGNORE",
        confidence: "NONE",
        score: 0,
        required: false,
      };
    }
  }
  return result;
}

// ── Invoice amount fallback ──────────────────────────────────────────────────
// INVAMT is required for invoice providers. If nothing is mapped to it, map the
// first column whose header contains "amount" (e.g. "Open Amount", "Invoice
// Amount") to INVAMT.
export function ensureInvoiceAmount(mappings: ColumnMapping[]): ColumnMapping[] {
  if (mappings.some((m) => m.mappedTo === "INVAMT")) return mappings;
  const idx = mappings.findIndex((m) => /amount/i.test(m.excelHeader));
  if (idx < 0) return mappings;
  const result = mappings.map((m) => ({ ...m }));
  result[idx] = {
    ...result[idx],
    mappedTo: "INVAMT",
    confidence: "HIGH",
    score: 1,
    required: false,
  };
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

// ── Joined FixedRawData preview (multi-file) ─────────────────────────────────
// Mirrors the generated provider: inner-joins each file's mapped data on the
// join key and shows the combined row set (union of DSP columns), instead of
// previewing each file separately. Joins over the full data rows (not just the
// sample) so the preview can fill up to `count` rows. Join keys are uppercased
// (and trimmed) on both sides before matching; iteration stops once `count`
// rows have been joined.
export interface JoinPreviewSource {
  rows: string[][]; // data rows (no header), columns positional by excelIndex
  mappings: ColumnMapping[];
}

export function buildJoinedPreview(
  sources: JoinPreviewSource[],
  joinKey: string,
  count = 50
): PreviewData {
  const empty: PreviewData = { origHeaders: [], dspHeaders: [], rows: [] };
  if (sources.length < 2 || !joinKey) return empty;

  const perSource = sources.map((s) => {
    const mapped = s.mappings.filter((m) => m.mappedTo !== "IGNORE");
    const joinM = mapped.find((m) => m.mappedTo === joinKey);
    return { mapped, joinIdx: joinM ? joinM.excelIndex : -1, rows: s.rows };
  });

  // Every source must map the join key to be joinable.
  if (perSource.some((p) => p.joinIdx < 0)) return empty;

  // Union DSP columns (dedupe by field, first source wins) + where each comes from.
  const seen = new Set<string>();
  const cols: { dsp: string; src: number; idx: number }[] = [];
  perSource.forEach((p, si) => {
    for (const m of p.mapped) {
      if (seen.has(m.mappedTo)) continue;
      seen.add(m.mappedTo);
      cols.push({ dsp: m.mappedTo, src: si, idx: m.excelIndex });
    }
  });

  // Uppercase + trim the join field on both sides before matching.
  const key = (v: string | number | null) => String(v ?? "").trim().toUpperCase();

  // key → first matching row, for each non-primary source
  const lookups = perSource.slice(1).map((p) => {
    const map = new Map<string, string[]>();
    for (const row of p.rows) {
      const k = key(row[p.joinIdx]);
      if (k && !map.has(k)) map.set(k, row);
    }
    return map;
  });

  const primary = perSource[0];
  const rows: PreviewData["rows"] = [];
  for (const prow of primary.rows) {
    if (rows.length >= count) break; // stop once `count` rows have been joined
    const k = key(prow[primary.joinIdx]);
    if (!k) continue;
    const srcRows: (string[] | undefined)[] = [prow];
    let ok = true;
    for (let li = 0; li < lookups.length; li++) {
      const match = lookups[li].get(k);
      if (!match) { ok = false; break; }
      srcRows[li + 1] = match;
    }
    if (!ok) continue;
    const vals = cols.map((c) => {
      const r = srcRows[c.src];
      return r ? String(r[c.idx] ?? "") : "";
    });
    rows.push({ orig: vals, remap: vals });
  }

  const headers = cols.map((c) => c.dsp);
  return { origHeaders: headers, dspHeaders: headers, rows };
}