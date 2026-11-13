export const DEFAULT_WAKE_WORDS = ["hey handy", "handy start"] as const;

export const MAX_WAKE_WORD_LENGTH = 60;
export const MAX_WAKE_WORDS = 25;
export const DEFAULT_WAKE_COOLDOWN_MS = 1800;

export interface WakeWordMatchResult {
  matched: boolean;
  wakeWord: string | null;
  trailingCommand: string;
}

const EDGE_PUNCTUATION_RE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const SEPARATOR_PUNCTUATION_RE = /[^\p{L}\p{N}\s]+/gu;

/**
 * Strip unsafe wrapper characters and normalize internal spacing for user-entered
 * wake-word chips while preserving intended casing for display.
 */
export function sanitizeWakeWordInput(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[<>"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize speech text or a wake phrase into space-separated lowercase tokens
 * suitable for boundary-aware phrase matching across punctuation and casing.
 */
export function normalizeWakePhrase(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(SEPARATOR_PUNCTUATION_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Deduplicate (case-insensitively) and bound a list of configured wake words.
 */
export function sanitizeWakeWordList(words: readonly string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];

  for (const raw of words) {
    const display = sanitizeWakeWordInput(raw);
    const normalized = normalizeWakePhrase(display);
    if (!display || !normalized || display.length > MAX_WAKE_WORD_LENGTH) {
      continue;
    }
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    cleaned.push(display);
    if (cleaned.length >= MAX_WAKE_WORDS) {
      break;
    }
  }

  return cleaned;
}

interface TokenSpan {
  token: string;
  start: number;
  end: number;
}

function tokenizeWithSpans(text: string): TokenSpan[] {
  const spans: TokenSpan[] = [];
  const wordRe = /[\p{L}\p{N}]+/gu;
  let match: RegExpExecArray | null;

  while ((match = wordRe.exec(text)) !== null) {
    spans.push({
      token: match[0].toLowerCase(),
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return spans;
}

/**
 * Match a spoken transcript against configured wake words using whole-token
 * boundaries so substrings inside unrelated words (e.g. "cat" in "concatenate")
 * never trigger.
 */
export function matchWakeWord(
  transcript: string,
  wakeWords: readonly string[],
): WakeWordMatchResult {
  const normalizedTranscript = transcript.normalize("NFKC");
  const transcriptTokens = tokenizeWithSpans(normalizedTranscript);

  if (transcriptTokens.length === 0 || wakeWords.length === 0) {
    return { matched: false, wakeWord: null, trailingCommand: "" };
  }

  const candidates = wakeWords
    .map((phrase) => ({
      phrase: sanitizeWakeWordInput(phrase),
      tokens: normalizeWakePhrase(phrase).split(" ").filter(Boolean),
    }))
    .filter((entry) => entry.phrase.length > 0 && entry.tokens.length > 0);

  let bestMatch: {
    startIdx: number;
    tokenCount: number;
    phrase: string;
    endCharIndex: number;
  } | null = null;

  for (const candidate of candidates) {
    const len = candidate.tokens.length;
    if (len > transcriptTokens.length) continue;

    for (let i = 0; i <= transcriptTokens.length - len; i += 1) {
      let allMatch = true;
      for (let j = 0; j < len; j += 1) {
        if (transcriptTokens[i + j].token !== candidate.tokens[j]) {
          allMatch = false;
          break;
        }
      }
      if (!allMatch) continue;

      const isBetter =
        !bestMatch ||
        i < bestMatch.startIdx ||
        (i === bestMatch.startIdx && len > bestMatch.tokenCount);

      if (isBetter) {
        bestMatch = {
          startIdx: i,
          tokenCount: len,
          phrase: candidate.phrase,
          endCharIndex: transcriptTokens[i + len - 1].end,
        };
      }
      break;
    }
  }

  if (!bestMatch) {
    return { matched: false, wakeWord: null, trailingCommand: "" };
  }

  const rawTail = normalizedTranscript.slice(bestMatch.endCharIndex);
  const trailingCommand = rawTail
    .replace(EDGE_PUNCTUATION_RE, "")
    .replace(/\s+/g, " ")
    .trim();

  return {
    matched: true,
    wakeWord: bestMatch.phrase,
    trailingCommand,
  };
}

export function canTriggerWakeWord(
  lastTriggeredAt: number | null,
  now: number,
  cooldownMs: number = DEFAULT_WAKE_COOLDOWN_MS,
): boolean {
  if (lastTriggeredAt === null) return true;
  return now - lastTriggeredAt >= cooldownMs;
}
