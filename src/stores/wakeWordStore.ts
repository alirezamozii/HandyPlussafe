import { create } from "zustand";
import type { WakeEngineStatus } from "@/lib/wakeWord/browserEngine";
import type { WakeWordMatchResult } from "@/lib/wakeWord/matcher";

export type WakePhraseSimulator = (phrase: string) => WakeWordMatchResult;

interface WakeWordStoreState {
  status: WakeEngineStatus;
  lastMatchedWord: string | null;
  lastDetail: string | null;
  simulator: WakePhraseSimulator | null;
  setStatus: (status: WakeEngineStatus, detail?: string | null) => void;
  setSimulator: (simulator: WakePhraseSimulator | null) => void;
  simulateWakePhrase: (phrase: string) => WakeWordMatchResult;
}

export const useWakeWordStore = create<WakeWordStoreState>((set, get) => ({
  status: "off",
  lastMatchedWord: null,
  lastDetail: null,
  simulator: null,

  setStatus: (status, detail = null) =>
    set((state) => ({
      status,
      lastDetail: detail,
      lastMatchedWord:
        status === "triggered"
          ? detail
          : status === "off"
            ? null
            : state.lastMatchedWord,
    })),

  setSimulator: (simulator) => set({ simulator }),

  simulateWakePhrase: (phrase: string) => {
    const { simulator } = get();
    if (!simulator) {
      return { matched: false, wakeWord: null, trailingCommand: "" };
    }
    return simulator(phrase);
  },
}));
