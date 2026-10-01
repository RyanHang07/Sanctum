//! System tray (SPEC 4.0.1). Left click toggles the tray panel window, right click opens the
//! native menu. Quit is disabled while sealed. While sealed, the keyhole breathes
//! (LogoMotion.dc.html, "Sealed idle pulse", 3.2 s loop).

use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition,
};

use crate::Shared;

const TRAY_ID: &str = "sanctum";
const PANEL: &str = "tray-panel";

/// Clicking the tray icon while the panel is open blurs (and hides) it first; without this
/// the same click would immediately reopen it.
static LAST_BLUR_HIDE: Mutex<Option<Instant>> = Mutex::new(None);

fn build_menu(app: &AppHandle, sealed: bool) -> tauri::Result<Menu<tauri::Wry>> {
    let open = MenuItem::with_id(app, "open", "Open Sanctum", true, None::<&str>)?;
    let focus = if sealed {
        MenuItem::with_id(app, "compact", "Compact timer", true, None::<&str>)?
    } else {
        MenuItem::with_id(app, "enter-focus", "Enter focus", true, None::<&str>)?
    };
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", !sealed, None::<&str>)?;
    // Quiet hours (v0.1): pause for 15 minutes with a reason, or end the pause.
    let (quiet_on, quiet_paused) = app.state::<Shared>().engine.quiet_menu();
    if !sealed && (quiet_on || quiet_paused) {
        let quiet = if quiet_on {
            MenuItem::with_id(app, "quiet-pause", "Pause quiet hours 15 min…", true, None::<&str>)?
        } else {
            MenuItem::with_id(app, "quiet-resume", "Resume quiet hours", true, None::<&str>)?
        };
        return Menu::with_items(app, &[&open, &focus, &quiet, &sep, &quit]);
    }
    Menu::with_items(app, &[&open, &focus, &sep, &quit])
}

const ICON: &[u8] = include_bytes!("../icons/tray/32x32.png");
const PULSE_FRAMES: usize = 16;
const PULSE_MS: u64 = 3200;

/// Fades only the cobalt keyhole pixels, so the torii stays solid. `opacity` in 0..=1.
pub fn fade_keyhole(rgba: &[u8], opacity: f32) -> Vec<u8> {
    let mut out = rgba.to_vec();
    for px in out.chunks_exact_mut(4) {
        let (r, g, b) = (px[0] as i32, px[1] as i32, px[2] as i32);
        if b - r > 80 && b - g > 60 {
            px[3] = (px[3] as f32 * opacity).round() as u8;
        }
    }
    out
}

/// Opacity through one breath: 1, down to 0.45 halfway, back to 1.
pub fn breath(frame: usize, frames: usize) -> f32 {
    let t = frame as f32 / frames as f32;
    0.725 + 0.275 * (2.0 * std::f32::consts::PI * t).cos()
}

/// Animates the tray icon while sealed; restores it when the seal ends.
pub fn spawn_pulse(app: AppHandle) {
    std::thread::Builder::new()
        .name("sanctum-tray-pulse".into())
        .spawn(move || {
            let Ok(decoded) = image::load_from_memory(ICON) else { return };
            let base = decoded.to_rgba8();
            let (w, h) = base.dimensions();
            let frames: Vec<Vec<u8>> = (0..PULSE_FRAMES).map(|i| fade_keyhole(base.as_raw(), breath(i, PULSE_FRAMES))).collect();
            let mut i = 0;
            let mut pulsing = false;
            loop {
                std::thread::sleep(Duration::from_millis(PULSE_MS / PULSE_FRAMES as u64));
                let Some(shared) = app.try_state::<Shared>() else { continue };
                let sealed = shared.sealed();
                let Some(tray) = app.tray_by_id(TRAY_ID) else { continue };
                if sealed {
                    let _ = tray.set_icon(Some(Image::new_owned(frames[i].clone(), w, h)));
                    i = (i + 1) % PULSE_FRAMES;
                    pulsing = true;
                } else if pulsing {
                    let _ = tray.set_icon(Image::from_bytes(ICON).ok());
                    pulsing = false;
                    i = 0;
                }
            }
        })
        .expect("tray pulse thread");
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let icon = Image::from_bytes(ICON)?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("Sanctum")
        .menu(&build_menu(app, false)?)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => crate::show_main_window(app),
            "enter-focus" => {
                crate::show_main_window(app);
                let _ = app.emit("sanctum://enter-focus", ());
            }
            "compact" => crate::show_compact_window(app),
            "quiet-pause" => {
                crate::show_main_window(app);
                let _ = app.emit(crate::engine::EV_QUIET_PAUSE, ());
            }
            "quiet-resume" => {
                let _ = crate::engine::quiet_resume(app.state::<Shared>());
            }
            "quit" => {
                if !app.state::<Shared>().sealed() {
                    app.exit(0);
                }
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                position,
                ..
            } = event
            {
                toggle_panel(tray.app_handle(), position);
            }
        })
        .build(app)?;
    Ok(())
}

/// Rebuilds the menu so "Enter focus" / "Compact timer" and Quit reflect the state.
pub fn refresh(app: &AppHandle, sealed: bool) -> tauri::Result<()> {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_menu(Some(build_menu(app, sealed)?))?;
    }
    Ok(())
}

pub fn hide_panel(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(PANEL) {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
            *LAST_BLUR_HIDE.lock().unwrap() = Some(Instant::now());
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

/// Where the tray panel goes: beside the taskbar on whichever edge it sits (found by comparing
/// the screen with its work area), near the click, and fully inside the work area.
pub fn panel_position(click: (i32, i32), panel: (i32, i32), screen: Rect, work: Rect, gap: i32) -> (i32, i32) {
    let (pw, ph) = panel;
    let (left, top, right, bottom) = (work.x, work.y, work.x + work.w, work.y + work.h);
    let (x, y) = if work.x > screen.x {
        // Taskbar on the left.
        (left + gap, click.1 - ph / 2)
    } else if right < screen.x + screen.w {
        (right - pw - gap, click.1 - ph / 2)
    } else if work.y > screen.y {
        (click.0 - pw / 2, top + gap)
    } else {
        // Bottom, the default (also when the taskbar auto-hides).
        (click.0 - pw / 2, bottom - ph - gap)
    };
    let clamp = |v: i32, lo: i32, hi: i32| v.max(lo).min(hi.max(lo));
    (clamp(x, left + gap, right - pw - gap), clamp(y, top + gap, bottom - ph - gap))
}

fn toggle_panel(app: &AppHandle, at: PhysicalPosition<f64>) {
    let Some(w) = app.get_webview_window(PANEL) else { return };
    if w.is_visible().unwrap_or(false) {
        let _ = w.hide();
        return;
    }
    let just_hidden = LAST_BLUR_HIDE
        .lock()
        .unwrap()
        .is_some_and(|t| t.elapsed() < Duration::from_millis(250));
    if just_hidden {
        return;
    }
    // Next to the taskbar, wherever it is, and never over it.
    if let (Ok(size), Ok(Some(monitor))) = (w.outer_size(), app.monitor_from_point(at.x, at.y)) {
        let r = |p: tauri::PhysicalPosition<i32>, s: tauri::PhysicalSize<u32>| Rect { x: p.x, y: p.y, w: s.width as i32, h: s.height as i32 };
        let screen = r(*monitor.position(), *monitor.size());
        let work = r(monitor.work_area().position, monitor.work_area().size);
        let gap = (12.0 * monitor.scale_factor()).round() as i32;
        let (x, y) = panel_position((at.x as i32, at.y as i32), (size.width as i32, size.height as i32), screen, work, gap);
        let _ = w.set_position(PhysicalPosition::new(x, y));
    }
    let _ = w.show();
    let _ = w.set_focus();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_panel_sits_beside_the_taskbar_on_any_edge() {
        let screen = Rect { x: 0, y: 0, w: 1920, h: 1080 };
        let panel = (340, 440);
        // Bottom taskbar: above it, centered on the click.
        let work = Rect { x: 0, y: 0, w: 1920, h: 1032 };
        assert_eq!(panel_position((1800, 1050), panel, screen, work, 12), (1568, 580));
        // Left taskbar (as in the bug): to its right, never over it, kept on screen vertically.
        let work = Rect { x: 62, y: 0, w: 1858, h: 1080 };
        let (x, y) = panel_position((30, 1040), panel, screen, work, 12);
        assert_eq!(x, 74);
        assert_eq!(y, 1080 - 440 - 12);
        // Right taskbar.
        let work = Rect { x: 0, y: 0, w: 1858, h: 1080 };
        assert_eq!(panel_position((1890, 500), panel, screen, work, 12).0, 1858 - 340 - 12);
        // Top taskbar.
        let work = Rect { x: 0, y: 48, w: 1920, h: 1032 };
        assert_eq!(panel_position((900, 20), panel, screen, work, 12), (730, 60));
        // A second monitor to the left (negative coordinates) with a bottom taskbar.
        let screen = Rect { x: -1920, y: 0, w: 1920, h: 1080 };
        let work = Rect { x: -1920, y: 0, w: 1920, h: 1032 };
        assert_eq!(panel_position((-10, 1050), panel, screen, work, 12), (-352, 580));
    }

    #[test]
    fn only_the_keyhole_breathes() {
        // white torii pixel, cobalt keyhole pixel, transparent
        let px = [255, 255, 255, 255, 47, 91, 255, 255, 0, 0, 0, 0];
        let out = fade_keyhole(&px, 0.45);
        assert_eq!(&out[0..4], &[255, 255, 255, 255]);
        assert_eq!(&out[4..8], &[47, 91, 255, 115]);
        assert_eq!(&out[8..12], &[0, 0, 0, 0]);
        assert!((breath(0, 16) - 1.0).abs() < 1e-6);
        assert!((breath(8, 16) - 0.45).abs() < 1e-6);
    }
}
