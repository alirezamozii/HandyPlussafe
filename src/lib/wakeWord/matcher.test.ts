import assert from "node:assert/strict";
import test from "node:test";
import {
  canTriggerWakeWord,
  matchWakeWord,
  normalizeWakePhrase,
  sanitizeWakeWordInput,
  sanitizeWakeWordList,
} from "./matcher";

test("normalizeWakePhrase lowercases and strips punctuation", () => {
  assert.equal(normalizeWakePhrase("  Hey, Handy!!  "), "hey handy");
  assert.equal(normalizeWakePhrase("Handy-Start..."), "handy start");
});

test("sanitizeWakeWordList deduplicates case-insensitively and removes invalid items", () => {
  const result = sanitizeWakeWordList([
    " hey handy ",
    "Hey Handy",
    "",
    "   ",
    "<computer>",
    "x".repeat(80),
  ]);
  assert.deepEqual(result, ["hey handy", "computer"]);
  assert.equal(sanitizeWakeWordInput("  Hey   Handy  "), "Hey Handy");
});

test("matchWakeWord matches whole words/phrases regardless of punctuation or casing", () => {
  const res = matchWakeWord("Umm, Hey Handy! Take a quick note.", [
    "hey handy",
    "computer",
  ]);
  assert.equal(res.matched, true);
  assert.equal(res.wakeWord, "hey handy");
  assert.equal(res.trailingCommand, "Take a quick note");
});

test("matchWakeWord prefers longer phrase when starting at the same position", () => {
  const res = matchWakeWord("Handy start meeting summary", [
    "handy",
    "handy start",
  ]);
  assert.equal(res.matched, true);
  assert.equal(res.wakeWord, "handy start");
  assert.equal(res.trailingCommand, "meeting summary");
});

test("matchWakeWord ignores substrings inside unrelated words", () => {
  const res = matchWakeWord("Please concatenate the files now", ["cat"]);
  assert.equal(res.matched, false);
  assert.equal(res.wakeWord, null);
  assert.equal(res.trailingCommand, "");
});

test("matchWakeWord returns empty trailingCommand when only wake word is spoken", () => {
  const res = matchWakeWord("Computer.", ["computer"]);
  assert.equal(res.matched, true);
  assert.equal(res.wakeWord, "computer");
  assert.equal(res.trailingCommand, "");
});

test("canTriggerWakeWord enforces cooldown window", () => {
  assert.equal(canTriggerWakeWord(null, 1000), true);
  assert.equal(canTriggerWakeWord(1000, 1500, 1800), false);
  assert.equal(canTriggerWakeWord(1000, 2800, 1800), true);
});
