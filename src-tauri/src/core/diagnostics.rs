//! Content-free pipeline diagnostics: timing, counts, language codes, and
//! sanitized error labels only. Recognized or translated text is forbidden.

/// Logs a pipeline diagnostic through `tracing`. Disabled when the
/// `MIMI_PIPELINE_DIAGNOSTICS` environment variable is exactly `"0"`.
#[macro_export]
macro_rules! pipeline_log {
    ($($arg:tt)*) => {
        if $crate::core::diagnostics::is_enabled() {
            tracing::info!($($arg)*);
        }
    };
}

pub fn is_enabled() -> bool {
    static CELL: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *CELL.get_or_init(|| std::env::var("MIMI_PIPELINE_DIAGNOSTICS").as_deref() != Ok("0"))
}

/// Milliseconds elapsed between two `Instant`s.
pub fn milliseconds(start: std::time::Instant, end: std::time::Instant) -> u64 {
    end.saturating_duration_since(start).as_millis() as u64
}

/// The two measured translation boundaries are deliberately distinct:
/// a text request duration is not the same as waiting for a streamed final.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TranslationLatencyKind {
    Request,
    Follow,
}

/// A content-free measurement of the latest successfully confirmed subtitle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TranslationLatency {
    pub milliseconds: u64,
    pub kind: TranslationLatencyKind,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn milliseconds_measures_elapsed_time() {
        let start = std::time::Instant::now();
        let end = start + std::time::Duration::from_millis(150);
        assert_eq!(milliseconds(start, end), 150);
    }

    #[test]
    fn translation_latency_kinds_keep_distinct_wire_values() {
        assert_eq!(
            serde_json::to_value(TranslationLatencyKind::Request).unwrap(),
            "request"
        );
        assert_eq!(
            serde_json::to_value(TranslationLatencyKind::Follow).unwrap(),
            "follow"
        );
    }
}
