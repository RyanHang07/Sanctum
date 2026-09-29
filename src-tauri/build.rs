fn main() {
    // Google OAuth client for Calendar (SPEC 4.3): read from the environment or the gitignored
    // src-tauri/.env at build time. Missing values build fine; Setup then says it's not configured.
    println!("cargo:rerun-if-changed=.env");
    let file = std::fs::read_to_string(".env").unwrap_or_default();
    for key in ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] {
        println!("cargo:rerun-if-env-changed={key}");
        let from_file = file.lines().find_map(|line| {
            let (k, v) = line.trim_start_matches('\u{feff}').split_once('=')?;
            (k.trim() == key).then(|| v.trim().trim_matches('"').to_string())
        });
        let value = std::env::var(key).ok().filter(|v| !v.is_empty()).or(from_file).unwrap_or_default();
        println!("cargo:rustc-env={key}={value}");
    }
    tauri_build::build()
}
