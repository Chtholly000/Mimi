//! Provider-neutral session state controller.

use crate::core::models::{DetectedLanguage, SessionStatus, SubtitleSnapshot, UtteranceRole};
use crate::core::protocols::live_translate::LiveTranslateServerEvent;
use crate::core::subtitle_reducer::SubtitleReducer;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TranslationSessionState {
    pub status: SessionStatus,
    pub subtitles: SubtitleSnapshot,
    pub detected_language: Option<DetectedLanguage>,
    pub is_translation_pending: bool,
    pub is_translation_preview_pending: bool,
    pub is_translation_timed_out: bool,
    pub translation_recovery: Option<crate::core::diagnostics::TranslationRecovery>,
}

impl Default for TranslationSessionState {
    fn default() -> Self {
        Self {
            status: SessionStatus::Idle,
            subtitles: SubtitleSnapshot::empty(),
            detected_language: None,
            is_translation_pending: false,
            is_translation_preview_pending: false,
            is_translation_timed_out: false,
            translation_recovery: None,
        }
    }
}

#[derive(Default)]
pub struct TranslationSessionController {
    pub state: TranslationSessionState,
    subtitle_reducer: SubtitleReducer,
    preview_pending_id: Option<u64>,
}

impl TranslationSessionController {
    pub fn accepts_confirmed_pair(
        &self,
        utterance_id: u64,
        source: &str,
        translation: &str,
    ) -> bool {
        !source.trim().is_empty()
            && !translation.trim().is_empty()
            && crate::core::models::subtitle_text_within_limit(source)
            && crate::core::models::subtitle_text_within_limit(translation)
            && self.subtitle_reducer.is_new_confirmation_id(utterance_id)
    }

    fn clear_preview_pending(&mut self) {
        self.preview_pending_id = None;
        self.state.is_translation_preview_pending = false;
    }

    pub fn archive(&self) -> &super::session_archive::TranscriptArchive {
        &self.subtitle_reducer.archive
    }
    pub fn archive_mut(&mut self) -> &mut super::session_archive::TranscriptArchive {
        &mut self.subtitle_reducer.archive
    }

    pub fn begin_connecting(&mut self) {
        self.clear_preview_pending();
        self.state.translation_recovery = None;
        self.subtitle_reducer.reset_transient();
        self.state.subtitles = self.subtitle_reducer.snapshot.clone();
        self.state.status = SessionStatus::Connecting;
        self.state.detected_language = None;
        self.state.is_translation_pending = false;
        self.state.is_translation_timed_out = false;
    }

    pub fn did_connect(&mut self) {
        self.clear_preview_pending();
        self.state.translation_recovery = None;
        self.state.status = SessionStatus::Listening;
    }

    pub fn did_pause(&mut self) {
        self.clear_preview_pending();
        self.state.translation_recovery = None;
        self.state.status = SessionStatus::Listening;
        self.state.is_translation_pending = false;
    }

    /// Marks the active translation as timed out and clears its
    /// waiting-for-final indicator without touching status or subtitles. The
    /// explicit timeout bit lets presentation distinguish an identical new
    /// utterance from the latest already-committed history pair.
    pub fn clear_translation_pending(&mut self) {
        self.state.is_translation_pending = false;
        self.state.is_translation_timed_out = true;
    }

    pub fn begin_stopping(&mut self) {
        self.clear_preview_pending();
        self.state.translation_recovery = None;
        self.state.status = SessionStatus::Stopping;
        self.state.is_translation_pending = false;
    }

    pub fn did_stop(&mut self) {
        self.clear_preview_pending();
        self.state.translation_recovery = None;
        self.state.status = SessionStatus::Idle;
        self.state.is_translation_pending = false;
        self.state.is_translation_timed_out = false;
    }

    pub fn did_fail(&mut self, message: impl Into<String>) {
        self.clear_preview_pending();
        self.state.translation_recovery = None;
        self.state.status = SessionStatus::Error(message.into());
        self.state.is_translation_pending = false;
    }

    pub fn clear_subtitles(&mut self) {
        self.clear_preview_pending();
        self.state.is_translation_pending = false;
        self.state.translation_recovery = None;
        self.subtitle_reducer
            .apply(crate::core::models::SubtitleEvent::Clear);
        self.state.subtitles = self.subtitle_reducer.snapshot.clone();
        self.state.is_translation_timed_out = false;
    }

    pub fn handle(&mut self, event: LiveTranslateServerEvent) {
        if !event.text_within_limit() {
            return;
        }
        // Alibaba teardown can emit synthetic source/translation cleanup
        // finals, which are intentionally ignored. OpenAI has no separate
        // final events: a real `session.closed` may flush one client-aligned
        // atomic pair, and that verified tail is safe to keep.
        if self.state.status == SessionStatus::Stopping
            && !matches!(
                event,
                LiveTranslateServerEvent::SubtitleFinalPair { .. }
                    | LiveTranslateServerEvent::SubtitleConfirmedPair { .. }
            )
        {
            return;
        }

        match event {
            LiveTranslateServerEvent::SessionCreated => {}
            LiveTranslateServerEvent::SessionUpdated => self.did_connect(),
            LiveTranslateServerEvent::SourceDraft { text, language } => {
                self.update_detected_language(language.as_deref());
                self.subtitle_reducer
                    .apply(crate::core::models::SubtitleEvent::SourceDraft(text));
            }
            LiveTranslateServerEvent::SourceUtteranceDraft {
                utterance_id,
                text,
                language,
            } => {
                self.update_detected_language(language.as_deref());
                self.subtitle_reducer.apply(
                    crate::core::models::SubtitleEvent::SourceUtteranceDraft { utterance_id, text },
                );
            }
            LiveTranslateServerEvent::SourceFinal { text, language }
            | LiveTranslateServerEvent::SourceUtteranceFinal { text, language, .. } => {
                self.update_detected_language(language.as_deref());
                self.subtitle_reducer
                    .apply(crate::core::models::SubtitleEvent::SourceFinal(text));
            }
            LiveTranslateServerEvent::TranslationStarted => {
                self.clear_preview_pending();
                self.state.translation_recovery = None;
                self.state.is_translation_pending = true;
                self.state.is_translation_timed_out = false;
            }
            LiveTranslateServerEvent::PreviewTranslationStarted { request_id } => {
                self.preview_pending_id = Some(request_id);
                self.state.is_translation_preview_pending = true;
                self.state.translation_recovery = None;
            }
            LiveTranslateServerEvent::PreviewTranslationFinished { request_id } => {
                if self.preview_pending_id == Some(request_id) {
                    self.clear_preview_pending();
                }
            }
            LiveTranslateServerEvent::TranslationDeferred(recovery) => {
                self.clear_preview_pending();
                self.state.translation_recovery = Some(recovery);
                self.state.is_translation_pending = false;
                self.state.is_translation_timed_out = false;
            }
            LiveTranslateServerEvent::TranslationDraft(text) => {
                if !text.trim().is_empty() {
                    self.state.translation_recovery = None;
                }
                self.subtitle_reducer
                    .apply(crate::core::models::SubtitleEvent::TranslationDraft(text));
            }
            LiveTranslateServerEvent::SubtitlePreviewPair {
                source_utterance_id,
                source,
                language,
                translation,
            } => {
                self.update_detected_language(language.as_deref());
                self.state.translation_recovery = None;
                self.subtitle_reducer
                    .apply(crate::core::models::SubtitleEvent::PreviewPair {
                        source_utterance_id,
                        source,
                        translation,
                    });
            }
            LiveTranslateServerEvent::SubtitlePreviewCleared => {
                self.clear_preview_pending();
                self.subtitle_reducer
                    .apply(crate::core::models::SubtitleEvent::ClearPreview);
            }
            LiveTranslateServerEvent::UtteranceText {
                utterance_id,
                role,
                text,
                is_final,
                language,
            } => {
                if role == UtteranceRole::Source {
                    self.update_detected_language(language.as_deref());
                }
                self.subtitle_reducer
                    .apply(crate::core::models::SubtitleEvent::UtteranceText {
                        utterance_id,
                        role,
                        text,
                        is_final,
                    });
            }
            LiveTranslateServerEvent::TranslationFinal(text) => {
                self.clear_preview_pending();
                self.state.translation_recovery = None;
                self.state.is_translation_pending = false;
                self.state.is_translation_timed_out = false;
                self.subtitle_reducer
                    .apply(crate::core::models::SubtitleEvent::TranslationFinal(text));
            }
            LiveTranslateServerEvent::SubtitleFinalPair {
                source,
                language,
                translation,
            } => {
                self.clear_preview_pending();
                self.state.translation_recovery = None;
                self.update_detected_language(language.as_deref());
                self.state.is_translation_pending = false;
                self.state.is_translation_timed_out = false;
                self.subtitle_reducer
                    .apply(crate::core::models::SubtitleEvent::FinalPair {
                        source,
                        translation,
                    });
            }
            LiveTranslateServerEvent::SubtitleConfirmedPair {
                utterance_id,
                source_utterance_id,
                source,
                language,
                translation,
            } => {
                if !self.accepts_confirmed_pair(utterance_id, &source, &translation) {
                    return;
                }
                self.clear_preview_pending();
                self.state.translation_recovery = None;
                self.update_detected_language(language.as_deref());
                self.state.is_translation_pending = false;
                self.state.is_translation_timed_out = false;
                self.subtitle_reducer
                    .apply(crate::core::models::SubtitleEvent::ConfirmedPair {
                        utterance_id,
                        source_utterance_id,
                        source,
                        translation,
                    });
            }
            LiveTranslateServerEvent::SessionFinished => self.did_stop(),
            LiveTranslateServerEvent::Error { message, .. } => self.did_fail(message),
            LiveTranslateServerEvent::Ignored { .. } => return,
        }

        self.state.subtitles = self.subtitle_reducer.snapshot.clone();
    }

    fn update_detected_language(&mut self, reported_language: Option<&str>) {
        if let Some(language) = DetectedLanguage::from_reported(reported_language) {
            self.state.detected_language = Some(language);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replayed_confirmation_cannot_clear_pending_work_or_rewind_a_live_pair() {
        let mut controller = TranslationSessionController::default();
        let replay = LiveTranslateServerEvent::SubtitleConfirmedPair {
            source_utterance_id: None,
            utterance_id: 1,
            source: "Synthetic final".into(),
            language: Some("en".into()),
            translation: "Synthetic final translation".into(),
        };
        controller.handle(replay.clone());
        controller.handle(LiveTranslateServerEvent::SubtitlePreviewPair {
            source_utterance_id: None,
            source: "New synthetic source".into(),
            language: Some("ja".into()),
            translation: "New synthetic translation".into(),
        });
        controller.handle(LiveTranslateServerEvent::TranslationStarted);
        let expected = controller.state.clone();
        controller.handle(replay);
        assert_eq!(controller.state, expected);
        controller.handle(LiveTranslateServerEvent::SubtitleConfirmedPair {
            source_utterance_id: None,
            utterance_id: 2,
            source: " ".into(),
            language: Some("en".into()),
            translation: "Synthetic incomplete result".into(),
        });
        assert_eq!(controller.state, expected);
    }

    #[test]
    fn oversized_events_cannot_clear_pending_recovery_or_claim_a_confirmation() {
        let mut controller = TranslationSessionController::default();
        controller.handle(LiveTranslateServerEvent::SubtitlePreviewPair {
            source_utterance_id: None,
            source: "Synthetic complete source".into(),
            language: Some("ja".into()),
            translation: "Synthetic complete translation".into(),
        });
        controller.handle(LiveTranslateServerEvent::TranslationStarted);
        controller.handle(LiveTranslateServerEvent::PreviewTranslationStarted { request_id: 7 });
        controller.state.translation_recovery =
            Some(crate::core::diagnostics::TranslationRecovery {
                reason: crate::core::diagnostics::TranslationRecoveryReason::RateLimited,
                retry_after_ms: 4_000,
                retry_scheduled: true,
            });
        let expected = controller.state.clone();
        let oversized = "x".repeat(crate::core::models::MAX_SUBTITLE_TEXT_BYTES + 1);
        for event in [
            LiveTranslateServerEvent::SourceUtteranceFinal {
                utterance_id: 1,
                text: oversized.clone(),
                language: Some("en".into()),
            },
            LiveTranslateServerEvent::TranslationDraft(oversized.clone()),
            LiveTranslateServerEvent::SubtitleConfirmedPair {
                source_utterance_id: None,
                utterance_id: 1,
                source: "valid".into(),
                language: Some("en".into()),
                translation: oversized,
            },
        ] {
            controller.handle(event);
            assert_eq!(controller.state, expected);
        }
        controller.handle(LiveTranslateServerEvent::SubtitleConfirmedPair {
            source_utterance_id: None,
            utterance_id: 1,
            source: "Synthetic valid final".into(),
            language: Some("en".into()),
            translation: "Synthetic valid translation".into(),
        });
        assert_eq!(controller.state.subtitles.history.len(), 1);
        assert!(!controller.state.is_translation_pending);
        assert!(!controller.state.is_translation_preview_pending);
    }

    #[test]
    fn preview_http_pending_is_owner_matched_and_does_not_change_final_pairing() {
        let mut controller = TranslationSessionController::default();
        controller.did_connect();
        controller.handle(LiveTranslateServerEvent::PreviewTranslationStarted { request_id: 1 });
        assert!(controller.state.is_translation_preview_pending);
        assert!(!controller.state.is_translation_pending);
        controller.handle(LiveTranslateServerEvent::SourceDraft {
            text: "Synthetic source".into(),
            language: Some("en".into()),
        });
        controller.handle(LiveTranslateServerEvent::TranslationDraft(
            "Synthetic partial".into(),
        ));
        assert!(controller.state.is_translation_preview_pending);
        assert!(controller.state.subtitles.history.is_empty());
        controller.handle(LiveTranslateServerEvent::PreviewTranslationStarted { request_id: 2 });
        controller.handle(LiveTranslateServerEvent::PreviewTranslationFinished { request_id: 1 });
        assert!(controller.state.is_translation_preview_pending);
        controller.clear_translation_pending();
        assert!(controller.state.is_translation_preview_pending);
        controller.handle(LiveTranslateServerEvent::PreviewTranslationFinished { request_id: 2 });
        assert!(!controller.state.is_translation_preview_pending);
        assert!(!controller.state.is_translation_pending);
        assert!(controller.state.subtitles.history.is_empty());
    }

    #[test]
    fn preview_cleanup_cannot_clear_a_final_and_final_start_clears_old_preview() {
        let mut controller = TranslationSessionController::default();
        controller.handle(LiveTranslateServerEvent::PreviewTranslationStarted { request_id: 1 });
        controller.handle(LiveTranslateServerEvent::TranslationStarted);
        assert!(!controller.state.is_translation_preview_pending);
        assert!(controller.state.is_translation_pending);
        controller.handle(LiveTranslateServerEvent::PreviewTranslationFinished { request_id: 1 });
        assert!(controller.state.is_translation_pending);
        controller.handle(LiveTranslateServerEvent::PreviewTranslationStarted { request_id: 2 });
        controller.handle(LiveTranslateServerEvent::PreviewTranslationFinished { request_id: 2 });
        assert!(!controller.state.is_translation_preview_pending);
        assert!(controller.state.is_translation_pending);
    }

    #[test]
    fn preview_pending_is_cleared_on_each_session_lifecycle_boundary() {
        let boundaries: [fn(&mut TranslationSessionController); 6] = [
            TranslationSessionController::begin_connecting,
            TranslationSessionController::did_connect,
            TranslationSessionController::did_pause,
            TranslationSessionController::begin_stopping,
            TranslationSessionController::did_stop,
            |controller| controller.did_fail("synthetic failure"),
        ];
        for boundary in boundaries {
            let mut controller = TranslationSessionController::default();
            controller
                .handle(LiveTranslateServerEvent::PreviewTranslationStarted { request_id: 1 });
            boundary(&mut controller);
            assert!(!controller.state.is_translation_preview_pending);
            assert!(controller.preview_pending_id.is_none());
        }
    }

    #[test]
    fn translation_backoff_is_nonterminal_and_lifecycle_or_valid_text_clears_it() {
        use crate::core::diagnostics::{TranslationRecovery, TranslationRecoveryReason};
        let recovery = TranslationRecovery {
            reason: TranslationRecoveryReason::RateLimited,
            retry_after_ms: 4_000,
            retry_scheduled: true,
        };
        let mut controller = TranslationSessionController::default();
        controller.did_connect();
        controller.handle(LiveTranslateServerEvent::TranslationStarted);
        controller.handle(LiveTranslateServerEvent::TranslationDeferred(recovery));
        assert_eq!(controller.state.status, SessionStatus::Listening);
        assert!(controller.state.status.is_active());
        assert!(!controller.state.is_translation_pending);
        assert!(!controller.state.is_translation_timed_out);
        assert_eq!(controller.state.translation_recovery, Some(recovery));
        let idle_recovery = TranslationRecovery {
            retry_scheduled: false,
            ..recovery
        };
        controller.handle(LiveTranslateServerEvent::TranslationDeferred(idle_recovery));
        controller.handle(LiveTranslateServerEvent::SourceDraft {
            text: "recognition keeps running without a scheduled retry".into(),
            language: Some("en".into()),
        });
        assert_eq!(controller.state.translation_recovery, Some(idle_recovery));
        assert_eq!(controller.state.status, SessionStatus::Listening);
        assert!(!controller.state.is_translation_pending);
        controller.handle(LiveTranslateServerEvent::TranslationDeferred(recovery));
        controller.handle(LiveTranslateServerEvent::SourceDraft {
            text: "new synthetic recognition".into(),
            language: Some("en".into()),
        });
        assert_eq!(controller.state.translation_recovery, Some(recovery));
        controller.handle(LiveTranslateServerEvent::TranslationDraft(
            "valid synthetic preview".into(),
        ));
        assert_eq!(controller.state.translation_recovery, None);
        for finish in [
            TranslationSessionController::did_pause,
            TranslationSessionController::begin_stopping,
            TranslationSessionController::did_stop,
            TranslationSessionController::begin_connecting,
        ] {
            controller.handle(LiveTranslateServerEvent::TranslationDeferred(recovery));
            finish(&mut controller);
            assert_eq!(controller.state.translation_recovery, None);
        }
        controller.did_connect();
        controller.handle(LiveTranslateServerEvent::TranslationDeferred(recovery));
        controller.handle(LiveTranslateServerEvent::TranslationStarted);
        assert_eq!(controller.state.translation_recovery, None);
        controller.handle(LiveTranslateServerEvent::TranslationDeferred(recovery));
        controller.did_fail("credential_authentication_failed");
        assert_eq!(controller.state.translation_recovery, None);
        assert!(!controller.state.status.is_active());
    }

    #[test]
    fn session_follows_the_happy_path_lifecycle() {
        let mut controller = TranslationSessionController::default();

        controller.begin_connecting();
        assert_eq!(controller.state.status, SessionStatus::Connecting);

        controller.did_connect();
        assert_eq!(controller.state.status, SessionStatus::Listening);

        controller.begin_stopping();
        assert_eq!(controller.state.status, SessionStatus::Stopping);

        controller.did_stop();
        assert_eq!(controller.state.status, SessionStatus::Idle);
    }

    #[test]
    fn server_events_update_subtitle_state() {
        let mut controller = TranslationSessionController::default();
        controller.handle(LiveTranslateServerEvent::SourceDraft {
            text: "Hello wor".into(),
            language: Some("en".into()),
        });
        controller.handle(LiveTranslateServerEvent::TranslationDraft(
            "你好，世".into(),
        ));

        assert_eq!(controller.state.subtitles.source.text, "Hello wor");
        assert!(!controller.state.subtitles.source.is_final);
        assert_eq!(controller.state.subtitles.translation.text, "你好，世");

        controller.handle(LiveTranslateServerEvent::SourceFinal {
            text: "Hello world.".into(),
            language: Some("en".into()),
        });
        controller.handle(LiveTranslateServerEvent::TranslationFinal(
            "你好，世界。".into(),
        ));

        assert_eq!(controller.state.subtitles.history.len(), 1);
        assert!(controller.state.subtitles.translation.is_final);
        assert_eq!(
            controller.state.detected_language.as_ref().unwrap().code,
            "en"
        );
    }

    #[test]
    fn a_new_connection_clears_the_previously_detected_language() {
        let mut controller = TranslationSessionController::default();
        controller.handle(LiveTranslateServerEvent::SourceDraft {
            text: "こんにちは".into(),
            language: Some("ja".into()),
        });
        assert_eq!(
            controller.state.detected_language.as_ref().unwrap().code,
            "ja"
        );

        controller.begin_connecting();
        assert_eq!(controller.state.detected_language, None);
    }

    #[test]
    fn service_errors_move_the_session_to_error() {
        let mut controller = TranslationSessionController::default();
        controller.begin_connecting();
        controller.handle(LiveTranslateServerEvent::Error {
            code: "invalid_value".into(),
            message: "Bad language".into(),
        });

        assert_eq!(
            controller.state.status,
            SessionStatus::Error("Bad language".into())
        );
    }

    #[test]
    fn translation_activity_follows_the_real_plus_request_lifecycle() {
        let mut controller = TranslationSessionController::default();
        controller.did_connect();

        controller.handle(LiveTranslateServerEvent::TranslationStarted);
        assert!(controller.state.is_translation_pending);

        controller.handle(LiveTranslateServerEvent::TranslationFinal(
            "翻译完成。".into(),
        ));
        assert!(!controller.state.is_translation_pending);

        controller.handle(LiveTranslateServerEvent::TranslationStarted);
        controller.did_fail("Request failed");
        assert!(!controller.state.is_translation_pending);
    }

    #[test]
    fn pausing_clears_translation_activity_without_discarding_subtitles() {
        let mut controller = TranslationSessionController::default();
        controller.did_connect();
        controller.handle(LiveTranslateServerEvent::SourceFinal {
            text: "Please wait.".into(),
            language: Some("en".into()),
        });
        controller.handle(LiveTranslateServerEvent::TranslationFinal(
            "请稍等。".into(),
        ));
        controller.handle(LiveTranslateServerEvent::TranslationStarted);
        let subtitles_before_pause = controller.state.subtitles.clone();

        controller.did_pause();

        assert_eq!(controller.state.status, SessionStatus::Listening);
        assert!(!controller.state.is_translation_pending);
        assert_eq!(controller.state.subtitles, subtitles_before_pause);
    }

    #[test]
    fn clearing_translation_pending_keeps_status_and_subtitles() {
        let mut controller = TranslationSessionController::default();
        controller.did_connect();
        controller.handle(LiveTranslateServerEvent::SourceFinal {
            text: "Hello.".into(),
            language: Some("en".into()),
        });
        controller.handle(LiveTranslateServerEvent::TranslationStarted);
        assert!(controller.state.is_translation_pending);
        let subtitles_before = controller.state.subtitles.clone();

        // The timeout guard clears only the waiting-for-final flag.
        controller.clear_translation_pending();

        assert_eq!(controller.state.status, SessionStatus::Listening);
        assert!(!controller.state.is_translation_pending);
        assert!(controller.state.is_translation_timed_out);
        assert_eq!(controller.state.subtitles, subtitles_before);

        controller.handle(LiveTranslateServerEvent::TranslationStarted);
        assert!(!controller.state.is_translation_timed_out);
    }

    #[test]
    fn clearing_subtitles_does_not_change_session_status() {
        let mut controller = TranslationSessionController::default();
        controller.did_connect();
        controller.handle(LiveTranslateServerEvent::SourceFinal {
            text: "Hello.".into(),
            language: Some("en".into()),
        });
        controller.handle(LiveTranslateServerEvent::TranslationFinal("你好。".into()));

        controller.clear_subtitles();

        assert_eq!(controller.state.status, SessionStatus::Listening);
        assert_eq!(controller.state.subtitles, SubtitleSnapshot::empty());
    }

    #[test]
    fn clear_resets_pending_work_without_stopping_and_new_preview_remains_owned() {
        let mut controller = TranslationSessionController::default();
        controller.did_connect();
        controller.handle(LiveTranslateServerEvent::TranslationStarted);
        controller.handle(LiveTranslateServerEvent::PreviewTranslationStarted { request_id: 1 });
        controller.state.is_translation_timed_out = true;
        controller.state.translation_recovery =
            Some(crate::core::diagnostics::TranslationRecovery {
                reason: crate::core::diagnostics::TranslationRecoveryReason::RateLimited,
                retry_after_ms: 4_000,
                retry_scheduled: true,
            });
        controller.clear_subtitles();
        assert_eq!(controller.state.status, SessionStatus::Listening);
        assert!(!controller.state.is_translation_pending);
        assert!(!controller.state.is_translation_preview_pending);
        assert!(!controller.state.is_translation_timed_out);
        assert!(controller.state.translation_recovery.is_none());
        controller.handle(LiveTranslateServerEvent::PreviewTranslationStarted { request_id: 2 });
        controller.handle(LiveTranslateServerEvent::PreviewTranslationFinished { request_id: 1 });
        assert!(controller.state.is_translation_preview_pending);
        controller.handle(LiveTranslateServerEvent::PreviewTranslationFinished { request_id: 2 });
        assert!(!controller.state.is_translation_preview_pending);
    }

    #[test]
    fn stopping_ignores_flushed_tail_subtitles() {
        let mut controller = TranslationSessionController::default();
        controller.did_connect();
        controller.handle(LiveTranslateServerEvent::SourceFinal {
            text: "Last real line.".into(),
            language: Some("en".into()),
        });
        controller.handle(LiveTranslateServerEvent::TranslationFinal(
            "最后一句正常字幕。".into(),
        ));
        let subtitles_before_stopping = controller.state.subtitles.clone();

        controller.begin_stopping();
        controller.handle(LiveTranslateServerEvent::SourceFinal {
            text: "Translation mode ended.".into(),
            language: Some("en".into()),
        });
        controller.handle(LiveTranslateServerEvent::TranslationFinal(
            "翻译模式已结束。".into(),
        ));
        controller.handle(LiveTranslateServerEvent::SessionFinished);

        assert_eq!(controller.state.status, SessionStatus::Stopping);
        assert_eq!(controller.state.subtitles, subtitles_before_stopping);
    }

    #[test]
    fn stopping_accepts_a_provider_confirmed_atomic_tail_pair() {
        let mut controller = TranslationSessionController::default();
        controller.did_connect();
        controller.begin_stopping();

        controller.handle(LiveTranslateServerEvent::SubtitleFinalPair {
            source: "Confirmed tail".into(),
            language: Some("en".into()),
            translation: "已确认的尾句".into(),
        });

        assert_eq!(controller.state.status, SessionStatus::Stopping);
        assert_eq!(controller.state.subtitles.history.len(), 1);
        assert_eq!(
            controller.state.subtitles.history[0].source,
            "Confirmed tail"
        );
        assert_eq!(
            controller.state.subtitles.history[0].translation,
            "已确认的尾句"
        );
    }

    #[test]
    fn unknown_server_events_leave_state_unchanged() {
        let mut controller = TranslationSessionController::default();
        let before = controller.state.clone();
        controller.handle(LiveTranslateServerEvent::Ignored {
            kind: "response.created".into(),
        });
        assert_eq!(controller.state, before);
    }

    #[test]
    fn atomic_pair_updates_history_and_detected_language_together() {
        let mut controller = TranslationSessionController::default();
        controller.did_connect();
        controller.handle(LiveTranslateServerEvent::SubtitleFinalPair {
            source: "Hello.".into(),
            language: Some("en".into()),
            translation: "你好。".into(),
        });

        assert_eq!(controller.state.subtitles.history.len(), 1);
        assert_eq!(controller.state.subtitles.history[0].source, "Hello.");
        assert_eq!(controller.state.subtitles.history[0].translation, "你好。");
        assert_eq!(
            controller
                .state
                .detected_language
                .as_ref()
                .map(|value| value.code.as_str()),
            Some("en")
        );
    }

    #[test]
    fn stamped_utterance_text_reaches_the_snapshot_with_its_identity() {
        let mut controller = TranslationSessionController::default();
        controller.did_connect();
        controller.handle(LiveTranslateServerEvent::UtteranceText {
            utterance_id: "item_source".into(),
            role: UtteranceRole::Source,
            text: "Hello.".into(),
            is_final: true,
            language: Some("en".into()),
        });
        controller.handle(LiveTranslateServerEvent::UtteranceText {
            utterance_id: "item_source".into(),
            role: UtteranceRole::Translation,
            text: "你好。".into(),
            is_final: false,
            language: None,
        });

        assert_eq!(
            controller.state.subtitles.source.utterance_id.as_deref(),
            Some("item_source")
        );
        assert_eq!(
            controller
                .state
                .subtitles
                .translation
                .utterance_id
                .as_deref(),
            Some("item_source")
        );
        assert_eq!(
            controller
                .state
                .detected_language
                .as_ref()
                .map(|value| value.code.as_str()),
            Some("en")
        );
    }
}
