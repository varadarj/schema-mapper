import { create } from "zustand";
import type { ColumnMapping, ExcelData, PreviewData } from "../lib/mapping";
import { buildPreviewRows } from "../lib/mapping";
import {
  buildDataMappings,
  applyDataMappingChange,
  findDataConflict,
  scoreColumnPair,
} from "../lib/dataMatch";
import { sampleSourceFiles, sampleTargetFiles } from "../lib/csvStream";
import { remapSourceTargetWithAI } from "../lib/ai";
import { useApiKeyStore } from "./useApiKeyStore";
import type { PendingConflict } from "./useMappingStore";

function label(names: string[]): string {
  if (names.length === 0) return "";
  return names.length === 1 ? names[0] : `${names.length} files`;
}

export const DEFAULT_SAMPLE_SIZE = 20000;

interface SourceTargetStore {
  // source (one shared schema; many row-shards allowed)
  sourceData: ExcelData | null;
  sourceName: string;
  sourceFiles: File[];
  sourceFileNames: string[];
  sourceRows: string[][]; // header + sampled rows, for export
  sourceWarnings: string[];
  loadingSource: boolean;

  // target (union of possibly-different schemas)
  targetData: ExcelData | null;
  targetName: string;
  targetFiles: File[];
  targetFileNames: string[];
  targetColFiles: Map<string, string[]>; // target column → file(s) it came from
  targetRows: string[][];
  loadingTarget: boolean;

  sampleSize: number;

  mappings: ColumnMapping[];
  preview: PreviewData | null;
  pendingConflict: PendingConflict | null;
  aiLoading: boolean;

  loadSourceFiles: (files: File[]) => Promise<void>;
  loadTargetFiles: (files: File[]) => Promise<void>;
  setSampleSize: (n: number) => Promise<void>;
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
  sourceFiles: [],
  sourceFileNames: [],
  sourceRows: [],
  sourceWarnings: [],
  loadingSource: false,
  targetData: null,
  targetName: "",
  targetFiles: [],
  targetFileNames: [],
  targetColFiles: new Map(),
  targetRows: [],
  loadingTarget: false,
  sampleSize: DEFAULT_SAMPLE_SIZE,
  mappings: [],
  preview: null,
  pendingConflict: null,
  aiLoading: false,

  loadSourceFiles: async (files) => {
    if (!files.length) return;
    set({ loadingSource: true, sourceFiles: files });
    try {
      const res = await sampleSourceFiles(files, get().sampleSize);
      set({
        sourceData: res.data,
        sourceFileNames: res.fileNames,
        sourceName: label(res.fileNames),
        sourceRows: res.rows,
        sourceWarnings: res.warnings,
        mappings: [],
        preview: null,
      });
    } finally {
      set({ loadingSource: false });
    }
  },

  loadTargetFiles: async (files) => {
    if (!files.length) return;
    set({ loadingTarget: true, targetFiles: files });
    try {
      const res = await sampleTargetFiles(files, get().sampleSize);
      set({
        targetData: res.data,
        targetFileNames: res.fileNames,
        targetName: label(res.fileNames),
        targetColFiles: res.colFiles,
        targetRows: res.rows,
        mappings: [],
        preview: null,
      });
    } finally {
      set({ loadingTarget: false });
    }
  },

  // Change the sample size and re-read whatever files are already selected.
  setSampleSize: async (n) => {
    const size = Math.max(100, Math.floor(n) || DEFAULT_SAMPLE_SIZE);
    set({ sampleSize: size });
    const { sourceFiles, targetFiles, loadSourceFiles, loadTargetFiles } = get();
    if (sourceFiles.length) await loadSourceFiles(sourceFiles);
    if (targetFiles.length) await loadTargetFiles(targetFiles);
  },

  runDataMatching: () => {
    const { sourceData, targetData } = get();
    if (!sourceData || !targetData) return;
    const m = buildDataMappings(sourceData, targetData);
    set({ mappings: m, preview: buildPreviewRows(sourceData, m) });
  },

  handleMappingChange: (rowIdx, newField) => {
    const { mappings, sourceData, targetData } = get();
    const conflictIdx = findDataConflict(mappings, newField, rowIdx);
    if (conflictIdx >= 0) {
      set({ pendingConflict: { newField, oldIdx: conflictIdx, newIdx: rowIdx } });
      return;
    }
    const info =
      newField !== "IGNORE" && sourceData && targetData
        ? scoreColumnPair(sourceData, targetData, rowIdx, newField)
        : undefined;
    const updated = applyDataMappingChange(mappings, rowIdx, newField, info);
    set({
      mappings: updated,
      preview: sourceData ? buildPreviewRows(sourceData, updated) : null,
    });
  },

  confirmConflict: () => {
    const { pendingConflict, mappings, sourceData, targetData } = get();
    if (!pendingConflict) return;

    let updated = mappings.map((m) => ({ ...m }));
    updated[pendingConflict.oldIdx] = {
      ...updated[pendingConflict.oldIdx],
      mappedTo: "IGNORE",
      confidence: "NONE" as const,
      score: 0,
      reason: "unmapped (reassigned to another column)",
    };
    const info =
      sourceData && targetData
        ? scoreColumnPair(sourceData, targetData, pendingConflict.newIdx, pendingConflict.newField)
        : undefined;
    updated = applyDataMappingChange(updated, pendingConflict.newIdx, pendingConflict.newField, info);

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
      sourceFiles: [],
      sourceFileNames: [],
      sourceRows: [],
      sourceWarnings: [],
      targetData: null,
      targetName: "",
      targetFiles: [],
      targetFileNames: [],
      targetColFiles: new Map(),
      targetRows: [],
      mappings: [],
      preview: null,
      pendingConflict: null,
    }),
}));
