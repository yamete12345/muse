//! The widget's beautiful glass, drawn by the Windows compositor.
//!
//! A visual behind the page shows the desktop blurred by Windows (the host
//! backdrop: what system acrylic is made from), clipped to a rounded rectangle
//! with smooth edges and any radius. The older way, the window's accent blur,
//! fills the whole window rectangle and on Windows 11 ignores a window region,
//! so its corners can only be the system's 8 px. That one stays as the fallback
//! where the host backdrop is not offered to desktop windows (Windows 10).
//!
//! Composition objects belong to the thread that made them: everything here
//! runs on the main (UI) thread.

use std::cell::RefCell;

use windows::core::{Interface, BOOL};
use windows::System::{DispatcherQueue, DispatcherQueueController};
use windows::UI::Composition::Desktop::DesktopWindowTarget;
use windows::UI::Composition::{CompositionRoundedRectangleGeometry, Compositor, SpriteVisual};
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWINDOWATTRIBUTE};
use windows::Win32::System::WinRT::Composition::ICompositorDesktopInterop;
use windows::Win32::System::WinRT::{CreateDispatcherQueueController, DispatcherQueueOptions, DQTAT_COM_NONE, DQTYPE_THREAD_CURRENT};
use windows_numerics::Vector2;

/// Lets a window use the host backdrop brush (Windows 11).
const DWMWA_USE_HOSTBACKDROPBRUSH: DWMWINDOWATTRIBUTE = DWMWINDOWATTRIBUTE(17);

struct Pane {
    hwnd: isize,
    _target: DesktopWindowTarget,
    _visual: SpriteVisual,
    shape: CompositionRoundedRectangleGeometry,
}

thread_local! {
    static QUEUE: RefCell<Option<DispatcherQueueController>> = const { RefCell::new(None) };
    static COMPOSITOR: RefCell<Option<Compositor>> = const { RefCell::new(None) };
    static PANE: RefCell<Option<Pane>> = const { RefCell::new(None) };
}

fn compositor() -> windows::core::Result<Compositor> {
    // A compositor needs a dispatcher queue on its thread.
    if DispatcherQueue::GetForCurrentThread().is_err() {
        let options = DispatcherQueueOptions {
            dwSize: std::mem::size_of::<DispatcherQueueOptions>() as u32,
            threadType: DQTYPE_THREAD_CURRENT,
            apartmentType: DQTAT_COM_NONE,
        };
        let controller = unsafe { CreateDispatcherQueueController(options)? };
        QUEUE.with(|q| *q.borrow_mut() = Some(controller));
    }
    COMPOSITOR.with(|c| {
        if let Some(c) = c.borrow().as_ref() {
            return Ok(c.clone());
        }
        let made = Compositor::new()?;
        *c.borrow_mut() = Some(made.clone());
        Ok(made)
    })
}

/// Shows the glass behind `hwnd`'s page: `width` x `height` physical pixels,
/// corners of `radius` physical pixels. Fails where Windows does not offer the
/// host backdrop; the caller then falls back to the accent blur.
pub fn show(hwnd: isize, width: f32, height: f32, radius: f32) -> windows::core::Result<()> {
    let existing = PANE.with(|p| p.borrow().as_ref().map(|p| p.hwnd == hwnd));
    if existing != Some(true) {
        hide();
        let on = BOOL::from(true);
        unsafe {
            DwmSetWindowAttribute(HWND(hwnd as _), DWMWA_USE_HOSTBACKDROPBRUSH, &on as *const _ as *const _, std::mem::size_of::<BOOL>() as u32)?;
        }
        let compositor = compositor()?;
        let interop: ICompositorDesktopInterop = compositor.cast()?;
        // Not topmost: the visual sits beneath the window's own content (the page).
        let target = unsafe { interop.CreateDesktopWindowTarget(HWND(hwnd as _), false)? };
        let visual = compositor.CreateSpriteVisual()?;
        visual.SetRelativeSizeAdjustment(Vector2 { X: 1.0, Y: 1.0 })?;
        visual.SetBrush(&compositor.CreateHostBackdropBrush()?)?;
        let shape = compositor.CreateRoundedRectangleGeometry()?;
        visual.SetClip(&compositor.CreateGeometricClipWithGeometry(&shape)?)?;
        target.SetRoot(&visual)?;
        PANE.with(|p| *p.borrow_mut() = Some(Pane { hwnd, _target: target, _visual: visual, shape }));
    }
    PANE.with(|p| {
        let p = p.borrow();
        let Some(p) = p.as_ref() else { return Ok(()) };
        p.shape.SetSize(Vector2 { X: width, Y: height })?;
        p.shape.SetCornerRadius(Vector2 { X: radius, Y: radius })
    })
}

pub fn showing(hwnd: isize) -> bool {
    PANE.with(|p| p.borrow().as_ref().map(|p| p.hwnd == hwnd)) == Some(true)
}

pub fn hide() {
    PANE.with(|p| {
        if let Some(pane) = p.borrow_mut().take() {
            let _ = pane._target.SetRoot(None);
            let off = BOOL::from(false);
            unsafe {
                let _ = DwmSetWindowAttribute(HWND(pane.hwnd as _), DWMWA_USE_HOSTBACKDROPBRUSH, &off as *const _ as *const _, std::mem::size_of::<BOOL>() as u32);
            }
        }
    });
}
