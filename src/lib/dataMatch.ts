import type { ColumnMapping, ExcelData, MatchAlternative } from "./mapping.ts";
import { confidenceFromScore } from "./mapping.ts";
import { stringSimilarity } from "./fuzzy.ts";

// ── Source ↔ Target matching by DATA SHAPE + SEMANTIC NAME ───────────────────
// No key join / no value overlap. Each column is matched by:
//   1. data shape — value pattern mask, type class, length (with a type veto:
//      a date column can't map to a phone/number/text column, etc.)
//   2. semantic header-name similarity — weighted concept overlap (generic words
//      like name/date/id count for little) + fuzzy fallback
// A mapping must clear a NAME floor (the headers must actually relate); otherwise
// it's left as IGNORE. Low-confidence picks use the most semantic target.

const SHAPE_WEIGHT = 0.5;
const NAME_WEIGHT = 0.5;
const MED = 0.55; // at/above this combined score we trust the score
const NAME_FLOOR = 0.35; // a mapping requires at least this much name relatedness
const ALT_BAND = 0.05; // "other potential mappings" within this much of the chosen score
const MIN_NONEMPTY = 20; // values needed before a column's shape/type is trusted

// ── Data shape ───────────────────────────────────────────────────────────────
function shapeMask(v: string): string {
  let out = "";
  let prev = "";
  for (const ch of v.trim()) {
    if (ch >= "0" && ch <= "9") {
      if (prev !== "9") out += "9";
      prev = "9";
    } else if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z")) {
      if (prev !== "A") out += "A";
      prev = "A";
    } else {
      out += ch;
      prev = "";
    }
  }
  return out;
}

type TypeClass = "date" | "email" | "number" | "text" | "unknown";

const isDate = (v: string) => /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}([ T].*)?$/.test(v);
const isEmail = (v: string) => v.includes("@") && /\.[a-z]{2,}$/i.test(v);
const isNumber = (v: string) => /^-?[\d,]*\.?\d+$/.test(v.replace(/[$£€\s]/g, ""));

interface ColumnProfile {
  dominantMask: string;
  avgLen: number;
  numericRatio: number;
  nonEmpty: number;
  typeClass: TypeClass;
}

function profileColumn(data: ExcelData, colIndex: number): ColumnProfile {
  const masks = new Map<string, number>();
  let count = 0;
  let lenSum = 0;
  let numeric = 0;
  let dates = 0;
  let emails = 0;
  for (const row of data.sampleRows) {
    const raw = String(row[colIndex] ?? "").trim();
    if (raw === "") continue;
    count++;
    lenSum += raw.length;
    masks.set(shapeMask(raw), (masks.get(shapeMask(raw)) ?? 0) + 1);
    if (isDate(raw)) dates++;
    else if (isEmail(raw)) emails++;
    if (isNumber(raw)) numeric++;
  }
  let dominantMask = "";
  let best = 0;
  for (const [m, c] of masks) if (c > best) { best = c; dominantMask = m; }

  let typeClass: TypeClass = "unknown";
  if (count >= MIN_NONEMPTY) {
    if (dates / count > 0.6) typeClass = "date";
    else if (emails / count > 0.6) typeClass = "email";
    else if (numeric / count > 0.8) typeClass = "number";
    else typeClass = "text";
  }

  return {
    dominantMask,
    avgLen: count ? lenSum / count : 0,
    numericRatio: count ? numeric / count : 0,
    nonEmpty: count,
    typeClass,
  };
}

// Hard type mismatches (date/email are distinctive) can't be the same field.
function typeCompatible(a: ColumnProfile, b: ColumnProfile): boolean {
  const ta = a.typeClass;
  const tb = b.typeClass;
  if (ta === "unknown" || tb === "unknown") return true;
  if (ta === tb) return true;
  if (ta === "date" || tb === "date") return false;
  if (ta === "email" || tb === "email") return false;
  return true; // number vs text is allowed (codes are often stored as text)
}

function shapeSimilarity(a: ColumnProfile, b: ColumnProfile): number {
  // Too few real values → don't let two mostly-empty columns match on emptiness.
  if (a.nonEmpty < MIN_NONEMPTY || b.nonEmpty < MIN_NONEMPTY) return 0;
  if (!typeCompatible(a, b)) return 0.1; // wrong data type → not the same field
  const maskEq = a.dominantMask && a.dominantMask === b.dominantMask
    ? 1
    : stringSimilarity(a.dominantMask, b.dominantMask);
  const typeAgree = 1 - Math.abs(a.numericRatio - b.numericRatio);
  const lenSim = 1 - Math.min(1, Math.abs(a.avgLen - b.avgLen) / Math.max(a.avgLen, b.avgLen, 1));
  return 0.5 * maskEq + 0.25 * typeAgree + 0.25 * lenSim;
}

// ── Semantic header-name similarity (AR + PII domain) ────────────────────────
// Concepts are SPECIFIC where it matters; deliberately NO generic "line",
// "value", "number", "code" entries (they matched everything).
const CONCEPTS: Record<string, string[]> = {
  ID: ["id", "identifier", "ecid", "orbisid", "bvdid", "multiid", "lei", "duns", "uid", "guid", "recordid", "rowid"],
  ACCOUNT: ["account", "accountnumber", "acctno", "accountno", "customerid", "customernumber", "debtorid", "loanid", "agreementid", "providerid"],
  NAME: ["name", "fullname", "legalname", "companyname", "businessname", "entityname", "customername", "debtorname", "clientname", "accountname"],
  FIRSTNAME: ["firstname", "fname", "givenname", "forename"],
  MIDDLENAME: ["middlename", "mname", "middleinitial"],
  LASTNAME: ["lastname", "lname", "surname", "familyname"],
  SUFFIX: ["suffix", "namesuffix"],
  PREFIX: ["prefix", "salutation", "honorific", "title"],
  DBA: ["dba", "tradename", "alternatename", "aka", "alias"],
  DOB: ["dob", "dateofbirth", "birthdate", "birthday"],
  SSN: ["ssn", "socialsecurity", "socialsecuritynumber", "sin", "nationalid"],
  TAXID: ["taxid", "tin", "ein", "fein", "vat", "vatnumber"],
  GENDER: ["gender", "sex"],
  ETHNICITY: ["ethnicity", "race"],
  EMAIL: ["email", "emailaddress"],
  PHONE: ["phone", "telephone", "tel", "mobile", "cell", "phonenumber", "cellphone", "homephone", "workphone"],
  FAX: ["fax", "faxnumber"],
  WEBSITE: ["website", "url", "domain", "homepage"],
  ADDRESS: ["address", "addr", "street", "thoroughfare", "addressline", "address1", "address2", "mailingaddress", "streetaddress", "premise", "building"],
  CITY: ["city", "town", "municipality", "locality"],
  REGION: ["state", "province", "region", "administrativearea", "county", "territory"],
  COUNTRY: ["country", "nation", "countryname", "domesticcountry"],
  POSTAL: ["postal", "postalcode", "postcode", "zip", "zipcode"],
  AMOUNT: ["amount", "balance", "total", "owed", "outstanding", "amountdue", "pastdue", "principal", "openbalance", "currentbalance", "originalamount"],
  PAYMENT: ["payment", "amountpaid", "remittance"],
  CHARGE: ["charge", "fee", "interest", "penalty"],
  INVOICE: ["invoice", "invoiceno", "invoicenumber", "billno", "billnumber"],
  AGING: ["aging", "bucket", "dayspastdue", "daysoverdue", "dpd", "overdue"],
  CREDITLIMIT: ["creditlimit", "creditline"],
  CREDITSCORE: ["creditscore", "fico", "riskscore"],
  CURRENCY: ["currency"],
  DATE: ["date", "day", "datetime", "timestamp"],
  LATITUDE: ["lat", "latitude", "geolat"],
  LONGITUDE: ["lon", "lng", "longitude", "geolng"],
  INDUSTRY: ["industry", "sic", "naics", "classification", "sector"],
  ISOCODE: ["iso", "iso31662", "iso31663", "iso3166n", "countrycode"],
};

// Generic concepts that appear all over a schema → low weight so sharing only
// these doesn't make two unrelated columns look related.
const CONCEPT_WEIGHT: Record<string, number> = {
  NAME: 0.4, DATE: 0.4, ID: 0.5, ACCOUNT: 0.6, STATUS: 0.5, ISOCODE: 0.6,
};
const weightOf = (c: string) => CONCEPT_WEIGHT[c] ?? 1;

const ABBREV: Record<string, string> = {
  addr: "address", amt: "amount", bal: "balance", tel: "phone",
  fname: "firstname", lname: "lastname", mname: "middlename",
  ssn: "socialsecurity", dob: "dateofbirth", dpd: "dayspastdue",
  cust: "customer", acct: "account",
};

const TOKEN_CONCEPT = new Map<string, string>();
for (const [concept, words] of Object.entries(CONCEPTS))
  for (const w of words) TOKEN_CONCEPT.set(w, concept);

function nameTokens(header: string): string[] {
  return header
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([A-Za-z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((t) => (t in ABBREV ? ABBREV[t] : t))
    .filter(Boolean);
}

function conceptsOf(header: string): Set<string> {
  const concepts = new Set<string>();
  const toks = nameTokens(header);
  for (const t of toks) if (TOKEN_CONCEPT.has(t)) concepts.add(TOKEN_CONCEPT.get(t)!);
  const joined = toks.join("");
  if (TOKEN_CONCEPT.has(joined)) concepts.add(TOKEN_CONCEPT.get(joined)!);
  return concepts;
}

// Concepts so generic that sharing ONLY one of them isn't evidence of a match
// (every date column shares DATE, every name column shares NAME, etc.). A match
// must be carried by a more specific shared concept; otherwise we fall back to
// literal name similarity so the distinguishing words (incorporation vs customer)
// decide it.
const GENERIC_ONLY = new Set(["NAME", "DATE", "STATUS"]);

// Structural filler words shared by many headers — ignored in the string-
// similarity fallback so the distinctive words (value vs name) decide, not the
// shared suffix (…_code, …_number, …_type).
const STOP = new Set([
  "code", "number", "no", "num", "type", "category", "index", "idx", "value",
  "std", "standardized", "ct", "cln", "orig", "original", "prev", "previous", "reported",
]);

function coreString(header: string): string {
  const core = nameTokens(header).filter((t) => !STOP.has(t));
  return (core.length ? core : nameTokens(header)).join(" ");
}

function semanticNameSim(a: string, b: string): number {
  const ca = conceptsOf(a);
  const cb = conceptsOf(b);
  let conceptScore = 0;
  const hasSpecificShared = [...ca].some((c) => cb.has(c) && !GENERIC_ONLY.has(c));
  if (hasSpecificShared) {
    let interW = 0;
    let unionW = 0;
    const all = new Set([...ca, ...cb]);
    for (const c of all) {
      const w = weightOf(c);
      unionW += w;
      if (ca.has(c) && cb.has(c)) interW += w;
    }
    conceptScore = unionW ? interW / unionW : 0; // weighted Jaccard
  }
  return Math.max(conceptScore, stringSimilarity(coreString(a), coreString(b)));
}

function pairScore(ps: ColumnProfile, pt: ColumnProfile, sHeader: string, tHeader: string) {
  const shape = shapeSimilarity(ps, pt);
  const name = semanticNameSim(sHeader, tHeader);
  return { score: SHAPE_WEIGHT * shape + NAME_WEIGHT * name, shape, name };
}

function sampleValsFor(data: ExcelData, colIndex: number): string[] {
  return data.sampleRows.slice(0, 5).map((r) => String(r[colIndex] ?? "")).filter((v) => v !== "");
}

interface Scored {
  ti: number;
  targetHeader: string;
  score: number;
  shape: number;
  name: number;
  eligible: boolean; // name relates AND types are compatible
}

export function buildDataMappings(source: ExcelData, target: ExcelData): ColumnMapping[] {
  const sP = source.headers.map((_, i) => profileColumn(source, i));
  const tP = target.headers.map((_, i) => profileColumn(target, i));

  interface Decision {
    cands: Scored[];
    chosen: Scored | null;
    semantic: boolean;
    bestName: number;
  }
  const decided: Decision[] = source.headers.map((sHeader, si) => {
    const cands: Scored[] = target.headers
      .map((tHeader, ti) => {
        const { score, shape, name } = pairScore(sP[si], tP[ti], sHeader, tHeader);
        const eligible = name >= NAME_FLOOR && typeCompatible(sP[si], tP[ti]);
        return { ti, targetHeader: tHeader, score, shape, name, eligible };
      })
      .sort((a, b) => b.score - a.score);

    const eligible = cands.filter((c) => c.eligible);
    let chosen: Scored | null = null;
    let semantic = false;
    if (eligible.length) {
      const byScore = eligible[0]; // already score-sorted
      if (byScore.score >= MED) {
        chosen = byScore;
      } else {
        // low confidence → the most semantically related eligible target
        chosen = eligible.reduce((m, c) => (c.name > m.name ? c : m), eligible[0]);
        semantic = true;
      }
    }
    const bestName = cands.reduce((m, c) => Math.max(m, c.name), 0);
    return { cands, chosen, semantic, bestName };
  });

  // Resolve target uniqueness: highest-scoring chosen wins; conflicts unmap.
  const order = decided
    .map((d, si) => ({ d, si }))
    .filter((x) => x.d.chosen)
    .sort((a, b) => b.d.chosen!.score - a.d.chosen!.score);
  const taken = new Set<number>();
  const assigned = new Set<number>();
  for (const { d, si } of order) {
    if (taken.has(d.chosen!.ti)) continue;
    taken.add(d.chosen!.ti);
    assigned.add(si);
  }

  return source.headers.map((header, si) => {
    const d = decided[si];
    const keep = d.chosen && assigned.has(si);
    const mappedTo = keep ? d.chosen!.targetHeader : "IGNORE";
    const score = keep ? d.chosen!.score : 0;

    const ref = keep ? d.chosen!.score : d.cands[0]?.score ?? 0;
    let alts = d.cands
      .filter((c) => !(keep && c.ti === d.chosen!.ti))
      .filter((c) => c.score > 0.05 && c.score >= ref - ALT_BAND)
      .slice(0, 5);
    if (!keep && alts.length === 0) alts = d.cands.filter((c) => c.score > 0.05).slice(0, 3);
    const alternatives: MatchAlternative[] = alts.map((c) => ({
      target: c.targetHeader,
      score: c.score,
      name: c.name,
    }));

    let reason: string;
    if (keep) {
      reason = d.semantic
        ? `low score — picked most semantic (name ${Math.round(d.chosen!.name * 100)}%, shape ${Math.round(d.chosen!.shape * 100)}%)`
        : `data shape ${Math.round(d.chosen!.shape * 100)}% · name ${Math.round(d.chosen!.name * 100)}%`;
    } else if (d.chosen) {
      reason = `left unmapped — ${d.chosen.targetHeader} taken by a higher-scoring column`;
    } else {
      reason = `left unmapped — no related target (best name ${Math.round(d.bestName * 100)}%)`;
    }

    return {
      excelIndex: si,
      excelHeader: header,
      sampleVals: sampleValsFor(source, si),
      mappedTo,
      score,
      confidence: confidenceFromScore(mappedTo, score),
      method: "data" as const,
      required: false,
      reason,
      alternatives,
    };
  });
}

// Actual combined score for a manually-chosen target — overrides show the real %.
export function scoreColumnPair(
  source: ExcelData,
  target: ExcelData,
  sourceIdx: number,
  targetHeader: string
): { score: number; reason: string } {
  const ti = target.headers.indexOf(targetHeader);
  if (ti < 0) return { score: 1, reason: "manually assigned" };
  const { score, shape, name } = pairScore(
    profileColumn(source, sourceIdx),
    profileColumn(target, ti),
    source.headers[sourceIdx],
    targetHeader
  );
  return { score, reason: `manually set — data shape ${Math.round(shape * 100)}% · name ${Math.round(name * 100)}%` };
}

// ── Generic conflict handling ────────────────────────────────────────────────
export function findDataConflict(mappings: ColumnMapping[], newField: string, rowIdx: number): number {
  if (newField === "IGNORE") return -1;
  return mappings.findIndex((m, i) => i !== rowIdx && m.mappedTo === newField);
}

export function applyDataMappingChange(
  mappings: ColumnMapping[],
  rowIdx: number,
  newField: string,
  scoreInfo?: { score: number; reason: string }
): ColumnMapping[] {
  const result = mappings.map((m) => ({ ...m }));
  const isIgnore = newField === "IGNORE";
  const score = isIgnore ? 0 : scoreInfo?.score ?? 1;
  result[rowIdx] = {
    ...result[rowIdx],
    mappedTo: newField,
    score,
    confidence: confidenceFromScore(newField, score),
    reason: isIgnore ? "manually set to IGNORE" : scoreInfo?.reason ?? "manually assigned",
  };
  return result;
}
