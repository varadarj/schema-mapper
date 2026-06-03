import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, Code2, AlertCircle, Copy, Check } from "lucide-react";

import { CodeBlock } from "../components/CodeBlock";
import { ClassNameModal } from "../components/ClassNameModal";
import { useMappingStore } from "../store/useMappingStore";
import { REQUIRED_FIELDS } from "../lib/mapping";

export function ProviderPage() {
  const navigate = useNavigate();
  const [showClassModal, setShowClassModal] = useState(false);
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    const text = "Field Mapping:\n" + mappings
      .map((m) => `${m.excelHeader.trim()} = ${m.mappedTo}`)
      .join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const { mappings, codeOutput, generateCode, clearCode, defaultClassName } =
    useMappingStore();

  const hasMappings = mappings.length > 0;
  const mapped = mappings.filter((m) => m.mappedTo !== "UNMAPPED");

  const missingRequired = (REQUIRED_FIELDS as readonly string[]).filter(
    (f) => !mapped.some((m) => m.mappedTo === f)
  );

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
          onClick={() => navigate("/")}
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

          {/* Mapping summary */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-medium">Field Mapping:</h2>
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
            <Card>
              <CardContent className="p-0">
                <div className="divide-y">
                  {mappings.map((m, i) => (
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

          {/* Generate button */}
          {!codeOutput && (
            <div className="flex justify-end">
              <Button
                onClick={() => setShowClassModal(true)}
                className="gap-2"
                disabled={missingRequired.length > 0}
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
