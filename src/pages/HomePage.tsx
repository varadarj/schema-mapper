import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeftRight, FileCode2, ArrowRight } from "lucide-react";

export function HomePage() {
  const navigate = useNavigate();

  const modes = [
    {
      title: "Source ↔ Target mapping",
      desc: "Provide a source file and a target file that hold the same data. The tool detects which source column maps to which target column based on the values inside them — even when the names differ (e.g. entity_id → ECID).",
      icon: <ArrowLeftRight className="h-6 w-6" />,
      to: "/source-target",
      accent: "group-hover:border-blue-400",
    },
    {
      title: "DSP3 field mapping",
      desc: "Upload an Excel data file and a column config. The tool predicts the standardized DSP field for each column using fuzzy matching, AR aging patterns, and address heuristics, then generates a C# provider class.",
      icon: <FileCode2 className="h-6 w-6" />,
      to: "/dsp3",
      accent: "group-hover:border-green-400",
    },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 py-12 space-y-8">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Schema Mapper</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Choose what kind of mapping you want to generate.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-5">
        {modes.map((m) => (
          <Card
            key={m.to}
            onClick={() => navigate(m.to)}
            className={`group cursor-pointer transition-colors border-2 ${m.accent}`}
          >
            <CardContent className="p-6 flex flex-col gap-3 h-full">
              <div className="flex items-center justify-between">
                <div className="rounded-lg bg-muted p-2.5 w-fit">{m.icon}</div>
                <ArrowRight className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <h2 className="text-lg font-semibold">{m.title}</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {m.desc}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
