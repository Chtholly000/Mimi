//! Runtime Apple capabilities mapped to Mimi's existing language choices.
//! Queries are read-only; only `prepare_source` can request language assets.

use crate::apple_speech::{self, AppleSpeechCapabilities};
use crate::core::models::SourceLanguage;
use serde::Serialize;
use std::sync::{Mutex, OnceLock};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppleSpeechLanguage {
    pub source_language: SourceLanguage,
    pub locale: String,
    pub installed: bool,
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppleSpeechSupport {
    pub available: bool,
    pub languages: Vec<AppleSpeechLanguage>,
}

static SUPPORT: OnceLock<Mutex<Option<AppleSpeechSupport>>> = OnceLock::new();
static PREPARING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub fn cached() -> AppleSpeechSupport {
    SUPPORT
        .get_or_init(Default::default)
        .lock()
        .unwrap()
        .clone()
        .unwrap_or_default()
}

pub fn is_loaded() -> bool {
    SUPPORT
        .get_or_init(Default::default)
        .lock()
        .unwrap()
        .is_some()
}

pub async fn refresh() -> Result<AppleSpeechSupport, String> {
    let native = apple_speech::capabilities()
        .await
        .map_err(|_| "apple_speech_status_failed".to_string());
    let support = native.map(map_capabilities);
    // A failed refresh must not keep a stale available/installed claim alive.
    *SUPPORT.get_or_init(Default::default).lock().unwrap() =
        Some(support.clone().unwrap_or_default());
    support
}

pub async fn locale_for_source(source: SourceLanguage) -> Result<String, String> {
    let support = refresh().await?;
    let language = require_language(&support, source)?;
    if !language.installed {
        return Err("apple_speech_assets_missing".into());
    }
    Ok(language.locale.clone())
}

pub async fn prepare_source(source: SourceLanguage) -> Result<AppleSpeechSupport, String> {
    let _preparing = PREPARING
        .try_lock()
        .map_err(|_| "apple_speech_preparing".to_string())?;
    let before = refresh().await?;
    let language = require_language(&before, source)?;
    if !language.installed {
        apple_speech::prepare(&language.locale)
            .await
            .map_err(|_| "apple_speech_prepare_failed".to_string())?;
    }
    let after = refresh().await?;
    if !require_language(&after, source)?.installed {
        return Err("apple_speech_assets_missing".into());
    }
    Ok(after)
}

fn require_language(
    support: &AppleSpeechSupport,
    source: SourceLanguage,
) -> Result<&AppleSpeechLanguage, String> {
    if !support.available {
        return Err("apple_speech_unavailable".into());
    }
    support
        .languages
        .iter()
        .find(|language| language.source_language == source)
        .ok_or_else(|| "apple_speech_language_unsupported".to_string())
}

fn map_capabilities(native: AppleSpeechCapabilities) -> AppleSpeechSupport {
    if !native.available {
        return AppleSpeechSupport::default();
    }
    let mut languages = Vec::new();
    for source in SourceLanguage::ALL {
        if source == SourceLanguage::Automatic {
            continue;
        }
        // Choosing a locale must be stable when assets are installed/removed.
        // Installed status is deliberately not a sort key.
        if let Some(identifier) =
            apple_speech::preferred_locale(source.raw_value(), &native.locales)
        {
            let locale = native
                .locales
                .iter()
                .find(|locale| locale.identifier == identifier)
                .unwrap();
            languages.push(AppleSpeechLanguage {
                source_language: source,
                locale: locale.identifier.clone(),
                installed: locale.installed,
            });
        }
    }
    AppleSpeechSupport {
        available: !languages.is_empty(),
        languages,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::apple_speech::AppleSpeechLocale;

    fn locale(identifier: &str, installed: bool) -> AppleSpeechLocale {
        AppleSpeechLocale {
            identifier: identifier.into(),
            installed,
        }
    }

    #[test]
    fn hides_unavailable_devices_and_unrepresentable_languages() {
        for native in [
            AppleSpeechCapabilities {
                available: false,
                locales: vec![locale("en-US", true)],
            },
            AppleSpeechCapabilities {
                available: true,
                locales: vec![locale("yue-HK", true)],
            },
        ] {
            assert_eq!(map_capabilities(native), AppleSpeechSupport::default());
        }
    }

    #[test]
    fn language_choices_are_dynamic_explicit_and_region_stable() {
        let support = map_capabilities(AppleSpeechCapabilities {
            available: true,
            locales: vec![
                locale("en_AU", true),
                locale("en_US", false),
                locale("ja_JP", true),
                locale("fr-FR", true),
                locale("yue-HK", true),
            ],
        });
        assert!(support.available);
        assert_eq!(support.languages.len(), 3);
        let english = require_language(&support, SourceLanguage::English).unwrap();
        assert_eq!(english.locale, "en_US");
        assert!(!english.installed);
        assert!(require_language(&support, SourceLanguage::Automatic).is_err());
        assert!(require_language(&support, SourceLanguage::Chinese).is_err());
        assert_eq!(
            require_language(&support, SourceLanguage::Japanese)
                .unwrap()
                .locale,
            "ja_JP"
        );
    }
}
