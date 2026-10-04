//! Hover for the nonactivating subtitle panel without activating its app.
//!
//! WKWebView's normal tracking is active in a key window; the subtitle panel
//! stays non-key until an explicit click needs its responder. An independent
//! public-AppKit tracking owner relays only view-local coordinates to that renderer. It
//! does not replace Tao's window delegate, synthesize clicks, or monitor
//! events globally. InVisibleRect follows resizing without polling.

use crate::core::overlay_pointer::{
    css_position, OverlayPointerPosition, PointerDelivery, PointerMotionGate,
};
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, NSObject};
use objc2::{define_class, msg_send, AnyThread, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{NSCursor, NSEvent, NSTrackingArea, NSTrackingAreaOptions, NSView};
use objc2_foundation::NSObjectProtocol;
use std::{
    cell::{Cell, RefCell},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Instant,
};
use tauri::{AppHandle, Emitter, EventTarget, Manager, WebviewWindow};

const EVENT: &str = "overlay-pointer-motion";

struct PointerOwnerIvars {
    app: AppHandle,
    view: Retained<NSView>,
    gate: RefCell<PointerMotionGate>,
    flush_scheduled: Cell<bool>,
    pointing_cursor: Cell<bool>,
    generation: Arc<AtomicU64>,
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements. Tracking callbacks,
    // view ownership, and registration/removal remain on AppKit's main thread.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "MimiOverlayPointerOwner"]
    #[ivars = PointerOwnerIvars]
    struct MimiOverlayPointerOwner;

    impl MimiOverlayPointerOwner {
        #[unsafe(method(mouseEntered:))]
        fn entered(&self, event: &NSEvent) {
            self.clear();
            self.motion(event);
        }

        #[unsafe(method(mouseMoved:))]
        fn moved(&self, event: &NSEvent) {
            self.motion(event);
        }

        #[unsafe(method(mouseExited:))]
        fn exited(&self, _event: &NSEvent) {
            self.clear();
        }
    }

    unsafe impl NSObjectProtocol for MimiOverlayPointerOwner {}
);

impl MimiOverlayPointerOwner {
    fn new(app: AppHandle, view: Retained<NSView>, mtm: MainThreadMarker) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(PointerOwnerIvars {
            app,
            view,
            gate: RefCell::new(PointerMotionGate::default()),
            flush_scheduled: Cell::new(false),
            pointing_cursor: Cell::new(false),
            generation: Arc::new(AtomicU64::new(0)),
        });
        unsafe { msg_send![super(this), init] }
    }

    fn motion(&self, event: &NSEvent) {
        let ivars = self.ivars();
        let view = &ivars.view;
        // Tracking must never make a locked, hidden surface appear clickable.
        if !self.tracking_allowed() {
            self.clear();
            return;
        }
        let point = view.convertPoint_fromView(event.locationInWindow(), None);
        let bounds = view.bounds();
        let Some(point) = css_position(
            (point.x, point.y),
            (bounds.origin.x, bounds.origin.y),
            (bounds.size.width, bounds.size.height),
            view.isFlipped(),
        ) else {
            self.clear();
            return;
        };
        if ivars.pointing_cursor.get() {
            // WebKit/Tao may reset a cursor while processing the same move.
            // Reassert this owner's intent on real movement, never a timer.
            NSCursor::pointingHandCursor().set();
        }
        let delivery = ivars.gate.borrow_mut().motion(point, Instant::now());
        self.deliver(delivery);
    }

    fn tracking_allowed(&self) -> bool {
        let view = &self.ivars().view;
        !view.isHiddenOrHasHiddenAncestor()
            && view
                .window()
                .is_some_and(|window| window.isVisible() && !window.ignoresMouseEvents())
    }

    fn deliver(&self, delivery: PointerDelivery) {
        let ivars = self.ivars();
        match delivery {
            PointerDelivery::Position(point) => {
                let _ =
                    ivars
                        .app
                        .emit_to(EventTarget::webview_window("overlay"), EVENT, Some(point));
            }
            PointerDelivery::Delay(delay) if !ivars.flush_scheduled.replace(true) => {
                let app = ivars.app.clone();
                let generation = Arc::clone(&ivars.generation);
                let token = generation.load(Ordering::Relaxed);
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(delay).await;
                    if generation.load(Ordering::Relaxed) != token {
                        return;
                    }
                    let _ = app.run_on_main_thread(move || {
                        REGISTRATION.with(|slot| {
                            let slot = slot.borrow();
                            let Some(registration) = slot.as_ref() else {
                                return;
                            };
                            let owner = &registration.owner;
                            if !Arc::ptr_eq(&owner.ivars().generation, &generation)
                                || generation.load(Ordering::Relaxed) != token
                            {
                                return;
                            }
                            // Visibility/passthrough may have changed while
                            // this single delayed flush was waiting.
                            if !owner.tracking_allowed() {
                                owner.clear();
                                return;
                            }
                            owner.ivars().flush_scheduled.set(false);
                            let delivery = owner.ivars().gate.borrow_mut().flush(Instant::now());
                            owner.deliver(delivery);
                        });
                    });
                });
            }
            PointerDelivery::Delay(_) | PointerDelivery::None => {}
        }
    }

    fn clear(&self) {
        self.restore_cursor();
        self.ivars().generation.fetch_add(1, Ordering::Relaxed);
        self.ivars().flush_scheduled.set(false);
        if self.ivars().gate.borrow_mut().clear() {
            let _ = self.ivars().app.emit_to(
                EventTarget::webview_window("overlay"),
                EVENT,
                None::<OverlayPointerPosition>,
            );
        }
    }

    fn set_pointer_cursor(&self, point: OverlayPointerPosition, pointing: bool) -> bool {
        if !self.tracking_allowed() {
            self.clear();
            return false;
        }
        if !self.ivars().gate.borrow().accepts_cursor_reply(point) {
            return false;
        }
        if pointing {
            self.ivars().pointing_cursor.set(true);
            // ActiveAlways does not receive cursorUpdate. Set the public
            // AppKit cursor directly, without making the panel key/active.
            NSCursor::pointingHandCursor().set();
        } else {
            self.restore_cursor();
        }
        true
    }

    fn restore_cursor(&self) {
        // Never change another application's cursor unless this owner set
        // the hand first. Leave, lock, hide, and drop all take this path.
        if self.ivars().pointing_cursor.replace(false) {
            NSCursor::arrowCursor().set();
        }
    }
}

struct PointerRegistration {
    view: Retained<NSView>,
    area: Retained<NSTrackingArea>,
    owner: Retained<MimiOverlayPointerOwner>,
}

impl Drop for PointerRegistration {
    fn drop(&mut self) {
        // AppKit does not retain the area's owner. Keep it alive until after
        // removing the area; replacing/destroying the overlay releases both.
        self.view.removeTrackingArea(&self.area);
        self.owner.clear();
    }
}

thread_local! {
    static REGISTRATION: RefCell<Option<PointerRegistration>> = const { RefCell::new(None) };
}

pub(super) fn install(window: &WebviewWindow) {
    if window.label() != "overlay" {
        return;
    }
    let app = window.app_handle().clone();
    let _ = window.with_webview(move |platform| {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        // Tauri supplies a live WKWebView (an NSView subclass) in this
        // main-thread callback. Retaining it makes registration cleanup safe.
        let Some(view) = (unsafe { Retained::retain(platform.inner().cast::<NSView>()) }) else {
            return;
        };
        let owner = MimiOverlayPointerOwner::new(app, view.clone(), mtm);
        let owner_object: &AnyObject = owner.as_ref();
        let options = NSTrackingAreaOptions::ActiveAlways
            | NSTrackingAreaOptions::MouseEnteredAndExited
            | NSTrackingAreaOptions::MouseMoved
            | NSTrackingAreaOptions::InVisibleRect;
        let area = unsafe {
            NSTrackingArea::initWithRect_options_owner_userInfo(
                NSTrackingArea::alloc(),
                view.bounds(),
                options,
                Some(owner_object),
                None,
            )
        };
        REGISTRATION.with(|slot| {
            let mut slot = slot.borrow_mut();
            // Remove the old area before adding another, keeping one owner.
            *slot = None;
            view.addTrackingArea(&area);
            *slot = Some(PointerRegistration { view, area, owner });
        });
    });
}

pub(super) fn clear(app: &AppHandle, remove: bool) {
    if MainThreadMarker::new().is_some() {
        clear_on_main(remove);
        return;
    }
    let _ = app.run_on_main_thread(move || {
        clear_on_main(remove);
    });
}

pub(super) async fn set_pointer_cursor(
    app: &AppHandle,
    point: OverlayPointerPosition,
    pointing: bool,
) -> Result<bool, String> {
    if MainThreadMarker::new().is_some() {
        return Ok(set_pointer_cursor_on_main(point, pointing));
    }
    let (reply, accepted) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = reply.send(set_pointer_cursor_on_main(point, pointing));
    })
    .map_err(|_| "overlay_pointer_cursor_unavailable".to_string())?;
    accepted
        .await
        .map_err(|_| "overlay_pointer_cursor_unavailable".to_string())
}

fn set_pointer_cursor_on_main(point: OverlayPointerPosition, pointing: bool) -> bool {
    REGISTRATION.with(|slot| {
        slot.borrow()
            .as_ref()
            .is_some_and(|registration| registration.owner.set_pointer_cursor(point, pointing))
    })
}

fn clear_on_main(remove: bool) {
    REGISTRATION.with(|slot| {
        if remove {
            *slot.borrow_mut() = None;
        } else if let Some(registration) = slot.borrow().as_ref() {
            registration.owner.clear();
        }
    });
}
