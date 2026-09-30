// Prevents an extra console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Started by a browser for the extension: relay, don't open the app (4b).
    if sanctum_lib::bridge::is_launch() {
        return sanctum_lib::bridge::run();
    }
    sanctum_lib::run()
}
