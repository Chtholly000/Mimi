//! UI-independent models, configuration, protocols, subtitle assembly, and
//! pipeline diagnostics.

pub mod committer;
pub mod configuration;
pub mod credentials;
pub mod diagnostics;
pub mod models;
pub mod openai_transcript_committer;
#[cfg(any(target_os = "macos", target_os = "windows", test))]
pub mod pcm16;
pub mod protocols;
pub mod provider;
pub mod session;
pub mod session_archive;
pub mod subtitle_reducer;

#[cfg(any(target_os = "windows", test))]
pub mod audio_source;

pub mod support_diagnostics;
