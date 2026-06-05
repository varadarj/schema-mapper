import { create } from "zustand";
import type { ColumnMapping, ExcelData, PreviewData } from "../lib/mapping";
import {
  buildMappings,
  applyMappingChange,
  enforceArUniqueness,
  fixAddressOrder,
  buildPreviewRows,
  findConflict,
} from "../lib/mapping";
import { remapWithAI } from "../lib/ai";
import { useApiKeyStore } from "./useApiKeyStore";
import { generateCSharp, toPascal } from "../lib/codegen";
import type { CodeGenOutput } from "../lib/codegen";

export interface PendingConflict {
  newField: string;
  oldIdx: number;
  newIdx: number;
}

interface MappingStore {
  // data
  excelData: ExcelData | null;
  fileName: string;
  standardizedColumns: string[];
  configLoaded: boolean;
  mappings: ColumnMapping[];
  preview: PreviewData | null;

  // ui state
  pendingConflict: PendingConflict | null;

  // ai
  aiLoading: boolean;

  // code output
  codeOutput: (CodeGenOutput & { className: string }) | null;

  // actions — data loading
  setExcelData: (data: ExcelData, fileName: string) => void;
  setStandardizedColumns: (cols: string[], loaded: boolean) => void;

  // actions — mapping
  runFuzzyMapping: () => void;
  handleMappingChange: (rowIdx: number, newField: string) => void;
  confirmConflict: () => void;
  cancelConflict: () => void;
  refreshPreview: () => void;

  // actions — AI
  runAiMapping: () => Promise<void>;

  // actions — code gen
  generateCode: (className: string) => void;
  clearCode: () => void;

  // util
  reset: () => void;
  defaultClassName: () => string;
}

export const useMappingStore = create<MappingStore>((set, get) => ({
  excelData: null,
  fileName: "",
  standardizedColumns: [],
  configLoaded: false,
  mappings: [],
  preview: null,
  pendingConflict: null,
  aiLoading: false,
  codeOutput: null,

  setExcelData: (data, fileName) =>
    set({ excelData: data, fileName, mappings: [], preview: null, codeOutput: null }),

  setStandardizedColumns: (cols, loaded) =>
    set({ standardizedColumns: cols, configLoaded: loaded }),

  runFuzzyMapping: () => {
    const { excelData, standardizedColumns } = get();
    if (!excelData || !standardizedColumns.length) return;
    const m = buildMappings(excelData, standardizedColumns);
    set({ mappings: m, preview: buildPreviewRows(excelData, m), codeOutput: null });
  },

  handleMappingChange: (rowIdx, newField) => {
    const { mappings, excelData } = get();
    const conflictIdx = findConflict(mappings, newField, rowIdx);

    if (conflictIdx >= 0) {
      set({ pendingConflict: { newField, oldIdx: conflictIdx, newIdx: rowIdx } });
      return;
    }

    const updated = applyMappingChange(mappings, rowIdx, newField);
    set({
      mappings: updated,
      preview: excelData ? buildPreviewRows(excelData, updated) : null,
      codeOutput: null,
    });
  },

  confirmConflict: () => {
    const { pendingConflict, mappings, excelData } = get();
    if (!pendingConflict) return;

    // unmap old
    let updated = mappings.map((m) => ({ ...m }));
    updated[pendingConflict.oldIdx] = {
      ...updated[pendingConflict.oldIdx],
      mappedTo: "IGNORE",
      confidence: "NONE" as const,
      score: 0,
    };

    // apply new
    updated = applyMappingChange(updated, pendingConflict.newIdx, pendingConflict.newField);

    set({
      mappings: updated,
      preview: excelData ? buildPreviewRows(excelData, updated) : null,
      pendingConflict: null,
      codeOutput: null,
    });
  },

  cancelConflict: () => set({ pendingConflict: null }),

  refreshPreview: () => {
    const { excelData, mappings } = get();
    if (excelData) set({ preview: buildPreviewRows(excelData, mappings) });
  },

  runAiMapping: async () => {
    const { excelData, standardizedColumns } = get();
    const { apiKey } = useApiKeyStore.getState();
    if (!excelData || !apiKey) return;
    set({ aiLoading: true });
    try {
      let aiMappings = await remapWithAI(excelData, standardizedColumns, apiKey);
      aiMappings = enforceArUniqueness(aiMappings);
      aiMappings = fixAddressOrder(aiMappings);
      set({
        mappings: aiMappings,
        preview: buildPreviewRows(excelData, aiMappings),
        codeOutput: null,
      });
    } finally {
      set({ aiLoading: false });
    }
  },

  generateCode: (className) => {
    const { mappings } = get();
    const output = generateCSharp(mappings, className);
    set({ codeOutput: { cs: output.cs, className } });
  },

  clearCode: () => set({ codeOutput: null }),

  reset: () =>
    set({
      excelData: null,
      fileName: "",
      mappings: [],
      preview: null,
      codeOutput: null,
      pendingConflict: null,
    }),

  defaultClassName: () => {
    const { fileName } = get();
    return toPascal(fileName || "Data") + "Provider";
  },
}));