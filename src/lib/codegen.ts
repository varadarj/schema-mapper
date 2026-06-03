import type { ColumnMapping } from "./mapping";
import { AGING_FIELDS } from "./matchers";

export interface CodeGenOutput {
  cs: string;
  ini: string;
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

export function generateCSharp(
  mappings: ColumnMapping[],
  className: string
): CodeGenOutput {
  const mapped = mappings.filter((m) => m.mappedTo !== "IGNORE");
  if (!mapped.length) return { cs: "", ini: "" };

  // ── FixRawData mappings ──
  const mapLines = mapped
    .map(
      (m, di) =>
        `        map.Add(new FileField("${m.excelHeader}", ${m.excelIndex}), new DspField("${m.mappedTo}", ${di}));`
    )
    .join("\n");

  // ── ODBC schema ──
  // AR aging fields get a "C" suffix (e.g. DEBTCURRENTC, DEBT30DAYC)
  // DEBT91PLUS: if only 1 column -> DEBT91PLUSC, if multiple -> DEBT91PLUSC1, DEBT91PLUSC2, ...
  const debt91Total = mapped.filter((m) => m.mappedTo === "DEBT91PLUS").length;
  let debt91SchemaCount = 0;
  function schemaColName(mappedTo: string): string {
    if (mappedTo === "DEBT91PLUS") {
      ++debt91SchemaCount;
      return debt91Total === 1 ? "DEBT91PLUSC" : `DEBT91PLUSC${debt91SchemaCount}`;
    }
    if ((AGING_FIELDS as readonly string[]).includes(mappedTo)) return `${mappedTo}C`;
    return mappedTo;
  }
  const schemaLines = mapped
    .map((m, di) => `            "Col${di + 1}=${schemaColName(m.mappedTo)} char\\r\\n"`)
    .join(" + \n");

  // ── ProviderScrub — string fields ──
  const strMapped = mapped.filter((m) => STR_FIELDS.has(m.mappedTo));
  const strDecls = strMapped
    .map((m) => `        string ${m.mappedTo.toLowerCase()} = string.Empty;`)
    .join("\n");
  const strReads = strMapped
    .map(
      (m) =>
        `            ${m.mappedTo.toLowerCase()} = dr["${m.mappedTo}"].ToString().ToUpper().Trim();`
    )
    .join("\n");
  const strAssigns = strMapped
    .map((m) => `            dr["${m.mappedTo}"] = ${m.mappedTo.toLowerCase()};`)
    .join("\n");

  // ── ProviderScrub — aging fields ──
  const agingMapped = mapped.filter((m) =>
    (AGING_FIELDS as readonly string[]).includes(m.mappedTo)
  );
  const hasAging = agingMapped.length > 0;
  const agingDecl = hasAging
    ? "\n        decimal debtCurr=0M, debt30D=0M, debt60D=0M, debt90D=0M, debt91P=0M;"
    : "";

  const debt91AgingTotal = agingMapped.filter((m) => m.mappedTo === "DEBT91PLUS").length;
  let debt91Count = 0;
  const agingReads = agingMapped
    .map((m) => {
      const v = AGING_VAR_MAP[m.mappedTo];
      if (!v) return "";
      if (m.mappedTo === "DEBT91PLUS") {
        ++debt91Count;
        // single DEBT91PLUS -> DEBT91PLUSC with =, multiple -> DEBT91PLUSCn with +=
        const colKey = debt91AgingTotal === 1 ? "DEBT91PLUSC" : `DEBT91PLUSC${debt91Count}`;
        const op = debt91AgingTotal === 1 ? "=" : "+=";
        return `            ${v} ${op} (dr["${colKey}"] == DBNull.Value) ? 0M : Convert.ToDecimal(_ut.CleanNumeric(dr["${colKey}"]));`;      
      }
      const colKey = m.mappedTo + "C";
    return `            ${v} = (dr["${colKey}"] == DBNull.Value) ? 0M : Convert.ToDecimal(_ut.CleanNumeric(dr["${colKey}"]));`;    })
    .filter(Boolean)
    .join("\n");

  const agingAssigns = hasAging
    ? `\n            dr["DEBTCURRENT"] = debtCurr;\n            dr["DEBT30DAY"] = debt30D;\n            dr["DEBT60DAY"] = debt60D;\n            dr["DEBT90DAY"] = debt90D;\n            dr["DEBT91PLUS"] = debt91P;`
    : "";

  // Use ACCOUNTNUMBER as the row filter if mapped, otherwise fall back to NAME
  const hasAccountNumber = mapped.some((m) => m.mappedTo === "ACCOUNTNUMBER");
  const rowFilterField = hasAccountNumber ? "ACCOUNTNUMBER" : "NAME";

  const cs = `public class ${className} : StandardProcessor
{
    protected override void FixRawData(string filePath, ref string fileName)
    {
        DSPFieldMapping map = new DSPFieldMapping();
${mapLines}

        DataTable dt = this.GetMappedDataTable(map, filePath, fileName)
                           .AsEnumerable()
                           .Where(R => R["${rowFilterField}"].ToString().Trim().Length > 0)
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
${strDecls}
${agingDecl}

        foreach (DataRow dr in dt.Rows)
        {
${agingReads}
${agingAssigns}

${strReads}

${strAssigns}
        }
        dt.AcceptChanges();
    }
}`;

  const ini = `[FixedRawData.csv]
ColNameHeader=True
Format=Delimited(,)
MaxScanRows=0
CharacterSet=65001
${(() => { let c = 0; const t = mapped.filter(m => m.mappedTo === "DEBT91PLUS").length; return mapped.map((m, di) => { let n = m.mappedTo; if (m.mappedTo === "DEBT91PLUS") { ++c; n = t === 1 ? "DEBT91PLUSC" : `DEBT91PLUSC${c}`; } else if ((AGING_FIELDS as readonly string[]).includes(m.mappedTo)) n = `${m.mappedTo}C`; return `Col${di + 1}=${n} char`; }).join("\n"); })()}`;

  return { cs, ini };
}

export { toPascal };