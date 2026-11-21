//! A note in its own window (2026-11-20): one window per note, labeled `note-<id>`, serving the
//! same bundle at `#/note/<id>`. Opening a note that already has a window brings that window
//! forward. Each window's place and size are kept per note and restored when it opens again, as
//! long as it would still be on a screen. Every window hears which notes have their own window
//! (`sanctum://note-windows`), so the main Notes page never shows a second editor for one note,
//! and hears when a note changes anywhere (`sanctum://notes`).

use crate::engine::Locked;
use crate::{db, notes, Shared};
use serde::Serialize;
use std::collections::{BTreeSet, HashMap};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

/// The ids of the notes open in their own window, sorted.
pub const WINDOWS_EVENT: &str = "sanctum://note-windows";
/// A note was created, saved, pinned, or deleted: `{ id, kind, from }`.
pub const NOTES_EVENT: &str = "sanctum://notes";
/// Sent to a note window asked to close: it saves what's waiting, then calls note_window_close.
pub const CLOSING_EVENT: &str = "sanctum://note-window-closing";

const PREFIX: &str = "note-";
const SIZE: (f64, f64) = (560.0, 640.0);
const MIN_SIZE: (f64, f64) = (360.0, 320.0);
/// How much of a saved window's top edge (the title bar, physical px) must be on a screen.
const GRIP: i32 = 32;

pub fn label_for(id: i64) -> String {
    format!("{PREFIX}{id}")
}

/// The note a window label belongs to, or None for any other window.
pub fn id_of(label: &str) -> Option<i64> {
    label.strip_prefix(PREFIX)?.parse().ok().filter(|id| *id > 0)
}

fn bounds_key(id: i64) -> String {
    format!("note_window:{id}")
}

/// How long a closing note window has to save before it's closed anyway: the main window's 3s.
pub const CLOSE_WAIT: std::time::Duration = std::time::Duration::from_secs(3);

/// The notes with their own window, kept as windows open and close, and each window's latest
/// place and size, kept in memory while it moves and written once when it closes (2026-11-21:
/// a write per Moved/Resized event held the database lock through a whole drag).
#[derive(Default)]
pub struct Open {
    ids: Mutex<BTreeSet<i64>>,
    placed: Mutex<HashMap<i64, Bounds>>,
}

impl Open {
    /// True when this changed the list.
    pub fn opened(&self, id: i64) -> bool {
        self.ids.locked().insert(id)
    }

    pub fn closed(&self, id: i64) -> bool {
        self.ids.locked().remove(&id)
    }

    pub fn ids(&self) -> Vec<i64> {
        self.ids.locked().iter().copied().collect()
    }

    /// The window moved or resized: remembered, not written yet.
    pub fn place(&self, id: i64, b: Bounds) {
        self.placed.locked().insert(id, b);
    }

    /// A window's place to write now, taken so it's written once.
    pub fn take_place(&self, id: i64) -> Option<Bounds> {
        self.placed.locked().remove(&id)
    }

    /// Every place still waiting to be written.
    pub fn take_places(&self) -> Vec<(i64, Bounds)> {
        self.placed.locked().drain().collect()
    }
}

/// A window's place and size, in physical pixels: outer position, inner size.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Bounds {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

impl Bounds {
    pub fn parse(s: &str) -> Option<Bounds> {
        let v: Vec<i32> = s.split(',').map(|p| p.trim().parse().ok()).collect::<Option<_>>()?;
        match v[..] {
            [x, y, w, h] if w > 0 && h > 0 => Some(Bounds { x, y, w, h }),
            _ => None,
        }
    }

    pub fn text(&self) -> String {
        format!("{},{},{},{}", self.x, self.y, self.w, self.h)
    }
}

/// Where a saved window goes back to: the screen (work area) holding the middle of its top edge,
/// with the window shrunk to fit that screen and moved fully onto it. None when that spot is on no
/// screen any more (a monitor unplugged): the window opens centered instead.
pub fn restore(saved: Bounds, areas: &[Bounds]) -> Option<Bounds> {
    let (cx, cy) = (saved.x + saved.w / 2, saved.y + GRIP / 2);
    let a = areas.iter().find(|a| cx >= a.x && cx < a.x + a.w && cy >= a.y && cy < a.y + a.h)?;
    let (w, h) = (saved.w.min(a.w), saved.h.min(a.h));
    Some(Bounds { x: saved.x.clamp(a.x, a.x + a.w - w), y: saved.y.clamp(a.y, a.y + a.h - h), w, h })
}

/// "#1C1F26" (or "#1C1F26FF") to a color; anything else is None.
pub fn parse_color(hex: &str) -> Option<tauri::window::Color> {
    let h = hex.strip_prefix('#')?;
    if !(h.len() == 6 || h.len() == 8) || !h.is_ascii() {
        return None;
    }
    let byte = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).ok();
    Some(tauri::window::Color(byte(0)?, byte(2)?, byte(4)?, if h.len() == 8 { byte(6)? } else { 255 }))
}

/// The window title for a note: its title, or "Note".
pub fn window_title(title: &str) -> String {
    let t = title.trim();
    if t.is_empty() { "Note".into() } else { t.chars().take(80).collect() }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NotesChanged {
    pub id: i64,
    pub kind: &'static str,
    /// The window it happened in, so that window can skip its own news.
    pub from: String,
}

/// Tells every window a note changed.
pub fn changed(app: &AppHandle, id: i64, kind: &'static str, from: &str) {
    let _ = app.emit(NOTES_EVENT, NotesChanged { id, kind, from: from.to_string() });
}

fn emit_list(app: &AppHandle) {
    if let Some(open) = app.try_state::<Open>() {
        let _ = app.emit(WINDOWS_EVENT, open.ids());
    }
}

fn work_areas(app: &AppHandle) -> Vec<Bounds> {
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            let a = m.work_area();
            Bounds { x: a.position.x, y: a.position.y, w: a.size.width as i32, h: a.size.height as i32 }
        })
        .collect()
}

/// Opens a note in its own window, or brings its window forward. `background` (the theme's page
/// color) and `theme` ("light"/"dark" when not following Windows) are the opening window's, so a
/// new window paints in the right colors from its first frame, the way the main window does.
#[tauri::command]
pub async fn note_window_open(app: AppHandle, id: i64, background: Option<String>, theme: Option<String>) -> Result<(), String> {
    let label = label_for(id);
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    let (title, saved) = {
        let shared = app.state::<Shared>();
        let conn = shared.db.locked();
        let title = notes::get(&conn, id)?.title;
        let saved = db::get_setting(&conn, &bounds_key(id)).ok().flatten().and_then(|s| Bounds::parse(&s));
        (title, saved)
    };
    // WebView2 runs every window in one browser process: a window asking for other arguments
    // than the main window's fails to open, so it asks for the same ones.
    let args = app.config().app.windows.iter().find(|w| w.label == "main").and_then(|w| w.additional_browser_args.clone());
    let mut b = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(format!("index.html#/note/{id}").into()))
        .title(window_title(&title))
        .inner_size(SIZE.0, SIZE.1)
        .min_inner_size(MIN_SIZE.0, MIN_SIZE.1)
        .resizable(true)
        .maximizable(true)
        .center()
        // Placed and sized while hidden, then shown: no jump, and no flash before the page paints.
        .visible(false)
        // Windows: the native file-drop handler swallows the page's own drag and drop.
        .disable_drag_drop_handler()
        .theme(match theme.as_deref() {
            Some("light") => Some(tauri::Theme::Light),
            Some("dark") => Some(tauri::Theme::Dark),
            _ => None,
        });
    if let Some(c) = background.as_deref().and_then(parse_color) {
        b = b.background_color(c);
    }
    if let Some(a) = args {
        b = b.additional_browser_args(&a);
    }
    let w = b.build().map_err(|e| e.to_string())?;
    if let Some(r) = saved.and_then(|s| restore(s, &work_areas(&app))) {
        let _ = w.set_position(PhysicalPosition::new(r.x, r.y));
        let _ = w.set_size(PhysicalSize::new(r.w as u32, r.h as u32));
    }
    let _ = w.show();
    let _ = w.set_focus();
    if app.state::<Open>().opened(id) {
        emit_list(&app);
    }
    Ok(())
}

/// Closes a note's window, if it has one (its page has saved by then, or the note is gone).
#[tauri::command]
pub fn note_window_close(app: AppHandle, id: i64) {
    close(&app, id);
}

/// The notes open in their own window now.
#[tauri::command]
pub fn note_window_list(open: tauri::State<Open>) -> Vec<i64> {
    open.ids()
}

pub fn close(app: &AppHandle, id: i64) {
    if let Some(w) = app.get_webview_window(&label_for(id)) {
        let _ = w.destroy();
    }
}

/// A deleted note's saved window place goes with it.
pub fn forget_bounds(conn: &rusqlite::Connection, id: i64) {
    let _ = conn.execute("DELETE FROM settings WHERE key = ?1", [bounds_key(id)]);
}

/// Window events for `note-*` windows (from lib.rs's on_window_event).
pub fn on_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    let Some(id) = id_of(window.label()) else { return };
    let app = window.app_handle();
    match event {
        // The page saves what's still waiting first; a page that doesn't answer is closed anyway.
        tauri::WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            if app.emit_to(window.label(), CLOSING_EVENT, id).is_err() {
                close(app, id);
                return;
            }
            // The main window's 3s (2026-11-21): 1.5s could cut off a save waiting on the database.
            let app = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(CLOSE_WAIT);
                close(&app, id);
            });
        }
        tauri::WindowEvent::Destroyed => {
            write_place(app, id);
            if app.try_state::<Open>().is_some_and(|o| o.closed(id)) {
                emit_list(app);
            }
        }
        tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => remember_place(window, id),
        _ => {}
    }
}

fn remember_place(window: &tauri::Window, id: i64) {
    // Minimized windows sit far off screen, and a maximized one has no size of its own to keep.
    if window.is_minimized().unwrap_or(true) || window.is_maximized().unwrap_or(true) || !window.is_visible().unwrap_or(false) {
        return;
    }
    let (Ok(p), Ok(s)) = (window.outer_position(), window.inner_size()) else { return };
    let Some(open) = window.app_handle().try_state::<Open>() else { return };
    open.place(id, Bounds { x: p.x, y: p.y, w: s.width as i32, h: s.height as i32 });
}

/// Writes a window's last place, if it moved since it was last written.
fn write_place(app: &AppHandle, id: i64) {
    let (Some(open), Some(shared)) = (app.try_state::<Open>(), app.try_state::<Shared>()) else { return };
    if let Some(b) = open.take_place(id) {
        let _ = db::set_setting(&shared.db.locked(), &bounds_key(id), &b.text());
    }
}

/// Writes every place still waiting, then quits.
fn finish_exit(app: &AppHandle) {
    if let (Some(open), Some(shared)) = (app.try_state::<Open>(), app.try_state::<Shared>()) {
        let conn = shared.db.locked();
        for (id, b) in open.take_places() {
            let _ = db::set_setting(&conn, &bounds_key(id), &b.text());
        }
    }
    app.exit(0);
}

/// Quits once every note window has saved and closed, each asked the way its X asks, or after
/// CLOSE_WAIT (2026-11-21). Quitting used to exit as soon as the main window had saved, so a note
/// window's last typing could be lost. Their places are written first either way.
pub fn exit_after_saving(app: &AppHandle) {
    let ids = app.try_state::<Open>().map(|o| o.ids()).unwrap_or_default();
    if ids.is_empty() {
        return finish_exit(app);
    }
    for id in &ids {
        if app.emit_to(label_for(*id).as_str(), CLOSING_EVENT, *id).is_err() {
            close(app, *id);
        }
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let until = std::time::Instant::now() + CLOSE_WAIT;
        while std::time::Instant::now() < until && app.try_state::<Open>().is_some_and(|o| !o.ids().is_empty()) {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        finish_exit(&app);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_round_trip_and_other_windows_are_not_notes() {
        assert_eq!(label_for(42), "note-42");
        assert_eq!(id_of("note-42"), Some(42));
        for other in ["main", "tray-panel", "compact", "intercept", "note-", "note-x", "note--3", "note-0", "notes-1"] {
            assert_eq!(id_of(other), None, "{other}");
        }
    }

    #[test]
    fn the_open_list_changes_once_per_open_and_close() {
        let open = Open::default();
        assert!(open.opened(7));
        assert!(!open.opened(7), "a second open of the same note is the same window");
        assert!(open.opened(3));
        assert_eq!(open.ids(), vec![3, 7]);
        assert!(open.closed(7));
        assert!(!open.closed(7));
        assert_eq!(open.ids(), vec![3]);
    }

    #[test]
    fn a_window_place_is_kept_in_memory_and_taken_once_to_write() {
        let open = Open::default();
        // A drag fires many moves: only the last place is kept, nothing is written yet.
        for x in 0..50 {
            open.place(3, Bounds { x, y: 10, w: 560, h: 640 });
        }
        open.place(7, Bounds { x: 1, y: 1, w: 400, h: 400 });
        assert_eq!(open.take_place(3), Some(Bounds { x: 49, y: 10, w: 560, h: 640 }));
        // Taken once: a second close writes nothing.
        assert_eq!(open.take_place(3), None);
        assert_eq!(open.take_places(), vec![(7, Bounds { x: 1, y: 1, w: 400, h: 400 })]);
        assert!(open.take_places().is_empty());
    }

    #[test]
    fn saved_bounds_parse_and_print() {
        let b = Bounds { x: -1200, y: 40, w: 560, h: 640 };
        assert_eq!(Bounds::parse(&b.text()), Some(b));
        for bad in ["", "1,2,3", "1,2,0,4", "a,b,c,d", "1,2,3,4,5"] {
            assert_eq!(Bounds::parse(bad), None, "{bad}");
        }
    }

    #[test]
    fn saved_bounds_come_back_only_on_a_screen_and_fit_it() {
        let primary = Bounds { x: 0, y: 0, w: 1920, h: 1040 };
        let left = Bounds { x: -1280, y: 0, w: 1280, h: 984 };
        let screens = [primary, left];
        // On a screen: unchanged.
        let b = Bounds { x: 300, y: 200, w: 560, h: 640 };
        assert_eq!(restore(b, &screens), Some(b));
        // On the second screen.
        let l = Bounds { x: -1000, y: 100, w: 560, h: 640 };
        assert_eq!(restore(l, &screens), Some(l));
        // Hanging off the right edge: moved back on.
        assert_eq!(restore(Bounds { x: 1600, y: 600, w: 560, h: 640 }, &screens), Some(Bounds { x: 1360, y: 400, w: 560, h: 640 }));
        // Bigger than the screen: shrunk to it.
        assert_eq!(restore(Bounds { x: 10, y: 10, w: 2400, h: 1400 }, &[primary]), Some(Bounds { x: 0, y: 0, w: 1920, h: 1040 }));
        // Its monitor is gone: opens centered instead.
        assert_eq!(restore(l, &[primary]), None);
        assert_eq!(restore(Bounds { x: 300, y: -500, w: 560, h: 640 }, &screens), None);
    }

    #[test]
    fn colors_and_titles() {
        let c = parse_color("#0B0D12").unwrap();
        assert_eq!((c.0, c.1, c.2, c.3), (0x0b, 0x0d, 0x12, 255));
        assert_eq!(parse_color("#0B0D1280").unwrap().3, 0x80);
        for bad in ["0B0D12", "#0B0D1", "#GG0000", "#Ã©Ã©Ã©"] {
            assert!(parse_color(bad).is_none(), "{bad}");
        }
        assert_eq!(window_title("  "), "Note");
        assert_eq!(window_title(" Books to read "), "Books to read");
    }
}
