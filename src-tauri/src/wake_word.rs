use crate::audio_toolkit::vad::{
    EarshotVad, VadFrame, VoiceActivityDetector, EARSHOT_FRAME_SAMPLES,
};
use crate::helpers::clamshell;
use crate::managers::audio::AudioRecordingManager;
use crate::managers::transcription::TranscriptionManager;
use crate::settings::{self, get_settings, AppSettings};
use crate::signal_handle;
use handy_recorder::{AudioChunk, Channels, Recorder, RecorderConfig, Sink};
use log::{debug, info, warn};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

const SAMPLE_RATE: usize = 16_000;
const CHUNK_SAMPLES: usize = EARSHOT_FRAME_SAMPLES; // 256 samples (16 ms at 16 kHz)
const PRE_ROLL_FRAMES: usize = 22; // ~352 ms pre-roll before speech onset
const ONSET_VOICED_FRAMES: usize = 2; // 32 ms of speech confirms onset
const END_SILENCE_FRAMES: usize = 16; // ~256 ms trailing silence triggers check
const PROBE_INTERVAL_FRAMES: usize = 50; // ~800 ms periodic check while speech continues
const MIN_SPEECH_SAMPLES: usize = SAMPLE_RATE / 2; // 0.5 s minimum window for ASR
const MAX_SPEECH_SAMPLES: usize = SAMPLE_RATE * 3; // 3 s rolling cap
const FRAME_RMS_FALLBACK: f32 = 0.008;
const EARSHOT_WAKE_THRESHOLD: f32 = 0.5;
const TRIGGER_COOLDOWN: Duration = Duration::from_millis(2500);
const RECV_TIMEOUT: Duration = Duration::from_millis(120);

struct WakeControl {
    armed: AtomicBool,
    condvar: Condvar,
    wait_lock: Mutex<()>,
}

static WAKE_CONTROL: OnceLock<WakeControl> = OnceLock::new();

fn control() -> &'static WakeControl {
    WAKE_CONTROL.get_or_init(|| WakeControl {
        armed: AtomicBool::new(false),
        condvar: Condvar::new(),
        wait_lock: Mutex::new(()),
    })
}

/// Normalize spoken/configured wake phrase tokens for punctuation- and case-insensitive matching.
fn normalize_tokens(input: &str) -> Vec<String> {
    input
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric() && c != '\'')
        .filter(|tok| !tok.is_empty())
        .map(ToString::to_string)
        .collect()
}

pub fn sanitize_wake_words(words: Vec<String>) -> Vec<String> {
    let mut cleaned = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for raw in words {
        let trimmed = raw
            .replace(['<', '>', '"', '\''], "")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        let trimmed = trimmed.trim().to_string();
        if trimmed.is_empty() || trimmed.chars().count() > 64 {
            continue;
        }
        let normalized_key = normalize_tokens(&trimmed).join(" ");
        if normalized_key.is_empty() || !seen.insert(normalized_key) {
            continue;
        }
        cleaned.push(trimmed);
    }
    cleaned
}

/// Returns the first matched wake phrase (case- and punctuation-insensitive, whole-token boundaries).
pub fn match_wake_word<'a>(transcript: &str, wake_words: &'a [String]) -> Option<&'a str> {
    let transcript_tokens = normalize_tokens(transcript);
    if transcript_tokens.is_empty() {
        return None;
    }

    for word in wake_words {
        let target_tokens = normalize_tokens(word);
        if target_tokens.is_empty() || target_tokens.len() > transcript_tokens.len() {
            continue;
        }
        if transcript_tokens
            .windows(target_tokens.len())
            .any(|window| window == target_tokens.as_slice())
        {
            return Some(word.as_str());
        }
    }

    None
}

struct WakeStreamSink {
    tx: mpsc::SyncSender<Vec<f32>>,
    pending: Vec<f32>,
}

impl WakeStreamSink {
    fn new(tx: mpsc::SyncSender<Vec<f32>>) -> Self {
        Self {
            tx,
            pending: Vec::with_capacity(CHUNK_SAMPLES * 2),
        }
    }
}

impl Sink for WakeStreamSink {
    fn process_chunk(&mut self, chunk: AudioChunk<'_>) {
        let real = &chunk.samples[..chunk.valid_frames];
        if real.is_empty() {
            return;
        }
        self.pending.extend_from_slice(real);
        while self.pending.len() >= CHUNK_SAMPLES {
            let frame: Vec<f32> = self.pending.drain(..CHUNK_SAMPLES).collect();
            let _ = self.tx.try_send(frame);
        }
    }
}

fn desired_mic_name(settings: &AppSettings) -> Option<String> {
    let candidate = if let Some(clamshell_mic) = settings.clamshell_microphone.as_deref() {
        if clamshell::is_clamshell().unwrap_or(false) {
            Some(clamshell_mic)
        } else {
            settings.selected_microphone.as_deref()
        }
    } else {
        settings.selected_microphone.as_deref()
    };
    candidate
        .map(str::trim)
        .filter(|d| !d.is_empty() && !d.eq_ignore_ascii_case("default"))
        .map(ToString::to_string)
}

fn resolve_device_id(mic_name: Option<&str>) -> Option<String> {
    let target = mic_name?;
    match handy_recorder::list_input_devices() {
        Ok(devices) => devices.into_iter().find(|d| d.name == target).map(|d| d.id),
        Err(err) => {
            debug!("Wake-word could not enumerate input devices ({err}); using system default");
            None
        }
    }
}

fn frame_rms(frame: &[f32]) -> f32 {
    if frame.is_empty() {
        return 0.0;
    }
    let sum_sq: f32 = frame.iter().map(|s| s * s).sum();
    (sum_sq / frame.len() as f32).sqrt()
}

fn is_frame_voiced(vad: &mut Option<EarshotVad>, frame: &[f32]) -> bool {
    if let Some(detector) = vad.as_mut() {
        if frame.len() == detector.frame_samples() {
            if let Ok(result) = detector.push_frame(frame) {
                return matches!(result, VadFrame::Speech(_));
            }
        }
    }
    frame_rms(frame) >= FRAME_RMS_FALLBACK
}

fn append_bounded_speech(buf: &mut Vec<f32>, samples: &[f32]) {
    buf.extend_from_slice(samples);
    if buf.len() > MAX_SPEECH_SAMPLES {
        let excess = buf.len() - MAX_SPEECH_SAMPLES;
        buf.drain(..excess);
    }
}

fn should_be_armed(app: &AppHandle) -> bool {
    let s = get_settings(app);
    s.wake_word_enabled && !sanitize_wake_words(s.wake_words).is_empty()
}

pub fn sync_with_settings(app: &AppHandle) {
    let armed = should_be_armed(app);
    let ctrl = control();
    ctrl.armed.store(armed, Ordering::SeqCst);
    ctrl.condvar.notify_all();
}

pub fn init(app: &AppHandle) {
    sync_with_settings(app);
    let app_handle = app.clone();
    thread::Builder::new()
        .name("handy-wake-word".to_string())
        .spawn(move || run_monitor_loop(app_handle))
        .expect("failed to spawn wake-word monitor thread");
}

fn run_monitor_loop(app: AppHandle) {
    let ctrl = control();
    let mut last_trigger_at = Instant::now() - TRIGGER_COOLDOWN;

    loop {
        if !ctrl.armed.load(Ordering::SeqCst) {
            let guard = ctrl.wait_lock.lock().unwrap();
            let _wait_guard = ctrl
                .condvar
                .wait_while(guard, |_| !ctrl.armed.load(Ordering::SeqCst));
            continue;
        }

        // Never compete with an active dictation session for the microphone.
        let audio_mgr = app.state::<Arc<AudioRecordingManager>>();
        if audio_mgr.is_recording() {
            thread::sleep(Duration::from_millis(200));
            continue;
        }

        let current_settings = get_settings(&app);
        let wake_words = sanitize_wake_words(current_settings.wake_words.clone());
        if !current_settings.wake_word_enabled || wake_words.is_empty() {
            ctrl.armed.store(false, Ordering::SeqCst);
            continue;
        }

        let tm = app.state::<Arc<TranscriptionManager>>();
        if !tm.is_model_loaded() {
            if !current_settings.selected_model.is_empty() {
                tm.initiate_model_load(false);
            }
            thread::sleep(Duration::from_millis(800));
            continue;
        }

        // Release any idle stream held by always-on / lazy-close before opening the
        // wake listener so shared/exclusive OS audio backends don't conflict.
        audio_mgr.release_idle_stream();

        let opened_mic_name = desired_mic_name(&current_settings);
        let opened_channel = current_settings.selected_channel;
        let opened_airpods_mode = current_settings.airpods_mode;
        let device = resolve_device_id(opened_mic_name.as_deref());

        let config = RecorderConfig {
            device,
            channels: opened_channel.map_or(Channels::MixToMono, Channels::Only),
            frames_per_chunk: Some(CHUNK_SAMPLES),
            take_headset: opened_airpods_mode,
            ..RecorderConfig::speech()
        };

        let recorder = match Recorder::<WakeStreamSink>::open(config) {
            Ok(rec) => rec,
            Err(err) => {
                debug!("Wake-word recorder unavailable ({err}); retrying soon");
                thread::sleep(Duration::from_secs(2));
                continue;
            }
        };

        let (tx, rx) = mpsc::sync_channel::<Vec<f32>>(256);
        let sink = WakeStreamSink::new(tx);
        if let Err(err) = recorder.start(sink) {
            warn!("Wake-word recorder failed to start: {}", err.error);
            let _ = recorder.close();
            thread::sleep(Duration::from_secs(2));
            continue;
        }

        let mut vad = EarshotVad::new(EARSHOT_WAKE_THRESHOLD).ok();
        let mut pre_roll: VecDeque<Vec<f32>> = VecDeque::with_capacity(PRE_ROLL_FRAMES);
        let mut speech_buf: Vec<f32> = Vec::with_capacity(MAX_SPEECH_SAMPLES);
        let mut onset_count: usize = 0;
        let mut speech_active = false;
        let mut silence_frames: usize = 0;
        let mut frames_since_probe: usize = 0;

        info!("Wake-word voice monitor armed (Earshot VAD continuous stream)");

        let mut matched_phrase: Option<String> = None;
        let mut idle_ticks: u8 = 0;
        while ctrl.armed.load(Ordering::SeqCst) && !audio_mgr.is_recording() {
            let frame = match rx.recv_timeout(RECV_TIMEOUT) {
                Ok(frame) => {
                    idle_ticks = 0;
                    frame
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    idle_ticks = idle_ticks.saturating_add(1);
                    if idle_ticks >= 8 {
                        idle_ticks = 0;
                        let latest = settings::get_settings(&app);
                        if desired_mic_name(&latest) != opened_mic_name
                            || latest.selected_channel != opened_channel
                            || latest.airpods_mode != opened_airpods_mode
                        {
                            debug!("Audio device settings changed; restarting wake-word listener");
                            break;
                        }
                    }
                    continue;
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            };

            if !ctrl.armed.load(Ordering::SeqCst) || audio_mgr.is_recording() {
                break;
            }

            let voiced = is_frame_voiced(&mut vad, &frame);
            if !speech_active {
                if pre_roll.len() >= PRE_ROLL_FRAMES {
                    pre_roll.pop_front();
                }
                pre_roll.push_back(frame);

                if voiced {
                    onset_count += 1;
                    if onset_count >= ONSET_VOICED_FRAMES {
                        speech_active = true;
                        onset_count = 0;
                        silence_frames = 0;
                        frames_since_probe = 0;
                        speech_buf.clear();
                        for f in &pre_roll {
                            append_bounded_speech(&mut speech_buf, f);
                        }
                        pre_roll.clear();
                    }
                } else {
                    onset_count = 0;
                }
                continue;
            }

            append_bounded_speech(&mut speech_buf, &frame);
            frames_since_probe += 1;
            if voiced {
                silence_frames = 0;
            } else {
                silence_frames += 1;
            }

            let speech_ended = silence_frames >= END_SILENCE_FRAMES;
            let periodic_probe = frames_since_probe >= PROBE_INTERVAL_FRAMES;
            if (!speech_ended && !periodic_probe) || speech_buf.len() < MIN_SPEECH_SAMPLES {
                continue;
            }

            if last_trigger_at.elapsed() < TRIGGER_COOLDOWN {
                if speech_ended {
                    speech_active = false;
                    speech_buf.clear();
                }
                continue;
            }

            frames_since_probe = 0;
            let latest_words = sanitize_wake_words(settings::get_settings(&app).wake_words);
            if latest_words.is_empty() {
                break;
            }

            let probe_audio = speech_buf.clone();
            match tm.transcribe(probe_audio) {
                Ok(transcript) => {
                    if let Some(matched) = match_wake_word(&transcript, &latest_words) {
                        info!("Wake word detected: '{}' in '{}'", matched, transcript);
                        last_trigger_at = Instant::now();
                        matched_phrase = Some(matched.to_string());
                        break;
                    }
                }
                Err(err) => {
                    debug!("Wake-word pass skipped transcription error: {err}");
                }
            }

            if speech_ended {
                speech_active = false;
                silence_frames = 0;
                speech_buf.clear();
                if let Some(detector) = vad.as_mut() {
                    detector.reset();
                }
            }
        }

        let _ = recorder.stop();
        let _ = recorder.close();

        if matched_phrase.is_some()
            && !audio_mgr.is_recording()
            && ctrl.armed.load(Ordering::SeqCst)
        {
            // Brief yield so OS audio device release settles before dictation captures it.
            thread::sleep(Duration::from_millis(60));
            signal_handle::send_transcription_input(&app, "transcribe", "WakeWord");

            // Wait for the triggered dictation session to start and finish before re-arming.
            let wait_start = Instant::now();
            while wait_start.elapsed() < Duration::from_millis(1200) && !audio_mgr.is_recording() {
                if !ctrl.armed.load(Ordering::SeqCst) {
                    break;
                }
                thread::sleep(Duration::from_millis(30));
            }
            while audio_mgr.is_recording() {
                thread::sleep(Duration::from_millis(100));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_case_and_punctuation_at_word_boundaries() {
        let words = vec!["hey handy".to_string(), "computer".to_string()];
        assert_eq!(
            match_wake_word("Hey, Handy! Start writing now.", &words),
            Some("hey handy")
        );
        assert_eq!(
            match_wake_word("Computer please summarize this.", &words),
            Some("computer")
        );
        assert_eq!(match_wake_word("supercomputer test", &words), None);
        assert_eq!(match_wake_word("unrelated dictation text", &words), None);
    }

    #[test]
    fn sanitizes_and_deduplicates_wake_words() {
        let cleaned = sanitize_wake_words(vec![
            "  Hey   Handy! ".to_string(),
            "hey handy".to_string(),
            "".to_string(),
            "\"Start Note\"".to_string(),
        ]);
        assert_eq!(
            cleaned,
            vec!["Hey Handy!".to_string(), "Start Note".to_string()]
        );
    }
}
