//! System tray (SPEC 4.0.1). Left click toggles the tray panel window, right click opens the
//! native menu. Quit is disabled while sealed. While sealed, the keyhole breathes
//! (LogoMotion.dc.html, "Sealed idle pulse", 3.2 s loop).
//! v0.3: on a light taskbar the mark is drawn in the dark ink of design/logo's light-background
//! mark (sanctum-mark-light.svg), following Windows' setting as it changes.

use std::sync::{Mutex, OnceLock};
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

/// Selected theme accent for the tray keyhole (RGB). None = original cobalt.
static ACCENT: Mutex<Option<[u8; 3]>> = Mutex::new(None);

/// The cobalt keyhole, as opposed to the torii's ink (detected from the original asset).
fn is_keyhole(r: i32, g: i32, b: i32) -> bool {
    b - r > 80 && b - g > 60
}

fn keyhole_mask() -> &'static Vec<bool> {
    static MASK: OnceLock<Vec<bool>> = OnceLock::new();
    MASK.get_or_init(|| {
        let Ok(decoded) = image::load_from_memory(ICON) else { return Vec::new() };
        decoded
            .to_rgba8()
            .chunks_exact(4)
            .map(|p| p[3] > 0 && is_keyhole(p[0] as i32, p[1] as i32, p[2] as i32))
            .collect()
    })
}

/// The dark ink of design/logo/sanctum-mark-light.svg.
const LIGHT_INK: [u8; 3] = [0x12, 0x15, 0x1C];

fn recolor_keyhole(rgba: &[u8], accent: Option<[u8; 3]>) -> Vec<u8> {
    let Some(rgb) = accent else { return rgba.to_vec() };
    let mask = keyhole_mask();
    let mut out = rgba.to_vec();
    for (i, px) in out.chunks_exact_mut(4).enumerate() {
        if mask.get(i).copied().unwrap_or(false) {
            px[0] = rgb[0];
            px[1] = rgb[1];
            px[2] = rgb[2];
        }
    }
    out
}

/// The mark for a light taskbar: the torii in dark ink, the keyhole and every edge's
/// smoothing (alpha) untouched.
pub fn for_light_taskbar(rgba: &[u8]) -> Vec<u8> {
    let mask = keyhole_mask();
    let mut out = rgba.to_vec();
    for (i, px) in out.chunks_exact_mut(4).enumerate() {
        if px[3] > 0 && !mask.get(i).copied().unwrap_or(false) {
            px[..3].copy_from_slice(&LIGHT_INK);
        }
    }
    out
}

/// Windows' taskbar (and Start) uses its light theme.
#[cfg(windows)]
pub fn taskbar_light() -> bool {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize")
        .and_then(|k| k.get_value::<u32, _>("SystemUsesLightTheme"))
        .is_ok_and(|v| v == 1)
}

#[cfg(not(windows))]
pub fn taskbar_light() -> bool {
    false
}

/// Fades only the keyhole pixels, so the torii stays solid. `opacity` in 0..=1.
pub fn fade_keyhole(rgba: &[u8], opacity: f32) -> Vec<u8> {
    let mask = keyhole_mask();
    let mut out = rgba.to_vec();
    for (i, px) in out.chunks_exact_mut(4).enumerate() {
        if mask.get(i).copied().unwrap_or(false) {
            px[3] = (px[3] as f32 * opacity).round() as u8;
        }
    }
    out
}

fn parse_hex(hex: &str) -> Option<[u8; 3]> {
    let h = hex.trim();
    if h.len() != 7 || !h.starts_with('#') { return None; }
    let r = u8::from_str_radix(&h[1..3], 16).ok()?;
    let g = u8::from_str_radix(&h[3..5], 16).ok()?;
    let b = u8::from_str_radix(&h[5..7], 16).ok()?;
    Some([r, g, b])
}

/// The window and taskbar icon (decided 2026-11-16): its keyhole follows the theme's accent too.
const WINDOW_ICON: &[u8] = include_bytes!("../icons/128x128.png");

/// The app icon with its cobalt keyhole painted in `accent` (None: the original). The torii is
/// untouched, and so is every pixel's alpha, so the edges stay smooth.
pub fn themed_window_icon(accent: Option<[u8; 3]>) -> Option<(Vec<u8>, u32, u32)> {
    let decoded = image::load_from_memory(WINDOW_ICON).ok()?.to_rgba8();
    let (w, h) = decoded.dimensions();
    let mut out = decoded.into_raw();
    if let Some(rgb) = accent {
        for px in out.chunks_exact_mut(4) {
            if px[3] > 0 && is_keyhole(px[0] as i32, px[1] as i32, px[2] as i32) {
                px[..3].copy_from_slice(&rgb);
            }
        }
    }
    Some((out, w, h))
}

/// Sets the tray keyhole accent color (hex). Call when the app theme changes.
pub fn set_theme(app: &AppHandle, accent: Option<String>) {
    let next = accent.as_deref().and_then(parse_hex);
    {
        let mut cur = ACCENT.lock().unwrap();
        if *cur == next { return; }
        *cur = next;
    }
    // The main window's icon (title bar, taskbar, Alt+Tab) follows as well.
    if let (Some(win), Some((rgba, w, h))) = (app.get_webview_window("main"), themed_window_icon(next)) {
        let _ = win.set_icon(Image::new_owned(rgba, w, h));
    }
    // Rebuild immediately for non-sealed state; the pulse thread also picks it up.
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        if let Ok(decoded) = image::load_from_memory(ICON) {
            let themed = recolor_keyhole(decoded.to_rgba8().as_raw(), next);
            let base = if taskbar_light() { for_light_taskbar(&themed) } else { themed };
            let (w, h) = decoded.to_rgba8().dimensions();
            let _ = tray.set_icon(Some(Image::new_owned(base, w, h)));
        }
    }
}

/// Opacity through one breath: 1, down to 0.45 halfway, back to 1.
pub fn breath(frame: usize, frames: usize) -> f32 {
    let t = frame as f32 / frames as f32;
    0.725 + 0.275 * (2.0 * std::f32::consts::PI * t).cos()
}

/// How often the taskbar's light or dark is looked at again (a registry read).
const TASKBAR_EVERY: usize = 25;

/// Animates the tray icon while sealed and restores it when the seal ends; follows the
/// taskbar's light or dark (v0.3) and the selected theme accent.
pub fn spawn_pulse(app: AppHandle) {
    std::thread::Builder::new()
        .name("sanctum-tray-pulse".into())
        .spawn(move || {
            let Ok(decoded) = image::load_from_memory(ICON) else { return };
            let dark_base = decoded.to_rgba8();
            let (w, h) = dark_base.dimensions();
            let mut light: Option<bool> = None;
            let mut accent: Option<[u8; 3]> = None;
            let mut base: Vec<u8> = Vec::new();
            let mut frames: Vec<Vec<u8>> = Vec::new();
            let mut i = 0;
            let mut tick = 0;
            let mut pulsing = false;
            loop {
                std::thread::sleep(Duration::from_millis(PULSE_MS / PULSE_FRAMES as u64));
                let Some(shared) = app.try_state::<Shared>() else { continue };
                let sealed = shared.sealed();
                let Some(tray) = app.tray_by_id(TRAY_ID) else { continue };
                let cur_accent = *ACCENT.lock().unwrap();
                let check = tick % TASKBAR_EVERY == 0;
                let now_light = if check { taskbar_light() } else { light.unwrap_or(false) };
                if light != Some(now_light) || accent != cur_accent || base.is_empty() {
                    light = Some(now_light);
                    accent = cur_accent;
                    let themed = recolor_keyhole(dark_base.as_raw(), accent);
                    base = if now_light { for_light_taskbar(&themed) } else { themed };
                    frames = (0..PULSE_FRAMES).map(|f| fade_keyhole(&base, breath(f, PULSE_FRAMES))).collect();
                    if !sealed {
                        let _ = tray.set_icon(Some(Image::new_owned(base.clone(), w, h)));
                    }
                }
                tick += 1;
                if sealed {
                    let _ = tray.set_icon(Some(Image::new_owned(frames[i].clone(), w, h)));
                    i = (i + 1) % PULSE_FRAMES;
                    pulsing = true;
                } else if pulsing {
                    let _ = tray.set_icon(Some(Image::new_owned(base.clone(), w, h)));
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
            "quit" => crate::quit_via_window(app),
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
    fn the_window_icon_keyhole_takes_the_accent_and_the_torii_stays() {
        let (orig, w, h) = themed_window_icon(None).unwrap();
        let (red, w2, h2) = themed_window_icon(Some([0xFF, 0x67, 0x67])).unwrap();
        assert_eq!((w, h), (w2, h2));
        let mut keyhole = 0;
        for (a, b) in orig.chunks_exact(4).zip(red.chunks_exact(4)) {
            assert_eq!(a[3], b[3], "alpha never changes");
            if a[3] > 0 && is_keyhole(a[0] as i32, a[1] as i32, a[2] as i32) {
                keyhole += 1;
                assert_eq!(&b[..3], &[0xFF, 0x67, 0x67]);
            } else {
                assert_eq!(a, b, "the torii and the background stay as they are");
            }
        }
        assert!(keyhole > 20, "the 128px icon has a keyhole to recolour");
    }

    #[test]
    fn a_light_taskbar_gets_the_dark_ink_mark_with_the_keyhole_kept() {
        // The real icon: every opaque torii pixel turns dark, the keyhole stays.
        let icon = image::load_from_memory(ICON).unwrap().to_rgba8();
        let mask = keyhole_mask();
        let light = for_light_taskbar(icon.as_raw());
        let keyhole = mask.iter().filter(|&&m| m).count();
        let kept = light.chunks_exact(4).zip(mask.iter()).filter(|(p, &m)| p[3] > 0 && m).count();
        assert!(keyhole > 0);
        assert_eq!(keyhole, kept);
        let torii_dark = light.chunks_exact(4).zip(mask.iter()).any(|(p, &m)| p[3] > 0 && !m && p[0] == 0x12 && p[1] == 0x15 && p[2] == 0x1C);
        assert!(torii_dark);
    }

    #[test]
    fn theme_accent_recolors_only_keyhole() {
        let icon = image::load_from_memory(ICON).unwrap().to_rgba8();
        let themed = recolor_keyhole(icon.as_raw(), Some([0xAA, 0xBB, 0xCC]));
        let mask = keyhole_mask();
        for (i, px) in themed.chunks_exact(4).enumerate() {
            if mask[i] { assert_eq!(&px[0..3], &[0xAA, 0xBB, 0xCC]); }
            else { assert_eq!(px, icon.as_raw().chunks_exact(4).nth(i).unwrap()); }
        }
    }

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
        let icon = image::load_from_memory(ICON).unwrap().to_rgba8();
        let out = fade_keyhole(icon.as_raw(), 0.45);
        let mask = keyhole_mask();
        for (i, px) in out.chunks_exact(4).enumerate() {
            if mask[i] { assert_eq!(px[3], (icon.as_raw()[i * 4 + 3] as f32 * 0.45).round() as u8); }
            else { assert_eq!(px[3], icon.as_raw()[i * 4 + 3]); }
        }
        assert!((breath(0, 16) - 1.0).abs() < 1e-6);
        assert!((breath(8, 16) - 0.45).abs() < 1e-6);
    }
}
