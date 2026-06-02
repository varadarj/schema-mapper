import { useEffect, useRef } from "react";
import { useMappingStore } from "../store/useMappingStore";

export function useConfigFile() {
  const inputRef = useRef<HTMLInputElement>(null);
  const { configLoaded, standardizedColumns, setStandardizedColumns } =
    useMappingStore();

  useEffect(() => {
    if (configLoaded) return;
    fetch("/data/config.json")
      .then((res) => res.blob())
      .then((blob) => {
        const file = new File([blob], "config.json", { type: "application/json" });
        handleFile(file);
      })
      .catch(() => {});
  }, []);

  async function handleFile(file: File) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);

      let cols: string[] = [];
      if (parsed.standardizedColumns && Array.isArray(parsed.standardizedColumns)) {
        cols = parsed.standardizedColumns;
      } else if (Array.isArray(parsed)) {
        cols = parsed;
      } else {
        cols = Object.values(parsed)
          .flat()
          .filter((v): v is string => typeof v === "string");
      }

      setStandardizedColumns(cols, true);
    } catch (err) {
      alert("Could not parse config JSON: " + (err as Error).message);
    }
  }

  function openPicker() {
    inputRef.current?.click();
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }

  return {
    inputRef,
    onChange,
    openPicker,
    loaded: configLoaded,
    count: standardizedColumns.length,
  };
}
