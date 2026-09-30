// Prevents an extra console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Run as the guard service or its elevated installer (M8).
    if let Some(code) = sanctum_lib::guard::cli() {
        std::process::exit(code as i32);
    }
    // Started by a browser for the extension: relay, don't open the app (4b).
    if sanctum_lib::bridge::is_launch() {
        return sanctum_lib::bridge::run();
    }
    sanctum_lib::run()
}
