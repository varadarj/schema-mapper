import { create } from "zustand";
import type { ColumnMapping, ExcelData, PreviewData } from "../lib/mapping";
import {
  buildMappings,
  applyMappingChange,
  enforceUniqueMapping,
  fixAddressOrder,
  buildPreviewRows,
  findConflict,
  ensureInvoiceAmount,
} from "../lib/mapping";
import type { ParsedFile } from "../lib/fileParse";
import { remapWithAI } from "../lib/ai";
import { useApiKeyStore } from "./useApiKeyStore";
import { generateCSharp, toPascal } from "../lib/codegen";
import type { CodeGenOutput, ProviderMode } from "../lib/codegen";

export interface PendingConflict {
  newField: string;
  oldIdx: number;
  newIdx: number;
}

// One uploaded source file: its own data + independent column mapping.
export interface MappingFile {
  id: string;
  fileName: string;
  keyword: string; // runtime filename token used for Contains() matching
  excelData: ExcelData;
  mappings: ColumnMapping[];
  allRows: string[][]; // full header + data rows (header at index 0), for the joined preview
}

// ── Join-key helpers ──────────────────────────────────────────────────────────
// Fields mapped (non-IGNORE) in EVERY file are the valid join-key candidates.
export function joinKeyCandidates(files: MappingFile[]): string[] {
  if (files.length === 0) return [];
  const sets = files.map(
    (f) =>
      new Set(
        f.mappings.filter((m) => m.mappedTo !== "IGNORE").map((m) => m.mappedTo)
      )
  );
  const [first, ...rest] = sets;
  return [...first].filter((field) => rest.every((s) => s.has(field)));
}

// Prefer ACCOUNTNUMBER, then NAME, then first available common field.
export function autoJoinKey(files: MappingFile[]): string {
  const candidates = joinKeyCandidates(files);
  if (candidates.includes("ACCOUNTNUMBER")) return "ACCOUNTNUMBER";
  if (candidates.includes("NAME")) return "NAME";
  return candidates[0] ?? "";
}

// Guess which of the files is the customer/identity file (the other is aging),
// from its keyword/filename. Falls back to the first file.
const CUSTOMER_HINT = /CUST|CUSTOMER|MASTER|IDENT|CLIENT|NAME|NA[_-]/i;
export function autoCustomerFileId(files: MappingFile[]): string | null {
  if (!files.length) return null;
  const hit = files.find((f) => CUSTOMER_HINT.test(f.keyword) || CUSTOMER_HINT.test(f.fileName));
  return (hit ?? files[0]).id;
}

interface MappingStore {
  // data — one mapping per uploaded file
  files: MappingFile[];
  activeFileId: string | null;
  standardizedColumns: string[];
  configLoaded: boolean;

  // join (multi-file only)
  joinKey: string;
  joinKeyAuto: boolean;

  // provider type — aging buckets vs raw invoice rows
  providerMode: ProviderMode;

  // two-file role override — which file is the customer file (other is aging)
  customerFileId: string | null;

  // preview for the active file
  preview: PreviewData | null;

  // ui state
  pendingConflict: (PendingConflict & { fileId: string }) | null;

  // ai
  aiLoading: boolean;

  // code output
  codeOutput: (CodeGenOutput & { className: string }) | null;

  // actions — data loading
  addFiles: (parsed: ParsedFile[]) => void;
  removeFile: (id: string) => void;
  setActiveFile: (id: string) => void;
  setKeyword: (id: string, keyword: string) => void;
  setStandardizedColumns: (cols: string[], loaded: boolean) => void;

  // actions — join
  setJoinKey: (field: string) => void;
  setProviderMode: (mode: ProviderMode) => void;
  setCustomerFile: (id: string) => void;

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
  activeFile: () => MappingFile | null;
}

// Recompute the auto join key after mappings change (no-op if user overrode it).
function recomputeJoinKey(
  files: MappingFile[],
  joinKey: string,
  joinKeyAuto: boolean
): string {
  if (!joinKeyAuto) {
    // Keep the user's choice only while it stays a valid candidate.
    return joinKeyCandidates(files).includes(joinKey) ? joinKey : autoJoinKey(files);
  }
  return autoJoinKey(files);
}

export const useMappingStore = create<MappingStore>((set, get) => ({
  files: [],
  activeFileId: null,
  standardizedColumns: [],
  configLoaded: false,
  joinKey: "",
  joinKeyAuto: true,
  providerMode: "aging",
  customerFileId: null,
  preview: null,
  pendingConflict: null,
  aiLoading: false,
  codeOutput: null,

  activeFile: () => {
    const { files, activeFileId } = get();
    return files.find((f) => f.id === activeFileId) ?? files[0] ?? null;
  },

  addFiles: (parsed) => {
    if (!parsed.length) return;
    const { files } = get();
    const offset = files.length;
    const added: MappingFile[] = parsed.map((p, i) => ({
      id: `${p.fileName}-${offset + i}-${p.data.headers.length}`,
      fileName: p.fileName,
      keyword: p.fileName.toUpperCase(),
      excelData: p.data,
      mappings: [],
      allRows: p.allRows,
    }));
    const next = [...files, ...added];
    set({
      files: next,
      activeFileId: get().activeFileId ?? added[0].id,
      preview: null,
      codeOutput: null,
    });
  },

  removeFile: (id) => {
    const { files, activeFileId, joinKey, joinKeyAuto } = get();
    const next = files.filter((f) => f.id !== id);
    set({
      files: next,
      activeFileId:
        activeFileId === id ? next[0]?.id ?? null : activeFileId,
      joinKey: recomputeJoinKey(next, joinKey, joinKeyAuto),
      preview: null,
      codeOutput: null,
    });
    get().refreshPreview();
  },

  setActiveFile: (id) => {
    set({ activeFileId: id });
    get().refreshPreview();
  },

  setKeyword: (id, keyword) =>
    set((s) => ({
      files: s.files.map((f) => (f.id === id ? { ...f, keyword } : f)),
      codeOutput: null,
    })),

  setStandardizedColumns: (cols, loaded) =>
    set({ standardizedColumns: cols, configLoaded: loaded }),

  setJoinKey: (field) => set({ joinKey: field, joinKeyAuto: false, codeOutput: null }),

  setProviderMode: (mode) => {
    const { files, activeFileId } = get();
    // Switching to invoice: ensure each mapped file has INVAMT (amount fallback).
    const next =
      mode === "invoice"
        ? files.map((f) =>
            f.mappings.length ? { ...f, mappings: ensureInvoiceAmount(f.mappings) } : f
          )
        : files;
    const active = next.find((f) => f.id === activeFileId) ?? next[0] ?? null;
    set({
      providerMode: mode,
      files: next,
      preview: active ? buildPreviewRows(active.excelData, active.mappings) : null,
      codeOutput: null,
    });
  },

  setCustomerFile: (id) => set({ customerFileId: id, codeOutput: null }),

  runFuzzyMapping: () => {
    const { files, standardizedColumns, joinKey, joinKeyAuto, providerMode } = get();
    if (!files.length || !standardizedColumns.length) return;
    const next = files.map((f) => {
      let mappings = buildMappings(f.excelData, standardizedColumns);
      if (providerMode === "invoice") mappings = ensureInvoiceAmount(mappings);
      return { ...f, mappings };
    });
    const active = next.find((f) => f.id === get().activeFileId) ?? next[0];
    set({
      files: next,
      joinKey: recomputeJoinKey(next, joinKey, joinKeyAuto),
      preview: buildPreviewRows(active.excelData, active.mappings),
      codeOutput: null,
    });
  },

  handleMappingChange: (rowIdx, newField) => {
    const { joinKey, joinKeyAuto } = get();
    const active = get().activeFile();
    if (!active) return;
    const conflictIdx = findConflict(active.mappings, newField, rowIdx);

    if (conflictIdx >= 0) {
      set({ pendingConflict: { newField, oldIdx: conflictIdx, newIdx: rowIdx, fileId: active.id } });
      return;
    }

    const updated = applyMappingChange(active.mappings, rowIdx, newField);
    const next = get().files.map((f) =>
      f.id === active.id ? { ...f, mappings: updated } : f
    );
    set({
      files: next,
      joinKey: recomputeJoinKey(next, joinKey, joinKeyAuto),
      preview: buildPreviewRows(active.excelData, updated),
      codeOutput: null,
    });
  },

  confirmConflict: () => {
    const { pendingConflict, files, joinKey, joinKeyAuto } = get();
    if (!pendingConflict) return;
    const file = files.find((f) => f.id === pendingConflict.fileId);
    if (!file) {
      set({ pendingConflict: null });
      return;
    }

    // unmap old
    let updated = file.mappings.map((m) => ({ ...m }));
    updated[pendingConflict.oldIdx] = {
      ...updated[pendingConflict.oldIdx],
      mappedTo: "IGNORE",
      confidence: "NONE" as const,
      score: 0,
    };

    // apply new
    updated = applyMappingChange(updated, pendingConflict.newIdx, pendingConflict.newField);

    const next = files.map((f) =>
      f.id === file.id ? { ...f, mappings: updated } : f
    );
    set({
      files: next,
      joinKey: recomputeJoinKey(next, joinKey, joinKeyAuto),
      preview: buildPreviewRows(file.excelData, updated),
      pendingConflict: null,
      codeOutput: null,
    });
  },

  cancelConflict: () => set({ pendingConflict: null }),

  refreshPreview: () => {
    const active = get().activeFile();
    if (active) set({ preview: buildPreviewRows(active.excelData, active.mappings) });
    else set({ preview: null });
  },

  runAiMapping: async () => {
    const { standardizedColumns, joinKey, joinKeyAuto } = get();
    const active = get().activeFile();
    const { apiKey } = useApiKeyStore.getState();
    if (!active || !apiKey) return;
    set({ aiLoading: true });
    try {
      let aiMappings = await remapWithAI(active.excelData, standardizedColumns, apiKey);
      aiMappings = enforceUniqueMapping(aiMappings);
      aiMappings = fixAddressOrder(aiMappings);
      const next = get().files.map((f) =>
        f.id === active.id ? { ...f, mappings: aiMappings } : f
      );
      set({
        files: next,
        joinKey: recomputeJoinKey(next, joinKey, joinKeyAuto),
        preview: buildPreviewRows(active.excelData, aiMappings),
        codeOutput: null,
      });
    } finally {
      set({ aiLoading: false });
    }
  },

  generateCode: (className) => {
    const { files, joinKey, providerMode, customerFileId } = get();
    const custId = files.length === 2 ? (customerFileId ?? autoCustomerFileId(files)) : null;
    const sources = files.map((f) => ({
      keyword: f.keyword,
      mappings: f.mappings,
      role:
        files.length === 2
          ? f.id === custId
            ? ("customer" as const)
            : ("aging" as const)
          : undefined,
    }));
    const output = generateCSharp(sources, className, joinKey, providerMode);
    set({ codeOutput: { cs: output.cs, className } });
  },

  clearCode: () => set({ codeOutput: null }),

  reset: () =>
    set({
      files: [],
      activeFileId: null,
      joinKey: "",
      joinKeyAuto: true,
      providerMode: "aging",
      customerFileId: null,
      preview: null,
      codeOutput: null,
      pendingConflict: null,
    }),

  defaultClassName: () => {
    const { files } = get();
    const base = files[0]?.fileName || "Data";
    return toPascal(base) + "Provider";
  },
}));
