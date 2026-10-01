//! Optional Dock/Cmd-Tab presence; never changes the user's Dock preferences.

#[cfg(target_os = "macos")]
pub(crate) fn policy(show: bool) -> tauri::ActivationPolicy {
    if show {
        tauri::ActivationPolicy::Regular
    } else {
        tauri::ActivationPolicy::Accessory
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn apply(app: &tauri::AppHandle, show: bool) -> Result<(), String> {
    // Tauri schedules the policy on its main event loop. Success means the
    // request was accepted; actual macOS presentation requires native QA.
    app.set_activation_policy(policy(show))
        .map_err(|_| "dock-policy-unavailable".to_string())
}

/// Called under the existing settings mutation guard. Do not publish or
/// persist a changed choice if the runtime request fails. If persistence
/// fails after requesting the new policy, restore the previous policy.
pub(crate) fn save_with_policy(
    previous: bool,
    next: Option<bool>,
    mut apply: impl FnMut(bool) -> Result<(), String>,
    save: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let changed = next.filter(|next| *next != previous);
    if let Some(next) = changed {
        apply(next)?;
    }
    let result = save();
    if result.is_err() && changed.is_some() && apply(previous).is_err() {
        tracing::warn!("Dock preference rollback failed label=dock_policy_unavailable");
    }
    result
}

#[cfg(test)]
mod tests {
    use super::save_with_policy;
    use std::cell::RefCell;

    #[test]
    fn failed_runtime_request_never_persists() {
        let saved = std::cell::Cell::new(false);
        let result = save_with_policy(
            false,
            Some(true),
            |_| Err("unavailable".into()),
            || {
                saved.set(true);
                Ok(())
            },
        );
        assert_eq!(result.unwrap_err(), "unavailable");
        assert!(!saved.get());
    }

    #[test]
    fn persistence_failure_restores_old_policy_before_returning_error() {
        let calls = RefCell::new(Vec::new());
        let result = save_with_policy(
            false,
            Some(true),
            |show| {
                calls.borrow_mut().push(if show { "show" } else { "hide" });
                Ok(())
            },
            || {
                calls.borrow_mut().push("save");
                Err("write-failed".into())
            },
        );
        assert_eq!(result.unwrap_err(), "write-failed");
        assert_eq!(*calls.borrow(), ["show", "save", "hide"]);
    }

    #[test]
    fn unrelated_or_unchanged_save_does_not_touch_app_policy() {
        for next in [None, Some(false)] {
            assert!(
                save_with_policy(false, next, |_| panic!("must not change policy"), || Ok(()))
                    .is_ok()
            );
        }
    }

    #[test]
    fn successful_choice_requests_policy_before_persisting() {
        let calls = RefCell::new(Vec::new());
        assert!(save_with_policy(
            true,
            Some(false),
            |show| {
                assert!(!show);
                calls.borrow_mut().push("hide");
                Ok(())
            },
            || {
                calls.borrow_mut().push("save");
                Ok(())
            }
        )
        .is_ok());
        assert_eq!(*calls.borrow(), ["hide", "save"]);
    }
}
