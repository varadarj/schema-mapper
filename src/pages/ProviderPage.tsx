import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, Code2, AlertCircle, Copy, Check } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { CodeBlock } from "../components/CodeBlock";
import { ClassNameModal } from "../components/ClassNameModal";
import { useMappingStore, autoCustomerFileId } from "../store/useMappingStore";
import { REQUIRED_FIELDS } from "../lib/mapping";

export function ProviderPage() {
  const navigate = useNavigate();
  const [showClassModal, setShowClassModal] = useState(false);
  const [copied, setCopied] = useState(false);

  const {
    files,
    joinKey,
    providerMode,
    customerFileId,
    setCustomerFile,
    codeOutput,
    generateCode,
    clearCode,
    defaultClassName,
  } = useMappingStore();

  const multiFile = files.length > 1;
  const twoFile = files.length === 2;
  const customerId = twoFile ? (customerFileId ?? autoCustomerFileId(files)) : null;

  function handleCopy() {
    const text = files
      .map((f) => {
        const head = multiFile ? `// ${f.fileName} (keyword: ${f.keyword})\n` : "";
        return (
          head +
          f.mappings
            .map((m) => `${m.excelHeader.trim()} = ${m.mappedTo}`)
            .join("\n")
        );
      })
      .join("\n\n");
    navigator.clipboard.writeText("Field Mapping:\n" + text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const hasMappings = files.some((f) => f.mappings.length > 0);

  // Required fields are satisfied if mapped in ANY file (union across sources).
  const unionMapped = new Set(
    files.flatMap((f) =>
      f.mappings.filter((m) => m.mappedTo !== "IGNORE").map((m) => m.mappedTo)
    )
  );
  // Invoice providers additionally require INVAMT.
  const requiredFields =
    providerMode === "invoice"
      ? [...REQUIRED_FIELDS, "INVAMT"]
      : (REQUIRED_FIELDS as readonly string[]);
  const missingRequired = requiredFields.filter((f) => !unionMapped.has(f));

  const missingJoinKey = multiFile && !joinKey;
  const canGenerate = missingRequired.length === 0 && !missingJoinKey;

  function handleGenerate(className: string) {
    generateCode(className);
    setShowClassModal(false);
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Provider code generator
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review your approved mapping and generate the C# provider class.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/dsp3")}
          className="gap-2 shrink-0"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to mapping
        </Button>
      </div>

      {/* No mappings state */}
      {!hasMappings && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            No mapping found. Go back to the mapping page and run the schema
            prediction first.
          </AlertDescription>
        </Alert>
      )}

      {hasMappings && (
        <>
          {/* Missing required fields warning */}
          {missingRequired.length > 0 && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Required fields are unmapped:{" "}
                <strong>{missingRequired.join(", ")}</strong>. Go back and
                assign them before generating.
              </AlertDescription>
            </Alert>
          )}

          {/* Missing join key warning */}
          {missingJoinKey && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                No join key is set. Go back and map a shared key (e.g.
                ACCOUNTNUMBER or NAME) in every file, then pick the join key.
              </AlertDescription>
            </Alert>
          )}

          {/* File roles (two files) — which is customer vs aging */}
          {twoFile && (
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <Label className="text-xs uppercase tracking-widest text-muted-foreground shrink-0">
                  Customer file
                </Label>
                <Select value={customerId ?? ""} onValueChange={setCustomerFile}>
                  <SelectTrigger className="w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {files.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.fileName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  The other file is treated as the aging/invoice file
                  (<code className="font-mono">custFile</code> /{" "}
                  <code className="font-mono">agingFile</code> in the generated code).
                </p>
              </CardContent>
            </Card>
          )}

          {/* Mapping summary */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-medium">
                Field Mapping{multiFile ? ` — joined on ${joinKey || "?"}` : ""}:
              </h2>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={handleCopy}
              >
                {copied ? (
                  <><Check className="h-3 w-3" /> Copied</>
                ) : (
                  <><Copy className="h-3 w-3" /> Copy</>
                )}
              </Button>
            </div>

            <div className="space-y-4">
              {files.map((file) => (
                <div key={file.id}>
                  {multiFile && (
                    <div className="text-xs font-medium mb-1 flex items-center gap-2">
                      <span className="truncate">{file.fileName}</span>
                      <span className="text-muted-foreground">
                        keyword: <code className="font-mono">{file.keyword}</code>
                      </span>
                    </div>
                  )}
                  <Card>
                    <CardContent className="p-0">
                      <div className="divide-y">
                        {file.mappings.map((m, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-2 px-4 py-2 font-mono text-xs"
                          >
                            <span className="text-muted-foreground w-6 shrink-0">
                              {m.excelIndex}
                            </span>
                            <span className="truncate">{m.excelHeader}</span>
                            <span className="text-muted-foreground">=</span>
                            <span
                              className={
                                m.mappedTo === "IGNORE"
                                  ? "text-muted-foreground"
                                  : "font-semibold text-foreground"
                              }
                            >
                              {m.mappedTo}
                            </span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              ))}
            </div>
          </div>

          {/* Generate button */}
          {!codeOutput && (
            <div className="flex justify-end">
              <Button
                onClick={() => setShowClassModal(true)}
                className="gap-2"
                disabled={!canGenerate}
              >
                <Code2 className="h-4 w-4" />
                Generate C# provider
              </Button>
            </div>
          )}

          {/* Code output */}
          {codeOutput && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">Provider Class:</h2>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    clearCode();
                    setShowClassModal(true);
                  }}
                  className="text-xs gap-1.5 bg-green-300 rounded-md"
                >
                  Regenerate with different class name
                </Button>
              </div>
              <CodeBlock title={`${codeOutput.className}.cs`} content={codeOutput.cs} />
            </div>
          )}
        </>
      )}

      {/* Class name modal */}
      {showClassModal && (
        <ClassNameModal
          defaultName={defaultClassName()}
          onConfirm={handleGenerate}
          onCancel={() => setShowClassModal(false)}
        />
      )}
    </div>
  );
}
