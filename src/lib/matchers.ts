import { stringSimilarity } from "./fuzzy";

export type MatchResult = {
  field: string;
  score: number;
  method: "pattern" | "address" | "heuristic" | "fuzzy" | "ai";
};

// ── AR aging ────────────────────────────────────────────────────────────────
export const AGING_FIELDS = [
  "DEBTCURRENT",
  "DEBT30DAY",
  "DEBT60DAY",
  "DEBT90DAY",
  "DEBT91PLUS",
] as const;

export type AgingField = (typeof AGING_FIELDS)[number];

// DEBT91PLUS can appear multiple times (summation). All others are unique.
export const AR_UNIQUE = new Set<string>([
  "DEBTCURRENT",
  "DEBT30DAY",
  "DEBT60DAY",
  "DEBT90DAY",
]);

const AGING_PATTERNS: RegExp[][] = [
  // DEBTCURRENT — "Due < 1", "current", "< 30", "0-30", "not yet due"
  [/due\s*[<＜]\s*1\b/i, /current/i, /<\s*30/i, /0\s*[-–]\s*30/i, /not\s*yet\s*due/i],
  // DEBT30DAY — "1-30", "30 days", "1 month"
  [/\b1\s*[-–]\s*30\b/i, /30\s*days?/i, /1\s*month/i],
  // DEBT60DAY — "31-60", "60 days", "2 months"
  [/\b31\s*[-–]\s*60\b/i, /60\s*days?/i, /2\s*months?/i],
  // DEBT90DAY — "61-90", "90 days", "3 months"
  [/\b61\s*[-–]\s*90\b/i, /90\s*days?/i, /3\s*months?/i],
  // DEBT91PLUS — "> 90", "> 120", "> 180", "91+", "over 90", etc.
  [
    /\b91\s*[-–]/i,
    /\b121\s*[-–]/i,
    /\b151\s*[-–]/i,
    />?\s*90/i,
    />?\s*120/i,
    />?\s*180/i,
    /over\s*90/i,
    /90\+/i,
    /91\+/i,
    /due\s*[>＞]\s*180/i,
  ],
];

export function matchAging(header: string): MatchResult | null {
  for (let i = 0; i < AGING_PATTERNS.length; i++)
    for (const rx of AGING_PATTERNS[i])
      if (rx.test(header))
        return { field: AGING_FIELDS[i], score: 0.95, method: "pattern" };
  return null;
}

// ── Address ─────────────────────────────────────────────────────────────────
const ADDR_RX: Record<string, RegExp[]> = {
  ADDRESS1: [/^address$/i, /address\s*(line\s*)?1$/i, /addr1/i, /street/i],
  ADDRESS2: [/address\s*(line\s*)?2/i, /addr2/i, /suite/i, /apt\b/i, /unit\b/i],
  CITY: [/^city$/i, /\bcity\b/i, /\btown\b/i],
  REGION: [/\bstate\b/i, /\bprovince\b/i, /\bregion\b/i],
  POSTALCODE: [/postal/i, /zip/i, /post\s*code/i, /postcode/i],
  COUNTRY: [/\bcountry\b/i, /\bnation\b/i],
};

const ADDR_LINE_MAP: Record<number, string> = {
  1: "ADDRESS1",
  2: "ADDRESS2",
  3: "CITY",
  4: "REGION",
};

export function matchAddress(header: string): MatchResult | null {
  for (const [field, patterns] of Object.entries(ADDR_RX))
    for (const rx of patterns)
      if (rx.test(header)) return { field, score: 0.9, method: "address" };

  const m = header.match(/address\s*(?:line\s*)?(\d)/i);
  if (m) {
    const n = parseInt(m[1]);
    const field = ADDR_LINE_MAP[n];
    return field ? { field, score: 0.85, method: "address" } : null;
  }
  return null;
}

// ── Key fields (account / name) ──────────────────────────────────────────────
export function matchKey(header: string): MatchResult | null {
  if (
    /account\s*(num|number|no|id|#)?$/i.test(header) ||
    /^acc\s*(no|num|id)?$/i.test(header) ||
    /customer\s*(id|no|num)/i.test(header) ||
    /child\s*(number|no|num|#)/i.test(header)
  )
    return { field: "ACCOUNTNUMBER", score: 0.92, method: "heuristic" };

  if (
    /^name$/i.test(header.trim()) ||
    /customer\s*name/i.test(header) ||
    /client\s*name/i.test(header) ||
    /company\s*name/i.test(header) ||
    /child\s*name/i.test(header)
  )
    return { field: "NAME", score: 0.92, method: "heuristic" };

  return null;
}

// ── Best match (priority chain) ──────────────────────────────────────────────
export function bestMatch(header: string, candidates: string[]): MatchResult {
  const k = matchKey(header);
  if (k) return k;

  const ag = matchAging(header);
  if (ag) return ag;

  const ad = matchAddress(header);
  if (ad) return ad;

  let best: string | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const s = stringSimilarity(header, c);
    if (s > bestScore) { bestScore = s; best = c; }
  }
  if (bestScore < 0.3) return { field: "IGNORE", score: 0, method: "fuzzy" };
  return { field: best!, score: bestScore, method: "fuzzy" };
}
