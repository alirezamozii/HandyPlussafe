use serde::{Deserialize, Serialize};
use specta::Type;
use std::sync::{LazyLock, Mutex};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum VoiceEditActionKind {
    Undo,
    RemoveTarget,
    ReplaceTarget,
    ReplaceRange,
    DeleteRange,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct VoiceEditOutcome {
    pub matched: bool,
    pub kind: VoiceEditActionKind,
    pub summary: String,
    pub previous_text: String,
    pub updated_text: String,
}

#[derive(Default)]
struct VoiceEditMemory {
    current_text: String,
    previous_snapshot: String,
}

static LAST_DICTATION_MEMORY: LazyLock<Mutex<VoiceEditMemory>> =
    LazyLock::new(|| Mutex::new(VoiceEditMemory::default()));

/// Record a newly dictated transcript so subsequent voice edit commands can operate on it.
pub fn record_dictated_text(text: &str) {
    if let Ok(mut mem) = LAST_DICTATION_MEMORY.lock() {
        let prev = mem.current_text.clone();
        mem.previous_snapshot = prev;
        mem.current_text = text.to_string();
    }
}

/// Read the most recently dictated text held in memory.
pub fn get_last_dictated_text() -> String {
    LAST_DICTATION_MEMORY
        .lock()
        .map(|m| m.current_text.clone())
        .unwrap_or_default()
}

/// Apply a spoken voice-edit utterance against the in-memory last dictation (if it matches a command)
/// and update the stored state.
pub fn try_apply_voice_edit_to_memory(
    utterance: &str,
    custom_prefixes: &[String],
) -> Option<VoiceEditOutcome> {
    let mut mem = LAST_DICTATION_MEMORY.lock().ok()?;
    if mem.current_text.trim().is_empty() {
        return None;
    }
    let outcome = apply_voice_edit(
        &mem.current_text,
        utterance,
        custom_prefixes,
        Some(&mem.previous_snapshot),
    );
    if outcome.matched {
        let prev = mem.current_text.clone();
        mem.previous_snapshot = prev;
        mem.current_text = outcome.updated_text.clone();
        Some(outcome)
    } else {
        None
    }
}

fn strip_outer_punct(input: &str) -> &str {
    input.trim().trim_matches(|c: char| {
        matches!(
            c,
            '.' | ',' | '!' | '?' | ';' | ':' | '"' | '\'' | '“' | '”' | '‘' | '’' | '-' | '–' | '—'
        ) || c.is_whitespace()
    })
}

fn strip_leading_prefix<'a>(utterance: &'a str, custom_prefixes: &[String]) -> &'a str {
    let trimmed = utterance.trim();
    let lower = trimmed.to_lowercase();

    let default_prefixes = [
        "hey jarvis",
        "jarvis",
        "handy plus",
        "hey handy",
        "handy",
        "voice edit",
        "edit",
    ];

    let mut all_prefixes: Vec<String> = custom_prefixes
        .iter()
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .chain(default_prefixes.iter().map(|s| s.to_string()))
        .collect();
    all_prefixes.sort_by(|a, b| b.len().cmp(&a.len()));
    all_prefixes.dedup();

    for p in all_prefixes {
        if lower.starts_with(&p) && trimmed.is_char_boundary(p.len()) {
            let rest = &trimmed[p.len()..];
            if rest
                .chars()
                .next()
                .map(|c| c.is_whitespace() || matches!(c, ',' | ':' | ';' | '-' | '.'))
                .unwrap_or(false)
            {
                return rest
                    .trim_start_matches(|c: char| {
                        c.is_whitespace() || matches!(c, ',' | ':' | ';' | '-' | '.')
                    })
                    .trim();
            }
        }
    }
    trimmed
}

fn normalize_spacing_and_punctuation(text: &str) -> String {
    let mut collapsed = String::with_capacity(text.len());
    let mut prev_space = false;
    for ch in text.chars() {
        if ch.is_whitespace() {
            if !prev_space {
                collapsed.push(' ');
                prev_space = true;
            }
        } else {
            if matches!(ch, ',' | '.' | ';' | ':' | '!' | '?') && collapsed.ends_with(' ') {
                collapsed.pop();
            }
            collapsed.push(ch);
            prev_space = false;
        }
    }
    let mut out = collapsed.trim().to_string();
    if let Some(first) = out.chars().next() {
        if first.is_ascii_lowercase() {
            let upper = first.to_ascii_uppercase().to_string();
            out.replace_range(0..first.len_utf8(), &upper);
        }
    }
    out
}

fn match_case_if_capitalized(original: &str, replacement: &str) -> String {
    let Some(orig_first) = original.chars().next() else {
        return replacement.to_string();
    };
    let Some(repl_first) = replacement.chars().next() else {
        return replacement.to_string();
    };
    if orig_first.is_uppercase() && repl_first.is_lowercase() {
        let mut out = String::with_capacity(replacement.len());
        for c in repl_first.to_uppercase() {
            out.push(c);
        }
        out.push_str(&replacement[repl_first.len_utf8()..]);
        out
    } else {
        replacement.to_string()
    }
}

fn find_last_case_insensitive(haystack: &str, needle: &str) -> Option<(usize, usize)> {
    let clean_needle = strip_outer_punct(needle);
    if clean_needle.is_empty() {
        return None;
    }
    let lower_hay = haystack.to_lowercase();
    let lower_needle = clean_needle.to_lowercase();
    if lower_hay.len() != haystack.len() || lower_needle.len() != clean_needle.len() {
        // Unicode safe fallback
        let idx = lower_hay.rfind(&lower_needle)?;
        if haystack.is_char_boundary(idx) && haystack.is_char_boundary(idx + lower_needle.len()) {
            return Some((idx, idx + lower_needle.len()));
        }
        return None;
    }
    let idx = lower_hay.rfind(&lower_needle)?;
    Some((idx, idx + lower_needle.len()))
}

fn find_range_case_insensitive(
    haystack: &str,
    start_phrase: &str,
    end_phrase: &str,
) -> Option<(usize, usize)> {
    let clean_start = strip_outer_punct(start_phrase);
    let clean_end = strip_outer_punct(end_phrase);
    if clean_start.is_empty() || clean_end.is_empty() {
        return None;
    }
    let lower_hay = haystack.to_lowercase();
    let lower_start = clean_start.to_lowercase();
    let lower_end = clean_end.to_lowercase();
    if lower_hay.len() != haystack.len() {
        return None;
    }

    let s_idx = lower_hay.find(&lower_start)?;
    let after_start = s_idx + lower_start.len();
    let rel_end = lower_hay[after_start..].find(&lower_end)?;
    let end_idx = after_start + rel_end + lower_end.len();
    Some((s_idx, end_idx))
}

fn split_once_case_insensitive<'a>(text: &'a str, delimiter: &str) -> Option<(&'a str, &'a str)> {
    let lower_text = text.to_lowercase();
    let lower_delim = delimiter.to_lowercase();
    if lower_text.len() != text.len() {
        return None;
    }
    let idx = lower_text.find(&lower_delim)?;
    Some((&text[..idx], &text[idx + lower_delim.len()..]))
}

pub fn apply_voice_edit(
    current_text: &str,
    utterance: &str,
    custom_prefixes: &[String],
    previous_snapshot: Option<&str>,
) -> VoiceEditOutcome {
    let body = strip_outer_punct(strip_leading_prefix(utterance, custom_prefixes));
    let lower = body.to_lowercase();

    // 1. Undo / Scratch That / Remove All
    if matches!(
        lower.as_str(),
        "undo"
            | "undo that"
            | "undo last"
            | "scratch that"
            | "remove all"
            | "delete all"
            | "clear all"
            | "clear that"
            | "erase all"
    ) {
        let updated = previous_snapshot.unwrap_or("").to_string();
        return VoiceEditOutcome {
            matched: true,
            kind: VoiceEditActionKind::Undo,
            summary: "Undo last dictation".to_string(),
            previous_text: current_text.to_string(),
            updated_text: updated,
        };
    }

    // 2. Range Replacement: "replace from <start> to <end> with <replacement>"
    for verb in ["replace from ", "change from ", "swap from "] {
        if lower.starts_with(verb) && body.is_char_boundary(verb.len()) {
            let rest = &body[verb.len()..];
            for to_sep in [" to ", " through ", " until "] {
                if let Some((start_part, after_to)) = split_once_case_insensitive(rest, to_sep) {
                    for with_sep in [" with ", " to ", " by "] {
                        if let Some((end_part, repl_part)) =
                            split_once_case_insensitive(after_to, with_sep)
                        {
                            let start_word = strip_outer_punct(start_part);
                            let end_word = strip_outer_punct(end_part);
                            let replacement_raw = strip_outer_punct(repl_part);
                            if let Some((s, e)) =
                                find_range_case_insensitive(current_text, start_word, end_word)
                            {
                                let removed = &current_text[s..e];
                                let replacement =
                                    match_case_if_capitalized(removed, replacement_raw);
                                let raw_updated = format!(
                                    "{}{}{}",
                                    &current_text[..s],
                                    replacement,
                                    &current_text[e..]
                                );
                                return VoiceEditOutcome {
                                    matched: true,
                                    kind: VoiceEditActionKind::ReplaceRange,
                                    summary: format!(
                                        "Replace from \"{}\" to \"{}\" with \"{}\"",
                                        start_word, end_word, replacement
                                    ),
                                    previous_text: current_text.to_string(),
                                    updated_text: normalize_spacing_and_punctuation(&raw_updated),
                                };
                            }
                        }
                    }
                }
            }
        }
    }

    // 3. Range Deletion: "delete/remove from <start> to <end>"
    for verb in ["delete from ", "remove from ", "erase from ", "cut from "] {
        if lower.starts_with(verb) && body.is_char_boundary(verb.len()) {
            let rest = &body[verb.len()..];
            for to_sep in [" to ", " through ", " until "] {
                if let Some((start_part, end_part)) = split_once_case_insensitive(rest, to_sep) {
                    let start_word = strip_outer_punct(start_part);
                    let end_word = strip_outer_punct(end_part);
                    if let Some((s, e)) =
                        find_range_case_insensitive(current_text, start_word, end_word)
                    {
                        let raw_updated = format!("{} {}", &current_text[..s], &current_text[e..]);
                        return VoiceEditOutcome {
                            matched: true,
                            kind: VoiceEditActionKind::DeleteRange,
                            summary: format!(
                                "Delete from \"{}\" to \"{}\"",
                                start_word, end_word
                            ),
                            previous_text: current_text.to_string(),
                            updated_text: normalize_spacing_and_punctuation(&raw_updated),
                        };
                    }
                }
            }
        }
    }

    // 4. Targeted Replacement: "replace <target> with/to <replacement>"
    for verb in ["replace ", "change ", "swap ", "substitute "] {
        if lower.starts_with(verb) && body.is_char_boundary(verb.len()) {
            let rest = &body[verb.len()..];
            let rest = rest
                .strip_prefix("the word ")
                .or_else(|| rest.strip_prefix("the phrase "))
                .unwrap_or(rest);
            for sep in [" with ", " to ", " by ", " for "] {
                if let Some((target_part, repl_part)) = split_once_case_insensitive(rest, sep) {
                    let target = strip_outer_punct(target_part);
                    let replacement_raw = strip_outer_punct(repl_part);
                    if let Some((s, e)) = find_last_case_insensitive(current_text, target) {
                        let removed = &current_text[s..e];
                        let replacement = match_case_if_capitalized(removed, replacement_raw);
                        let raw_updated = format!(
                            "{}{}{}",
                            &current_text[..s],
                            replacement,
                            &current_text[e..]
                        );
                        return VoiceEditOutcome {
                            matched: true,
                            kind: VoiceEditActionKind::ReplaceTarget,
                            summary: format!("Replace \"{}\" with \"{}\"", target, replacement),
                            previous_text: current_text.to_string(),
                            updated_text: normalize_spacing_and_punctuation(&raw_updated),
                        };
                    }
                }
            }
        }
    }

    // 5. Targeted Removal: "remove/delete <target>"
    for verb in ["remove ", "delete ", "erase ", "drop "] {
        if lower.starts_with(verb) && body.is_char_boundary(verb.len()) {
            let rest = &body[verb.len()..];
            let rest = rest
                .strip_prefix("the word ")
                .or_else(|| rest.strip_prefix("the phrase "))
                .unwrap_or(rest);
            let target = strip_outer_punct(rest);
            if let Some((s, e)) = find_last_case_insensitive(current_text, target) {
                let raw_updated = format!("{} {}", &current_text[..s], &current_text[e..]);
                return VoiceEditOutcome {
                    matched: true,
                    kind: VoiceEditActionKind::RemoveTarget,
                    summary: format!("Remove \"{}\"", target),
                    previous_text: current_text.to_string(),
                    updated_text: normalize_spacing_and_punctuation(&raw_updated),
                };
            }
        }
    }

    VoiceEditOutcome {
        matched: false,
        kind: VoiceEditActionKind::None,
        summary: "Standard dictation".to_string(),
        previous_text: current_text.to_string(),
        updated_text: current_text.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_voice_edit_undo_and_remove() {
        let base = "We need to deploy the staging server urgently today.";
        let res = apply_voice_edit(base, "remove urgently", &[], None);
        assert!(res.matched);
        assert_eq!(res.kind, VoiceEditActionKind::RemoveTarget);
        assert_eq!(res.updated_text, "We need to deploy the staging server today.");

        let undo = apply_voice_edit(&res.updated_text, "scratch that", &[], Some(base));
        assert!(undo.matched);
        assert_eq!(undo.kind, VoiceEditActionKind::Undo);
        assert_eq!(undo.updated_text, base);
    }

    #[test]
    fn test_voice_edit_replace_word_and_range() {
        let base = "Schedule the design review for Tuesday morning.";
        let r1 = apply_voice_edit(base, "replace Tuesday with Thursday", &[], None);
        assert!(r1.matched);
        assert_eq!(
            r1.updated_text,
            "Schedule the design review for Thursday morning."
        );

        let r2 = apply_voice_edit(
            &r1.updated_text,
            "replace from design review to Thursday morning with architecture sync on Friday",
            &[],
            None,
        );
        assert!(r2.matched);
        assert_eq!(r2.kind, VoiceEditActionKind::ReplaceRange);
        assert_eq!(
            r2.updated_text,
            "Schedule the architecture sync on Friday."
        );
    }
}
