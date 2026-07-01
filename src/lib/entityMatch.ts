// Self-contained (no local imports) so the Node CLI can load it directly —
// Node's ESM resolver can't follow the extensionless imports used elsewhere.

export type Confidence = "HIGH" | "MEDIUM" | "LOW" | "NONE";

function confidenceFromScore(field: string, score: number): Confidence {
  if (field === "IGNORE") return "NONE";
  if (score >= 0.85) return "HIGH";
  if (score >= 0.55) return "MEDIUM";
  return "LOW";
}

// ── Fuzzy string similarity (mirrors src/lib/fuzzy.ts) ───────────────────────
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[_\-\s./\\]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

function tokenize(s: string): string[] {
  return normalize(s).split(" ").filter(Boolean);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

function stringSimilarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  if (na && nb && (na.includes(nb) || nb.includes(na))) return 0.92;
  const ta = tokenize(a);
  const tb = tokenize(b);
  const intersection = ta.filter((t) => tb.includes(t)).length;
  const jaccard = intersection / (ta.length + tb.length - intersection || 1);
  const editSim = 1 - levenshtein(na, nb) / (Math.max(na.length, nb.length) || 1);
  return Math.max(jaccard * 0.6 + editSim * 0.4, editSim * 0.5 + jaccard * 0.5);
}

// ── Source ↔ Target column matching, value-overlap + entity confirmation ─────
// Base signal = how much two columns' VALUE SETS overlap (+ a little header
// similarity). Then, when the rows have been joined on a shared key, the
// per-entity AGREEMENT (does the SAME entity hold the SAME value in both files?)
// is used to be *more sure*:
//   • high agreement  → confirm + boost to high confidence
//   • medium          → keep, but temper the score
//   • low agreement   → veto (these columns share a vocabulary but aren't the
//                        same field) so it won't be force-mapped
// Columns with no confident candidate are left unmapped.

const VALUE_WEIGHT = 0.85;
const HEADER_WEIGHT = 0.15;
const ACCEPT = 0.3; // below this a column is left unmapped

const MIN_ALIGNED = 5; // joined entities needed before agreement is usable
const MIN_COMPARABLE = 5; // entities with both cells present needed to judge a pair
const AGREEMENT_CAP = 4000; // joined rows used to score agreement (enough for stable fractions)
const CONFIRM = 0.7; // chance-adjusted agreement that confirms a match
const MILD = 0.45;

// Canonicalize a value so "15,230.50" == "15230.5" and dates with different
// separators compare equal. Used for both overlap sets and per-entity agreement.
export function canonicalValue(raw: string): string {
  const t = (raw ?? "").trim();
  if (t === "") return "";
  const num = t.replace(/[$£€,\s]/g, "");
  if (/^-?\d+(\.\d+)?$/.test(num)) {
    const n = Number(num);
    if (!Number.isNaN(n)) return String(n);
  }
  if (/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(t)) return t.replace(/[/.]/g, "-");
  return t.toLowerCase();
}

export function overlapCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const v of small) if (large.has(v)) inter++;
  return inter / small.size;
}

// Per-entity agreement over key-joined rows for one (source col, target col).
// observed = fraction of compared entities whose values match.
// adj = observed corrected for chance (so near-constant columns don't score high).
function perEntityAgreement(
  aligned: Array<[string[], string[]]>,
  si: number,
  ti: number
): { observed: number; adj: number; comparable: number } {
  let comparable = 0;
  let matches = 0;
  const sc = new Map<string, number>();
  const tc = new Map<string, number>();
  for (const [srow, trow] of aligned) {
    const sv = canonicalValue(srow[si] ?? "");
    const tv = canonicalValue(trow[ti] ?? "");
    if (sv === "" || tv === "") continue;
    comparable++;
    if (sv === tv) matches++;
    sc.set(sv, (sc.get(sv) ?? 0) + 1);
    tc.set(tv, (tc.get(tv) ?? 0) + 1);
  }
  if (comparable === 0) return { observed: 0, adj: 0, comparable: 0 };
  const observed = matches / comparable;
  let chance = 0;
  for (const [v, n] of sc) chance += (n / comparable) * ((tc.get(v) ?? 0) / comparable);
  const adj = chance >= 1 ? 0 : Math.max(0, (observed - chance) / (1 - chance));
  return { observed, adj, comparable };
}

export interface MatchRow {
  sourceIdx: number;
  sourceHeader: string;
  target: string | null; // null = left unmapped
  valueOverlap: number; // 0..1
  agreement: number | null; // 0..1 observed per-entity agreement, or null if not joined
  score: number;
  confidence: Confidence;
  reason: string;
  sampleVals: string[];
}

export interface ConfirmedMappingInput {
  sourceHeaders: string[];
  targetHeaders: string[];
  sourceSets: Set<string>[];
  targetSets: Set<string>[];
  aligned: Array<[string[], string[]]>;
  keySourceIdx: number;
  keyTargetIdx: number;
  sourceExamples: string[][]; // a few display values per source column
}

interface Cand {
  si: number;
  ti: number;
  base: number;
  overlap: number;
  score: number;
  agreement: number | null;
  reason: string;
}

export function buildConfirmedMappings(input: ConfirmedMappingInput): MatchRow[] {
  const { sourceHeaders, targetHeaders, sourceSets, targetSets, aligned } = input;
  const { keySourceIdx, keyTargetIdx, sourceExamples } = input;
  const haveAligned = aligned.length >= MIN_ALIGNED;
  const agRows = aligned.length > AGREEMENT_CAP ? aligned.slice(0, AGREEMENT_CAP) : aligned;

  const all: Cand[] = [];
  const perSourceBest = new Map<number, Cand>(); // best candidate per source col (for reasons)

  // When rows are joined on a key, per-entity AGREEMENT is the primary signal and
  // it is computed for EVERY column pair (value-set overlap is only a tiebreaker /
  // fallback). When there is no join, fall back to value-overlap alone.
  for (let si = 0; si < sourceHeaders.length; si++) {
    for (let ti = 0; ti < targetHeaders.length; ti++) {
      if (haveAligned && si === keySourceIdx && ti === keyTargetIdx) continue; // key handled below

      const overlap = overlapCoefficient(sourceSets[si], targetSets[ti]);
      const base = VALUE_WEIGHT * overlap + HEADER_WEIGHT * stringSimilarity(sourceHeaders[si], targetHeaders[ti]);

      let score = base;
      let agreement: number | null = null;
      let reason = `value overlap ${Math.round(overlap * 100)}%`;

      if (haveAligned) {
        const ag = perEntityAgreement(agRows, si, ti);
        if (ag.comparable >= MIN_COMPARABLE) {
          agreement = ag.observed;
          const pct = Math.round(ag.observed * 100);
          if (ag.adj >= CONFIRM) {
            score = Math.max(base, 0.85 + 0.15 * ag.adj);
            reason = `${pct}% per-entity agreement across ${ag.comparable} entities — confirmed`;
          } else if (ag.adj >= MILD) {
            score = Math.max(base * 0.5, 0.5 + 0.2 * ag.adj);
            reason = `${pct}% per-entity agreement across ${ag.comparable} entities`;
          } else {
            // The same entities don't share this value → not the same field. Veto.
            score = Math.min(base * 0.2, 0.15);
            reason = `only ${pct}% per-entity agreement (${ag.comparable} entities) — not the same field`;
          }
        } else {
          // Too few comparable cells to judge by agreement → lean on value overlap,
          // but cap the confidence since it's unconfirmed.
          score = Math.min(base, 0.5);
        }
      }

      const cand: Cand = { si, ti, base, overlap, score, agreement, reason };
      if (score > 0) all.push(cand);
      const prev = perSourceBest.get(si);
      if (!prev || score > prev.score) perSourceBest.set(si, cand);
    }
  }

  // The key columns map to each other by definition.
  if (haveAligned && keySourceIdx >= 0 && keyTargetIdx >= 0) {
    all.push({
      si: keySourceIdx,
      ti: keyTargetIdx,
      base: 1,
      overlap: 1,
      score: 1,
      agreement: 1,
      reason: `join key (${aligned.length.toLocaleString()} entities joined)`,
    });
  }

  // Greedy unique assignment by score; each target used at most once.
  all.sort((a, b) => b.score - a.score);
  const sTaken = new Set<number>();
  const tTaken = new Set<number>();
  const chosen = new Map<number, Cand>();
  for (const c of all) {
    if (c.score < ACCEPT) continue;
    if (sTaken.has(c.si) || tTaken.has(c.ti)) continue;
    chosen.set(c.si, c);
    sTaken.add(c.si);
    tTaken.add(c.ti);
  }

  return sourceHeaders.map((h, si) => {
    const c = chosen.get(si);
    if (c) {
      return {
        sourceIdx: si,
        sourceHeader: h,
        target: targetHeaders[c.ti],
        valueOverlap: c.overlap,
        agreement: c.agreement,
        score: c.score,
        confidence: confidenceFromScore(targetHeaders[c.ti], c.score),
        reason: c.reason,
        sampleVals: sourceExamples[si] ?? [],
      };
    }
    const bb = perSourceBest.get(si);
    const reason = bb
      ? `left unmapped — best was ${targetHeaders[bb.ti]} (${bb.reason})`
      : `left unmapped — no candidate`;
    return {
      sourceIdx: si,
      sourceHeader: h,
      target: null,
      valueOverlap: 0,
      agreement: null,
      score: 0,
      confidence: "NONE",
      reason,
      sampleVals: sourceExamples[si] ?? [],
    };
  });
}
