import { create } from "zustand";
import type { WakeEngineStatus } from "@/lib/wakeWord/browserEngine";

interface WakeWordStoreState {
  status: WakeEngineStatus;
  lastMatchedWord: string | null;
  lastDetail: string | null;
  setStatus: (status: WakeEngineStatus, detail?: string | null) => void;
}

export const useWakeWordStore = create<WakeWordStoreState>((set) => ({
  status: "off",
  lastMatchedWord: null,
  lastDetail: null,

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
}));
