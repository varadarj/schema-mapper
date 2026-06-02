import { cn } from "@/lib/utils";

interface DropZoneProps {
  loaded: boolean;
  label: string;
  sublabel?: string;
  icon: React.ReactNode;
  onClick: () => void;
}

export function DropZone({ loaded, label, sublabel, icon, onClick }: DropZoneProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-lg border p-4 text-center transition-colors cursor-pointer",
        loaded
          ? "border-green-500 bg-green-50 dark:bg-green-950/30"
          : "border-dashed border-border hover:bg-muted/50"
      )}
    >
      <div
        className={cn(
          "text-2xl mb-1.5",
          loaded ? "text-green-600" : "text-muted-foreground"
        )}
      >
        {icon}
      </div>
      <p
        className={cn(
          "text-sm font-medium",
          loaded ? "text-green-700 dark:text-green-400" : "text-muted-foreground"
        )}
      >
        {label}
      </p>
      {sublabel && (
        <p className="text-xs text-muted-foreground mt-0.5">{sublabel}</p>
      )}
    </button>
  );
}
