import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Wand2,
  RefreshCw,
  ArrowRight,
  ArrowLeft,
  Brain,
  ChevronDown,
  ChevronUp,
  Loader2,
} from "lucide-react";

import { DropZone } from "../components/DropZone";
import { MappingTable } from "../components/MappingTable";
import { PreviewTable } from "../components/PreviewTable";
import { ConflictModal } from "../components/ConflictModal";
import { ApiKeyPanel } from "../components/ApiKeyPanel";
import { useSourceTargetStore } from "../store/useSourceTargetStore";
import { useApiKeyStore } from "../store/useApiKeyStore";
import { parseFile } from "../lib/fileParse";

export function SourceTargetMappingPage() {
  const navigate = useNavigate();
  const [showApiPanel, setShowApiPanel] = useState(false);

  const sourceInputRef = useRef<HTMLInputElement>(null);
  const targetInputRef = useRef<HTMLInputElement>(null);

  const {
    sourceData,
    sourceName,
    targetData,
    targetName,
    mappings,
    preview,
    pendingConflict,
    aiLoading,
    setSource,
    setTarget,
    runDataMatching,
    handleMappingChange,
    confirmConflict,
    cancelConflict,
    runAiRefine,
    reset,
  } = useSourceTargetStore();
  const { apiTested } = useApiKeyStore();

  const hasMappings = mappings.length > 0;
  const canRun = !!sourceData && !!targetData;

  const stats = {
    high: mappings.filter((m) => m.confidence === "HIGH").length,
    med: mappings.filter((m) => m.confidence === "MEDIUM").length,
    lo: mappings.filter((m) => m.confidence === "LOW").length,
    none: mappings.filter((m) => m.confidence === "NONE").length,
  };

  const allOptions = ["IGNORE", ...(targetData?.headers ?? [])];

  async function handleUpload(file: File, which: "source" | "target") {
    const parsed = await parseFile(file);
    if (!parsed) {
      alert("File appears empty.");
      return;
    }
    if (which === "source") setSource(parsed.data, parsed.fileName, parsed.allRows);
    else setTarget(parsed.data, parsed.fileName, parsed.allRows);
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Home
        </Button>
        <div className="flex gap-2">
          <Button
            variant={apiTested ? "secondary" : "outline"}
            size="sm"
            className="gap-1.5 shrink-0"
            onClick={() => setShowApiPanel((v) => !v)}
          >
            <Brain className="h-4 w-4" />
            {apiTested ? "AI ready" : "AI settings"}
            {showApiPanel ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>

          {apiTested && hasMappings && (
            <Button
              variant="outline"
              size="sm"
              disabled={aiLoading}
              onClick={runAiRefine}
              className="gap-1.5 shrink-0"
            >
              {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
              {aiLoading ? "Refining…" : "Refine with AI"}
            </Button>
          )}
        </div>
      </div>

      {showApiPanel && <ApiKeyPanel />}

      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Source ↔ Target mapping</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload two files containing the same data. Columns are matched by the
          values inside them, so renamed fields are detected automatically.
        </p>
      </div>

      {/* Upload cards */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Source file
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <DropZone
              loaded={!!sourceData}
              label={sourceData ? sourceName : "Click to upload .xlsx / .xls / .csv"}
              sublabel={
                sourceData
                  ? `${sourceData.headers.length} columns · ${sourceData.totalRows} rows`
                  : undefined
              }
              icon="📥"
              onClick={() => sourceInputRef.current?.click()}
            />
            <input
              ref={sourceInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f, "source");
                e.target.value = "";
              }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Target file
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <DropZone
              loaded={!!targetData}
              label={targetData ? targetName : "Click to upload .xlsx / .xls / .csv"}
              sublabel={
                targetData
                  ? `${targetData.headers.length} columns · ${targetData.totalRows} rows`
                  : undefined
              }
              icon="🎯"
              onClick={() => targetInputRef.current?.click()}
            />
            <input
              ref={targetInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f, "target");
                e.target.value = "";
              }}
            />
          </CardContent>
        </Card>
      </div>

      {/* Action bar */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="lg"
          disabled={!canRun}
          onClick={runDataMatching}
          className="flex-1 gap-2 bg-gray-200"
        >
          <Wand2 className="h-4 w-4" />
          Generate field mapping
        </Button>
      </div>

      {/* Results */}
      {hasMappings && (
        <>
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
              Predicted source → target mapping — review and adjust
            </h2>
            <MappingTable
              mappings={mappings}
              allOptions={allOptions}
              onMappingChange={handleMappingChange}
            />
          </div>

          {preview && preview.rows.length > 0 && (
            <div>
              <h2 className="text-sm font-medium mb-2">
                Data preview — {preview.rows.length} random rows
              </h2>
              <PreviewTable
                preview={preview}
                origTitle={`Source — ${sourceName}`}
                dspTitle={`Target columns — ${targetName}`}
              />
            </div>
          )}

          <Separator />

          <div className="flex justify-between items-center">
            <Button variant="ghost" size="sm" onClick={reset} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Reset
            </Button>
            <Button onClick={() => navigate("/source-target/export")} className="gap-2">
              Approve mapping
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </>
      )}

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