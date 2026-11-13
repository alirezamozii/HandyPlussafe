import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyVoiceEdit, parseVoiceEditCommand } from "./engine";

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

  it("does not alter regular dictation sentences that are not voice edit commands", () => {
    const text = "Initial paragraph.";
    const parsed = parseVoiceEditCommand(
      "Let's discuss how we can improve our product onboarding flow.",
    );
    assert.equal(parsed.kind, "none");
    const res = applyVoiceEdit(
      text,
      "Let's discuss how we can improve our product onboarding flow.",
    );
    assert.equal(res.matched, false);
    assert.equal(res.updatedText, text);
  });

  it("respects word boundaries for target and range edits", () => {
    const base = "The plan is clear and this island is ready.";
    const noPartialDelete = applyVoiceEdit(base, "remove an");
    assert.equal(noPartialDelete.matched, false);
    assert.equal(noPartialDelete.updatedText, base);

    const exactReplace = applyVoiceEdit(base, "replace is with was");
    assert.equal(exactReplace.matched, true);
    assert.equal(
      exactReplace.updatedText,
      "The plan is clear and this island was ready.",
    );

    const rangeEdit = applyVoiceEdit(
      "Review this plan is good until it ships.",
      "replace from plan to good with architecture holds",
    );
    assert.equal(rangeEdit.matched, true);
    assert.equal(
      rangeEdit.updatedText,
      "Review this architecture holds until it ships.",
    );
  });
});
