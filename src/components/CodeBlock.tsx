import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, Copy } from "lucide-react";

interface CodeBlockProps {
  title: string;
  content: string;
}

export function CodeBlock({ title, content }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-muted border-b">
        <span className="text-sm font-medium text-muted-foreground">{title}</span>
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
      <pre className="p-4 text-xs font-mono leading-relaxed overflow-auto max-h-96 whitespace-pre-wrap break-words">
        {content}
      </pre>
    </div>
  );
}
