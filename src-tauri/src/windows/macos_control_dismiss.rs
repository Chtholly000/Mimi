//! Outside-click dismissal for nonactivating panels, which need not become
//! key and therefore cannot reliably produce a focus-lost event.
use super::{OverlayControlMode, OverlayControlWindowManager};
use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_app_kit::{NSEvent, NSEventMask};
use std::{cell::RefCell, ptr::NonNull};
use tauri::{AppHandle, Manager};

struct Monitors(Vec<Retained<AnyObject>>);
impl Drop for Monitors {
    fn drop(&mut self) {
        for monitor in &self.0 {
            // Tokens are created below and only touched on the main thread.
            unsafe { NSEvent::removeMonitor(monitor) };
        }
    }
}
thread_local! {
    static MONITORS: RefCell<Option<Monitors>> = const { RefCell::new(None) };
}

pub fn sync(app: &AppHandle) {
    let app = app.clone();
    let dispatcher = app.clone();
    let _ = dispatcher.run_on_main_thread(move || {
        MONITORS.with(|slot| {
            let mut slot = slot.borrow_mut();
            if OverlayControlWindowManager::mode(&app) != OverlayControlMode::Panel {
                *slot = None;
                return;
            }
            if slot.is_some() {
                return;
            }
            let mask = NSEventMask::LeftMouseDown
                | NSEventMask::RightMouseDown
                | NSEventMask::OtherMouseDown;
            let global_app = app.clone();
            let global = RcBlock::new(move |_: NonNull<NSEvent>| {
                OverlayControlWindowManager::dismiss_panel(&global_app);
            });
            let local = RcBlock::new(move |event: NonNull<NSEvent>| {
                let inside = app
                    .get_webview_window("overlay-control")
                    .and_then(|window| window.ns_window().ok())
                    .is_some_and(|pointer| unsafe {
                        event
                            .as_ref()
                            .window(
                                objc2::MainThreadMarker::new()
                                    .expect("AppKit event callback is on the main thread"),
                            )
                            .is_some_and(|window| {
                                Retained::as_ptr(&window).cast::<std::ffi::c_void>()
                                    == pointer.cast_const()
                            })
                    });
                if !inside {
                    OverlayControlWindowManager::dismiss_panel(&app);
                }
                // Observe the click without consuming it or activating Mimi.
                event.as_ptr()
            });
            let mut tokens = Vec::new();
            if let Some(token) =
                NSEvent::addGlobalMonitorForEventsMatchingMask_handler(mask, &global)
            {
                tokens.push(token);
            }
            if let Some(token) =
                unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &local) }
            {
                tokens.push(token);
            }
            *slot = Some(Monitors(tokens));
        });
    });
}
