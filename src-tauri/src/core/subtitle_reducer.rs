//! Subtitle assembly state machine for drafts, confirmed pairs, and bounded
//! history.
//!
//! Providers that stream recognition and translation independently pair them by
//! the identity their own protocol carries and commit one atomic
//! [`SubtitleEvent::FinalPair`]. [`SubtitleEvent::TranslationFinal`] remains the
//! best-effort path for a stream without identity: the translation is paired
//! with the recognition line currently on screen.

use crate::core::models::{
    PreviewSubtitlePair, SubtitleEvent, SubtitleLine, SubtitlePair, SubtitleSnapshot, UtteranceRole,
};

// Keep one complete pair rather than truncating a sentence for presentation.
// This matches the MT clients' translated-text bound and also bounds its ASR
// counterpart when retained independently of the latest raw recognition.
#[cfg(test)]
const MAX_PREVIEW_TEXT_BYTES: usize = crate::core::models::MAX_SUBTITLE_TEXT_BYTES;

pub struct SubtitleReducer {
    pub snapshot: SubtitleSnapshot,
    pub archive: super::session_archive::TranscriptArchive,
    max_history_count: usize,
    source_draft_since_confirmation: bool,
    last_confirmed_id: Option<u64>,
}

impl SubtitleReducer {
    pub fn new(max_history_count: usize) -> Self {
        Self {
            snapshot: SubtitleSnapshot::empty(),
            archive: Default::default(),
            max_history_count,
            source_draft_since_confirmation: false,
            last_confirmed_id: None,
        }
    }

    pub fn is_new_confirmation_id(&self, utterance_id: u64) -> bool {
        self.last_confirmed_id.is_none_or(|last| {
            let distance = utterance_id.wrapping_sub(last);
            distance != 0 && distance < 1_u64 << 63
        })
    }

    pub fn apply(&mut self, event: SubtitleEvent) {
        if !event.text_within_limit() {
            return;
        }
        match event {
            SubtitleEvent::SourceDraft(text) => {
                let text = trim(&text);
                // A new recognition cycle may repeat the preceding lyric or
                // sentence. Its final is distinct from a duplicate final sent
                // without any intervening recognition draft.
                self.source_draft_since_confirmation |= !text.is_empty();
                self.snapshot.source = SubtitleLine::new(text, false);
            }
            SubtitleEvent::SourceFinal(text) => {
                self.snapshot.source = SubtitleLine::new(trim(&text), true);
            }
            SubtitleEvent::TranslationDraft(text) => {
                let trimmed = trim(&text);
                // A blank draft must not overwrite an already-confirmed final.
                if trimmed.is_empty() && self.snapshot.translation.is_final {
                    return;
                }
                self.snapshot.translation = SubtitleLine::new(trimmed, false);
            }
            SubtitleEvent::PreviewPair {
                source,
                translation,
            } => {
                let source = trim(&source);
                let translation = trim(&translation);
                if source.is_empty() || translation.is_empty() {
                    return;
                }
                // This is a replaceable display pair, never a confirmation.
                // Raw ASR can continue independently while a later request
                // waits; retaining its last complete pair avoids a blank and
                // a new short SSE prefix on every request.
                self.snapshot.preview_pair = Some(PreviewSubtitlePair {
                    source,
                    translation,
                });
            }
            SubtitleEvent::UtteranceText {
                utterance_id,
                role,
                text,
                is_final,
            } => {
                let text = trim(&text);
                match role {
                    UtteranceRole::Source => {
                        self.snapshot.source =
                            SubtitleLine::for_utterance(text, is_final, utterance_id);
                    }
                    UtteranceRole::Translation => {
                        if text.is_empty() && self.snapshot.translation.is_final {
                            return;
                        }
                        self.snapshot.translation =
                            SubtitleLine::for_utterance(text.clone(), is_final, utterance_id);
                        if is_final {
                            let source = self.snapshot.source.text.clone();
                            if !source.is_empty() && !text.is_empty() {
                                self.snapshot.preview_pair = None;
                            }
                            self.append_history_if_possible(source, text);
                        }
                    }
                }
            }
            SubtitleEvent::TranslationFinal(text) => {
                let translation = trim(&text);
                self.snapshot.translation = SubtitleLine::new(translation.clone(), true);
                let source = self.snapshot.source.text.clone();
                if !source.is_empty() && !translation.is_empty() {
                    self.snapshot.preview_pair = None;
                }
                self.append_history_if_possible(source, translation);
            }
            SubtitleEvent::FinalPair {
                source,
                translation,
            } => {
                let source = trim(&source);
                let translation = trim(&translation);
                self.snapshot.source = SubtitleLine::new(source.clone(), true);
                self.snapshot.translation = SubtitleLine::new(translation.clone(), true);
                // HQ finals own the durable lane and exclude later preview
                // work until completion. A corrected final therefore replaces
                // its preview even when the provider revised the source text.
                if !source.is_empty() && !translation.is_empty() {
                    self.snapshot.preview_pair = None;
                }
                self.append_history_if_possible(source, translation);
            }
            SubtitleEvent::ConfirmedPair {
                utterance_id,
                source,
                translation,
            } => {
                if !self.is_new_confirmation_id(utterance_id) {
                    return;
                }
                let source = trim(&source);
                let translation = trim(&translation);
                if source.is_empty() || translation.is_empty() {
                    return;
                }
                self.last_confirmed_id = Some(utterance_id);
                self.source_draft_since_confirmation = false;
                self.snapshot.source = SubtitleLine::new(source.clone(), true);
                self.snapshot.translation = SubtitleLine::new(translation.clone(), true);
                self.snapshot.preview_pair = None;
                self.append_confirmed_history(source, translation, true);
            }
            SubtitleEvent::Clear => {
                self.archive.clear();
                self.snapshot = SubtitleSnapshot::empty();
                self.source_draft_since_confirmation = false;
                // Clearing the display is not a new generation. Keep its
                // watermark so a replay cannot restore explicitly cleared text.
            }
        }
    }

    /// Drops generation-local state while preserving confirmed history and any
    /// fully confirmed line still displayed: an unconfirmed line belongs to the
    /// connection that produced it.
    pub fn reset_transient(&mut self) {
        self.last_confirmed_id = None;
        self.snapshot.preview_pair = None;
        self.source_draft_since_confirmation = false;
        if !self.snapshot.source.is_final {
            self.snapshot.source = SubtitleLine::new("", false);
        }
        if !self.snapshot.translation.is_final {
            self.snapshot.translation = SubtitleLine::new("", false);
        }
    }

    fn append_history_if_possible(&mut self, source: String, translation: String) {
        if source.is_empty() || translation.is_empty() {
            return;
        }
        let new_recognition = std::mem::take(&mut self.source_draft_since_confirmation);
        self.append_confirmed_history(source, translation, new_recognition);
    }

    fn append_confirmed_history(
        &mut self,
        source: String,
        translation: String,
        is_new_utterance: bool,
    ) {
        if source.is_empty() || translation.is_empty() {
            return;
        }
        // Timestamps also identify the frontend's bounded history rows. Two
        // legitimate repeated finals can finish within one millisecond.
        let created_at_ms = self
            .snapshot
            .history
            .last()
            .map_or_else(now_epoch_ms, |last| {
                now_epoch_ms().max(last.created_at_ms.saturating_add(1))
            });
        let pair = SubtitlePair::new(source, translation, created_at_ms);
        if !is_new_utterance && self.snapshot.history.last() == Some(&pair) {
            return;
        }
        self.archive.append(&pair);
        self.snapshot.history.push(pair);
        if self.snapshot.history.len() > self.max_history_count {
            let overflow = self.snapshot.history.len() - self.max_history_count;
            self.snapshot.history.drain(0..overflow);
        }
    }
}

impl Default for SubtitleReducer {
    fn default() -> Self {
        Self::new(20)
    }
}

/// Trims leading and trailing Unicode whitespace.
pub(crate) fn trim(text: &str) -> String {
    text.trim().to_string()
}

/// Current wall-clock time as epoch milliseconds.
pub(crate) fn now_epoch_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::models::{SubtitleLine, SubtitlePair};

    fn confirmed(utterance_id: u64, text: &str) -> SubtitleEvent {
        SubtitleEvent::ConfirmedPair {
            utterance_id,
            source: text.into(),
            translation: text.into(),
        }
    }

    #[test]
    fn every_oversized_caption_preserves_complete_pair_and_confirmation_identity() {
        let mut reducer = SubtitleReducer::default();
        reducer.archive.begin(true, 0);
        reducer.apply(confirmed(1, "Synthetic final"));
        reducer.apply(SubtitleEvent::PreviewPair {
            source: "Synthetic complete preview".into(),
            translation: "Synthetic complete translation".into(),
        });
        let expected = reducer.snapshot.clone();
        let oversized = "x".repeat(crate::core::models::MAX_SUBTITLE_TEXT_BYTES + 1);
        let events = [
            SubtitleEvent::SourceDraft(oversized.clone()),
            SubtitleEvent::SourceFinal(oversized.clone()),
            SubtitleEvent::TranslationDraft(oversized.clone()),
            SubtitleEvent::TranslationFinal(oversized.clone()),
            SubtitleEvent::UtteranceText {
                utterance_id: "synthetic-id".into(),
                role: UtteranceRole::Source,
                text: oversized.clone(),
                is_final: false,
            },
            SubtitleEvent::UtteranceText {
                utterance_id: "synthetic-id".into(),
                role: UtteranceRole::Translation,
                text: oversized.clone(),
                is_final: true,
            },
            SubtitleEvent::PreviewPair {
                source: oversized.clone(),
                translation: "valid".into(),
            },
            SubtitleEvent::FinalPair {
                source: "valid".into(),
                translation: oversized.clone(),
            },
            SubtitleEvent::ConfirmedPair {
                utterance_id: 2,
                source: oversized.clone(),
                translation: "valid".into(),
            },
            SubtitleEvent::ConfirmedPair {
                utterance_id: 2,
                source: "valid".into(),
                translation: oversized,
            },
        ];
        for event in events {
            reducer.apply(event);
            assert_eq!(reducer.snapshot, expected);
            assert_eq!(reducer.archive.count(), 1);
        }
        let exact = "🙂".repeat(crate::core::models::MAX_SUBTITLE_TEXT_BYTES / 4);
        reducer.apply(confirmed(2, &exact));
        assert_eq!(reducer.snapshot.source.text, exact);
        assert_eq!(reducer.snapshot.history.len(), 2);
        assert_eq!(reducer.archive.count(), 2);
    }

    #[test]
    fn confirmed_identity_preserves_repeated_text_and_rejects_older_or_duplicate_ids() {
        let mut reducer = SubtitleReducer::new(2);
        reducer.archive.begin(true, 0);
        for id in [1, 2, 3] {
            reducer.apply(confirmed(id, "Synthetic repeated line"));
        }
        assert_eq!(reducer.snapshot.history.len(), 2);
        assert_eq!(reducer.archive.count(), 3);
        let snapshot = reducer.snapshot.clone();
        for id in [3, 1, 2] {
            reducer.apply(confirmed(id, "Stale synthetic revision"));
        }
        assert_eq!(reducer.snapshot, snapshot);
        assert_eq!(reducer.archive.count(), 3);
    }

    #[test]
    fn clear_keeps_identity_watermark_and_reconnect_resets_it_with_history_preserved() {
        let mut reducer = SubtitleReducer::default();
        reducer.apply(confirmed(9, "Synthetic line"));
        reducer.apply(SubtitleEvent::Clear);
        reducer.apply(confirmed(9, "Synthetic replay"));
        assert!(reducer.snapshot.history.is_empty());
        reducer.apply(confirmed(10, "New synthetic line"));
        assert_eq!(reducer.snapshot.history.len(), 1);
        reducer.reset_transient();
        reducer.apply(confirmed(0, "New generation synthetic line"));
        assert_eq!(reducer.snapshot.history.len(), 2);
    }

    #[test]
    fn empty_confirmation_does_not_claim_identity_and_wrapped_serials_remain_ordered() {
        let mut reducer = SubtitleReducer::default();
        reducer.apply(confirmed(u64::MAX, " \n"));
        reducer.apply(confirmed(u64::MAX, "Synthetic line"));
        reducer.apply(confirmed(1, "Synthetic line"));
        reducer.apply(confirmed(u64::MAX, "Obsolete line"));
        assert_eq!(reducer.snapshot.history.len(), 2);
        assert_eq!(reducer.snapshot.source.text, "Synthetic line");
    }

    #[test]
    fn opted_in_archive_outlives_overlay_history_and_excludes_drafts() {
        let mut reducer = SubtitleReducer::new(2);
        reducer.archive.begin(true, 0);
        reducer.apply(SubtitleEvent::SourceDraft("unconfirmed source".into()));
        reducer.apply(SubtitleEvent::TranslationDraft(
            "unconfirmed translation".into(),
        ));
        assert_eq!(reducer.archive.count(), 0);
        for i in 0..25 {
            reducer.apply(SubtitleEvent::FinalPair {
                source: format!("synthetic source {i}"),
                translation: format!("synthetic translation {i}"),
            });
        }
        assert_eq!(reducer.snapshot.history.len(), 2);
        assert_eq!(reducer.archive.count(), 25);
        reducer.reset_transient();
        assert_eq!(reducer.archive.count(), 25);
        reducer.apply(SubtitleEvent::Clear);
        assert_eq!(reducer.archive.count(), 0);
    }

    #[test]
    fn final_duplicates_and_empty_pairs_do_not_enter_archive() {
        let mut reducer = SubtitleReducer::default();
        reducer.archive.begin(true, 0);
        for _ in 0..2 {
            reducer.apply(SubtitleEvent::FinalPair {
                source: "synthetic".into(),
                translation: "test".into(),
            });
        }
        reducer.apply(SubtitleEvent::FinalPair {
            source: "".into(),
            translation: "test".into(),
        });
        assert_eq!(reducer.archive.count(), 1);
    }

    #[test]
    fn subtitle_reducer_starts_empty() {
        let reducer = SubtitleReducer::default();
        assert_eq!(reducer.snapshot, SubtitleSnapshot::empty());
    }

    #[test]
    fn drafts_remain_visibly_unconfirmed() {
        let mut reducer = SubtitleReducer::default();
        reducer.apply(SubtitleEvent::SourceDraft("Hello wor".into()));
        reducer.apply(SubtitleEvent::TranslationDraft("你好，世".into()));

        assert_eq!(
            reducer.snapshot.source,
            SubtitleLine::new("Hello wor", false)
        );
        assert_eq!(
            reducer.snapshot.translation,
            SubtitleLine::new("你好，世", false)
        );
    }

    #[test]
    fn a_complete_preview_survives_new_raw_drafts_without_pairing_them() {
        let mut reducer = SubtitleReducer::default();
        reducer.archive.begin(true, 0);
        reducer.apply(SubtitleEvent::SourceDraft("Old recognized source".into()));
        reducer.apply(SubtitleEvent::TranslationDraft(
            "Old raw translation".into(),
        ));
        let stable = PreviewSubtitlePair {
            source: "Old recognized source".into(),
            translation: "Complete translated preview".into(),
        };
        reducer.apply(SubtitleEvent::PreviewPair {
            source: stable.source.clone(),
            translation: stable.translation.clone(),
        });
        reducer.apply(SubtitleEvent::SourceDraft(
            "New recognition still growing".into(),
        ));
        reducer.apply(SubtitleEvent::TranslationDraft(String::new()));
        reducer.apply(SubtitleEvent::SourceFinal(
            "New recognition revised.".into(),
        ));

        assert_eq!(reducer.snapshot.preview_pair, Some(stable));
        assert_eq!(reducer.snapshot.source.text, "New recognition revised.");
        assert!(reducer.snapshot.translation.text.is_empty());
        assert!(reducer.snapshot.history.is_empty());
        assert_eq!(reducer.archive.count(), 0);
    }

    #[test]
    fn preview_pairs_replace_one_slot_without_rewinding_raw_asr_or_entering_history() {
        let mut reducer = SubtitleReducer::new(2);
        reducer.archive.begin(true, 0);
        reducer.apply(SubtitleEvent::SourceDraft("Latest ASR draft".into()));
        reducer.apply(SubtitleEvent::TranslationDraft("Latest raw draft".into()));
        for index in 0..2_000 {
            reducer.apply(SubtitleEvent::PreviewPair {
                source: format!("Earlier candidate {index}"),
                translation: format!("Completed preview {index}"),
            });
        }
        assert_eq!(
            reducer.snapshot.preview_pair,
            Some(PreviewSubtitlePair {
                source: "Earlier candidate 1999".into(),
                translation: "Completed preview 1999".into(),
            })
        );
        assert_eq!(reducer.snapshot.source.text, "Latest ASR draft");
        assert_eq!(reducer.snapshot.translation.text, "Latest raw draft");
        assert!(reducer.snapshot.history.is_empty());
        assert_eq!(reducer.archive.count(), 0);
    }

    #[test]
    fn empty_or_oversized_preview_pairs_keep_the_last_complete_pair() {
        let mut reducer = SubtitleReducer::default();
        let stable = PreviewSubtitlePair {
            source: "Stable source".into(),
            translation: "Stable translation".into(),
        };
        reducer.apply(SubtitleEvent::PreviewPair {
            source: stable.source.clone(),
            translation: stable.translation.clone(),
        });
        for (source, translation) in [
            (" \n\t".into(), "Translation".into()),
            ("Source".into(), " \n\t".into()),
            ("x".repeat(MAX_PREVIEW_TEXT_BYTES + 1), "Translation".into()),
            ("Source".into(), "字".repeat(MAX_PREVIEW_TEXT_BYTES / 3 + 1)),
        ] {
            reducer.apply(SubtitleEvent::PreviewPair {
                source,
                translation,
            });
            assert_eq!(reducer.snapshot.preview_pair, Some(stable.clone()));
        }
        assert!(reducer.snapshot.history.is_empty());
    }

    #[test]
    fn complete_preview_text_at_the_byte_limit_is_not_truncated() {
        let mut reducer = SubtitleReducer::default();
        let source = format!("{}a", "字".repeat(MAX_PREVIEW_TEXT_BYTES / 3));
        let translation = "🙂".repeat(MAX_PREVIEW_TEXT_BYTES / 4);
        assert_eq!(source.len(), MAX_PREVIEW_TEXT_BYTES);
        assert_eq!(translation.len(), MAX_PREVIEW_TEXT_BYTES);
        reducer.apply(SubtitleEvent::PreviewPair {
            source: source.clone(),
            translation: translation.clone(),
        });
        assert_eq!(
            reducer.snapshot.preview_pair,
            Some(PreviewSubtitlePair {
                source,
                translation
            })
        );
    }

    #[test]
    fn valid_final_boundaries_replace_the_preview_even_when_source_was_revised() {
        for final_event in [
            SubtitleEvent::FinalPair {
                source: "Corrected source.".into(),
                translation: "Confirmed translation.".into(),
            },
            SubtitleEvent::TranslationFinal("Confirmed translation.".into()),
            SubtitleEvent::UtteranceText {
                utterance_id: "confirmed-source".into(),
                role: UtteranceRole::Translation,
                text: "Confirmed translation.".into(),
                is_final: true,
            },
        ] {
            let mut reducer = SubtitleReducer::default();
            reducer.apply(SubtitleEvent::SourceFinal("Corrected source.".into()));
            reducer.apply(SubtitleEvent::PreviewPair {
                source: "Provisional source".into(),
                translation: "Provisional translation".into(),
            });
            reducer.apply(final_event);
            assert!(reducer.snapshot.preview_pair.is_none());
            assert_eq!(reducer.snapshot.history.len(), 1);
            assert_eq!(reducer.snapshot.history[0].source, "Corrected source.");
            assert_eq!(
                reducer.snapshot.history[0].translation,
                "Confirmed translation."
            );
        }
    }

    #[test]
    fn an_empty_final_cannot_erase_a_complete_preview_without_replacing_it() {
        let mut reducer = SubtitleReducer::default();
        let stable = PreviewSubtitlePair {
            source: "Stable source".into(),
            translation: "Stable translation".into(),
        };
        reducer.apply(SubtitleEvent::PreviewPair {
            source: stable.source.clone(),
            translation: stable.translation.clone(),
        });
        reducer.apply(SubtitleEvent::FinalPair {
            source: "Final source".into(),
            translation: " \n".into(),
        });
        assert_eq!(reducer.snapshot.preview_pair, Some(stable));
        assert!(reducer.snapshot.history.is_empty());
    }

    #[test]
    fn transient_reset_and_manual_clear_remove_the_preview_with_distinct_history_lifetimes() {
        let mut reducer = SubtitleReducer::default();
        reducer.archive.begin(true, 0);
        reducer.apply(SubtitleEvent::FinalPair {
            source: "Confirmed source".into(),
            translation: "Confirmed translation".into(),
        });
        reducer.apply(SubtitleEvent::PreviewPair {
            source: "Current source".into(),
            translation: "Current preview".into(),
        });
        reducer.reset_transient();
        assert!(reducer.snapshot.preview_pair.is_none());
        assert_eq!(reducer.snapshot.history.len(), 1);
        assert_eq!(reducer.archive.count(), 1);
        assert!(reducer.snapshot.source.is_final);
        reducer.apply(SubtitleEvent::PreviewPair {
            source: "Current source".into(),
            translation: "Current preview".into(),
        });
        reducer.apply(SubtitleEvent::Clear);
        assert_eq!(reducer.snapshot, SubtitleSnapshot::empty());
        assert_eq!(reducer.archive.count(), 0);
    }

    #[test]
    fn a_new_recognition_cycle_preserves_repeated_lyrics_but_duplicate_finals_stay_idempotent() {
        let mut reducer = SubtitleReducer::default();
        reducer.archive.begin(true, 0);
        for _ in 0..2 {
            reducer.apply(SubtitleEvent::SourceDraft("Repeated lyric".into()));
            // Revising one recognition cycle does not create several finals.
            reducer.apply(SubtitleEvent::SourceDraft("Repeated lyric".into()));
            for _ in 0..2 {
                reducer.apply(SubtitleEvent::FinalPair {
                    source: "Repeated lyric".into(),
                    translation: "Repeated translation".into(),
                });
            }
        }
        assert_eq!(reducer.snapshot.history.len(), 2);
        assert_eq!(reducer.archive.count(), 2);
        assert!(
            reducer.snapshot.history[0].created_at_ms < reducer.snapshot.history[1].created_at_ms
        );
    }

    #[test]
    fn blank_drafts_or_reset_cannot_rearm_a_duplicate_confirmation() {
        let mut reducer = SubtitleReducer::default();
        for _ in 0..2 {
            reducer.apply(SubtitleEvent::FinalPair {
                source: "Confirmed source".into(),
                translation: "Confirmed translation".into(),
            });
            reducer.apply(SubtitleEvent::SourceDraft(" \n".into()));
            reducer.apply(SubtitleEvent::TranslationDraft(
                "A translation update".into(),
            ));
        }
        assert_eq!(reducer.snapshot.history.len(), 1);
        reducer.apply(SubtitleEvent::SourceDraft("Confirmed source".into()));
        reducer.reset_transient();
        reducer.apply(SubtitleEvent::FinalPair {
            source: "Confirmed source".into(),
            translation: "Confirmed translation".into(),
        });
        assert_eq!(reducer.snapshot.history.len(), 1);
    }

    #[test]
    fn final_translation_creates_a_history_pair() {
        let mut reducer = SubtitleReducer::default();
        reducer.apply(SubtitleEvent::SourceFinal("Hello world.".into()));
        reducer.apply(SubtitleEvent::TranslationFinal("你好，世界。".into()));

        assert_eq!(
            reducer.snapshot.source,
            SubtitleLine::new("Hello world.", true)
        );
        assert_eq!(
            reducer.snapshot.translation,
            SubtitleLine::new("你好，世界。", true)
        );
        assert_eq!(
            reducer.snapshot.history,
            vec![SubtitlePair::new(
                "Hello world.".into(),
                "你好，世界。".into(),
                0
            )]
        );
    }

    #[test]
    fn an_atomic_final_pair_alone_enters_history() {
        let mut reducer = SubtitleReducer::default();
        reducer.apply(SubtitleEvent::SourceFinal("legacy pending".into()));
        reducer.apply(SubtitleEvent::FinalPair {
            source: "OpenAI source".into(),
            translation: "OpenAI translation".into(),
        });

        assert_eq!(reducer.snapshot.history.len(), 1);
        assert_eq!(reducer.snapshot.history[0].source, "OpenAI source");
        assert_eq!(
            reducer.snapshot.history[0].translation,
            "OpenAI translation"
        );
    }

    #[test]
    fn a_new_draft_keeps_confirmed_history_available() {
        let mut reducer = SubtitleReducer::default();
        reducer.apply(SubtitleEvent::SourceFinal("Hello.".into()));
        reducer.apply(SubtitleEvent::TranslationFinal("你好。".into()));
        reducer.apply(SubtitleEvent::SourceDraft("How are".into()));
        reducer.apply(SubtitleEvent::TranslationDraft("你最近".into()));

        assert_eq!(
            reducer.snapshot.history,
            vec![SubtitlePair::new("Hello.".into(), "你好。".into(), 0)]
        );
        assert_eq!(
            reducer.snapshot.translation,
            SubtitleLine::new("你最近", false)
        );
    }

    #[test]
    fn a_plus_final_replaces_its_preview_and_alone_enters_history() {
        let mut reducer = SubtitleReducer::default();
        reducer.apply(SubtitleEvent::SourceDraft("今日は晴れです".into()));
        reducer.apply(SubtitleEvent::TranslationDraft("今天晴天".into()));
        assert!(reducer.snapshot.history.is_empty());

        reducer.apply(SubtitleEvent::SourceFinal("今日は晴れです。".into()));
        reducer.apply(SubtitleEvent::TranslationFinal("今天天气很好。".into()));

        assert_eq!(
            reducer.snapshot.history,
            vec![SubtitlePair::new(
                "今日は晴れです。".into(),
                "今天天气很好。".into(),
                0
            )]
        );
        assert_eq!(
            reducer.snapshot.translation,
            SubtitleLine::new("今天天气很好。", true)
        );
    }

    #[test]
    fn a_late_final_translation_uses_the_recognition_line_on_screen() {
        let mut reducer = SubtitleReducer::default();
        reducer.apply(SubtitleEvent::SourceFinal("First sentence.".into()));
        reducer.apply(SubtitleEvent::SourceDraft("Second sentence".into()));
        reducer.apply(SubtitleEvent::TranslationFinal("第一句。".into()));

        assert_eq!(
            reducer.snapshot.history,
            vec![SubtitlePair::new(
                "Second sentence".into(),
                "第一句。".into(),
                0
            )]
        );
        assert_eq!(
            reducer.snapshot.source,
            SubtitleLine::new("Second sentence", false)
        );
    }

    #[test]
    fn duplicate_finals_do_not_duplicate_history() {
        let mut reducer = SubtitleReducer::default();
        reducer.apply(SubtitleEvent::SourceFinal("Hello.".into()));
        reducer.apply(SubtitleEvent::TranslationFinal("你好。".into()));
        reducer.apply(SubtitleEvent::TranslationFinal("你好。".into()));
        assert_eq!(reducer.snapshot.history.len(), 1);
    }

    #[test]
    fn identical_source_and_translation_remain_in_history() {
        let mut reducer = SubtitleReducer::default();
        reducer.apply(SubtitleEvent::SourceFinal("嗯啊".into()));
        reducer.apply(SubtitleEvent::TranslationFinal("嗯啊".into()));

        assert_eq!(
            reducer.snapshot.history,
            vec![SubtitlePair::new("嗯啊".into(), "嗯啊".into(), 0)]
        );
    }

    #[test]
    fn history_is_bounded() {
        let mut reducer = SubtitleReducer::new(2);
        for index in 1..=3 {
            reducer.apply(SubtitleEvent::SourceFinal(format!("source {index}")));
            reducer.apply(SubtitleEvent::TranslationFinal(format!(
                "translation {index}"
            )));
        }

        assert_eq!(
            reducer.snapshot.history,
            vec![
                SubtitlePair::new("source 2".into(), "translation 2".into(), 0),
                SubtitlePair::new("source 3".into(), "translation 3".into(), 0),
            ]
        );
    }

    #[test]
    fn recognition_finals_without_translations_never_enter_history() {
        let mut reducer = SubtitleReducer::new(2);
        reducer.apply(SubtitleEvent::SourceFinal("source 1".into()));
        reducer.apply(SubtitleEvent::SourceFinal("source 2".into()));
        reducer.apply(SubtitleEvent::SourceFinal("source 3".into()));

        assert!(reducer.snapshot.history.is_empty());
        assert_eq!(reducer.snapshot.source, SubtitleLine::new("source 3", true));

        reducer.apply(SubtitleEvent::TranslationFinal("late translation".into()));
        assert_eq!(
            reducer.snapshot.history,
            vec![SubtitlePair::new(
                "source 3".into(),
                "late translation".into(),
                0
            )]
        );
    }

    #[test]
    fn clear_resets_all_subtitle_state() {
        let mut reducer = SubtitleReducer::default();
        reducer.apply(SubtitleEvent::SourceFinal("Hello.".into()));
        reducer.apply(SubtitleEvent::TranslationFinal("你好。".into()));
        reducer.apply(SubtitleEvent::Clear);

        assert_eq!(reducer.snapshot, SubtitleSnapshot::empty());
    }

    #[test]
    fn reconnect_clears_unconfirmed_lines_before_a_late_translation_final() {
        let mut reducer = SubtitleReducer::default();
        reducer.apply(SubtitleEvent::SourceDraft("generation A".into()));

        reducer.reset_transient();
        assert_eq!(reducer.snapshot.source, SubtitleLine::new("", false));
        reducer.apply(SubtitleEvent::TranslationFinal("译文 A".into()));
        assert!(reducer.snapshot.history.is_empty());

        reducer.apply(SubtitleEvent::SourceFinal("generation B".into()));
        reducer.apply(SubtitleEvent::TranslationFinal("译文 B".into()));
        assert_eq!(
            reducer.snapshot.history,
            vec![SubtitlePair::new("generation B".into(), "译文 B".into(), 0)]
        );
    }

    #[test]
    fn blank_draft_does_not_overwrite_confirmed_final() {
        let mut reducer = SubtitleReducer::default();
        reducer.apply(SubtitleEvent::SourceFinal("Hello.".into()));
        reducer.apply(SubtitleEvent::TranslationFinal("你好。".into()));
        reducer.apply(SubtitleEvent::TranslationDraft("   ".into()));

        assert_eq!(
            reducer.snapshot.translation,
            SubtitleLine::new("你好。", true)
        );
    }

    #[test]
    fn stamped_text_keeps_one_utterance_identity_on_both_lines() {
        let mut reducer = SubtitleReducer::default();
        reducer.apply(SubtitleEvent::UtteranceText {
            utterance_id: "item_source".into(),
            role: UtteranceRole::Source,
            text: "Hello.".into(),
            is_final: true,
        });
        reducer.apply(SubtitleEvent::UtteranceText {
            utterance_id: "item_source".into(),
            role: UtteranceRole::Translation,
            text: "你好。".into(),
            is_final: false,
        });

        assert_eq!(
            reducer.snapshot.source.utterance_id.as_deref(),
            Some("item_source")
        );
        assert_eq!(
            reducer.snapshot.translation.utterance_id.as_deref(),
            Some("item_source")
        );
        assert!(reducer.snapshot.history.is_empty());

        reducer.apply(SubtitleEvent::UtteranceText {
            utterance_id: "item_source".into(),
            role: UtteranceRole::Translation,
            text: "你好。".into(),
            is_final: true,
        });
        assert_eq!(
            reducer.snapshot.history,
            vec![SubtitlePair::new("Hello.".into(), "你好。".into(), 0)]
        );
    }

    #[test]
    fn stamped_blank_draft_does_not_overwrite_confirmed_final() {
        let mut reducer = SubtitleReducer::default();
        reducer.apply(SubtitleEvent::UtteranceText {
            utterance_id: "item_source".into(),
            role: UtteranceRole::Translation,
            text: "你好。".into(),
            is_final: true,
        });
        reducer.apply(SubtitleEvent::UtteranceText {
            utterance_id: "item_source".into(),
            role: UtteranceRole::Translation,
            text: "   ".into(),
            is_final: false,
        });

        assert_eq!(
            reducer.snapshot.translation,
            SubtitleLine::for_utterance("你好。", true, "item_source".into())
        );
    }
}
