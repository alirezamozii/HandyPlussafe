use crate::managers::audio::AudioRecordingManager;
use crate::managers::transcription::TranscriptionManager;
use crate::settings::{self, get_settings};
use crate::signal_handle;
use handy_recorder::{AudioChunk, Channels, Recorder, RecorderConfig, Sink};
use log::{debug, info, trace, warn};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

const SAMPLE_RATE: usize = 16_000;
const CHUNK_SAMPLES: usize = 480; // 30 ms at 16 kHz
const ROLLING_WINDOW_SAMPLES: usize = SAMPLE_RATE * 3; // 3 seconds rolling audio buffer
const SPEECH_RMS_THRESHOLD: f32 = 0.015;
const TRIGGER_COOLDOWN: Duration = Duration::from_millis(2500);
const POLL_INTERVAL: Duration = Duration::from_millis(900);

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

struct WakeRingSink {
    buffer: Arc<Mutex<VecDeque<f32>>>,
    max_samples: usize,
}

impl WakeRingSink {
    fn new(buffer: Arc<Mutex<VecDeque<f32>>>, max_samples: usize) -> Self {
        Self {
            buffer,
            max_samples,
        }
    }
}

impl Sink for WakeRingSink {
    fn process_chunk(&mut self, chunk: AudioChunk<'_>) {
        let real = &chunk.samples[..chunk.valid_frames];
        if real.is_empty() {
            return;
        }
        if let Ok(mut guard) = self.buffer.lock() {
            for &sample in real {
                if guard.len() >= self.max_samples {
                    guard.pop_front();
                }
                guard.push_back(sample);
            }
        }
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
            let _ = ctrl
                .condvar
                .wait_while(guard, |_| !ctrl.armed.load(Ordering::SeqCst));
            continue;
        }

        // Never compete with an active dictation session for the microphone.
        let audio_mgr = app.state::<Arc<AudioRecordingManager>>();
        if audio_mgr.is_recording() {
            thread::sleep(Duration::from_millis(250));
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
            thread::sleep(Duration::from_millis(1200));
            continue;
        }

        let device = current_settings
            .selected_microphone
            .as_deref()
            .filter(|d| !d.is_empty() && !d.eq_ignore_ascii_case("default"))
            .map(ToString::to_string);

        let config = RecorderConfig {
            device,
            channels: current_settings
                .selected_channel
                .map_or(Channels::MixToMono, Channels::Only),
            frames_per_chunk: Some(CHUNK_SAMPLES),
            take_headset: current_settings.airpods_mode,
            ..RecorderConfig::speech()
        };

        let recorder = match Recorder::<WakeRingSink>::open(config) {
            Ok(rec) => rec,
            Err(err) => {
                debug!("Wake-word recorder unavailable ({err}); retrying soon");
                thread::sleep(Duration::from_secs(2));
                continue;
            }
        };

        let ring = Arc::new(Mutex::new(VecDeque::with_capacity(ROLLING_WINDOW_SAMPLES)));
        let sink = WakeRingSink::new(Arc::clone(&ring), ROLLING_WINDOW_SAMPLES);
        if let Err(err) = recorder.start(sink) {
            warn!("Wake-word recorder failed to start: {}", err.error);
            let _ = recorder.close();
            thread::sleep(Duration::from_secs(2));
            continue;
        }

        info!("Wake-word voice monitor armed");

        let mut triggered = false;
        while ctrl.armed.load(Ordering::SeqCst) && !audio_mgr.is_recording() {
            thread::sleep(POLL_INTERVAL);

            if !ctrl.armed.load(Ordering::SeqCst) || audio_mgr.is_recording() {
                break;
            }

            if last_trigger_at.elapsed() < TRIGGER_COOLDOWN {
                continue;
            }

            let samples: Vec<f32> = match ring.lock() {
                Ok(guard) => {
                    if guard.len() < SAMPLE_RATE / 2 {
                        continue;
                    }
                    guard.iter().copied().collect()
                }
                Err(_) => continue,
            };

            let rms = {
                let sum_sq: f32 = samples.iter().map(|s| s * s).sum();
                (sum_sq / samples.len() as f32).sqrt()
            };
            if rms < SPEECH_RMS_THRESHOLD {
                trace!("Wake-word audio below speech RMS threshold ({rms:.4})");
                continue;
            }

            let latest_words = sanitize_wake_words(settings::get_settings(&app).wake_words);
            if latest_words.is_empty() {
                break;
            }

            match tm.transcribe(samples) {
                Ok(transcript) => {
                    if let Some(matched) = match_wake_word(&transcript, &latest_words) {
                        info!("Wake word detected: '{}' in '{}'", matched, transcript);
                        last_trigger_at = Instant::now();
                        triggered = true;
                        break;
                    }
                }
                Err(err) => {
                    debug!("Wake-word pass skipped transcription error: {err}");
                }
            }
        }

        let _ = recorder.stop();
        let _ = recorder.close();

        if triggered && !audio_mgr.is_recording() && ctrl.armed.load(Ordering::SeqCst) {
            // Brief yield so OS audio device release settles before dictation captures it.
            thread::sleep(Duration::from_millis(80));
            signal_handle::send_transcription_input(&app, "transcribe", "WakeWord");
            // Wait until the dictation session spins up or finishes before resuming monitoring.
            thread::sleep(Duration::from_millis(600));
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
