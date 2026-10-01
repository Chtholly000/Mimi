//! A fixed, content-free support snapshot. Never accept logs, endpoint URLs,
//! profile/device names, paths, credentials, or subtitle content as inputs.
use crate::core::models::TranslationMode;
use crate::core::provider::ProviderKind;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupportIssue {
    pub url: String,
    pub report: String,
    pub requires_paste: bool,
}

/// Fixed destination and typed facts only; never accept a frontend URL/body.
pub fn issue_link(facts: DiagnosticFacts) -> SupportIssue {
    let report = render(facts);
    let body = format!("## What happened?\nPlease describe what you expected and what happened. Review this public report before submitting.\n\n## Safe diagnostics\n```json\n{report}\n```\n\nRefs #74, #75\n");
    let mut url = url::Url::parse("https://github.com/yuxino/mimi/issues/new").unwrap();
    url.query_pairs_mut()
        .append_pair("title", "Mimi troubleshooting report")
        .append_pair("body", &body);
    let requires_paste = url.as_str().len() > 6000;
    if requires_paste {
        url.set_query(None);
        url.query_pairs_mut().append_pair("title", "Mimi troubleshooting report").append_pair("body", "## What happened?\nDescribe the problem.\n\n## Safe diagnostics\nPaste the diagnostic snapshot copied from Mimi here. Review before submitting.\n\nRefs #74, #75\n");
    }
    SupportIssue {
        url: url.into(),
        report,
        requires_paste,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RecoveryAction {
    Retrying,
    Recovered,
    RetriesExhausted,
    UserStopped,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct SafeFailure {
    phase: &'static str,
    category: &'static str,
    code: &'static str,
}

impl SafeFailure {
    pub fn from_error(error: &str) -> Self {
        let unknown = Self {
            phase: "unknown",
            category: "unknown",
            code: "OTHER",
        };
        if error.len() > 128 {
            return unknown;
        }
        if error == "credential_authentication_failed" {
            return Self {
                phase: "unknown",
                category: "authentication",
                code: "AUTHENTICATION_FAILED",
            };
        }
        let storage_code = match error {
            "credential_store_unavailable" => Some("CREDENTIAL_STORE_UNAVAILABLE"),
            "credential_service_unavailable" => Some("CREDENTIAL_SERVICE_UNAVAILABLE"),
            "credential_store_access_denied" => Some("CREDENTIAL_STORE_ACCESS_DENIED"),
            _ => None,
        };
        if let Some(code) = storage_code {
            return Self {
                phase: "setup",
                category: "credential_storage",
                code,
            };
        }
        if error == "The selected sound output is unavailable. Stop subtitles and choose another sound source in Settings." { return Self { phase: "capture_setup", category: "device_unavailable", code: "OUTPUT_UNAVAILABLE" }; }
        let mut parts = error.split('.');
        if parts.next() != Some("audio3_error") {
            return unknown;
        }
        let phase = match parts.next() {
            Some("setup") => "asr_setup",
            Some("recognition") => "asr_recognition",
            Some("connection") => "websocket_connection",
            _ => return unknown,
        };
        let category = match parts.next() {
            Some("timeout") => "timeout",
            Some("authentication") => "authentication",
            Some("request") => "request_rejected",
            Some("service") => "service_error",
            Some("rate_limit") => "rate_limit",
            Some("task_failed") => "unknown",
            _ => return unknown,
        };
        let code = match parts.next() {
            Some("CLIENT_ERROR") => "CLIENT_ERROR",
            Some("SERVER_ERROR") => "SERVER_ERROR",
            Some("INVALID_API_KEY") => "INVALID_API_KEY",
            Some("UNAUTHORIZED") => "UNAUTHORIZED",
            Some("REQUEST_TIMEOUT") => "REQUEST_TIMEOUT",
            Some("THROTTLED") => "THROTTLED",
            Some("LOCAL_TIMEOUT") => "LOCAL_TIMEOUT",
            Some("HTTP_AUTH") => "HTTP_AUTH",
            Some("OTHER") => "OTHER",
            _ => return unknown,
        };
        if parts.next().is_some() {
            return unknown;
        }
        Self {
            phase,
            category,
            code,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Serialize)]
pub struct CaptureObservation {
    pub pcm_data_recent: bool,
    pub sound_recent: bool,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticStatus {
    Idle,
    Connecting,
    Stopping,
    Listening,
    Paused,
    Error,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OutputSelection {
    #[cfg(any(target_os = "windows", test))]
    SystemDefault,
    #[cfg(any(target_os = "windows", test))]
    ManualOutput,
    PlatformSystemAudio,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Availability {
    #[cfg(any(target_os = "windows", test))]
    Available,
    #[cfg(any(target_os = "windows", test))]
    Unavailable,
    Unknown,
}

pub struct DiagnosticFacts {
    pub provider: Option<ProviderKind>,
    pub mode: TranslationMode,
    pub status: DiagnosticStatus,
    pub output_selection: OutputSelection,
    pub output_availability: Availability,
    pub capture: Option<(CaptureObservation, u64)>,
    pub translation_pending: bool,
    pub translation_timed_out: bool,
    pub last_error: Option<(SafeFailure, u64)>,
    pub recovery: Option<(RecoveryAction, u64)>,
    pub elapsed_ms: u64,
}

impl Default for DiagnosticFacts {
    fn default() -> Self {
        Self {
            provider: None,
            mode: TranslationMode::LowLatency,
            status: DiagnosticStatus::Idle,
            output_selection: OutputSelection::PlatformSystemAudio,
            output_availability: Availability::Unknown,
            capture: None,
            translation_pending: false,
            translation_timed_out: false,
            last_error: None,
            recovery: None,
            elapsed_ms: 0,
        }
    }
}

pub fn render(facts: DiagnosticFacts) -> String {
    let report = serde_json::json!({
        "schema": "mimi.support.v1",
        "app_version": env!("CARGO_PKG_VERSION"),
        "os": { "family": std::env::consts::OS, "architecture": std::env::consts::ARCH, "version": "unknown" },
        "snapshot": { "elapsed_since_app_start_ms": facts.elapsed_ms, "consistency": "best_effort_observations", "audio_recent_window_ms": 2000 },
        "provider": facts.provider,
        "mode": facts.mode,
        "session_status": facts.status,
        "capture": { "output_selection": facts.output_selection, "output_availability": facts.output_availability,
            "observation": facts.capture.map(|(observation, age)| serde_json::json!({ "pcm_data_recent": observation.pcm_data_recent, "sound_recent": observation.sound_recent, "observation_age_ms": age })) },
        "service": { "websocket_stage": "unknown", "asr_stage": "unknown", "last_failure_stage": facts.last_error.map(|(error, _)| error.phase),
            "translation_pending": facts.translation_pending, "translation_timed_out": facts.translation_timed_out },
        "last_error": facts.last_error.map(|(error, age)| serde_json::json!({ "classification": error, "observed_ago_ms": age })),
        "recent_recovery": facts.recovery.map(|(action, age)| serde_json::json!({ "action": action, "observed_ago_ms": age })),
        "unknown": ["root_cause", "app_output_route", "device_display_name", "os_version", "live_service_internals"],
        "interpretation": "Observations do not prove incorrect device selection, speech presence, or the cause of a provider failure. Null means not observed.",
        "excluded": ["credentials", "tokens", "audio", "subtitle_text", "endpoint_urls", "usernames", "paths", "raw_provider_responses", "raw_logs"]
    });
    serde_json::to_string_pretty(&report).expect("fixed diagnostic schema serializes")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn issue_link_has_a_fixed_public_destination_and_only_safe_facts() {
        let issue = issue_link(DiagnosticFacts {
            last_error: Some((
                SafeFailure::from_error(
                    "private-token /Users/private https://private.invalid original-text",
                ),
                7,
            )),
            ..Default::default()
        });
        let url = url::Url::parse(&issue.url).unwrap();
        assert_eq!(url.host_str(), Some("github.com"));
        assert_eq!(url.path(), "/yuxino/mimi/issues/new");
        assert!(issue.url.len() <= 6000);
        let body = url.query_pairs().find(|(key, _)| key == "body").unwrap().1;
        assert!(body.contains(&issue.report));
        for secret in [
            "private-token",
            "/Users/private",
            "private.invalid",
            "original-text",
        ] {
            assert!(!body.contains(secret));
        }
        assert!(body.contains("before submitting"));
        assert!(!issue.requires_paste);
    }

    #[test]
    fn windows_output_categories_are_values_not_private_names() {
        for (selection, availability) in [
            (OutputSelection::SystemDefault, Availability::Available),
            (OutputSelection::ManualOutput, Availability::Unavailable),
        ] {
            let report = render(DiagnosticFacts {
                output_selection: selection,
                output_availability: availability,
                ..Default::default()
            });
            assert!(report.contains("output_selection"));
        }
    }

    #[test]
    fn unknown_and_oversized_errors_cannot_leak_into_reports() {
        let marker =
            "synthetic-secret /Users/private audio-words https://private.invalid/api?token=secret";
        for error in [
            marker.to_string(),
            marker.repeat(10000),
            "audio3_error.recognition.timeout.private-token".into(),
            "audio3_error.recognition.timeout.CLIENT_ERROR.private-text".into(),
        ] {
            let report = render(DiagnosticFacts {
                last_error: Some((SafeFailure::from_error(&error), 0)),
                ..Default::default()
            });
            for excluded in [
                "synthetic-secret",
                "/Users/private",
                "audio-words",
                "https://private",
                "private-token",
                "private-text",
            ] {
                assert!(!report.contains(excluded));
            }
            assert!(report.len() < 4096);
        }
    }

    #[test]
    fn missing_state_is_unknown_and_timeout_does_not_assert_wrong_output() {
        let report = render(DiagnosticFacts::default());
        let json: serde_json::Value = serde_json::from_str(&report).unwrap();
        assert_eq!(json["capture"]["observation"], serde_json::Value::Null);
        assert_eq!(json["os"]["version"], "unknown");
        let error = SafeFailure::from_error("audio3_error.recognition.timeout.CLIENT_ERROR");
        assert_eq!(error.phase, "asr_recognition");
        assert_eq!(error.category, "timeout");
        assert_ne!(error.category, "device_unavailable");
    }

    #[test]
    fn credential_storage_categories_use_fixed_content_free_codes() {
        for (label, code) in [
            (
                "credential_store_unavailable",
                "CREDENTIAL_STORE_UNAVAILABLE",
            ),
            (
                "credential_service_unavailable",
                "CREDENTIAL_SERVICE_UNAVAILABLE",
            ),
            (
                "credential_store_access_denied",
                "CREDENTIAL_STORE_ACCESS_DENIED",
            ),
        ] {
            let failure = SafeFailure::from_error(label);
            assert_eq!(failure.phase, "setup");
            assert_eq!(failure.category, "credential_storage");
            assert_eq!(failure.code, code);
        }
        assert_eq!(
            SafeFailure::from_error("credential_service_unavailable: private detail").code,
            "OTHER"
        );
    }

    #[test]
    fn concurrent_reports_keep_schema_bounded_and_independent() {
        std::thread::scope(|scope| {
            for index in 0..16 {
                scope.spawn(move || {
                    for _ in 0..50 {
                        let report = render(DiagnosticFacts {
                            elapsed_ms: index,
                            last_error: Some((
                                SafeFailure::from_error(
                                    "audio3_error.setup.authentication.INVALID_API_KEY",
                                ),
                                1,
                            )),
                            ..Default::default()
                        });
                        let json: serde_json::Value = serde_json::from_str(&report).unwrap();
                        assert_eq!(json["schema"], "mimi.support.v1");
                        assert_eq!(
                            json["last_error"]["classification"]["category"],
                            "authentication"
                        );
                        assert_eq!(json["snapshot"]["elapsed_since_app_start_ms"], index);
                        assert!(report.len() < 4096);
                    }
                });
            }
        });
    }
}
