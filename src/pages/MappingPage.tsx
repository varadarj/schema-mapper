import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Wand2, RefreshCw, ArrowRight, Brain, ChevronDown, ChevronUp, Loader2, X } from "lucide-react";

import { DropZone } from "../components/DropZone";
import { MappingTable } from "../components/MappingTable";
import { PreviewTable } from "../components/PreviewTable";
import { ConflictModal } from "../components/ConflictModal";
import { ApiKeyPanel } from "../components/ApiKeyPanel";
import { useMappingStore, joinKeyCandidates } from "../store/useMappingStore";
import { buildJoinedPreview } from "../lib/mapping";
import { useApiKeyStore } from "../store/useApiKeyStore";
import { useExcelFile } from "../hooks/useExcelFile";
import { useConfigFile } from "../hooks/useConfigFile";

export function MappingPage() {
  const navigate = useNavigate();
  const [showApiPanel, setShowApiPanel] = useState(false);

  const {
    files,
    activeFileId,
    standardizedColumns,
    configLoaded,
    preview,
    pendingConflict,
    aiLoading,
    joinKey,
    providerMode,
    runFuzzyMapping,
    runAiMapping,
    handleMappingChange,
    confirmConflict,
    cancelConflict,
    setActiveFile,
    setKeyword,
    setJoinKey,
    setProviderMode,
    removeFile,
    reset,
  } = useMappingStore();
  const { apiTested } = useApiKeyStore();

  const excel = useExcelFile();
  const config = useConfigFile();

  const activeFile = files.find((f) => f.id === activeFileId) ?? files[0] ?? null;
  const mappings = activeFile?.mappings ?? [];
  const hasMappings = files.some((f) => f.mappings.length > 0);
  const multiFile = files.length > 1;

  const stats = {
    high: mappings.filter((m) => m.confidence === "HIGH").length,
    med: mappings.filter((m) => m.confidence === "MEDIUM").length,
    lo: mappings.filter((m) => m.confidence === "LOW").length,
    none: mappings.filter((m) => m.confidence === "NONE").length,
  };

  const allOptions = ["IGNORE", ...standardizedColumns];
  const joinCandidates = multiFile ? joinKeyCandidates(files) : [];
  const joinedPreview =
    multiFile && hasMappings && joinKey
      ? buildJoinedPreview(
          files.map((f) => ({ rows: f.allRows.slice(1), mappings: f.mappings })),
          joinKey
        )
      : null;

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

        <div className="ml-auto flex items-center gap-2">                                                                                                                                                                                                                                                                                                                                                                                                                                                                         
          <Select value={providerMode} onValueChange={(v) => setProviderMode(v as "aging" | "invoice")}>
            <SelectTrigger id="provider-mode" className="w-40 h-8 text-sm bg-green-400">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="aging">Aging provider</SelectItem>
              <SelectItem value="invoice">Invoice provider</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* API panel */}
      {showApiPanel && <ApiKeyPanel />}

      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Schema mapper</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload one or more Excel data files and a column config to predict
          schema mappings using fuzzy matching, AR aging patterns, and address
          heuristics. Multiple files are mapped independently and joined on a
          shared key.
        </p>
      </div>

      {/* Upload cards */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Step 1 — Excel data file(s)
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <DropZone
              loaded={files.length > 0}
              label={
                files.length === 0
                  ? "Click to upload .xlsx / .xls / .csv "
                  : files.length === 1
                  ? files[0].fileName
                  : `${files.length} files`
              }
              sublabel={
                files.length > 0
                  ? files.map((f) => f.fileName).join(", ")
                  : "You can select multiple files"
              }
              icon="📊"
              onClick={excel.openPicker}
            />
            <input
              ref={excel.inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              multiple
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
          onClick={runFuzzyMapping}
          className="flex-1 gap-2 bg-gray-200"
        >
          <Wand2 className="h-4 w-4" />
          Predict schema mapping
        </Button>
      </div>

      {/* File tabs (multi-file, only once mappings are predicted) */}
      {multiFile && hasMappings && (
        <div className="flex flex-wrap gap-1 border-b">
          {files.map((f) => (
            <button
              key={f.id}
              onClick={() => setActiveFile(f.id)}
              className={
                "group flex items-center gap-2 px-3 py-2 text-sm border-b-2 -mb-px transition-colors " +
                (f.id === activeFile?.id
                  ? "border-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground")
              }
            >
              <span className="truncate max-w-[200px]">{f.fileName}</span>
              {files.length > 1 && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(f.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 hover:text-red-500"
                >
                  <X className="h-3 w-3" />
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Mapping results */}
      {hasMappings && activeFile && (
        <>
          {/* Per-file runtime keyword (multi-file) */}
          {multiFile && (
            <Card>
              <CardContent className="p-4 space-y-2">
                <Label htmlFor="kw" className="text-xs uppercase tracking-widest text-muted-foreground">
                  Runtime filename keyword for “{activeFile.fileName}”
                </Label>
                <Input
                  id="kw"
                  value={activeFile.keyword}
                  onChange={(e) => setKeyword(activeFile.id, e.target.value.toUpperCase())}
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  The generated provider matches each delivered file by{" "}
                  <code>fileName.Contains("{activeFile.keyword || "…"}")</code>. Use a
                  substring that uniquely identifies this file at runtime.
                </p>
              </CardContent>
            </Card>
          )}

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

          {/* Join key (multi-file) */}
          {multiFile && (
            <Card>
              <CardContent className="p-4 space-y-2">
                <Label className="text-xs uppercase tracking-widest text-muted-foreground">
                  Join key
                </Label>
                {joinCandidates.length === 0 ? (
                  <p className="text-xs text-red-500">
                    No field is mapped in every file yet. Map a shared key (e.g.
                    ACCOUNTNUMBER or NAME) in each file to enable the join.
                  </p>
                ) : (
                  <div className="flex items-center gap-3">
                    <Select value={joinKey} onValueChange={setJoinKey}>
                      <SelectTrigger className="w-64 font-mono">
                        <SelectValue placeholder="Select join key" />
                      </SelectTrigger>
                      <SelectContent>
                        {joinCandidates.map((c) => (
                          <SelectItem key={c} value={c} className="font-mono">
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Files are joined on this column (mapped in all files).
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Data preview */}
          {multiFile ? (
            <div>
              <h2 className="text-sm font-medium mb-2">
                FixedRawData preview — files joined on{" "}
                <code className="font-mono">{joinKey || "?"}</code>
              </h2>
              {joinedPreview && joinedPreview.rows.length > 0 ? (
                <PreviewTable
                  preview={joinedPreview}
                  single
                  dspTitle={`FixedRawData (joined on ${joinKey})`}
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  {joinKey
                    ? "No rows matched across files in the sampled data. The join key may not overlap within the sample, or a file may not map the key."
                    : "Set a join key to preview the joined output."}
                </p>
              )}
            </div>
          ) : (
            preview &&
            preview.rows.length > 0 && (
              <div>
                <h2 className="text-sm font-medium mb-2">
                  Data preview — {preview.rows.length} random rows
                </h2>
                <PreviewTable preview={preview} />
              </div>
            )
          )}

          <Separator />

          {/* Footer actions */}
          <div className="flex justify-between items-center">
            <Button variant="ghost" size="sm" onClick={reset} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Reset
            </Button>
            <Button onClick={() => navigate("/dsp3/provider")} className="gap-2">
              Approve mapping
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </>
      )}

      {/* Conflict modal */}
      {pendingConflict && activeFile && (
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
