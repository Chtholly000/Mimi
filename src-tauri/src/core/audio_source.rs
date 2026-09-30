//! Device-change decisions, independent of WASAPI and the session lifecycle.
#[derive(Debug, PartialEq, Eq)]
pub enum SourceAction {
    StopMonitor,
    Unavailable,
    Rebind,
    Keep,
}

pub fn source_action(
    generation_current: bool,
    bound: Option<&str>,
    resolved: Option<&str>,
) -> SourceAction {
    if !generation_current {
        SourceAction::StopMonitor
    } else if resolved.is_none() {
        SourceAction::Unavailable
    } else if resolved != bound {
        SourceAction::Rebind
    } else {
        SourceAction::Keep
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn follows_changed_default_and_keeps_stable_endpoint() {
        assert_eq!(
            source_action(true, Some("speakers"), Some("headphones")),
            SourceAction::Rebind
        );
        assert_eq!(
            source_action(true, Some("headphones"), Some("headphones")),
            SourceAction::Keep
        );
    }

    #[test]
    fn disconnected_or_invalid_selection_does_not_fall_back_silently() {
        assert_eq!(
            source_action(true, Some("headphones"), None),
            SourceAction::Unavailable
        );
        assert_eq!(source_action(true, None, None), SourceAction::Unavailable);
    }

    #[test]
    fn stop_invalidates_monitor_even_when_another_endpoint_appears() {
        assert_eq!(
            source_action(false, Some("speakers"), Some("headphones")),
            SourceAction::StopMonitor
        );
        assert_eq!(source_action(false, None, None), SourceAction::StopMonitor);
    }
}
