//! Starts an AppKit file drag for the running app bundle from the permission card.

use objc2::rc::Retained;
use objc2::runtime::{NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{define_class, msg_send, AnyThread, MainThreadMarker};
use objc2_app_kit::{
    NSApplication, NSDragOperation, NSDraggingContext, NSDraggingItem, NSDraggingSession,
    NSDraggingSource, NSEvent, NSEventModifierFlags, NSEventType, NSPasteboardWriting, NSWindow,
    NSWorkspace,
};
use objc2_foundation::{NSArray, NSPoint, NSRect, NSSize, NSString, NSURL};
use std::cell::OnceCell;
use std::path::Path;

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = objc2::MainThreadOnly]
    #[name = "BycodaPermissionAppDragSource"]
    struct AppDragSource;

    unsafe impl NSObjectProtocol for AppDragSource {}

    unsafe impl NSDraggingSource for AppDragSource {
        #[unsafe(method(draggingSession:sourceOperationMaskForDraggingContext:))]
        fn allowed_operations(
            &self,
            _session: &NSDraggingSession,
            _context: NSDraggingContext,
        ) -> NSDragOperation {
            NSDragOperation::Copy
        }
    }
);

thread_local! {
    static SOURCE: OnceCell<Retained<AppDragSource>> = const { OnceCell::new() };
}

fn mouse_event(window: &NSWindow, mtm: MainThreadMarker) -> Option<Retained<NSEvent>> {
    if !window.isVisible() || NSEvent::pressedMouseButtons() & 1 == 0 {
        return None;
    }
    let app = NSApplication::sharedApplication(mtm);
    let current = app.currentEvent();
    if let Some(event) = current.as_ref().filter(|event| {
        event.windowNumber() == window.windowNumber()
            && matches!(
                event.r#type(),
                NSEventType::LeftMouseDown | NSEventType::LeftMouseDragged
            )
    }) {
        return Some(event.clone());
    }

    // WebKit delivers dragstart over IPC, so the matching native mouse event can
    // already have left the dispatch loop. The real left button is still held.
    let point = window.convertPointFromScreen(NSEvent::mouseLocation());
    NSEvent::mouseEventWithType_location_modifierFlags_timestamp_windowNumber_context_eventNumber_clickCount_pressure(
        NSEventType::LeftMouseDown,
        point,
        current.as_ref().map_or(NSEventModifierFlags::empty(), |event| event.modifierFlags()),
        current.as_ref().map_or(0.0, |event| event.timestamp()),
        window.windowNumber(),
        None,
        0,
        1,
        1.0,
    )
}

pub(super) fn start(window: &NSWindow, bundle: &Path) -> Result<(), String> {
    let mtm = MainThreadMarker::new().ok_or("App drag must start on the main thread.")?;
    let event =
        mouse_event(window, mtm).ok_or("The mouse gesture ended before the drag started.")?;
    let path = bundle
        .to_str()
        .ok_or("The app bundle path is not valid UTF-8.")?;
    let path = NSString::from_str(path);
    let url = NSURL::fileURLWithPath_isDirectory(&path, true);
    let writer = ProtocolObject::<dyn NSPasteboardWriting>::from_retained(url);
    let item = NSDraggingItem::initWithPasteboardWriter(NSDraggingItem::alloc(), &writer);
    let icon = NSWorkspace::sharedWorkspace().iconForFile(&path);
    let point = event.locationInWindow();
    let frame = NSRect::new(
        NSPoint::new(point.x - 24.0, point.y - 24.0),
        NSSize::new(48.0, 48.0),
    );
    // SAFETY: The drag preview is an NSImage, an accepted contents type.
    unsafe { item.setDraggingFrame_contents(frame, Some(&icon)) };
    let items = NSArray::from_retained_slice(&[item]);
    SOURCE.with(|slot| {
        let source = slot.get_or_init(|| {
            // SAFETY: The NSObject subclass has no ivars and uses NSObject initialization.
            unsafe { msg_send![mtm.alloc::<AppDragSource>(), init] }
        });
        let source = ProtocolObject::<dyn NSDraggingSource>::from_ref(&**source);
        // SAFETY: AppKit takes the item array, this window's mouse event and a
        // live source. A failed start can return nil.
        let session: Option<Retained<NSDraggingSession>> =
            unsafe { msg_send![window, beginDraggingSessionWithItems: &*items, event: &*event, source: source] };
        session.map(|_| ()).ok_or_else(|| "Could not start dragging the app.".into())
    })
}
