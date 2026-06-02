import { Badge } from "@/components/ui/badge";
import type { Confidence } from "../lib/mapping";
import { cn } from "@/lib/utils";

interface ConfidenceBadgeProps {
  confidence: Confidence;
}

const CONF_CLASS: Record<Confidence, string> = {
  HIGH: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 border-0",
  MEDIUM: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300 border-0",
  LOW: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-0",
  NONE: "bg-muted text-muted-foreground border-0",
};

export function ConfidenceBadge({ confidence }: ConfidenceBadgeProps) {
  return (
    <Badge className={cn("text-xs font-medium", CONF_CLASS[confidence])}>
      {confidence}
    </Badge>
  );
}
