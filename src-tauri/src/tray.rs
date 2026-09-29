//! System tray (SPEC 4.0.1). Left click toggles the tray panel window (stubbed until M12),
//! right click opens the native menu. Quit is disabled while sealed.

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
    Menu::with_items(app, &[&open, &focus, &sep, &quit])
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let icon = Image::from_bytes(include_bytes!("../icons/tray/32x32.png"))?;
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
