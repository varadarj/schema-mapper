import { create } from "zustand";
import { testApiKey as testKey } from "../lib/ai";

// Shared Anthropic API key state — used by both the DSP3 and source↔target
// modes so the key only needs to be tested once.
interface ApiKeyStore {
  apiKey: string;
  apiTested: boolean;
  setApiKey: (key: string, tested: boolean) => void;
  testApiConnection: (key: string) => Promise<void>;
}

export const useApiKeyStore = create<ApiKeyStore>((set) => ({
  apiKey: "",
  apiTested: false,
  setApiKey: (key, tested) => set({ apiKey: key, apiTested: tested }),
  testApiConnection: async (key) => {
    await testKey(key);
    set({ apiKey: key, apiTested: true });
  },
}));
