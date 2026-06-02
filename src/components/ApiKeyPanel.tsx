import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";
import { useApiKey } from "../hooks/useApiKey";

export function ApiKeyPanel() {
  const {
    inputValue,
    setInputValue,
    testing,
    error,
    handleTest,
    apiTested,
  } = useApiKey();

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div>
        <h3 className="text-sm font-medium">Anthropic API key</h3>
        <p className="text-xs text-muted-foreground mt-1">
          The tool uses fuzzy matching by default. Provide a key to enable
          AI-assisted remapping as a secondary option.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="apikey" className="text-xs">API key</Label>
        <div className="flex gap-2">
          <Input
            id="apikey"
            type="password"
            placeholder="sk-ant-..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            className="font-mono text-xs"
            onKeyDown={(e) => e.key === "Enter" && handleTest()}
          />
          <Button
            size="sm"
            disabled={!inputValue.trim() || testing}
            onClick={handleTest}
            className="shrink-0"
          >
            {testing ? (
              <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Testing…</>
            ) : (
              "Test connection"
            )}
          </Button>
        </div>
      </div>

      {apiTested && (
        <Alert className="border-green-200 bg-green-50 dark:bg-green-950/20 py-2">
          <CheckCircle className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-xs text-green-700 dark:text-green-400">
            Connection successful. "Remap with AI" is now available.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive" className="py-2">
          <XCircle className="h-4 w-4" />
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
