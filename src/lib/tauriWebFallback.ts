import type {
  AppSettings,
  HistoryEntry,
  ModelInfo,
  Notice,
  RecordingPhase,
} from "@/bindings";
import { CURATED_ASR } from "./models/catalog";
import { applyVoiceEdit } from "./voiceEdit/engine";
import { DEFAULT_WAKE_WORDS, sanitizeWakeWordList } from "./wakeWord/matcher";

const SETTINGS_STORAGE_KEY = "handyplus.web.settings.v2";
const HISTORY_STORAGE_KEY = "handyplus.web.history.v1";

type EventCallbackEntry = {
  id: number;
  event: string;
  handlerId: number;
};

type TauriInternalsWindow = Window & {
  __TAURI_INTERNALS__?: {
    transformCallback: (cb: (data: unknown) => void, once?: boolean) => number;
    unregisterCallback: (id: number) => void;
    invoke: (
      cmd: string,
      args?: Record<string, unknown>,
      options?: unknown,
    ) => Promise<unknown>;
    convertFileSrc: (filePath: string, protocol?: string) => string;
    metadata: {
      currentWindow: { label: string };
      currentWebview: { windowLabel: string; label: string };
    };
  };
  __TAURI_OS_PLUGIN_INTERNALS__?: {
    eol: string;
    platform: string;
    version: string;
    family: string;
    os_type: string;
    arch: string;
    exe_extension: string;
  };
  __TAURI_EVENT_PLUGIN_INTERNALS__?: {
    unregisterListener: (event: string, eventId: number) => void;
  };
  __HANDY_WEB_PREVIEW__?: boolean;
};

export function isWebPreviewRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean((window as TauriInternalsWindow).__HANDY_WEB_PREVIEW__)
  );
}

const DEFAULT_WEB_MODELS: ModelInfo[] = CURATED_ASR.map((m, idx) => {
  const quantFile = m.files[m.quant] ?? Object.values(m.files)[0];
  const sizeMb = quantFile
    ? Math.max(1, Math.round(quantFile.size / (1024 * 1024)))
    : 500;
  return {
    id: m.id,
    name: m.name,
    description: m.description,
    filename: quantFile?.filename ?? `${m.id}.gguf`,
    source: {
      HuggingFace: {
        repo_id: m.repository,
        revision: m.revision,
      },
    },
    size_mb: sizeMb,
    is_downloaded: m.id === "parakeet-unified-en-0.6b" || idx === 0,
    is_downloading: false,
    partial_size: 0,
    accuracy_score: 0.95,
    speed_score: 0.92,
    supports_translation: Boolean(m.capabilities?.translate),
    is_recommended: m.id === "parakeet-unified-en-0.6b",
    supported_languages: [...m.languages],
    supports_language_selection: m.languages.length > 1,
    is_custom: false,
    supports_streaming: Boolean(m.capabilities?.streaming),
    supports_language_detection: Boolean(m.capabilities?.languageDetection),
  };
});

function buildDefaultSettings(): AppSettings {
  return {
    settings_schema_version: 2,
    bindings: {
      transcribe: {
        id: "transcribe",
        name: "Transcribe",
        description: "Hold or tap to transcribe speech",
        default_binding: "Ctrl+Space",
        current_binding: "Ctrl+Space",
      },
      cancel: {
        id: "cancel",
        name: "Cancel",
        description: "Cancel current recording",
        default_binding: "Escape",
        current_binding: "Escape",
      },
      transcribe_with_post_process: {
        id: "transcribe_with_post_process",
        name: "Transcribe + Post Process",
        description: "Transcribe speech and apply LLM post-processing",
        default_binding: "Ctrl+Shift+Space",
        current_binding: "",
      },
    },
    shortcut_activation: "hold_or_toggle",
    hold_threshold_ms: 300,
    audio_feedback: false,
    audio_feedback_volume: 1.0,
    sound_theme: "marimba",
    start_hidden: false,
    autostart_enabled: false,
    update_checks_enabled: false,
    show_whats_new_on_update: false,
    whats_new_last_seen_version: "0.10.0",
    selected_model: "parakeet-unified-en-0.6b",
    onboarding_completed: true,
    always_on_microphone: false,
    selected_microphone: "Default",
    selected_channel: null,
    clamshell_microphone: "Default",
    selected_output_device: "Default",
    translate_to_english: false,
    selected_language: "auto",
    spoken_languages: ["en"],
    overlay_position: "bottom",
    debug_mode: false,
    log_level: "info",
    custom_words: [],
    wake_word_enabled: false,
    wake_words: [...DEFAULT_WAKE_WORDS],
    voice_edit_enabled: true,
    model_unload_timeout: "min_5",
    word_correction_threshold: 0.18,
    history_limit: 25,
    recording_retention_period: "preserve_limit",
    paste_method: "ctrl_v",
    clipboard_handling: "dont_modify",
    auto_submit: false,
    auto_submit_key: "enter",
    post_process_enabled: false,
    post_process_provider_id: "openai",
    post_process_providers: [
      {
        id: "openai",
        label: "OpenAI",
        base_url: "https://api.openai.com/v1",
        allow_base_url_edit: false,
        models_endpoint: "/models",
        supports_structured_output: true,
        api_format: "openai",
      },
    ],
    post_process_api_keys: {},
    post_process_models: {},
    post_process_prompts: [],
    post_process_selected_prompt_id: null,
    mute_while_recording: false,
    append_trailing_space: true,
    app_language: "en",
    theme: "dark",
    experimental_enabled: false,
    lazy_stream_close: false,
    airpods_mode: false,
    keyboard_implementation: "tauri",
    show_tray_icon: true,
    paste_delay_ms: 60,
    paste_delay_after_ms: 150,
    reliable_paste: false,
    typing_tool: "auto",
    external_script_path: null,
    filler_word_removal_enabled: true,
    custom_filler_words: null,
    chinese_script: "as_transcribed",
    transcribe_accelerator: "auto",
    transcribe_gpu_device: null,
    extra_recording_buffer_ms: 250,
    vad_enabled: true,
    vad_backend: "silero",
    long_form_chunking: true,
    language_detection: "when_needed",
    language_detection_window_secs: 5,
    overlay_style: "live",
  };
}

function buildDefaultHistory(): HistoryEntry[] {
  const nowSec = Math.floor(Date.now() / 1000);
  return [
    {
      id: 101,
      file_name: "wake-sample-101.wav",
      timestamp: nowSec - 180,
      saved: false,
      title: "Wake-word test note",
      transcription_text:
        "Draft Q4 architecture notes for local hands-free voice triggers.",
      post_processed_text: null,
      post_process_prompt: null,
      post_process_requested: false,
      source_name: null,
      language: "en",
      language_source: "selected",
    },
  ];
}

function loadSettingsFromStorage(): AppSettings {
  const defaults = buildDefaultSettings();
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...defaults,
      ...parsed,
      bindings: {
        ...defaults.bindings,
        ...(parsed.bindings ?? {}),
      },
      wake_words: Array.isArray(parsed.wake_words)
        ? parsed.wake_words
        : defaults.wake_words,
    };
  } catch {
    return defaults;
  }
}

function saveSettingsToStorage(settings: AppSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota errors in private contexts
  }
}

function loadHistoryFromStorage(): HistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return buildDefaultHistory();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : buildDefaultHistory();
  } catch {
    return buildDefaultHistory();
  }
}

function saveHistoryToStorage(entries: HistoryEntry[]): void {
  try {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Ignore storage errors
  }
}

const callbacks = new Map<number, { fn: (data: unknown) => void; once: boolean }>();
const listeners: EventCallbackEntry[] = [];
let nextCallbackId = 1;
let nextEventId = 1;

function dispatchEvent(eventName: string, payload: unknown): void {
  for (const entry of [...listeners]) {
    if (entry.event !== eventName) continue;
    const cb = callbacks.get(entry.handlerId);
    if (!cb) continue;
    cb.fn({
      event: eventName,
      id: entry.id,
      payload,
    });
    if (cb.once) {
      callbacks.delete(entry.handlerId);
    }
  }
}

let webSettings: AppSettings = buildDefaultSettings();
let webHistory: HistoryEntry[] = [];
let webModels: ModelInfo[] = DEFAULT_WEB_MODELS.map((m) => ({ ...m }));
const webNotices: Notice[] = [];
let webRecording = false;
let webCaptureTimer: number | null = null;
let webCaptureLevelsTimer: number | null = null;

function stopActiveWebCapture(cancelled: boolean): void {
  if (webCaptureTimer !== null) {
    window.clearTimeout(webCaptureTimer);
    webCaptureTimer = null;
  }
  if (webCaptureLevelsTimer !== null) {
    window.clearInterval(webCaptureLevelsTimer);
    webCaptureLevelsTimer = null;
  }
  if (webRecording) {
    webRecording = false;
    dispatchEvent("recording-state-event", {
      phase: (cancelled ? "cancelled" : "stopped") as RecordingPhase,
    });
    dispatchEvent("hide-overlay", null);
  }
}

export function triggerWebSimulatedDictation(options?: {
  wakeWord?: string | null;
  trailingText?: string;
}): void {
  if (webRecording) return;

  const phrase =
    options?.trailingText?.trim() ||
    "Schedule the architecture review for tomorrow morning at 10 AM.";
  const words = phrase.split(/\s+/);

  webRecording = true;
  dispatchEvent("recording-state-event", { phase: "started" as RecordingPhase });
  dispatchEvent("show-overlay", webSettings.overlay_style === "minimal" ? "recording" : "streaming");
  dispatchEvent("recording-ready", null);

  let step = 0;
  webCaptureLevelsTimer = window.setInterval(() => {
    step += 1;
    const levels = Array.from({ length: 16 }, (_, idx) => {
      const wave = Math.abs(Math.sin(step * 0.65 + idx * 0.55));
      return Math.min(1, 0.18 + wave * 0.72);
    });
    dispatchEvent("mic-level", levels);

    if (webSettings.overlay_style !== "minimal") {
      const visibleCount = Math.min(words.length, Math.max(1, Math.ceil((step / 14) * words.length)));
      const committed = words.slice(0, Math.max(0, visibleCount - 1)).join(" ");
      const tentative = words[visibleCount - 1] ?? "";
      dispatchEvent("stream-text-event", { committed, tentative });
    }
  }, 85);

  webCaptureTimer = window.setTimeout(() => {
    if (webCaptureLevelsTimer !== null) {
      window.clearInterval(webCaptureLevelsTimer);
      webCaptureLevelsTimer = null;
    }
    dispatchEvent("stream-phase-event", {
      phase: "working",
      kind: "transcribing",
    });

    webCaptureTimer = window.setTimeout(() => {
      webRecording = false;
      const latestEntry = webHistory[0];
      if (webSettings.voice_edit_enabled !== false && latestEntry) {
        const editOutcome = applyVoiceEdit(
          latestEntry.transcription_text,
          phrase,
        );
        if (editOutcome.matched) {
          const updatedEntry: HistoryEntry = {
            ...latestEntry,
            title: `Voice edit (${editOutcome.command.kind}): "${phrase}"`,
            transcription_text: editOutcome.updatedText,
          };
          webHistory = [updatedEntry, ...webHistory.slice(1)];
          saveHistoryToStorage(webHistory);
          dispatchEvent("history-update-payload", {
            action: "updated",
            entry: updatedEntry,
          });
          dispatchEvent("transcription-complete-event", {
            outcome: "typed",
            audio_seconds: 1.2,
            wait_seconds: 0.18,
          });
          dispatchEvent("recording-state-event", {
            phase: "stopped" as RecordingPhase,
          });
          dispatchEvent("hide-overlay", null);
          return;
        }
      }

      const newEntry: HistoryEntry = {
        id: Date.now(),
        file_name: `wake-${Date.now()}.wav`,
        timestamp: Math.floor(Date.now() / 1000),
        saved: false,
        title: options?.wakeWord
          ? `Wake word: "${options.wakeWord}"`
          : "Hands-free dictation",
        transcription_text: phrase,
        post_processed_text: null,
        post_process_prompt: null,
        post_process_requested: false,
        source_name: options?.wakeWord ? `Wake: ${options.wakeWord}` : null,
        language: "en",
        language_source: "selected",
      };
      webHistory = [newEntry, ...webHistory];
      saveHistoryToStorage(webHistory);
      dispatchEvent("history-update-payload", {
        action: "added",
        entry: newEntry,
      });
      dispatchEvent("transcription-complete-event", {
        outcome: "typed",
        audio_seconds: 1.4,
        wait_seconds: 0.25,
      });
      dispatchEvent("recording-state-event", {
        phase: "stopped" as RecordingPhase,
      });
      dispatchEvent("hide-overlay", null);
    }, 380);
  }, 1250);
}

async function handleWebInvoke(
  cmd: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  switch (cmd) {
    case "plugin:event|listen": {
      const event = String(args.event ?? "");
      const handlerId = Number(args.handler ?? 0);
      const id = nextEventId++;
      listeners.push({ id, event, handlerId });
      return id;
    }
    case "plugin:event|unlisten": {
      const eventId = Number(args.eventId ?? 0);
      const idx = listeners.findIndex((entry) => entry.id === eventId);
      if (idx >= 0) {
        const [removed] = listeners.splice(idx, 1);
        callbacks.delete(removed.handlerId);
      }
      return null;
    }
    case "plugin:event|emit":
    case "plugin:event|emit_to": {
      dispatchEvent(String(args.event ?? ""), args.payload);
      return null;
    }
    case "plugin:app|version":
      return "0.10.0";
    case "plugin:os|locale":
      return navigator.language || "en-US";
    case "plugin:updater|check":
      return null;
    case "plugin:opener|open_url": {
      return null;
    }
    case "get_app_settings":
      return webSettings;
    case "get_default_settings":
      return buildDefaultSettings();
    case "complete_onboarding":
      webSettings = { ...webSettings, onboarding_completed: true };
      saveSettingsToStorage(webSettings);
      return null;
    case "is_portable":
      return false;
    case "is_update_checks_locked":
      return true;
    case "get_app_dir_path":
      return "/home/handy-plus/data";
    case "get_log_dir_path":
      return "/home/handy-plus/logs";
    case "check_custom_sounds":
      return { start: false, stop: false };
    case "get_available_microphones":
      return [
        { index: "default", name: "System Default Microphone", is_default: true },
        { index: "web-mic-1", name: "Studio USB Microphone", is_default: false },
      ];
    case "get_available_output_devices":
      return [{ index: "default", name: "System Default Output", is_default: true }];
    case "get_selected_microphone":
      return webSettings.selected_microphone ?? "Default";
    case "get_clamshell_microphone":
      return webSettings.clamshell_microphone ?? "Default";
    case "get_selected_output_device":
      return webSettings.selected_output_device ?? "Default";
    case "get_microphone_mode":
      return webSettings.always_on_microphone ?? false;
    case "get_microphone_channels":
      return 1;
    case "get_available_models":
      return webModels;
    case "get_model_info":
      return webModels.find((m) => m.id === args.modelId) ?? null;
    case "get_current_model":
      return webSettings.selected_model ?? "";
    case "get_transcription_model_status":
      return webSettings.selected_model || null;
    case "is_model_loading":
      return false;
    case "get_model_load_status":
      return {
        is_loaded: Boolean(webSettings.selected_model),
        current_model: webSettings.selected_model || null,
      };
    case "get_retired_models":
      return [];
    case "is_language_detector_downloaded":
      return true;
    case "get_language_status":
      return { kind: "auto" };
    case "get_history_entries": {
      const limit = Number(args.limit ?? 30);
      const cursor = args.cursor as number | null | undefined;
      const filtered =
        typeof cursor === "number"
          ? webHistory.filter((entry) => entry.id < cursor)
          : webHistory;
      return {
        entries: filtered.slice(0, limit),
        has_more: filtered.length > limit,
      };
    }
    case "toggle_history_entry_saved": {
      const id = Number(args.id);
      webHistory = webHistory.map((entry) =>
        entry.id === id ? { ...entry, saved: !entry.saved } : entry,
      );
      saveHistoryToStorage(webHistory);
      return null;
    }
    case "delete_history_entry": {
      const id = Number(args.id);
      webHistory = webHistory.filter((entry) => entry.id !== id);
      saveHistoryToStorage(webHistory);
      return null;
    }
    case "get_active_notices":
      return webNotices;
    case "dismiss_notice":
    case "dismiss_overlay_notice":
      return null;
    case "get_available_accelerators":
      return { transcribe: ["auto", "cpu"], gpu_devices: [] };
    case "get_available_typing_tools":
      return ["auto"];
    case "get_keyboard_implementation":
      return webSettings.keyboard_implementation ?? "tauri";
    case "get_secure_input_status":
      return {
        enabled: false,
        sustained: false,
        culprit_pid: null,
        culprit_name: null,
        fallback_active: false,
        covered_bindings: [],
        degraded_bindings: [],
        uncovered_bindings: [],
        recorder_blocked: false,
      };
    case "get_windows_microphone_permission_status":
      return {
        supported: false,
        overall_access: "allowed",
        device_access: "allowed",
        app_access: "allowed",
        desktop_app_access: "allowed",
      };
    case "is_laptop":
      return false;
    case "is_recording":
      return webRecording;
    case "cancel_operation":
      stopActiveWebCapture(true);
      return null;
    case "initialize_enigo":
    case "initialize_shortcuts":
    case "show_main_window_command":
    case "suspend_all_bindings":
    case "resume_all_bindings":
    case "play_test_sound":
    case "rescan_local_models":
      return null;
    case "set_active_model": {
      const modelId = String(args.modelId ?? "");
      webSettings = { ...webSettings, selected_model: modelId };
      saveSettingsToStorage(webSettings);
      dispatchEvent("model-state-changed", {
        event_type: "loading_completed",
        model_id: modelId,
      });
      return null;
    }
    case "download_model": {
      const modelId = String(args.modelId ?? "");
      webModels = webModels.map((m) =>
        m.id === modelId ? { ...m, is_downloaded: true, is_downloading: false } : m,
      );
      dispatchEvent("model-download-complete", modelId);
      return null;
    }
    case "delete_model": {
      const modelId = String(args.modelId ?? "");
      webModels = webModels.map((m) =>
        m.id === modelId ? { ...m, is_downloaded: false } : m,
      );
      return null;
    }
    case "change_theme_setting":
      webSettings = { ...webSettings, theme: args.theme as AppSettings["theme"] };
      saveSettingsToStorage(webSettings);
      dispatchEvent("theme-changed", webSettings.theme);
      return null;
    case "change_wake_word_enabled_setting":
      webSettings = { ...webSettings, wake_word_enabled: Boolean(args.enabled) };
      saveSettingsToStorage(webSettings);
      dispatchEvent("settings-changed", {
        setting: "wake_word_enabled",
        value: webSettings.wake_word_enabled,
      });
      return null;
    case "update_wake_words": {
      const words = Array.isArray(args.words)
        ? sanitizeWakeWordList(args.words.map(String))
        : [];
      webSettings = { ...webSettings, wake_words: words };
      saveSettingsToStorage(webSettings);
      dispatchEvent("settings-changed", {
        setting: "wake_words",
        value: words,
      });
      return null;
    }
    case "change_voice_edit_enabled_setting":
      webSettings = {
        ...webSettings,
        voice_edit_enabled: Boolean(args.enabled),
      };
      saveSettingsToStorage(webSettings);
      dispatchEvent("settings-changed", {
        setting: "voice_edit_enabled",
        value: webSettings.voice_edit_enabled,
      });
      return null;
    case "change_extra_recording_buffer_setting":
      webSettings = {
        ...webSettings,
        extra_recording_buffer_ms: Number(args.ms ?? 250),
      };
      saveSettingsToStorage(webSettings);
      return null;
    case "change_paste_delay_after_ms_setting":
      webSettings = {
        ...webSettings,
        paste_delay_after_ms: Number(args.ms ?? 150),
      };
      saveSettingsToStorage(webSettings);
      return null;
    case "change_shortcut_activation_setting":
      webSettings = {
        ...webSettings,
        shortcut_activation: args.activation as AppSettings["shortcut_activation"],
      };
      saveSettingsToStorage(webSettings);
      return null;
    case "change_audio_feedback_setting":
      webSettings = { ...webSettings, audio_feedback: Boolean(args.enabled) };
      saveSettingsToStorage(webSettings);
      return null;
    case "change_audio_feedback_volume_setting":
      webSettings = { ...webSettings, audio_feedback_volume: Number(args.volume ?? 1) };
      saveSettingsToStorage(webSettings);
      return null;
    case "change_mute_while_recording_setting":
      webSettings = { ...webSettings, mute_while_recording: Boolean(args.enabled) };
      saveSettingsToStorage(webSettings);
      return null;
    case "change_selected_language_setting":
      webSettings = { ...webSettings, selected_language: String(args.language ?? "auto") };
      saveSettingsToStorage(webSettings);
      return null;
    case "change_spoken_languages_setting":
      webSettings = {
        ...webSettings,
        spoken_languages: Array.isArray(args.languages) ? args.languages.map(String) : [],
      };
      saveSettingsToStorage(webSettings);
      return null;
    case "change_app_language_setting":
      webSettings = { ...webSettings, app_language: String(args.language ?? "en") };
      saveSettingsToStorage(webSettings);
      return null;
    case "update_custom_words":
      webSettings = {
        ...webSettings,
        custom_words: Array.isArray(args.words) ? args.words.map(String) : [],
      };
      saveSettingsToStorage(webSettings);
      return null;
    case "change_experimental_enabled_setting":
      webSettings = { ...webSettings, experimental_enabled: Boolean(args.enabled) };
      saveSettingsToStorage(webSettings);
      return null;
    case "change_post_process_enabled_setting":
      webSettings = { ...webSettings, post_process_enabled: Boolean(args.enabled) };
      saveSettingsToStorage(webSettings);
      return null;
    case "change_debug_mode_setting":
      webSettings = { ...webSettings, debug_mode: Boolean(args.enabled) };
      saveSettingsToStorage(webSettings);
      return null;
    case "change_overlay_style_setting":
      webSettings = {
        ...webSettings,
        overlay_style: String(args.style ?? "live") as AppSettings["overlay_style"],
      };
      saveSettingsToStorage(webSettings);
      return null;
    case "change_overlay_position_setting":
      webSettings = {
        ...webSettings,
        overlay_position: String(args.position ?? "bottom") as AppSettings["overlay_position"],
      };
      saveSettingsToStorage(webSettings);
      return null;
    case "change_binding": {
      const id = String(args.id ?? "");
      const bindingStr = String(args.binding ?? "");
      const existing = webSettings.bindings?.[id];
      const updated = existing
        ? { ...existing, current_binding: bindingStr }
        : {
            id,
            name: id,
            description: id,
            default_binding: bindingStr,
            current_binding: bindingStr,
          };
      webSettings = {
        ...webSettings,
        bindings: {
          ...webSettings.bindings,
          [id]: updated,
        },
      };
      saveSettingsToStorage(webSettings);
      return { success: true, binding: updated, error: null };
    }
    case "reset_binding": {
      const id = String(args.id ?? "");
      const existing = webSettings.bindings?.[id];
      if (existing) {
        const reset = { ...existing, current_binding: existing.default_binding };
        webSettings = {
          ...webSettings,
          bindings: { ...webSettings.bindings, [id]: reset },
        };
        saveSettingsToStorage(webSettings);
        return { success: true, binding: reset, error: null };
      }
      return { success: true, binding: null, error: null };
    }
    default:
      return null;
  }
}

export function installTauriWebFallback(): void {
  if (typeof window === "undefined") return;
  const w = window as TauriInternalsWindow;
  if ("__TAURI_INTERNALS__" in w && w.__TAURI_INTERNALS__) return;

  webSettings = loadSettingsFromStorage();
  webHistory = loadHistoryFromStorage();

  // Optional query overrides for verification (?onboarding=1 or ?autostart=1)
  const params = new URLSearchParams(window.location.search);
  if (params.get("onboarding") === "1") {
    webSettings = { ...webSettings, onboarding_completed: false };
  } else if (params.get("autostart") === "1") {
    webSettings = {
      ...webSettings,
      onboarding_completed: true,
      show_whats_new_on_update: false,
    };
  }

  w.__HANDY_WEB_PREVIEW__ = true;

  w.__TAURI_OS_PLUGIN_INTERNALS__ = {
    eol: "\n",
    platform: "linux",
    version: "6.8.0",
    family: "unix",
    os_type: "linux",
    arch: "x86_64",
    exe_extension: "",
  };

  w.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: (_event: string, eventId: number) => {
      const idx = listeners.findIndex((entry) => entry.id === eventId);
      if (idx >= 0) {
        const [removed] = listeners.splice(idx, 1);
        callbacks.delete(removed.handlerId);
      }
    },
  };

  w.__TAURI_INTERNALS__ = {
    transformCallback: (cb: (data: unknown) => void, once = false) => {
      const id = nextCallbackId++;
      callbacks.set(id, { fn: cb, once });
      return id;
    },
    unregisterCallback: (id: number) => {
      callbacks.delete(id);
    },
    invoke: (cmd: string, args?: Record<string, unknown>) =>
      handleWebInvoke(cmd, args),
    convertFileSrc: (filePath: string) => filePath,
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { windowLabel: "main", label: "main" },
    },
  };
}

// Install synchronously at module evaluation time so static ES imports of
// @tauri-apps/* plugins resolve their globals immediately.
installTauriWebFallback();
