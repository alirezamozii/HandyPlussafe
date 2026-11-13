import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import type { RecordingPhase } from "@/bindings";
import { useSettings } from "@/hooks/useSettings";
import {
  isWebPreviewRuntime,
  triggerWebSimulatedDictation,
} from "@/lib/tauriWebFallback";
import { BrowserWakeWordEngine } from "@/lib/wakeWord/browserEngine";
import { useWakeWordStore } from "@/stores/wakeWordStore";

export function useWakeWordController(active: boolean): void {
  const { settings } = useSettings();
  const enabled = Boolean(active && settings?.wake_word_enabled);
  const wakeWords = settings?.wake_words ?? [];
  const language = settings?.selected_language || "en-US";
  const engineRef = useRef<BrowserWakeWordEngine | null>(null);
  const resetTimerRef = useRef<number | null>(null);

  const setStatus = useWakeWordStore((state) => state.setStatus);

  useEffect(() => {
    const isWeb = isWebPreviewRuntime();

    if (!isWeb) {
      setStatus(enabled && wakeWords.length > 0 ? "listening" : "off");
      return;
    }

    if (!engineRef.current) {
      engineRef.current = new BrowserWakeWordEngine({
        enabled: enabled && wakeWords.length > 0,
        wakeWords,
        language,
        onStatusChange: (status, detail) => {
          setStatus(status, detail ?? null);
        },
        onWakeMatch: (match) => {
          setStatus("triggered", match.wakeWord ?? null);
          triggerWebSimulatedDictation({
            wakeWord: match.wakeWord,
            trailingText: match.trailingCommand,
          });
        },
      });
    } else {
      engineRef.current.updateConfig({
        enabled: enabled && wakeWords.length > 0,
        wakeWords,
        language,
      });
    }
  }, [enabled, wakeWords, language, setStatus]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    listen<{ phase?: RecordingPhase }>("recording-state-event", (event) => {
      const phase = event.payload?.phase;
      if (phase === "stopped" || phase === "cancelled") {
        if (resetTimerRef.current !== null) {
          window.clearTimeout(resetTimerRef.current);
        }
        resetTimerRef.current = window.setTimeout(() => {
          const current = useWakeWordStore.getState();
          if (current.status === "triggered") {
            setStatus(enabled && wakeWords.length > 0 ? "listening" : "off");
          }
        }, 250);
      }
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {
        // Ignore listener errors in restricted contexts
      });

    return () => {
      unlisten?.();
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, [enabled, wakeWords.length, setStatus]);

  useEffect(() => {
    return () => {
      engineRef.current?.stop();
      engineRef.current = null;
    };
  }, []);
}
