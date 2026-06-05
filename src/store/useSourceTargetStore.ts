import { create } from "zustand";
import type { ColumnMapping, ExcelData, PreviewData } from "../lib/mapping";
import { buildPreviewRows } from "../lib/mapping";
import {
  buildDataMappings,
  applyDataMappingChange,
  findDataConflict,
} from "../lib/dataMatch";
import { remapSourceTargetWithAI } from "../lib/ai";
import { useApiKeyStore } from "./useApiKeyStore";
import type { PendingConflict } from "./useMappingStore";

interface SourceTargetStore {
  // data
  sourceData: ExcelData | null;
  sourceName: string;
  sourceRows: string[][]; // full header + rows, for export
  targetData: ExcelData | null;
  targetName: string;
  targetRows: string[][];

  mappings: ColumnMapping[];
  preview: PreviewData | null;
  pendingConflict: PendingConflict | null;
  aiLoading: boolean;

  // actions
  setSource: (data: ExcelData, name: string, allRows: string[][]) => void;
  setTarget: (data: ExcelData, name: string, allRows: string[][]) => void;
  runDataMatching: () => void;
  handleMappingChange: (rowIdx: number, newField: string) => void;
  confirmConflict: () => void;
  cancelConflict: () => void;
  runAiRefine: () => Promise<void>;
  reset: () => void;
}

export const useSourceTargetStore = create<SourceTargetStore>((set, get) => ({
  sourceData: null,
  sourceName: "",
  sourceRows: [],
  targetData: null,
  targetName: "",
  targetRows: [],
  mappings: [],
  preview: null,
  pendingConflict: null,
  aiLoading: false,

  setSource: (data, name, allRows) =>
    set({ sourceData: data, sourceName: name, sourceRows: allRows, mappings: [], preview: null }),

  setTarget: (data, name, allRows) =>
    set({ targetData: data, targetName: name, targetRows: allRows, mappings: [], preview: null }),

  runDataMatching: () => {
    const { sourceData, targetData } = get();
    if (!sourceData || !targetData) return;
    const m = buildDataMappings(sourceData, targetData);
    set({ mappings: m, preview: buildPreviewRows(sourceData, m) });
  },

  handleMappingChange: (rowIdx, newField) => {
    const { mappings, sourceData } = get();
    const conflictIdx = findDataConflict(mappings, newField, rowIdx);
    if (conflictIdx >= 0) {
      set({ pendingConflict: { newField, oldIdx: conflictIdx, newIdx: rowIdx } });
      return;
    }
    const updated = applyDataMappingChange(mappings, rowIdx, newField);
    set({
      mappings: updated,
      preview: sourceData ? buildPreviewRows(sourceData, updated) : null,
    });
  },

  confirmConflict: () => {
    const { pendingConflict, mappings, sourceData } = get();
    if (!pendingConflict) return;

    let updated = mappings.map((m) => ({ ...m }));
    updated[pendingConflict.oldIdx] = {
      ...updated[pendingConflict.oldIdx],
      mappedTo: "IGNORE",
      confidence: "NONE" as const,
      score: 0,
    };
    updated = applyDataMappingChange(updated, pendingConflict.newIdx, pendingConflict.newField);

    set({
      mappings: updated,
      preview: sourceData ? buildPreviewRows(sourceData, updated) : null,
      pendingConflict: null,
    });
  },

  cancelConflict: () => set({ pendingConflict: null }),

  runAiRefine: async () => {
    const { sourceData, targetData } = get();
    const { apiKey } = useApiKeyStore.getState();
    if (!sourceData || !targetData || !apiKey) return;
    set({ aiLoading: true });
    try {
      const aiMappings = await remapSourceTargetWithAI(sourceData, targetData, apiKey);
      set({ mappings: aiMappings, preview: buildPreviewRows(sourceData, aiMappings) });
    } finally {
      set({ aiLoading: false });
    }
  },

  reset: () =>
    set({
      sourceData: null,
      sourceName: "",
      sourceRows: [],
      targetData: null,
      targetName: "",
      targetRows: [],
      mappings: [],
      preview: null,
      pendingConflict: null,
    }),
}));
