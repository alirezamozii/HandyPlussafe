import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw, Sparkles } from "lucide-react";
import { useSettings } from "@/hooks/useSettings";
import { applyVoiceEdit } from "@/lib/voiceEdit/engine";
import {
  DEFAULT_WAKE_WORDS,
  MAX_WAKE_WORDS,
  MAX_WAKE_WORD_LENGTH,
  normalizeWakePhrase,
  sanitizeWakeWordInput,
} from "@/lib/wakeWord/matcher";
import { isComposingKeyEvent } from "@/lib/utils/keyboard";
import { notify } from "@/stores/noticeStore";
import { useWakeWordStore } from "@/stores/wakeWordStore";
import Badge from "../ui/Badge";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { SettingContainer } from "../ui/SettingContainer";
import { Switch } from "../ui/Switch";

const INITIAL_STUDIO_DRAFT =
  "We urgently scheduled the deployment for Tuesday because the old cloud pipeline is way too slow for daily builds.";

interface WakeWordSettingsProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const WakeWordSettings: React.FC<WakeWordSettingsProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();
    const wakeStatus = useWakeWordStore((state) => state.status);
    const lastMatchedWord = useWakeWordStore((state) => state.lastMatchedWord);
    const simulateWakePhrase = useWakeWordStore(
      (state) => state.simulateWakePhrase,
    );

    const [newWakeWord, setNewWakeWord] = useState("");
    const [testPhrase, setTestPhrase] = useState("");
    const [studioDraft, setStudioDraft] = useState(INITIAL_STUDIO_DRAFT);
    const [previousStudioDraft, setPreviousStudioDraft] = useState<
      string | null
    >(null);
    const [voiceEditCommand, setVoiceEditCommand] = useState(
      "replace from old cloud to way too slow with local Rust engine",
    );

    const wakeWordEnabled = getSetting("wake_word_enabled") ?? false;
    const voiceEditEnabled = getSetting("voice_edit_enabled") ?? true;
    const wakeWords = getSetting("wake_words") ?? [...DEFAULT_WAKE_WORDS];
    const sanitizedNewWord = sanitizeWakeWordInput(newWakeWord);
    const isToggleUpdating = isUpdating("wake_word_enabled");
    const isVoiceEditUpdating = isUpdating("voice_edit_enabled");
    const isListUpdating = isUpdating("wake_words");

    const handleToggleWakeWord = (enabled: boolean) => {
      updateSetting("wake_word_enabled", enabled);
    };

    const handleToggleVoiceEdit = (enabled: boolean) => {
      updateSetting("voice_edit_enabled", enabled);
    };

    const handleAddWakeWord = () => {
      if (!sanitizedNewWord || sanitizedNewWord.length > MAX_WAKE_WORD_LENGTH) {
        return;
      }
      if (wakeWords.length >= MAX_WAKE_WORDS) {
        notify({
          title: t("settings.general.wakeWord.phrases.limitReached", {
            max: MAX_WAKE_WORDS,
          }),
        });
        return;
      }
      const candidateNorm = normalizeWakePhrase(sanitizedNewWord);
      const duplicate = wakeWords.some(
        (existing) => normalizeWakePhrase(existing) === candidateNorm,
      );
      if (duplicate) {
        notify({
          title: t("settings.general.wakeWord.phrases.duplicate", {
            word: sanitizedNewWord,
          }),
        });
        return;
      }
      updateSetting("wake_words", [...wakeWords, sanitizedNewWord]);
      setNewWakeWord("");
    };

    const handleRemoveWakeWord = (wordToRemove: string) => {
      updateSetting(
        "wake_words",
        wakeWords.filter((word) => word !== wordToRemove),
      );
    };

    const handleResetDefaults = () => {
      updateSetting("wake_words", [...DEFAULT_WAKE_WORDS]);
    };

    const handleKeyDownAdd = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (isComposingKeyEvent(e.nativeEvent)) return;
      if (e.key === "Enter") {
        e.preventDefault();
        handleAddWakeWord();
      }
    };

    const handleTestWakePhrase = () => {
      const phrase = testPhrase.trim();
      if (!phrase) return;
      const result = simulateWakePhrase(phrase);
      if (!result.matched) {
        notify({
          title: t("settings.general.wakeWord.test.noMatch"),
        });
      }
    };

    const handleKeyDownTest = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (isComposingKeyEvent(e.nativeEvent)) return;
      if (e.key === "Enter") {
        e.preventDefault();
        handleTestWakePhrase();
      }
    };

    const executeVoiceEditCommand = (rawCommand: string) => {
      const cmd = rawCommand.trim();
      if (!cmd) return;
      const outcome = applyVoiceEdit(studioDraft, cmd, {
        previousSnapshot: previousStudioDraft ?? undefined,
      });
      if (outcome.matched) {
        setPreviousStudioDraft(studioDraft);
        setStudioDraft(outcome.updatedText);
        notify({
          title: t("settings.general.wakeWord.voiceEdit.appliedToast", {
            kind: outcome.command.kind,
          }),
        });
      } else {
        setPreviousStudioDraft(studioDraft);
        setStudioDraft((prev) => (prev ? `${prev} ${cmd}` : cmd));
        notify({
          title: t("settings.general.wakeWord.voiceEdit.noMatchToast"),
        });
      }
    };

    const handleKeyDownVoiceEdit = (
      e: React.KeyboardEvent<HTMLInputElement>,
    ) => {
      if (isComposingKeyEvent(e.nativeEvent)) return;
      if (e.key === "Enter") {
        e.preventDefault();
        executeVoiceEditCommand(voiceEditCommand);
      }
    };

    const handleResetStudioDraft = () => {
      setPreviousStudioDraft(null);
      setStudioDraft(INITIAL_STUDIO_DRAFT);
    };

    const isArmed = wakeWordEnabled && wakeWords.length > 0;
    const statusLabel = !wakeWordEnabled
      ? t("settings.general.wakeWord.status.off")
      : wakeWords.length === 0
        ? t("settings.general.wakeWord.status.noWords")
        : wakeStatus === "triggered" && lastMatchedWord
          ? t("settings.general.wakeWord.status.triggered", {
              word: lastMatchedWord,
            })
          : wakeStatus === "unavailable" || wakeStatus === "error"
            ? t("settings.general.wakeWord.status.unavailable")
            : t("settings.general.wakeWord.status.armed");

    const matchesDefaultList =
      wakeWords.length === DEFAULT_WAKE_WORDS.length &&
      DEFAULT_WAKE_WORDS.every((word, idx) => wakeWords[idx] === word);

    return (
      <>
        <SettingContainer
          title={t("settings.general.wakeWord.toggle.title")}
          description={t("settings.general.wakeWord.toggle.description")}
          descriptionMode={descriptionMode}
          grouped={grouped}
        >
          <div className="flex items-center gap-3">
            <Badge
              variant={isArmed ? "primary" : "secondary"}
              className="gap-1.5"
            >
              {isArmed && (
                <span
                  aria-hidden="true"
                  className="wake-pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-on-accent"
                />
              )}
              <span>{statusLabel}</span>
            </Badge>
            <Switch
              checked={wakeWordEnabled}
              onChange={handleToggleWakeWord}
              disabled={isToggleUpdating}
              ariaLabel={t("settings.general.wakeWord.toggle.title")}
            />
          </div>
        </SettingContainer>

        <SettingContainer
          title={t("settings.general.wakeWord.phrases.title")}
          description={t("settings.general.wakeWord.phrases.description")}
          descriptionMode={descriptionMode}
          grouped={grouped}
        >
          <div className="flex items-center gap-2">
            <Input
              type="text"
              className="w-56"
              value={newWakeWord}
              onChange={(e) => setNewWakeWord(e.target.value)}
              onKeyDown={handleKeyDownAdd}
              placeholder={t("settings.general.wakeWord.phrases.placeholder")}
              maxLength={MAX_WAKE_WORD_LENGTH}
              variant="compact"
              disabled={isListUpdating}
            />
            <Button
              onClick={handleAddWakeWord}
              disabled={
                !sanitizedNewWord ||
                sanitizedNewWord.length > MAX_WAKE_WORD_LENGTH ||
                isListUpdating
              }
              variant="primary"
              size="md"
            >
              {t("settings.general.wakeWord.phrases.add")}
            </Button>
            {!matchesDefaultList && (
              <Button
                onClick={handleResetDefaults}
                disabled={isListUpdating}
                variant="secondary"
                size="sm"
                title={t("settings.general.wakeWord.phrases.resetTooltip")}
                aria-label={t("settings.general.wakeWord.phrases.resetTooltip")}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </SettingContainer>

        {wakeWords.length > 0 && (
          <div
            className={`px-4 py-2.5 ${grouped ? "" : "rounded-lg border border-line"} flex flex-wrap gap-1.5`}
          >
            {wakeWords.map((word) => (
              <Button
                key={word}
                onClick={() => handleRemoveWakeWord(word)}
                disabled={isListUpdating}
                variant="secondary"
                size="sm"
                className="inline-flex items-center gap-1.5 cursor-pointer"
                aria-label={t("settings.general.wakeWord.phrases.remove", {
                  word,
                })}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-logo-primary" />
                <span>{word}</span>
                <svg
                  className="w-3 h-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </Button>
            ))}
          </div>
        )}

        {wakeWordEnabled && (
          <SettingContainer
            title={t("settings.general.wakeWord.test.title")}
            description={t("settings.general.wakeWord.test.description")}
            descriptionMode={descriptionMode}
            grouped={grouped}
          >
            <div className="flex items-center gap-2">
              <Input
                type="text"
                className="w-56"
                value={testPhrase}
                onChange={(e) => setTestPhrase(e.target.value)}
                onKeyDown={handleKeyDownTest}
                placeholder={t("settings.general.wakeWord.test.placeholder", {
                  sample: wakeWords[0] || DEFAULT_WAKE_WORDS[0],
                })}
                variant="compact"
                disabled={!isArmed}
              />
              <Button
                onClick={handleTestWakePhrase}
                disabled={!isArmed || !testPhrase.trim()}
                variant="primary"
                size="md"
              >
                {t("settings.general.wakeWord.test.button")}
              </Button>
            </div>
          </SettingContainer>
        )}

        <SettingContainer
          title={t("settings.general.wakeWord.voiceEdit.title")}
          description={t("settings.general.wakeWord.voiceEdit.description")}
          descriptionMode={descriptionMode}
          grouped={grouped}
        >
          <Switch
            checked={voiceEditEnabled}
            onChange={handleToggleVoiceEdit}
            disabled={isVoiceEditUpdating}
            ariaLabel={t("settings.general.wakeWord.voiceEdit.title")}
          />
        </SettingContainer>

        {voiceEditEnabled && (
          <div className="px-4 py-3.5 border-t border-line/60 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-accent" />
                <span className="text-xs font-semibold uppercase tracking-wider text-ink-2">
                  {t("settings.general.wakeWord.voiceEdit.studioTitle")}
                </span>
              </div>
              <Button
                onClick={handleResetStudioDraft}
                variant="secondary"
                size="sm"
              >
                {t("settings.general.wakeWord.voiceEdit.resetButton")}
              </Button>
            </div>

            <div className="rounded-lg border border-line bg-surface-1 px-3 py-2.5 text-sm text-ink leading-relaxed font-mono">
              {studioDraft || "—"}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const cmd =
                    "replace from old cloud to way too slow with local Rust engine";
                  setVoiceEditCommand(cmd);
                  executeVoiceEditCommand(cmd);
                }}
              >
                {t("settings.general.wakeWord.voiceEdit.presetRange")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const cmd = "replace Tuesday with Thursday";
                  setVoiceEditCommand(cmd);
                  executeVoiceEditCommand(cmd);
                }}
              >
                {t("settings.general.wakeWord.voiceEdit.presetReplace")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const cmd = "remove urgently";
                  setVoiceEditCommand(cmd);
                  executeVoiceEditCommand(cmd);
                }}
              >
                {t("settings.general.wakeWord.voiceEdit.presetRemove")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const cmd = "undo";
                  setVoiceEditCommand(cmd);
                  executeVoiceEditCommand(cmd);
                }}
              >
                {t("settings.general.wakeWord.voiceEdit.presetUndo")}
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Input
                type="text"
                className="flex-1"
                value={voiceEditCommand}
                onChange={(e) => setVoiceEditCommand(e.target.value)}
                onKeyDown={handleKeyDownVoiceEdit}
                placeholder={t(
                  "settings.general.wakeWord.voiceEdit.commandPlaceholder",
                )}
                variant="compact"
              />
              <Button
                onClick={() => executeVoiceEditCommand(voiceEditCommand)}
                disabled={!voiceEditCommand.trim()}
                variant="primary"
                size="md"
              >
                {t("settings.general.wakeWord.voiceEdit.runButton")}
              </Button>
            </div>
          </div>
        )}
      </>
    );
  },
);
