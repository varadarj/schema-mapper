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

const ACCEPT = ".csv,.txt,.tsv,.xlsx,.xls";

export function SourceTargetMappingPage() {
  const navigate = useNavigate();
  const [showApiPanel, setShowApiPanel] = useState(false);
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const targetInputRef = useRef<HTMLInputElement>(null);

  const {
    sourceData,
    sourceName,
    sourceFileNames,
    sourceWarnings,
    loadingSource,
    targetData,
    targetName,
    targetFileNames,
    targetColFiles,
    loadingTarget,
    sampleSize,
    mappings,
    preview,
    pendingConflict,
    aiLoading,
    loadSourceFiles,
    loadTargetFiles,
    setSampleSize,
    runDataMatching,
    handleMappingChange,
    confirmConflict,
    cancelConflict,
    runAiRefine,
    reset,
  } = useSourceTargetStore();
  const { apiTested } = useApiKeyStore();

  const hasMappings = mappings.length > 0;
  const canRun = !!sourceData && !!targetData && !loadingSource && !loadingTarget;
  const allOptions = ["IGNORE", ...(targetData?.headers ?? [])];
  // Show which target file a column came from only when there's more than one.
  const multiTarget = targetFileNames.length > 1;
  const targetFileOf = multiTarget
    ? (col: string) => targetColFiles.get(col)?.join(", ")
    : undefined;

  const stats = {
    high: mappings.filter((m) => m.confidence === "HIGH").length,
    med: mappings.filter((m) => m.confidence === "MEDIUM").length,
    lo: mappings.filter((m) => m.confidence === "LOW").length,
    none: mappings.filter((m) => m.confidence === "NONE").length,
  };

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
          Upload source and target files — each side can be a single file or many shards.
          Large files are streamed (only the header + a sample of rows is read), so multi-GB
          files won't crash the tab. Columns are matched by data shape and semantic name.
        </p>
      </div>

      {/* Sample size */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Rows sampled per side:</span>
        <input
          type="number"
          min={100}
          step={1000}
          defaultValue={sampleSize}
          disabled={loadingSource || loadingTarget}
          onBlur={(e) => {
            const v = parseInt(e.target.value, 10);
            if (v && v !== sampleSize) setSampleSize(v);
          }}
          className="w-28 h-7 rounded border px-2 text-xs"
        />
        <span>Larger = more accurate shapes, slower. Re-reads files on change.</span>
      </div>

      {/* Upload cards */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Source file(s) — one shared schema
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            <DropZone
              loaded={!!sourceData}
              label={
                loadingSource
                  ? "Reading…"
                  : sourceData
                  ? sourceName
                  : "Click to upload .csv / .txt / .tsv / .xlsx (multiple allowed)"
              }
              sublabel={
                sourceData
                  ? `${sourceData.headers.length} columns · ${sourceData.sampleRows.length.toLocaleString()} sampled rows`
                  : undefined
              }
              icon={loadingSource ? "⏳" : "📥"}
              onClick={() => sourceInputRef.current?.click()}
            />
            {sourceFileNames.length > 1 && (
              <p className="text-[11px] text-muted-foreground truncate" title={sourceFileNames.join(", ")}>
                {sourceFileNames.join(", ")}
              </p>
            )}
            {sourceWarnings.map((w, i) => (
              <p key={i} className="text-[11px] text-amber-600">⚠ {w}</p>
            ))}
            <input
              ref={sourceInputRef}
              type="file"
              accept={ACCEPT}
              multiple
              className="hidden"
              onChange={(e) => {
                const files = e.target.files ? Array.from(e.target.files) : [];
                if (files.length) loadSourceFiles(files);
                e.target.value = "";
              }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Target file(s) — combined into one schema
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            <DropZone
              loaded={!!targetData}
              label={
                loadingTarget
                  ? "Reading…"
                  : targetData
                  ? targetName
                  : "Click to upload .csv / .txt / .tsv / .xlsx (multiple allowed)"
              }
              sublabel={
                targetData
                  ? `${targetData.headers.length} columns (union) · ${targetData.sampleRows.length.toLocaleString()} sampled rows`
                  : undefined
              }
              icon={loadingTarget ? "⏳" : "🎯"}
              onClick={() => targetInputRef.current?.click()}
            />
            {targetFileNames.length > 1 && (
              <p className="text-[11px] text-muted-foreground truncate" title={targetFileNames.join(", ")}>
                {targetFileNames.join(", ")}
              </p>
            )}
            <input
              ref={targetInputRef}
              type="file"
              accept={ACCEPT}
              multiple
              className="hidden"
              onChange={(e) => {
                const files = e.target.files ? Array.from(e.target.files) : [];
                if (files.length) loadTargetFiles(files);
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
              targetFileOf={targetFileOf}
            />
          </div>

          {preview && preview.rows.length > 0 && (
            <div>
              <h2 className="text-sm font-medium mb-2">Data preview — {preview.rows.length} sampled rows</h2>
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
