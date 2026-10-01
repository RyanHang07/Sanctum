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
    // Anchor above the click point (the tray sits at the bottom of the screen on Windows).
    if let Ok(size) = w.outer_size() {
        let x = at.x - size.width as f64 / 2.0;
        let y = at.y - size.height as f64 - 12.0;
        let _ = w.set_position(PhysicalPosition::new(x.max(0.0), y.max(0.0)));
    }
    let _ = w.show();
    let _ = w.set_focus();
}

#[cfg(test)]
mod tests {
    use super::*;

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
