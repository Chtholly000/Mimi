//! Explicit single-source capture selection. Missing preferences remain system-only.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AudioInput {
    #[default]
    System,
    Microphone,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selection_is_explicit_and_single_source() {
        assert_eq!(AudioInput::default(), AudioInput::System);
        for (input, wire) in [
            (AudioInput::System, "system"),
            (AudioInput::Microphone, "microphone"),
        ] {
            assert_eq!(serde_json::to_value(input).unwrap(), wire);
            assert_eq!(
                serde_json::from_value::<AudioInput>(wire.into()).unwrap(),
                input
            );
        }
        for invalid in ["both", "", "default", "camera"] {
            assert!(serde_json::from_value::<AudioInput>(invalid.into()).is_err());
        }
    }
}
