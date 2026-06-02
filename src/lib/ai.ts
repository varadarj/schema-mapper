import type { ExcelData, ColumnMapping, Confidence } from "./mapping";
import { REQUIRED_FIELDS } from "./mapping";
import { confidenceFromScore } from "./mapping";

export interface AiMappingRow {
  excelIndex: number;
  excelHeader: string;
  mappedTo: string;
  confidence: Confidence;
}

export async function remapWithAI(
  excelData: ExcelData,
  standardizedColumns: string[],
  apiKey: string
): Promise<ColumnMapping[]> {
  const preview = excelData.sampleRows.slice(0, 10);

  const prompt = `You are a schema mapping assistant. Map each Excel column to the best standardized DSP field name.

Excel columns (0-indexed):
${excelData.headers.map((h, i) => `${i}: "${h}"`).join("\n")}

Sample rows (first 10):
${preview
  .map(
    (row, ri) =>
      `Row ${ri + 1}: ${excelData.headers.map((h, i) => `${h}="${row[i] ?? ""}"`).join(", ")}`
  )
  .join("\n")}

Standardized target fields:
${standardizedColumns.join(", ")}

Rules:
- DEBT91PLUS can appear multiple times (it is summed across buckets)
- DEBTCURRENT, DEBT30DAY, DEBT60DAY, DEBT90DAY must each appear at most once
- ADDRESS1 must be assigned to a column that appears before ADDRESS2 in the file
- Aging headers like "Due 1-30", "Due 31-60", "Due > 180" map to DEBT30DAY, DEBT60DAY, DEBT91PLUS respectively
- If no reasonable match exists, use IGNORE

Respond ONLY with a valid JSON array. No markdown, no explanation:
[{"excelIndex":0,"excelHeader":"...","mappedTo":"...","confidence":"HIGH|MEDIUM|LOW"}]`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`);

  const data = await res.json();
  const raw: string = data.content
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("");

  const aiRows: AiMappingRow[] = JSON.parse(
    raw.replace(/```json|```/g, "").trim()
  );

  return excelData.headers.map((header, i) => {
    const aiRow = aiRows.find((r) => r.excelIndex === i);
    const field = aiRow?.mappedTo ?? "IGNORE";
    const score =
      field === "IGNORE"
        ? 0
        : aiRow?.confidence === "HIGH"
        ? 0.9
        : aiRow?.confidence === "MEDIUM"
        ? 0.65
        : 0.4;
    const sampleVals = excelData.sampleRows
      .slice(0, 5)
      .map((r) => String(r[i] ?? ""))
      .filter((v) => v !== "");
    return {
      excelIndex: i,
      excelHeader: header,
      sampleVals,
      mappedTo: field,
      score,
      confidence: confidenceFromScore(field, score),
      method: "ai" as const,
      required: (REQUIRED_FIELDS as readonly string[]).includes(field),
    };
  });
}

export async function testApiKey(apiKey: string): Promise<void> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 10,
      messages: [{ role: "user", content: "Say OK" }],
    }),
  });
  if (!res.ok) throw new Error(`Status ${res.status}`);
}
