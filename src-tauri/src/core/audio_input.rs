//! Explicit capture selection. Missing preferences remain system-only.
use serde::{Deserialize, Serialize};

/// One independent capture/recognition lane. A lane can never mix inputs.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AudioSource {
    #[default]
    System,
    Microphone,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AudioInput {
    #[default]
    System,
    Microphone,
    Both,
}

impl AudioInput {
    pub fn sources(self) -> &'static [AudioSource] {
        match self {
            Self::System => &[AudioSource::System],
            Self::Microphone => &[AudioSource::Microphone],
            Self::Both => &[AudioSource::System, AudioSource::Microphone],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selection_is_explicit_and_nonempty() {
        assert_eq!(AudioInput::default(), AudioInput::System);
        for (input, wire) in [
            (AudioInput::System, "system"),
            (AudioInput::Microphone, "microphone"),
            (AudioInput::Both, "both"),
        ] {
            assert_eq!(serde_json::to_value(input).unwrap(), wire);
            assert_eq!(
                serde_json::from_value::<AudioInput>(wire.into()).unwrap(),
                input
            );
        }
        for invalid in ["none", "", "default", "camera"] {
            assert!(serde_json::from_value::<AudioInput>(invalid.into()).is_err());
        }
    }

    #[test]
    fn both_has_exactly_two_separate_sources() {
        assert_eq!(AudioInput::System.sources(), &[AudioSource::System]);
        assert_eq!(AudioInput::Microphone.sources(), &[AudioSource::Microphone]);
        assert_eq!(
            AudioInput::Both.sources(),
            &[AudioSource::System, AudioSource::Microphone]
        );
        assert!(serde_json::from_str::<AudioSource>("\"both\"").is_err());
    }
}
