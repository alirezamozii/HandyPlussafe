# Handy+ (`alirezamozii/HandyPlus`) — Master Engineering & Design Plan

> **Author & Edition:** mozii (`alirezamozii/HandyPlus`)  
> **Upstream Base:** [cjpais/Handy](https://github.com/cjpais/Handy) v0.10.0 (Tauri 2.x Rust Backend + React 18 / TypeScript / Vite 6 / Tailwind CSS v4 Frontend)

---

## 1. Vision & Product Architecture

**Handy+** is a high-craft, zero-compromise evolution of the open-source offline speech-to-text app **Handy**, engineered by **mozii**. It preserves 100% upstream merge compatibility with `cjpais/Handy` while introducing:

1. **Signature AMOLED Obsidian + Higgsfield Electric Lime (`#D4FF00`) Design System**:
   - True `#000000` AMOLED pitch-black canvas, `#08080A` obsidian card surfaces, crisp `1px` specular borders, and `#D4FF00` neon lime accents with `#050505` high-contrast ink on active pills.
   - Fixed `HandyHand.tsx` active sidebar icon (`fill-current stroke-current`) so active navigation tabs render crisp `#050505` black icons on `#D4FF00` lime pills instead of disappearing in white-on-lime.
   - Redesigned `HandyTextLogo.tsx` (`HANDY+`) geometric vector wordmark with zero white outer stroke and an electric lime `+` badge.
   - Redesigned Dynamic-Island-inspired `RecordingOverlay.tsx` with spring physics, 12-band acoustic spectrum visualizer, and unmistakable state badges (**Arming / Warming Model** vs. **Listening Live — Speak Now** vs. **Voice Edit Applied** vs. **Transcribing**).
   - Internationalized Model Accuracy display in `GradeChip.tsx` / `catalog.ts` / `columns.tsx` showing both letter grade (`A+`) and explicit accuracy percentage (`97%`) so non-US users immediately understand model quality.

2. **Hands-Free Voice Activation (Wake-Word Engine) + Zero-Clipped-Words Audio Pipeline**:
   - **Pre-Roll & Tail Buffer Protection**:
     - Default `extra_recording_buffer_ms` increased from `0 ms` to `250 ms` so trailing words spoken as the key is released or at the end of a phrase are never clipped.
     - `SmoothedVad::flush_tail()` & `CaptureSink::finish()` flush any buffered onset/hangover speech frames held inside the VAD ring buffer when recording stops, rescuing the first and final syllables.
     - Explicit readiness state in the overlay (`arming` vs `listening`) so users never speak before the audio stream and model are ready.

3. **Hands-Free Voice Editing & Replacement Engine ("Jarvis Mode")**:
   - Deterministic, zero-latency voice commands that operate on the last dictated transcript without touching the keyboard:
     - **Undo / Scratch That**: `"undo"`, `"undo that"`, `"scratch that"`, `"remove all"`, `"clear all"` → clears or reverts the last dictated text.
     - **Targeted Deletion**: `"remove <word/phrase>"`, `"delete <word/phrase>"` → strips the target word or phrase and normalizes surrounding whitespace and punctuation.
     - **Instant Word/Phrase Replacement**: `"replace <old> with <new>"`, `"replace <old> to <new>"`, `"change <old> to <new>"` → replaces `<old>` with `<new>` in-place (case-insensitive match with smart casing preservation).
     - **Span / Range Replacement ("Shift-Select by Voice")**: `"replace from <start_word> to <end_word> with <replacement>"` and `"delete from <start_word> to <end_word>"` → selects the inclusive span from `<start_word>` through `<end_word>` in the previous transcript and replaces or deletes the entire span in one spoken command.
   - Implemented in both Rust (`src-tauri/src/voice_edit.rs`) and TypeScript (`src/lib/voiceEdit/engine.ts`) with full unit test suites and an interactive **Voice Edit & Replace Studio** in Settings.

4. **Comprehensive Upstream Bug & Stability Fixes**:
   - **Issue #2480 (Settings Reset / Hand-Edited `settings_store.json` / Windows Start Menu Launch)**:
     - Harden `salvage_settings` and `get_settings` in `src-tauri/src/settings.rs` to strip UTF-8 BOMs, tolerate trailing commas, and preserve `onboarding_completed: true` whenever `selected_model` is already configured.
   - **Issue #2408 (Windows Tray `E_FAIL` & Transcription Coordinator Panic `Any { .. }`)**:
     - Extract readable `&str` / `String` payloads from panics in `src-tauri/src/transcription_coordinator.rs` and keep the coordinator worker thread alive across panics so hotkeys never die silently.
   - **Issue #1005 & `--no-tray` Window Close Behavior**:
     - In `src-tauri/src/lib.rs`, when `WindowEvent::CloseRequested` fires and `!settings.show_tray_icon || cli_args.no_tray`, cleanly exit the application (`app_handle().exit(0)`) instead of hiding the window into an unrecoverable background process.
   - **Issue #642 (Mute System Audio Delay Captures First Words of Media/YouTube)**:
     - In `src-tauri/src/actions.rs`, apply system audio mute (`rm.apply_mute()`) immediately before microphone capture when audio feedback is disabled, and unmute (`rm.remove_mute()`) only *after* `rm.stop_recording()` finishes draining captured samples.
   - **Issues #502 & #1366 (Clipboard Restore Race Under GPU/System Load & Wayland `wl-copy`)**:
     - Increase default `paste_delay_after_ms` floor in `src-tauri/src/settings.rs` (`180 ms` default instead of `100 ms`) so target apps under load read the new transcript before the previous clipboard is restored.
   - **Issue #483 (`env:VAR_NAME` Secret Resolution for LLM Post-Processing)**:
     - In `src-tauri/src/llm_client.rs`, dynamically resolve `env:VAR_NAME` and `$VAR_NAME` references in API keys and base URLs, with automatic fallback to `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, and `GROQ_API_KEY`.
   - **Issue #1809 (DeepSeek / OpenAI-Compatible Reasoning Disable Fallback)**:
     - In `src-tauri/src/llm_client.rs`, cascade through `reasoning_effort: "none"` → `reasoning_effort: "off"` → `thinking: {"type": "disabled"}` before falling back to bare requests, caching the working strategy per `(base_url, model)` and logging at `warn!` when all disable strategies are rejected.
   - **Issues #1261 / #1310 (Empty `<transcript>` Block in Structured Output System Prompt)**:
     - In `src-tauri/src/actions.rs`, strip empty `<transcript>\s*</transcript>` blocks from `build_system_prompt` and wrap the user turn in `<transcript>\n...\n</transcript>` so instruction-tuned models never mistake dictated commands for assistant instructions.
   - **Issues #1262 / #1311 (Accidental Data Loss When Editing History Limit / Retention Period)**:
     - In `src-tauri/src/commands/history.rs`, remove synchronous `cleanup_old_entries()` deletion from `update_history_limit` and `update_recording_retention_period` so changing settings in the UI never unexpectedly wipes existing recordings.
   - **Issue #1841 (NVIDIA Vulkan `KHR_coopmat` 70s Model Reload Freeze)**:
     - In `src-tauri/src/main.rs`, set `GGML_VK_DISABLE_COOPMAT=1` by default unless `HANDY_KEEP_VK_COOPMAT=1` is set.
   - **Security Hardening (`src-tauri/tauri.conf.json`)**:
     - Restrict `assetProtocol.scope.allow` from `["**"]` to `["$APPDATA/recordings/**", "$APPLOCALDATA/recordings/**"]`.

---

## 2. Verification & CI Matrix

- **Unit Tests**:
  - `src/lib/wakeWord/matcher.test.ts`: Wake-word fuzzy/phonetic/prefix matching and command extraction.
  - `src/lib/voiceEdit/engine.test.ts`: Voice editing commands (`undo`, `remove X`, `replace X with Y`, `replace from X to Y with Z`, `delete from X to Y`, punctuation & case preservation).
  - `src-tauri/src/voice_edit.rs` & `src-tauri/src/audio_toolkit/audio/sink/tests.rs`: Rust unit tests for voice edit operations and VAD tail flushing.
- **Translation Integrity**:
  - `scripts/check-translations.ts`: 100% key parity across all 25 locale files (`src/i18n/locales/*/translation.json`).
- **GitHub Actions CI (`.github/workflows/test.yml`)**:
  - Automated translation check, TypeScript typecheck, ESLint, frontend unit tests (`wakeWord` + `voiceEdit`), and Cargo test suite.
