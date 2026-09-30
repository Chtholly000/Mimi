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

/// Only timestamps are retained; data presence does not imply sound or speech.
#[derive(Default)]
pub struct AudioActivity {
    last_data: Option<std::time::Instant>,
    last_sound: Option<std::time::Instant>,
}

impl AudioActivity {
    pub fn observe(&mut self, samples: &[f32], now: std::time::Instant) {
        if samples.is_empty() {
            return;
        }
        self.last_data = Some(now);
        if samples
            .iter()
            .any(|sample| sample.is_finite() && sample.abs() > 0.001)
        {
            self.last_sound = Some(now);
        }
    }

    pub fn state(&self, now: std::time::Instant) -> (bool, bool) {
        let recent = |at: Option<std::time::Instant>| {
            at.is_some_and(|at| {
                now.saturating_duration_since(at) < std::time::Duration::from_secs(2)
            })
        };
        (recent(self.last_data), recent(self.last_sound))
    }
}

#[cfg(test)]
mod activity_tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn data_silence_sound_and_stale_data_are_distinct() {
        let now = Instant::now();
        let mut activity = AudioActivity::default();
        assert_eq!(activity.state(now), (false, false));
        activity.observe(&[], now);
        assert_eq!(activity.state(now), (false, false));
        activity.observe(&[0.0, 0.0001, f32::NAN, f32::INFINITY], now);
        assert_eq!(activity.state(now), (true, false));
        activity.observe(&[-0.02], now);
        assert_eq!(activity.state(now), (true, true));
        activity.observe(&[0.0], now + Duration::from_secs(3));
        assert_eq!(activity.state(now + Duration::from_secs(3)), (true, false));
        assert_eq!(activity.state(now + Duration::from_secs(5)), (false, false));
    }
}
