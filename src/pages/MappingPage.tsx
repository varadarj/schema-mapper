import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Wand2, RefreshCw, ArrowRight, Brain, ChevronDown, ChevronUp, Loader2 } from "lucide-react";

import { DropZone } from "../components/DropZone";
import { MappingTable } from "../components/MappingTable";
import { PreviewTable } from "../components/PreviewTable";
import { ConflictModal } from "../components/ConflictModal";
import { ApiKeyPanel } from "../components/ApiKeyPanel";
import { useMappingStore } from "../store/useMappingStore";
import { useExcelFile } from "../hooks/useExcelFile";
import { useConfigFile } from "../hooks/useConfigFile";

export function MappingPage() {
  const navigate = useNavigate();
  const [showApiPanel, setShowApiPanel] = useState(false);

  const {
    excelData,
    fileName,
    standardizedColumns,
    configLoaded,
    mappings,
    preview,
    pendingConflict,
    apiTested,
    aiLoading,
    runFuzzyMapping,
    runAiMapping,
    handleMappingChange,
    confirmConflict,
    cancelConflict,
    reset,
  } = useMappingStore();

  const excel = useExcelFile();
  const config = useConfigFile();

  const canRun = !!excelData && configLoaded;
  const hasMappings = mappings.length > 0;

  const stats = {
    high: mappings.filter((m) => m.confidence === "HIGH").length,
    med: mappings.filter((m) => m.confidence === "MEDIUM").length,
    lo: mappings.filter((m) => m.confidence === "LOW").length,
    none: mappings.filter((m) => m.confidence === "NONE").length,
  };

  const allOptions = ["IGNORE", ...standardizedColumns];

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      {/*Settings */}
      <div className="flex gap-2">
        <Button
          variant={apiTested ? "secondary" : "outline"}
          size="sm"
          className="gap-1.5 shrink-0"
          onClick={() => setShowApiPanel((v) => !v)}
        >
          <Brain className="h-4 w-4" />
          {apiTested ? "AI ready" : "AI settings"}
          {showApiPanel ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </Button>

        {apiTested && hasMappings && (
          <Button
            variant="outline"
            size="sm"
            disabled={aiLoading}
            onClick={runAiMapping}
            className="gap-1.5 shrink-0"
          >
            {aiLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Brain className="h-4 w-4" />
            )}
            {aiLoading ? "Mapping…" : "Remap with AI"}
          </Button>
        )}
      </div>
      
      {/* API panel */}
      {showApiPanel && <ApiKeyPanel />}

      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Schema mapper</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload an Excel file and a column config to predict schema mappings
          using fuzzy matching, AR aging patterns, and address heuristics.
        </p>
      </div>

      {/* Upload cards */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Step 1 — Excel data file
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <DropZone
              loaded={!!excelData}
              label={
                excelData
                  ? fileName
                  : "Click to upload .xlsx / .xls / .csv "
              }
              sublabel={
                excelData
                  ? `${excelData.headers.length} columns · ${excelData.totalRows} rows`
                  : undefined
              }
              icon="📊"
              onClick={excel.openPicker}
            />
            <input
              ref={excel.inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={excel.onChange}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Step 2 — Column config (JSON)
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <DropZone
              loaded={configLoaded}
              label={configLoaded ? "Config loaded" : "Click to upload config.json"}
              sublabel={
                configLoaded
                  ? `${standardizedColumns.length} standardized columns`
                  : undefined
              }
              icon="⚙️"
              onClick={config.openPicker}
            />
            <input
              ref={config.inputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={config.onChange}
            />
          </CardContent>
        </Card>
      </div>

      {/* Action bar */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="lg"
          // disabled={!canRun}
          onClick={runFuzzyMapping}
          className="flex-1 gap-2 bg-gray-200"
        >
          <Wand2 className="h-4 w-4" />
          Predict schema mapping
        </Button>
      </div>

      {/* Mapping results */}
      {hasMappings && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { num: stats.high, label: "High confidence" },
              { num: stats.med, label: "Medium confidence" },
              { num: stats.lo, label: "Low confidence" },
              { num: stats.none, label: "IGNORE" },
            ].map((s) => (
              <Card key={s.label} className="text-center py-3">
                <div className="text-2xl font-semibold">{s.num}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
              </Card>
            ))}
          </div>

          <div>
            <h2 className="text-sm font-medium mb-2">
              Predicted mapping — review and adjust
            </h2>
            <MappingTable
              mappings={mappings}
              allOptions={allOptions}
              onMappingChange={handleMappingChange}
            />
          </div>

          {/* Data preview */}
          {preview && preview.rows.length > 0 && (
            <div>
              <h2 className="text-sm font-medium mb-2">
                Data preview — {preview.rows.length} random rows
              </h2>
              <PreviewTable preview={preview} />
            </div>
          )}

          <Separator />

          {/* Footer actions */}
          <div className="flex justify-between items-center">
            <Button variant="ghost" size="sm" onClick={reset} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Reset
            </Button>
            <Button onClick={() => navigate("/provider")} className="gap-2">
              Approve mapping
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </>
      )}

      {/* Conflict modal */}
      {pendingConflict && (
        <ConflictModal
          conflict={pendingConflict}
          mappings={mappings}
          onConfirm={confirmConflict}
          onCancel={cancelConflict}
        />
      )}
    </div>
  );
}
