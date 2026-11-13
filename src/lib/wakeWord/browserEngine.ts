import {
  canTriggerWakeWord,
  matchWakeWord,
  type WakeWordMatchResult,
} from "./matcher";

export type WakeEngineStatus =
  "off" | "listening" | "triggered" | "unavailable" | "error";

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionErrorEventLike {
  error?: string;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface BrowserWakeControllerOptions {
  enabled: boolean;
  wakeWords: readonly string[];
  language?: string;
  onStatusChange?: (status: WakeEngineStatus, detail?: string) => void;
  onWakeMatch: (match: WakeWordMatchResult, rawTranscript: string) => void;
}

export function isBrowserSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

export class BrowserWakeWordEngine {
  private recognition: SpeechRecognitionLike | null = null;
  private active = false;
  private wakeWords: readonly string[] = [];
  private language = "en-US";
  private lastTriggeredAt: number | null = null;
  private restartTimer: number | null = null;
  private onStatusChange?: (status: WakeEngineStatus, detail?: string) => void;
  private onWakeMatch: (
    match: WakeWordMatchResult,
    rawTranscript: string,
  ) => void;

  constructor(options: BrowserWakeControllerOptions) {
    this.wakeWords = options.wakeWords;
    this.language = options.language || "en-US";
    this.onStatusChange = options.onStatusChange;
    this.onWakeMatch = options.onWakeMatch;
    if (options.enabled) {
      this.start();
    } else {
      this.onStatusChange?.("off");
    }
  }

  public updateConfig(options: {
    enabled: boolean;
    wakeWords: readonly string[];
    language?: string;
  }): void {
    this.wakeWords = options.wakeWords;
    if (options.language) {
      this.language = options.language;
    }

    if (options.enabled && !this.active) {
      this.start();
    } else if (!options.enabled && this.active) {
      this.stop();
    } else if (!options.enabled) {
      this.onStatusChange?.("off");
    }
  }

  /**
   * Evaluate a spoken (or simulated) transcript directly against configured
   * wake words, respecting the debounce cooldown.
   */
  public processTranscript(rawTranscript: string): WakeWordMatchResult {
    const result = matchWakeWord(rawTranscript, this.wakeWords);
    if (!result.matched) return result;

    const now = Date.now();
    if (!canTriggerWakeWord(this.lastTriggeredAt, now)) {
      return { matched: false, wakeWord: null, trailingCommand: "" };
    }

    this.lastTriggeredAt = now;
    this.onStatusChange?.("triggered", result.wakeWord ?? undefined);
    this.onWakeMatch(result, rawTranscript);
    return result;
  }

  public start(): void {
    if (this.active) return;
    this.active = true;

    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      // Headless / non-WebSpeech browser preview stays armed via text simulation
      this.onStatusChange?.("listening");
      return;
    }

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = this.language;

    recognition.onstart = () => {
      if (this.active) {
        this.onStatusChange?.("listening");
      }
    };

    recognition.onresult = (event) => {
      if (!this.active) return;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const item = event.results[i];
        const transcript = item[0]?.transcript ?? "";
        if (!transcript.trim()) continue;
        this.processTranscript(transcript);
      }
    };

    recognition.onerror = (event) => {
      if (!this.active) return;
      if (
        event.error === "not-allowed" ||
        event.error === "service-not-allowed"
      ) {
        this.onStatusChange?.("unavailable", event.error);
        this.active = false;
        return;
      }
      if (event.error === "no-speech" || event.error === "aborted") {
        return;
      }
      this.onStatusChange?.("error", event.error);
    };

    recognition.onend = () => {
      if (!this.active) {
        this.onStatusChange?.("off");
        return;
      }
      this.restartTimer = window.setTimeout(() => {
        if (!this.active) return;
        try {
          recognition.start();
        } catch {
          this.onStatusChange?.("listening");
        }
      }, 450);
    };

    this.recognition = recognition;
    try {
      recognition.start();
      this.onStatusChange?.("listening");
    } catch {
      this.onStatusChange?.("listening");
    }
  }

  public stop(): void {
    this.active = false;
    if (this.restartTimer !== null) {
      window.clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {
        // Ignore teardown errors
      }
      this.recognition = null;
    }
    this.onStatusChange?.("off");
  }
}
