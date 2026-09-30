//! Releases (M13, decided 2026-09-30): unsigned NSIS installers on GitHub Releases, updated
//! in place by tauri-plugin-updater (updates are signed with the project's updater key, so
//! only published builds install). Crash reports stay local: a panic writes a log under app
//! data, and Setup copies a diagnostics summary to paste into a GitHub issue.

use crate::{db, Shared};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_updater::UpdaterExt;

pub const REPO: &str = "https://github.com/ryanhang07/sanctum";
const MAX_LOGS: usize = 5;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub notes: Option<String>,
}

fn friendly(e: impl std::fmt::Display) -> String {
    let e = e.to_string();
    if e.contains("404") || e.to_lowercase().contains("could not fetch") {
        "No published release to check against yet.".into()
    } else {
        format!("Couldn't check for updates: {e}")
    }
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    let update = app.updater().map_err(friendly)?.check().await.map_err(friendly)?;
    Ok(update.map(|u| UpdateInfo { version: u.version, notes: u.body }))
}

/// Downloads, installs, and restarts. Never while sealed: the restart would drop the seal's
/// enforcement for a few seconds and look like tampering.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    if app.state::<Shared>().sealed() {
        return Err("Updates wait until the seal ends.".into());
    }
    let Some(update) = app.updater().map_err(friendly)?.check().await.map_err(friendly)? else {
        return Err("Sanctum is up to date.".into());
    };
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| format!("The update didn't install: {e}"))?;
    app.restart();
}

#[tauri::command]
pub fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

// --- Crash logs ---

pub fn logs_dir(app_data: &Path) -> PathBuf {
    app_data.join("logs")
}

/// Writes panics to `<app data>\logs\crash-<time>.log`, keeping the last few.
pub fn install_panic_hook(app_data: &Path) {
    let dir = logs_dir(app_data);
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let _ = std::fs::create_dir_all(&dir);
        let now = chrono::Local::now();
        let thread = std::thread::current().name().unwrap_or("unnamed").to_string();
        let text = format!(
            "Sanctum {} crashed at {}\nthread: {thread}\n{info}\n\n{}",
            env!("CARGO_PKG_VERSION"),
            now.to_rfc3339(),
            std::backtrace::Backtrace::force_capture()
        );
        let _ = std::fs::write(dir.join(format!("crash-{}.log", now.format("%Y%m%d-%H%M%S"))), text);
        prune(&dir);
        previous(info);
    }));
}

fn crash_logs(dir: &Path) -> Vec<PathBuf> {
    let mut logs: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|r| r.filter_map(|e| e.ok().map(|e| e.path())).filter(|p| p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("crash-"))).collect())
        .unwrap_or_default();
    logs.sort();
    logs
}

fn prune(dir: &Path) {
    let logs = crash_logs(dir);
    for old in logs.iter().take(logs.len().saturating_sub(MAX_LOGS)) {
        let _ = std::fs::remove_file(old);
    }
}

/// A plain-text summary for bug reports. Nothing personal: no titles, sites, or emails.
#[tauri::command]
pub fn diagnostics(app: AppHandle, shared: State<Shared>) -> Result<String, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let mut out = vec![
        format!("Sanctum {}{}", env!("CARGO_PKG_VERSION"), if cfg!(debug_assertions) { " (dev build)" } else { "" }),
        format!("Windows: {}", sysinfo::System::long_os_version().unwrap_or_default()),
    ];
    if let Ok(conn) = shared.db.lock() {
        if let Ok(s) = db::status(&conn) {
            out.push(format!("Database: schema {} of {}, {}", s.version, db::MIGRATIONS.len(), if s.ready { "ready" } else { "NOT ready" }));
        }
        let g = crate::guard::status(&conn);
        out.push(format!("Protection: {}", if !g.installed { "off" } else if g.running { "on" } else { "installed, not running" }));
    }
    out.push(format!("Sealed: {}", shared.sealed()));
    out.push(format!(
        "Configured: Google Calendar {}, account {}",
        if crate::gcal::oauth::CLIENT_ID.is_empty() { "no" } else { "yes" },
        if crate::cloud::configured() { "yes" } else { "no" }
    ));
    let logs = crash_logs(&logs_dir(&app_data));
    match logs.last() {
        Some(last) => {
            let text = std::fs::read_to_string(last).unwrap_or_default();
            let head: String = text.lines().take(40).collect::<Vec<_>>().join("\n");
            out.push(format!("Crash logs: {} (latest below)\n\n{head}", logs.len()));
        }
        None => out.push("Crash logs: none".into()),
    }
    out.push(format!("Report at {REPO}/issues"));
    Ok(out.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_last_few_crash_logs() {
        let dir = std::env::temp_dir().join(format!("sanctum-logs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        for i in 0..8 {
            std::fs::write(dir.join(format!("crash-2026093{}-000000.log", i)), "x").unwrap();
        }
        std::fs::write(dir.join("other.txt"), "keep").unwrap();
        prune(&dir);
        let left = crash_logs(&dir);
        assert_eq!(left.len(), MAX_LOGS);
        assert!(left[0].ends_with("crash-20260933-000000.log"));
        assert!(dir.join("other.txt").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
