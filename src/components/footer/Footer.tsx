import React, { useState, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useTranslation } from "react-i18next";
import { useSettings } from "@/hooks/useSettings";
import { useWakeWordStore } from "@/stores/wakeWordStore";

import ModelSelector from "../model-selector";
import UpdateChecker from "../update-checker";
import NoticeChip from "./NoticeChip";
import TranscriptionStatus from "./TranscriptionStatus";

interface FooterProps {
  onShowHistory: () => void;
}

const Footer: React.FC<FooterProps> = ({ onShowHistory }) => {
  const { t } = useTranslation();
  const [version, setVersion] = useState("");
  const { getSetting } = useSettings();
  const wakeStatus = useWakeWordStore((state) => state.status);
  const lastMatchedWord = useWakeWordStore((state) => state.lastMatchedWord);

  const wakeWordEnabled = getSetting("wake_word_enabled") ?? false;
  const wakeWords = getSetting("wake_words") ?? [];

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const appVersion = await getVersion();
        setVersion(appVersion);
      } catch (error) {
        console.error("Failed to get app version:", error);
        setVersion("0.1.2");
      }
    };

    fetchVersion();
  }, []);

  const wakeFooterLabel =
    wakeWords.length === 0
      ? t("footer.wakeWord.noPhrases")
      : wakeStatus === "triggered" && lastMatchedWord
        ? t("footer.wakeWord.triggered", { word: lastMatchedWord })
        : t("footer.wakeWord.armed", { count: wakeWords.length });

  return (
    <div className="w-full border-t border-line bg-surface/80 pt-3">
      <div className="flex justify-between items-center text-xs px-4 pb-3 text-ink-2">
        <div className="flex items-center gap-3">
          <ModelSelector />
          {wakeWordEnabled && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                wakeWords.length > 0
                  ? "border-logo-primary/35 bg-logo-primary/10 text-logo-primary"
                  : "border-line bg-surface-elevated text-ink-2"
              }`}
            >
              {wakeWords.length > 0 && (
                <span
                  aria-hidden="true"
                  className="wake-pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-logo-primary"
                />
              )}
              <span>{wakeFooterLabel}</span>
            </span>
          )}
          <TranscriptionStatus onShowHistory={onShowHistory} />
        </div>

        <div className="flex items-center gap-3">
          {/* Update Status */}
          <div className="flex items-center gap-1">
            <UpdateChecker />
            <span>•</span>
            {/* eslint-disable-next-line i18next/no-literal-string */}
            <span>v{version}</span>
          </div>
          <NoticeChip />
        </div>
      </div>
    </div>
  );
};

export default Footer;
