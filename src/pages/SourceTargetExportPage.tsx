import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, AlertCircle, FileSpreadsheet, FileText, Copy, Check } from "lucide-react";

import { useSourceTargetStore } from "../store/useSourceTargetStore";
import { downloadMappingCsv, downloadMappingWorkbook } from "../lib/stExport";

export function SourceTargetExportPage() {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [building, setBuilding] = useState(false);

  const { mappings, sourceName, targetName, sourceRows, targetRows } =
    useSourceTargetStore();

  const hasMappings = mappings.length > 0;
  const baseName = `${sourceName || "source"}_to_${targetName || "target"}_mapping`;

  function handleCopy() {
    const text =
      "Source Column,Target Column\n" +
      mappings
        .map((m) => `${m.excelHeader} = ${m.mappedTo === "IGNORE" ? "(unmapped)" : m.mappedTo}`)
        .join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleCsv() {
    downloadMappingCsv(mappings, baseName);
  }

  async function handleWorkbook() {
    setBuilding(true);
    try {
      await downloadMappingWorkbook({
        sourceRows,
        targetRows,
        sourceName,
        targetName,
        mappings,
        fileName: baseName,
      });
    } finally {
      setBuilding(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Export field mapping</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Download the source → target mapping as an Excel-compatible CSV, or a
            workbook with the source, target, and mapping on separate sheets.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/source-target")}
          className="gap-2 shrink-0"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to mapping
        </Button>
      </div>

      {!hasMappings && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            No mapping found. Go back and generate the field mapping first.
          </AlertDescription>
        </Alert>
      )}

      {hasMappings && (
        <>
          {/* Download options */}
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardContent className="p-5 flex flex-col gap-3 h-full">
                <div className="rounded-lg bg-muted p-2.5 w-fit">
                  <FileText className="h-5 w-5" />
                </div>
                <h2 className="text-base font-semibold">Mapping CSV</h2>
                <p className="text-sm text-muted-foreground flex-1">
                  A simple two-column file: source column names and their matched
                  target column names. Opens cleanly in Excel.
                </p>
                <Button onClick={handleCsv} className="gap-2 w-full">
                  <FileText className="h-4 w-4" />
                  Download .csv
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5 flex flex-col gap-3 h-full">
                <div className="rounded-lg bg-muted p-2.5 w-fit">
                  <FileSpreadsheet className="h-5 w-5" />
                </div>
                <h2 className="text-base font-semibold">3-sheet workbook</h2>
                <p className="text-sm text-muted-foreground flex-1">
                  An .xlsx with three sheets: the source file, the target file,
                  and the schema mapping.
                </p>
                <Button onClick={handleWorkbook} disabled={building} className="gap-2 w-full">
                  <FileSpreadsheet className="h-4 w-4" />
                  {building ? "Building…" : "Download .xlsx"}
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Mapping summary */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-medium">Field mapping</h2>
              <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={handleCopy}>
                {copied ? (
                  <><Check className="h-3 w-3" /> Copied</>
                ) : (
                  <><Copy className="h-3 w-3" /> Copy</>
                )}
              </Button>
            </div>
            <Card>
              <CardContent className="p-0">
                <div className="divide-y">
                  {mappings.map((m, i) => (
                    <div key={i} className="flex items-center gap-2 px-4 py-2 font-mono text-xs">
                      <span className="text-muted-foreground w-6 shrink-0">{m.excelIndex}</span>
                      <span className="truncate flex-1">{m.excelHeader}</span>
                      <span className="text-muted-foreground">→</span>
                      <span
                        className={
                          m.mappedTo === "IGNORE"
                            ? "text-muted-foreground flex-1"
                            : "font-semibold text-foreground flex-1"
                        }
                      >
                        {m.mappedTo === "IGNORE" ? "(unmapped)" : m.mappedTo}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}