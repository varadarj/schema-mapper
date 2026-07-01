import type { ColumnMapping } from "./mapping.ts";
import { AGING_FIELDS, INVOICE_FIELDS } from "./matchers.ts";

export interface CodeGenOutput {
  cs: string;
}

// Aging providers carry AR aging buckets (DEBTCURRENT…DEBT91PLUS); invoice
// providers carry raw invoice rows (INVDATE/DUEDATE/INVAMT) converted to aging.
export type ProviderMode = "aging" | "invoice";

// A single mapped source file: its runtime filename keyword + column mappings.
// `role` is only used for the two-file case to name vars custFile / agingFile.
export interface MappingSource {
  keyword: string;
  mappings: ColumnMapping[];
  role?: "customer" | "aging";
}

function toPascal(s: string): string {
  return s
    .replace(/(?:^|[\s_\-\.])(\w)/g, (_, c: string) => c.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, "");
}

const AGING_VAR_MAP: Record<string, string> = {
  DEBTCURRENT: "debtCurr",
  DEBT30DAY: "debt30D",
  DEBT60DAY: "debt60D",
  DEBT90DAY: "debt90D",
  DEBT91PLUS: "debt91P",
};

const STR_FIELDS = new Set([
  "NAME", "ADDRESS1", "ADDRESS2", "CITY", "REGION", "POSTALCODE", "COUNTRY",
]);

function isAging(field: string): boolean {
  return (AGING_FIELDS as readonly string[]).includes(field);
}

function isInvoice(field: string): boolean {
  return (INVOICE_FIELDS as readonly string[]).includes(field);
}

// ── FixRawData map lines for one source (dspField index restarts at 0) ────────
// DEBT91PLUS: single -> "DEBT91PLUS", multiple -> "DEBT91PLUS1", "DEBT91PLUS2", ...
function buildMapLines(mapped: ColumnMapping[]): string {
  const debt91Total = mapped.filter((m) => m.mappedTo === "DEBT91PLUS").length;
  let debt91Count = 0;
  return mapped
    .map((m, di) => {
      let dspName = m.mappedTo;
      if (m.mappedTo === "DEBT91PLUS") {
        ++debt91Count;
        dspName = debt91Total === 1 ? "DEBT91PLUS" : `DEBT91PLUS${debt91Count}`;
      }
      return `        map.Add(new FileField("${m.excelHeader}", ${m.excelIndex}), new DspField("${dspName}", ${di}));`;
    })
    .join("\n");
}

// Invoice/aging files: the not-null signal is a value field, not the key.
const INVOICE_FILTER_PRIORITY = ["INVDATE", "INVAMT", "DUEDATE"];

// ── FixRawData .Where() — filter empty rows and header bleed-through ──────────
// Field priority: (1) an invoice value field if present (the row's "has data"
// signal on an aging/invoice file), else (2) the shared join column so every
// file filters on the same column, else (3) ACCOUNTNUMBER/NAME (single file).
function buildWhereClause(mapped: ColumnMapping[], joinKey: string): string {
  const has = (f: string) => mapped.some((m) => m.mappedTo === f);

  let field = INVOICE_FILTER_PRIORITY.find((f) => has(f)) ?? "";
  if (!field && joinKey && has(joinKey)) field = joinKey;
  if (!field) field = has("ACCOUNTNUMBER") ? "ACCOUNTNUMBER" : "NAME";

  const header = mapped.find((m) => m.mappedTo === field)?.excelHeader ?? "";
  return header
    ? `R["${field}"].ToString().Trim().Length > 0\n                           && !R["${field}"].ToString().Equals("${header}", StringComparison.OrdinalIgnoreCase)`
    : `R["${field}"].ToString().Trim().Length > 0`;
}

// ── ODBC schema column name (AR aging fields get a "C" suffix) ────────────────
// DEBT91PLUS: 1 column -> DEBT91PLUSC, multiple -> DEBT91PLUSC1, DEBT91PLUSC2, ...
function makeSchemaColNamer(mapped: ColumnMapping[]): (mappedTo: string) => string {
  const debt91Total = mapped.filter((m) => m.mappedTo === "DEBT91PLUS").length;
  let debt91Count = 0;
  return (mappedTo: string): string => {
    if (mappedTo === "DEBT91PLUS") {
      ++debt91Count;
      return debt91Total === 1 ? "DEBT91PLUSC" : `DEBT91PLUSC${debt91Count}`;
    }
    if (isAging(mappedTo) || isInvoice(mappedTo)) return `${mappedTo}C`;
    return mappedTo;
  };
}

function buildSchemaLines(mapped: ColumnMapping[]): string {
  const schemaColName = makeSchemaColNamer(mapped);
  return mapped
    .map((m, di) => `            "Col${di + 1}=${schemaColName(m.mappedTo)} char\\r\\n"`)
    .join(" + \n");
}

// ── ProviderScrub body over a (deduped) list of mapped fields ─────────────────
function buildScrubBody(mapped: ColumnMapping[], mode: ProviderMode): string {
  // string fields (handled identically in both provider types)
  const strMapped = mapped.filter((m) => STR_FIELDS.has(m.mappedTo));
  const strDecls = strMapped
    .map((m) => `        string ${m.mappedTo.toLowerCase()} = string.Empty;`)
    .join("\n");
  const strReads = strMapped
    .map((m) => `            ${m.mappedTo.toLowerCase()} = dr["${m.mappedTo}"].ToString().ToUpper().Trim();`)
    .join("\n");
  const strAssigns = strMapped
    .map((m) => `            dr["${m.mappedTo}"] = ${m.mappedTo.toLowerCase()};`)
    .join("\n");

  if (mode === "invoice") return buildInvoiceScrub(mapped, strDecls, strReads, strAssigns);

  // aging fields
  const agingMapped = mapped.filter((m) => isAging(m.mappedTo));
  const hasAging = agingMapped.length > 0;
  const agingDecl = hasAging
    ? "        decimal debtCurr=0M, debt30D=0M, debt60D=0M, debt90D=0M, debt91P=0M;"
    : "";

  const debt91Total = agingMapped.filter((m) => m.mappedTo === "DEBT91PLUS").length;
  let debt91Count = 0;
  const agingReads = agingMapped
    .map((m) => {
      const v = AGING_VAR_MAP[m.mappedTo];
      if (!v) return "";
      if (m.mappedTo === "DEBT91PLUS") {
        ++debt91Count;
        const colKey = debt91Total === 1 ? "DEBT91PLUSC" : `DEBT91PLUSC${debt91Count}`;
        // first DEBT91PLUS uses =, subsequent use +=
        const op = debt91Count === 1 ? "=" : "+=";
        return `            ${v} ${op} (dr["${colKey}"] == DBNull.Value) ? 0M : Convert.ToDecimal(_ut.CleanNumeric(dr["${colKey}"]));`;
      }
      const colKey = m.mappedTo + "C";
      return `            ${v} = (dr["${colKey}"] == DBNull.Value) ? 0M : Convert.ToDecimal(_ut.CleanNumeric(dr["${colKey}"]));`;
    })
    .filter(Boolean)
    .join("\n");

  const agingAssigns = hasAging
    ? `            dr["DEBTCURRENT"] = debtCurr;\n            dr["DEBT30DAY"] = debt30D;\n            dr["DEBT60DAY"] = debt60D;\n            dr["DEBT90DAY"] = debt90D;\n            dr["DEBT91PLUS"] = debt91P;`
    : "";

  return `${strDecls}
${agingDecl}

        foreach (DataRow dr in dt.Rows)
        {
${strReads}

${agingReads}

${strAssigns}

${agingAssigns}
        }
        dt.AcceptChanges();`;
}

// ── Invoice ProviderScrub — raw invoice rows → parsed dates / amount, then
// converted to aging buckets. Only emits lines for the invoice fields actually
// mapped; the provider-specific scrub rules from the examples are NOT included.
function buildInvoiceScrub(
  mapped: ColumnMapping[],
  strDecls: string,
  strReads: string,
  strAssigns: string
): string {
  const dateFields = mapped.filter(
    (m) => m.mappedTo === "INVDATE" || m.mappedTo === "DUEDATE"
  );
  const hasDates = dateFields.length > 0;
  const hasAmt = mapped.some((m) => m.mappedTo === "INVAMT");

  const declLines: string[] = [];
  if (strDecls) declLines.push(strDecls);
  if (hasAmt) declLines.push("        decimal invamt = 0M;");
  if (hasDates)
    declLines.push(
      '        string[] dateFormat = new string[] { "M/d/yyyy", "MM/dd/yyyy", "M/d/yy", "MM/dd/yy" };'
    );
  const declBlock = declLines.join("\n");

  // On a parse failure, reset the primary date (INVDATE if mapped, else DUEDATE).
  const catchField = dateFields.some((m) => m.mappedTo === "INVDATE")
    ? "INVDATE"
    : dateFields[0]?.mappedTo;
  const dateBlock = hasDates
    ? `            try
            {
${dateFields.map((m) => `                dr["${m.mappedTo}"] = _ut.ParseStringAsDate(dr["${m.mappedTo}C"].ToString(), dateFormat);`).join("\n")}
            }
            catch
            {
                dr["${catchField}"] = DateTime.MinValue;
            }`
    : "";

  const amtBlock = hasAmt
    ? `            invamt = dr["INVAMTC"] == DBNull.Value ? 0M : Convert.ToDecimal(_ut.CleanNumeric(dr["INVAMTC"]));

            dr["INVAMT"] = Convert.ToInt64(invamt);`
    : "";

  const loopParts = [strReads, dateBlock, amtBlock, strAssigns].filter(Boolean).join("\n\n");

  return `${declBlock}

        SUtility.AddInvoiceRelatedColumns(dt);

        foreach (DataRow dr in dt.Rows)
        {
${loopParts}
        }
        dt.AcceptChanges();

        ConvertInvoiceToAging converter = new ConvertInvoiceToAging();
        converter.CreateAgingValues(_submissionId, dt, _log);`;
}

// ── Union of mapped fields across all sources ─────────────────────────────────
// Dedupes by DSP field (preserving first occurrence) so the joined table's
// schema/scrub lists each column once. DEBT91PLUS may repeat (summation), so it
// is exempt from de-duplication to keep its multi-column numbering.
function unionMapped(sources: MappingSource[]): ColumnMapping[] {
  const seen = new Set<string>();
  const out: ColumnMapping[] = [];
  for (const src of sources) {
    for (const m of src.mappings) {
      if (m.mappedTo === "IGNORE") continue;
      if (m.mappedTo !== "DEBT91PLUS") {
        if (seen.has(m.mappedTo)) continue;
        seen.add(m.mappedTo);
      }
      out.push(m);
    }
  }
  return out;
}

// ── Single-file template (unchanged output) ───────────────────────────────────
function generateSingle(mapped: ColumnMapping[], className: string, mode: ProviderMode, joinKey: string): CodeGenOutput {
  const mapLines = buildMapLines(mapped);
  const schemaLines = buildSchemaLines(mapped);
  const whereClause = buildWhereClause(mapped, joinKey);
  const scrubBody = buildScrubBody(mapped, mode);

  const cs = `public class ${className} : StandardProcessor
{
    protected override void FixRawData(string filePath, ref string fileName)
    {
        DSPFieldMapping map = new DSPFieldMapping();
${mapLines}

        DataTable dt = this.GetMappedDataTable(map, filePath, fileName)
                           .AsEnumerable()
                           .Where(R => ${whereClause})
                           .CopyToDataTable();

        _ut.ExportToTextFile(dt, filePath + (fileName = "FixedRawData.csv"), ",", true, true);
    }

    protected override void CreateODBCSchemaFile(string filePath, string fileName)
    {
        string schemaText = "[" + fileName + "]\\r\\n" +
            "ColNameHeader=True\\r\\n" +
            "Format=Delimited(,)\\r\\n" +
            "MaxScanRows=0\\r\\n" +
            "CharacterSet=65001\\r\\n" +
${schemaLines};

        File.WriteAllText(filePath + "schema.ini", schemaText);
        _commandText = "SELECT * FROM [" + fileName + "]";
    }

    protected override void ProviderScrub(DataTable dt)
    {
${scrubBody}
    }
}`;

  return { cs };
}

// ── Multi-file template (split → identify by keyword → per-file map → join) ────
function generateMulti(
  sources: MappingSource[],
  className: string,
  joinKey: string,
  mode: ProviderMode
): CodeGenOutput {
  const n = sources.length;

  // Sanitize keywords for matching; fall back to FILE1/FILE2/... if blank.
  const keywords = sources.map(
    (s, i) => (s.keyword || `FILE${i + 1}`).toUpperCase().trim()
  );

  // Variable names. For the two-file case, name by role (custFile / agingFile,
  // dtCust / dtAging); otherwise use generic file0/file1/… and dt0/dt1/….
  const useRoles = n === 2 && sources.every((s) => s.role);
  const fileVar = (i: number) =>
    useRoles ? (sources[i].role === "customer" ? "custFile" : "agingFile") : `file${i}`;
  const dtVar = (i: number) =>
    useRoles ? (sources[i].role === "customer" ? "dtCust" : "dtAging") : `dt${i}`;

  // file variable declarations
  const fileDecls = keywords
    .map((_, i) => `        string ${fileVar(i)} = string.Empty;`)
    .join("\n");

  // keyword-based identification loop
  const idBranches = keywords
    .map((kw, i) => {
      const head = i === 0 ? "if" : "else if";
      return `            ${head} (name.Contains("${kw}")) ${fileVar(i)} = name;`;
    })
    .join("\n");

  // missing-file guard
  const missingCheck = keywords
    .map((_, i) => `${fileVar(i)}.Length == 0`)
    .join(" || ");
  const expecting = keywords.map((kw) => `'${kw}'`).join(", ");

  // per-file mapping + GetMappedDataTable
  const fileBlocks = sources
    .map((src, i) => {
      const mapped = src.mappings.filter((m) => m.mappedTo !== "IGNORE");
      const mapLines = buildMapLines(mapped);
      const whereClause = buildWhereClause(mapped, joinKey);
      const decl = i === 0 ? "DSPFieldMapping map = new DSPFieldMapping();" : "map = new DSPFieldMapping();";
      return `        ${decl}
${mapLines}

        DataTable ${dtVar(i)} = this.GetMappedDataTable(map, filePath, ${fileVar(i)})
                           .AsEnumerable()
                           .Where(R => ${whereClause})
                           .CopyToDataTable();`;
    })
    .join("\n\n");

  // chained joins on the shared key (customer table first when roles are known)
  const joinCol = (v: string) => `${v}.Columns["${joinKey}"]`;
  let joinBlock: string;
  if (n === 2) {
    const a = useRoles ? "dtCust" : "dt0";
    const b = useRoles ? "dtAging" : "dt1";
    joinBlock = `        DataTable dt = SUtility.JoinDataTables(${a}, ${b}, ${joinCol(a)}, ${joinCol(b)}, false);`;
  } else {
    const lines = [
      `        DataTable dt = SUtility.JoinDataTables(dt0, dt1, ${joinCol("dt0")}, ${joinCol("dt1")}, false);`,
    ];
    for (let i = 2; i < n; i++) {
      lines.push(
        `        dt = SUtility.JoinDataTables(dt, dt${i}, ${joinCol("dt")}, ${joinCol(`dt${i}`)}, false);`
      );
    }
    joinBlock = lines.join("\n");
  }

  // union schema + scrub
  const union = unionMapped(sources);
  const schemaLines = buildSchemaLines(union);
  const scrubBody = buildScrubBody(union, mode);

  const cs = `public class ${className} : StandardProcessor
{
    protected override void FixRawData(string filePath, ref string fileName)
    {
        string[] files = fileName.ToUpper().Split(',');
        SUtility.CheckForFileCount(files, ${n});

${fileDecls}

        foreach (string f in files)
        {
            string name = f.Trim();
${idBranches}
        }

        if (${missingCheck})
            throw new Exception("Expected files not found. Expecting ${expecting}");

${fileBlocks}

${joinBlock}

        _ut.ExportToTextFile(dt, filePath + (fileName = "FixedRawData.csv"), ",", true, true);
    }

    protected override void CreateODBCSchemaFile(string filePath, string fileName)
    {
        string schemaText = "[" + fileName + "]\\r\\n" +
            "ColNameHeader=True\\r\\n" +
            "Format=Delimited(,)\\r\\n" +
            "MaxScanRows=0\\r\\n" +
            "CharacterSet=65001\\r\\n" +
${schemaLines};

        File.WriteAllText(filePath + "schema.ini", schemaText);
        _commandText = "SELECT * FROM [" + fileName + "]";
    }

    protected override void ProviderScrub(DataTable dt)
    {
${scrubBody}
    }
}`;

  return { cs };
}

export function generateCSharp(
  sources: MappingSource[],
  className: string,
  joinKey: string,
  mode: ProviderMode = "aging"
): CodeGenOutput {
  const usable = sources.filter((s) =>
    s.mappings.some((m) => m.mappedTo !== "IGNORE")
  );
  if (!usable.length) return { cs: "" };

  if (usable.length === 1) {
    const mapped = usable[0].mappings.filter((m) => m.mappedTo !== "IGNORE");
    return generateSingle(mapped, className, mode, joinKey);
  }

  return generateMulti(usable, className, joinKey, mode);
}

export { toPascal };
