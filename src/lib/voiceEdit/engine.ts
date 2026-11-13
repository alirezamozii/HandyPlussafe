export type VoiceEditActionKind =
  | "undo"
  | "remove_target"
  | "replace_target"
  | "replace_range"
  | "delete_range"
  | "append"
  | "none";

export interface VoiceEditCommand {
  kind: VoiceEditActionKind;
  target?: string;
  rangeEnd?: string;
  replacement?: string;
  rawUtterance: string;
  summary: string;
}

export interface VoiceEditResult {
  matched: boolean;
  command: VoiceEditCommand;
  previousText: string;
  updatedText: string;
  changedSpan?: {
    removed: string;
    inserted: string;
  };
}

const DEFAULT_EDIT_PREFIXES = [
  "jarvis",
  "hey jarvis",
  "handy",
  "hey handy",
  "handy plus",
  "voice edit",
  "edit",
];

function stripOuterPunctuation(input: string): string {
  return input
    .trim()
    .replace(/^[.,!?;:"'“”‘’\-–—\s]+|[.,!?;:"'“”‘’\-–—\s]+$/g, "")
    .trim();
}

function stripLeadingPrefix(
  utterance: string,
  customPrefixes: string[] = DEFAULT_EDIT_PREFIXES,
): string {
  const trimmed = utterance.trim();
  const lower = trimmed.toLowerCase();
  const allPrefixes = [
    ...new Set(
      [...customPrefixes, ...DEFAULT_EDIT_PREFIXES]
        .map((p) => p.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].sort((a, b) => b.length - a.length);

  for (const prefix of allPrefixes) {
    if (lower.startsWith(prefix)) {
      const rest = trimmed.slice(prefix.length);
      if (/^[\s,.:;!\-–—]+/.test(rest)) {
        return rest.replace(/^[\s,.:;!\-–—]+/, "").trim();
      }
    }
  }
  return trimmed;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSpacingAndPunctuation(text: string): string {
  let out = text
    // Collapse multiple spaces
    .replace(/[ \t]{2,}/g, " ")
    // Remove space before common punctuation
    .replace(/\s+([,.;:!?])/g, "$1")
    // Collapse duplicate punctuation caused by removing a middle phrase
    .replace(/([,;:])\s*([,.;:!?])/g, "$2")
    .trim();

  // Capitalize first letter if sentence starts with lowercase after a deletion at index 0
  if (out.length > 0 && /^[a-z]/.test(out)) {
    out = out[0].toUpperCase() + out.slice(1);
  }
  return out;
}

function matchCaseIfCapitalized(original: string, replacement: string): string {
  if (!original || !replacement) return replacement;
  const firstOrig = original[0];
  const firstRepl = replacement[0];
  if (
    firstOrig >= "A" &&
    firstOrig <= "Z" &&
    firstRepl >= "a" &&
    firstRepl <= "z"
  ) {
    return firstRepl.toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

/**
 * Finds the last word-boundary-aware (or fallback substring) match of `needle` in `haystack`.
 */
function findLastMatchSpan(
  haystack: string,
  needle: string,
): { start: number; end: number } | null {
  const cleanNeedle = stripOuterPunctuation(needle);
  if (!cleanNeedle) return null;

  // Try word-boundary regex first (allowing flexible whitespace between words)
  const words = cleanNeedle.split(/\s+/).map(escapeRegExp);
  const pattern = `(?:^|\\b)(${words.join("\\s+")})(?:\\b|$)`;
  const regex = new RegExp(pattern, "gi");

  let lastMatch: { start: number; end: number } | null = null;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(haystack)) !== null) {
    const matchedText = m[1];
    const start = m.index + m[0].indexOf(matchedText);
    lastMatch = { start, end: start + matchedText.length };
  }
  if (lastMatch) return lastMatch;

  // Fallback substring search only when punctuation/symbols don't match regex \b
  const lowerHay = haystack.toLowerCase();
  const lowerNeedle = cleanNeedle.toLowerCase();
  let fromIndex = lowerHay.length;
  while (fromIndex >= 0) {
    const idx = lowerHay.lastIndexOf(lowerNeedle, fromIndex);
    if (idx === -1) break;
    const end = idx + lowerNeedle.length;
    if (isWordBoundaryMatch(haystack, idx, end, cleanNeedle)) {
      return { start: idx, end };
    }
    if (idx === 0) break;
    fromIndex = idx - 1;
  }
  return null;
}

function isWordBoundaryMatch(
  haystack: string,
  start: number,
  end: number,
  needle: string,
): boolean {
  const startsWordChar = /[a-z0-9]/i.test(needle[0] ?? "");
  const endsWordChar = /[a-z0-9]/i.test(needle[needle.length - 1] ?? "");
  const leftOk =
    !startsWordChar || start === 0 || !/[a-z0-9]/i.test(haystack[start - 1]);
  const rightOk =
    !endsWordChar || end >= haystack.length || !/[a-z0-9]/i.test(haystack[end]);
  return leftOk && rightOk;
}

/**
 * Finds an inclusive range `[startWord ... endWord]` in `haystack`.
 * Searches for `startWord` and a subsequent `endWord` with word boundaries.
 */
function findRangeSpan(
  haystack: string,
  startPhrase: string,
  endPhrase: string,
): { start: number; end: number } | null {
  const cleanStart = stripOuterPunctuation(startPhrase);
  const cleanEnd = stripOuterPunctuation(endPhrase);
  if (!cleanStart || !cleanEnd) return null;

  const lowerHay = haystack.toLowerCase();
  const lowerStart = cleanStart.toLowerCase();
  const lowerEnd = cleanEnd.toLowerCase();

  // Prefer the most recent word-boundary-valid range that has both start and end in order
  let bestSpan: { start: number; end: number } | null = null;
  let searchPos = 0;

  while (searchPos < lowerHay.length) {
    const sIdx = lowerHay.indexOf(lowerStart, searchPos);
    if (sIdx === -1) break;

    const afterStart = sIdx + lowerStart.length;
    if (isWordBoundaryMatch(haystack, sIdx, afterStart, cleanStart)) {
      let endSearch = afterStart;
      while (endSearch < lowerHay.length) {
        const eIdx = lowerHay.indexOf(lowerEnd, endSearch);
        if (eIdx === -1) break;
        const endPos = eIdx + lowerEnd.length;
        if (isWordBoundaryMatch(haystack, eIdx, endPos, cleanEnd)) {
          bestSpan = { start: sIdx, end: endPos };
          break;
        }
        endSearch = eIdx + 1;
      }
    }
    searchPos = sIdx + 1;
  }

  return bestSpan;
}

/**
 * Parses a natural spoken utterance into a structured `VoiceEditCommand`.
 */
export function parseVoiceEditCommand(
  utterance: string,
  customPrefixes: string[] = DEFAULT_EDIT_PREFIXES,
): VoiceEditCommand {
  const rawUtterance = utterance.trim();
  const body = stripOuterPunctuation(
    stripLeadingPrefix(rawUtterance, customPrefixes),
  );
  const lower = body.toLowerCase();

  if (!body) {
    return {
      kind: "none",
      rawUtterance,
      summary: "No command detected",
    };
  }

  // 1. Undo / Scratch That / Clear All
  if (
    /^(?:undo(?:\s+that|\s+last)?|scratch\s+that|remove\s+all|delete\s+all|clear\s+(?:all|that|everything)|erase\s+(?:all|that))$/i.test(
      lower,
    )
  ) {
    return {
      kind: "undo",
      rawUtterance,
      summary: "Undo / Clear last dictation",
    };
  }

  // 2. Range Replacement: "replace from <start> to <end> with <replacement>"
  const rangeReplaceMatch = body.match(
    /^(?:replace|change|swap)\s+from\s+(.+?)\s+(?:to|through|until|till)\s+(.+?)\s+(?:with|to|by)\s+(.+)$/i,
  );
  if (rangeReplaceMatch) {
    const target = stripOuterPunctuation(rangeReplaceMatch[1]);
    const rangeEnd = stripOuterPunctuation(rangeReplaceMatch[2]);
    const replacement = stripOuterPunctuation(rangeReplaceMatch[3]);
    if (target && rangeEnd) {
      return {
        kind: "replace_range",
        target,
        rangeEnd,
        replacement,
        rawUtterance,
        summary: `Replace from "${target}" to "${rangeEnd}" with "${replacement}"`,
      };
    }
  }

  // 3. Range Deletion: "delete/remove from <start> to <end>"
  const rangeDeleteMatch = body.match(
    /^(?:delete|remove|erase|cut)\s+from\s+(.+?)\s+(?:to|through|until|till)\s+(.+)$/i,
  );
  if (rangeDeleteMatch) {
    const target = stripOuterPunctuation(rangeDeleteMatch[1]);
    const rangeEnd = stripOuterPunctuation(rangeDeleteMatch[2]);
    if (target && rangeEnd) {
      return {
        kind: "delete_range",
        target,
        rangeEnd,
        rawUtterance,
        summary: `Delete from "${target}" to "${rangeEnd}"`,
      };
    }
  }

  // 4. Targeted Word/Phrase Replacement:
  // "replace <target> with/to <replacement>" or "change <target> to/with <replacement>"
  const replaceMatch = body.match(
    /^(?:replace|change|swap|substitute)\s+(?:the\s+(?:word|phrase)\s+)?(.+?)\s+(?:with|to|by|for)\s+(.+)$/i,
  );
  if (replaceMatch) {
    const target = stripOuterPunctuation(replaceMatch[1]);
    const replacement = stripOuterPunctuation(replaceMatch[2]);
    if (target) {
      return {
        kind: "replace_target",
        target,
        replacement,
        rawUtterance,
        summary: `Replace "${target}" with "${replacement}"`,
      };
    }
  }

  // 5. Targeted Word/Phrase Deletion:
  // "remove <target>" or "delete <target>" or "erase <target>"
  const removeMatch = body.match(
    /^(?:remove|delete|erase|drop)\s+(?:the\s+(?:word|phrase)\s+)?(.+)$/i,
  );
  if (removeMatch) {
    const target = stripOuterPunctuation(removeMatch[1]);
    if (target) {
      return {
        kind: "remove_target",
        target,
        rawUtterance,
        summary: `Remove "${target}"`,
      };
    }
  }

  return {
    kind: "none",
    rawUtterance,
    summary: "Standard dictation",
  };
}

/**
 * Applies a spoken utterance or parsed voice edit command to `currentText`.
 * If `previousSnapshot` is provided and the command is `undo`, restores `previousSnapshot`.
 */
export function applyVoiceEdit(
  currentText: string,
  utterance: string,
  options?: {
    customPrefixes?: string[];
    previousSnapshot?: string;
  },
): VoiceEditResult {
  const command = parseVoiceEditCommand(utterance, options?.customPrefixes);
  const previousText = currentText;

  if (command.kind === "none") {
    return {
      matched: false,
      command,
      previousText,
      updatedText: currentText,
    };
  }

  if (command.kind === "undo") {
    const restored = options?.previousSnapshot ?? "";
    return {
      matched: true,
      command,
      previousText,
      updatedText: restored,
      changedSpan: {
        removed: currentText,
        inserted: restored,
      },
    };
  }

  if (command.kind === "replace_range" && command.target && command.rangeEnd) {
    const span = findRangeSpan(currentText, command.target, command.rangeEnd);
    if (!span) {
      return {
        matched: false,
        command,
        previousText,
        updatedText: currentText,
      };
    }
    const removed = currentText.slice(span.start, span.end);
    const replacement = matchCaseIfCapitalized(
      removed,
      command.replacement ?? "",
    );
    const rawUpdated =
      currentText.slice(0, span.start) +
      replacement +
      currentText.slice(span.end);
    return {
      matched: true,
      command,
      previousText,
      updatedText: normalizeSpacingAndPunctuation(rawUpdated),
      changedSpan: {
        removed,
        inserted: replacement,
      },
    };
  }

  if (command.kind === "delete_range" && command.target && command.rangeEnd) {
    const span = findRangeSpan(currentText, command.target, command.rangeEnd);
    if (!span) {
      return {
        matched: false,
        command,
        previousText,
        updatedText: currentText,
      };
    }
    const removed = currentText.slice(span.start, span.end);
    const rawUpdated =
      currentText.slice(0, span.start) + " " + currentText.slice(span.end);
    return {
      matched: true,
      command,
      previousText,
      updatedText: normalizeSpacingAndPunctuation(rawUpdated),
      changedSpan: {
        removed,
        inserted: "",
      },
    };
  }

  if (command.kind === "replace_target" && command.target) {
    const span = findLastMatchSpan(currentText, command.target);
    if (!span) {
      return {
        matched: false,
        command,
        previousText,
        updatedText: currentText,
      };
    }
    const removed = currentText.slice(span.start, span.end);
    const replacement = matchCaseIfCapitalized(
      removed,
      command.replacement ?? "",
    );
    const rawUpdated =
      currentText.slice(0, span.start) +
      replacement +
      currentText.slice(span.end);
    return {
      matched: true,
      command,
      previousText,
      updatedText: normalizeSpacingAndPunctuation(rawUpdated),
      changedSpan: {
        removed,
        inserted: replacement,
      },
    };
  }

  if (command.kind === "remove_target" && command.target) {
    const span = findLastMatchSpan(currentText, command.target);
    if (!span) {
      return {
        matched: false,
        command,
        previousText,
        updatedText: currentText,
      };
    }
    const removed = currentText.slice(span.start, span.end);
    const rawUpdated =
      currentText.slice(0, span.start) + " " + currentText.slice(span.end);
    return {
      matched: true,
      command,
      previousText,
      updatedText: normalizeSpacingAndPunctuation(rawUpdated),
      changedSpan: {
        removed,
        inserted: "",
      },
    };
  }

  return {
    matched: false,
    command,
    previousText,
    updatedText: currentText,
  };
}
