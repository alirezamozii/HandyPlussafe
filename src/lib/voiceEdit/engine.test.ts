import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyVoiceEdit,
  getEditModeTag,
  parseVoiceEditCommand,
} from "./engine";

describe("Voice Edit & Replacement Engine (Jarvis Mode)", () => {
  it("recognizes undo, scratch that, and remove all commands", () => {
    const text = "Send the quarterly report to Sarah by Friday.";
    const r1 = applyVoiceEdit(text, "undo");
    assert.equal(r1.matched, true);
    assert.equal(r1.command.kind, "undo");
    assert.equal(r1.updatedText, "");

    const r2 = applyVoiceEdit(text, "Jarvis, scratch that", {
      previousSnapshot: "Earlier draft.",
    });
    assert.equal(r2.matched, true);
    assert.equal(r2.updatedText, "Earlier draft.");

    const r3 = applyVoiceEdit(text, "remove all");
    assert.equal(r3.matched, true);
    assert.equal(r3.updatedText, "");
  });

  it("recognizes select all, copy, cut, and paste clipboard action commands", () => {
    const text = "Active content inside the editor.";
    const sel = applyVoiceEdit(text, "select all");
    assert.equal(sel.matched, true);
    assert.equal(sel.command.kind, "select_all");

    const copyCmd = applyVoiceEdit(text, "copy that");
    assert.equal(copyCmd.matched, true);
    assert.equal(copyCmd.command.kind, "copy");

    const cutCmd = applyVoiceEdit(text, "cut");
    assert.equal(cutCmd.matched, true);
    assert.equal(cutCmd.command.kind, "cut");
    assert.equal(cutCmd.updatedText, "");

    const pasteCmd = applyVoiceEdit(text, "paste clipboard");
    assert.equal(pasteCmd.matched, true);
    assert.equal(pasteCmd.command.kind, "paste_clipboard");
  });

  it("recognizes agentic multi-action combinations (select all copy, select all delete, etc.)", () => {
    const text = "Full block of text to manipulate.";
    const combo1 = applyVoiceEdit(text, "select all copy");
    assert.equal(combo1.matched, true);
    assert.equal(combo1.command.kind, "select_all_copy");

    const combo2 = applyVoiceEdit(text, "select all and delete");
    assert.equal(combo2.matched, true);
    assert.equal(combo2.command.kind, "select_all_delete");
    assert.equal(combo2.updatedText, "");

    const combo3 = applyVoiceEdit(text, "select all paste");
    assert.equal(combo3.matched, true);
    assert.equal(combo3.command.kind, "select_all_paste");

    const combo4 = applyVoiceEdit(text, "select all and cut");
    assert.equal(combo4.matched, true);
    assert.equal(combo4.command.kind, "select_all_cut");
  });

  it("removes a specific word or phrase while keeping surrounding text clean", () => {
    const text = "We need to deploy the staging server urgently today.";
    const res = applyVoiceEdit(text, "remove urgently");
    assert.equal(res.matched, true);
    assert.equal(res.command.kind, "remove_target");
    assert.equal(
      res.updatedText,
      "We need to deploy the staging server today.",
    );

    const res2 = applyVoiceEdit(
      "Hello world, this is a fast voice test.",
      "delete fast voice",
    );
    assert.equal(res2.matched, true);
    assert.equal(res2.updatedText, "Hello world, this is a test.");
  });

  it("replaces a specific word or phrase with a new word or phrase", () => {
    const text = "Schedule the design review for Tuesday morning.";
    const res = applyVoiceEdit(text, "replace Tuesday with Thursday");
    assert.equal(res.matched, true);
    assert.equal(res.command.kind, "replace_target");
    assert.equal(
      res.updatedText,
      "Schedule the design review for Thursday morning.",
    );

    const resTo = applyVoiceEdit(
      res.updatedText,
      "change Thursday morning to Friday afternoon",
    );
    assert.equal(resTo.matched, true);
    assert.equal(
      resTo.updatedText,
      "Schedule the design review for Friday afternoon.",
    );
  });

  it("handles phonetic 'form' in place of 'from' gracefully", () => {
    const text = "We migrated from the legacy database to our new cluster.";
    const res = applyVoiceEdit(
      text,
      "replace form legacy database to new cluster with PostgreSQL",
    );
    assert.equal(res.matched, true);
    assert.equal(res.updatedText, "We migrated from the PostgreSQL.");

    const base = "Please copy from here to there.";
    const res2 = applyVoiceEdit(
      base,
      "replace form from here to there with everywhere",
    );
    assert.equal(res2.matched, true);
    assert.equal(res2.updatedText, "Please copy everywhere.");
  });

  it("replaces an inclusive range from start word to end word with replacement text", () => {
    const text =
      "The latency on the old cloud transcription pipeline was way too slow for daily coding.";
    const res = applyVoiceEdit(
      text,
      "replace from old cloud to way too slow with local Rust engine is blazing fast",
    );
    assert.equal(res.matched, true);
    assert.equal(res.command.kind, "replace_range");
    assert.equal(
      res.updatedText,
      "The latency on the local Rust engine is blazing fast for daily coding.",
    );
  });

  it("deletes an inclusive range from start word to end word", () => {
    const text =
      "Please merge the pull request after all automated checks pass on GitHub.";
    const res = applyVoiceEdit(text, "delete from after all to checks pass");
    assert.equal(res.matched, true);
    assert.equal(res.command.kind, "delete_range");
    assert.equal(res.updatedText, "Please merge the pull request on GitHub.");
  });

  it("does not alter regular dictation sentences that contain command words in context", () => {
    const text = "Initial paragraph.";
    const regularSentences = [
      "Let's discuss how we can improve our product onboarding flow.",
      "I need to copy this report before 5 PM today.",
      "Please paste the shipping label onto the box.",
      "You should select all relevant checkboxes in that form.",
    ];

    for (const sentence of regularSentences) {
      const parsed = parseVoiceEditCommand(sentence);
      assert.equal(parsed.kind, "none");
      const res = applyVoiceEdit(text, sentence);
      assert.equal(res.matched, false);
      assert.equal(res.updatedText, text);
      assert.equal(getEditModeTag(sentence), null);
    }
  });

  it("computes accurate glowing UI mode tags via getEditModeTag", () => {
    assert.deepEqual(getEditModeTag("select all"), {
      isEditMode: true,
      tag: "SELECT ALL",
    });
    assert.deepEqual(getEditModeTag("select all copy"), {
      isEditMode: true,
      tag: "SELECT ALL & COPY",
    });
    assert.deepEqual(getEditModeTag("select all delete"), {
      isEditMode: true,
      tag: "SELECT ALL & DELETE",
    });
    assert.deepEqual(getEditModeTag("copy that"), {
      isEditMode: true,
      tag: "COPY",
    });
    assert.deepEqual(getEditModeTag("paste clipboard"), {
      isEditMode: true,
      tag: "PASTE",
    });
    assert.deepEqual(getEditModeTag("replace this with that"), {
      isEditMode: true,
      tag: "REPLACE",
    });
    assert.deepEqual(getEditModeTag("replace from start to finish with done"), {
      isEditMode: true,
      tag: "REPLACE RANGE",
    });
    assert.deepEqual(getEditModeTag("delete from start to finish"), {
      isEditMode: true,
      tag: "DELETE RANGE",
    });
    assert.deepEqual(getEditModeTag("remove error message"), {
      isEditMode: true,
      tag: "REMOVE",
    });
    assert.deepEqual(getEditModeTag("scratch that"), {
      isEditMode: true,
      tag: "UNDO",
    });
    assert.equal(getEditModeTag("Hello everyone this is a dictation"), null);
  });
});
