//! App discovery for the picker: Start menu shortcuts a person would launch, plus apps
//! with a window open right now (their real exe, which is what sealing matches on).
//! Windows only; other platforms return nothing for now.

use crate::blocker;
use serde::Serialize;
use std::collections::HashSet;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstalledApp {
    /// Display name ("Discord").
    pub name: String,
    /// Lowercase exe name, what blocking matches on ("discord.exe").
    pub exe: String,
    /// What to open to launch it (a .lnk keeps its arguments, e.g. Squirrel apps).
    pub launch: String,
    /// Has a window open right now.
    pub running: bool,
}

/// Start menu folders that hold Windows tools, SDKs, and autostart copies, not apps.
const SKIP_FOLDERS: [&str; 10] = [
    "accessories",
    "accessibility",
    "administrative tools",
    "maintenance",
    "startup",
    "system tools",
    "windows accessories",
    "windows kits",
    "windows powershell",
    "windows tools",
];

/// `rel` is the shortcut's folder relative to the Start menu Programs root.
pub fn skip_folder(rel: &str) -> bool {
    rel.split(['\\', '/']).any(|part| SKIP_FOLDERS.contains(&part.to_lowercase().as_str()))
}

/// Squirrel installers (Discord, Slack, ...) point shortcuts at Update.exe with
/// `--processStart Real.exe`; the real exe is what runs, so that's what we seal.
pub fn exe_from_target(target: &str, args: &str) -> Option<String> {
    let file = target.rsplit(['\\', '/']).next()?.to_lowercase();
    if !file.ends_with(".exe") {
        return None;
    }
    if file == "update.exe" {
        let mut parts = args.split_whitespace();
        while let Some(p) = parts.next() {
            if p.eq_ignore_ascii_case("--processStart") {
                return parts.next().map(|s| s.trim_matches('"').to_lowercase());
            }
        }
    }
    Some(file)
}

/// Uninstallers, installers, updaters, readmes, and anything Sanctum may never close.
pub fn is_noise(name: &str, exe: &str) -> bool {
    let n = name.to_lowercase();
    const NAME_WORDS: [&str; 10] =
        ["uninstall", "readme", "help", "documentation", "release notes", "license", "website", "support", "setup", "installer"];
    const EXE_WORDS: [&str; 7] = ["unins", "install", "setup", "update", "crashpad", "crashhandler", "msiexec"];
    NAME_WORDS.iter().any(|w| n.contains(w)) || EXE_WORDS.iter().any(|w| exe.contains(w)) || blocker::is_protected(exe)
}

/// A running app with a visible window.
#[derive(Clone, Debug, PartialEq)]
pub struct RunningApp {
    pub exe: String,
    pub path: String,
    /// The exe's FileDescription ("League of Legends"), if it has one.
    pub description: Option<String>,
}

fn stem_name(exe: &str) -> String {
    let stem = exe.trim_end_matches(".exe");
    let mut c = stem.chars();
    c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
}

/// Drops noise and duplicate exes (first shortcut wins), marks what's running, and adds
/// running apps that have no shortcut (games started by launchers, portable apps).
pub fn merge(shortcuts: Vec<InstalledApp>, running: Vec<RunningApp>) -> Vec<InstalledApp> {
    let live: HashSet<&str> = running.iter().map(|r| r.exe.as_str()).collect();
    let mut seen = HashSet::new();
    let mut out: Vec<InstalledApp> = shortcuts
        .into_iter()
        .filter(|a| !is_noise(&a.name, &a.exe) && seen.insert(a.exe.clone()))
        .map(|a| InstalledApp { running: live.contains(a.exe.as_str()), ..a })
        .collect();
    for r in running {
        let name = r.description.clone().filter(|d| !d.trim().is_empty()).unwrap_or_else(|| stem_name(&r.exe));
        if !is_noise(&name, &r.exe) && seen.insert(r.exe.clone()) {
            out.push(InstalledApp { name, exe: r.exe, launch: r.path, running: true });
        }
    }
    out.sort_by_key(|a| a.name.to_lowercase());
    out
}

#[cfg(windows)]
pub use win::{icon_data_url, scan};

#[cfg(not(windows))]
pub fn scan() -> Vec<InstalledApp> {
    Vec::new()
}

#[cfg(not(windows))]
pub fn icon_data_url(_path: &str) -> Option<String> {
    None
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::path::{Path, PathBuf};
    use windows::core::{Interface, PCWSTR};
    use windows::Win32::Graphics::Gdi::{
        DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
        DIB_RGB_COLORS, HGDIOBJ,
    };
    use windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED, STGM_READ,
    };
    use windows::Win32::UI::Shell::{
        IShellLinkW, SHDefExtractIconW, SHGetFileInfoW, ShellLink, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON,
    };
    use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, HICON, ICONINFO};

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn from_wide(buf: &[u16]) -> String {
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        String::from_utf16_lossy(&buf[..end])
    }

    /// Initializes COM for the calling thread; balanced on drop.
    struct Com(bool);
    impl Com {
        fn init() -> Self {
            Com(unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.is_ok())
        }
    }
    impl Drop for Com {
        fn drop(&mut self) {
            if self.0 {
                unsafe { CoUninitialize() };
            }
        }
    }

    fn start_menu_dirs() -> Vec<PathBuf> {
        // Per-user shortcuts first so they win over all-users duplicates.
        ["APPDATA", "ProgramData"]
            .iter()
            .filter_map(|var| std::env::var(var).ok())
            .map(|base| Path::new(&base).join("Microsoft\\Windows\\Start Menu\\Programs"))
            .collect()
    }

    /// Every .lnk under `root`, with its folder relative to `root`.
    fn shortcuts(root: &Path, dir: &Path, out: &mut Vec<(PathBuf, String)>) {
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                shortcuts(root, &p, out);
            } else if p.extension().is_some_and(|x| x.eq_ignore_ascii_case("lnk")) {
                let rel = dir.strip_prefix(root).map(|r| r.to_string_lossy().to_string()).unwrap_or_default();
                out.push((p, rel));
            }
        }
    }

    fn resolve(link: &IShellLinkW, lnk: &Path) -> Option<(String, String)> {
        unsafe {
            link.cast::<IPersistFile>().ok()?.Load(PCWSTR(wide(&lnk.to_string_lossy()).as_ptr()), STGM_READ).ok()?;
            let mut target = [0u16; 1024];
            link.GetPath(&mut target, std::ptr::null_mut(), 0).ok()?;
            let mut args = [0u16; 2048];
            let _ = link.GetArguments(&mut args);
            Some((from_wide(&target), from_wide(&args)))
        }
    }

    fn from_shortcuts() -> Vec<InstalledApp> {
        let mut files = Vec::new();
        for root in start_menu_dirs() {
            shortcuts(&root, &root, &mut files);
        }
        let Ok(link) = (unsafe { CoCreateInstance::<_, IShellLinkW>(&ShellLink, None, CLSCTX_INPROC_SERVER) }) else {
            return Vec::new();
        };
        files
            .into_iter()
            .filter(|(_, rel)| !skip_folder(rel))
            .filter_map(|(lnk, _)| {
                let (target, args) = resolve(&link, &lnk)?;
                // MSI "advertised" shortcuts have no target, and dead shortcuts point at
                // files that were removed; neither is an app you can run.
                if target.is_empty() || !Path::new(&target).exists() {
                    return None;
                }
                let exe = exe_from_target(&target, &args)?;
                if target.to_lowercase().contains("\\windows\\") {
                    return None;
                }
                let name = lnk.file_stem()?.to_string_lossy().to_string();
                Some(InstalledApp { name, exe, launch: lnk.to_string_lossy().to_string(), running: false })
            })
            .collect()
    }

    /// FileDescription from the exe's version resource ("League of Legends").
    fn file_description(path: &str) -> Option<String> {
        use windows::Win32::Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW};
        unsafe {
            let wpath = wide(path);
            let size = GetFileVersionInfoSizeW(PCWSTR(wpath.as_ptr()), None);
            if size == 0 {
                return None;
            }
            let mut data = vec![0u8; size as usize];
            GetFileVersionInfoW(PCWSTR(wpath.as_ptr()), None, size, data.as_mut_ptr() as *mut _).ok()?;
            let mut ptr: *mut std::ffi::c_void = std::ptr::null_mut();
            let mut len = 0u32;
            // First language/codepage pair, e.g. 0409 04b0.
            if !VerQueryValueW(data.as_ptr() as *const _, PCWSTR(wide("\\VarFileInfo\\Translation").as_ptr()), &mut ptr, &mut len).as_bool()
                || len < 4
            {
                return None;
            }
            let pair = std::slice::from_raw_parts(ptr as *const u16, 2);
            let key = format!("\\StringFileInfo\\{:04x}{:04x}\\FileDescription", pair[0], pair[1]);
            if !VerQueryValueW(data.as_ptr() as *const _, PCWSTR(wide(&key).as_ptr()), &mut ptr, &mut len).as_bool() || len == 0 {
                return None;
            }
            let desc = String::from_utf16_lossy(std::slice::from_raw_parts(ptr as *const u16, len as usize));
            let desc = desc.trim_end_matches('\0').trim().to_string();
            (!desc.is_empty()).then_some(desc)
        }
    }

    /// Apps with a visible window right now, with the exe that actually runs.
    fn running_apps() -> Vec<RunningApp> {
        use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
        let windowed = crate::winutil::windowed_pids();
        let mut sys = System::new();
        sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_exe(UpdateKind::Always));
        let mut seen = HashSet::new();
        windowed
            .into_iter()
            .filter_map(|pid| {
                let p = sys.process(sysinfo::Pid::from_u32(pid))?;
                let exe = p.name().to_string_lossy().to_lowercase();
                let path = p.exe()?.to_string_lossy().to_string();
                if !seen.insert(exe.clone()) || path.to_lowercase().contains("\\windows\\") {
                    return None;
                }
                Some(RunningApp { description: file_description(&path), exe, path })
            })
            .collect()
    }

    pub fn scan() -> Vec<InstalledApp> {
        let _com = Com::init();
        merge(from_shortcuts(), running_apps())
    }

    /// Icon size extracted; the UI draws 16-20px, so 48 stays sharp at 150-200% scaling.
    const ICON_PX: u32 = 48;

    /// Where to look for an icon, best first. Reading it off the .lnk itself bakes in the
    /// shortcut arrow, so try the link's icon location and its target before the link.
    fn icon_sources(path: &str) -> Vec<(String, i32)> {
        let mut out = Vec::new();
        if path.to_lowercase().ends_with(".lnk") {
            unsafe {
                if let Ok(link) = CoCreateInstance::<_, IShellLinkW>(&ShellLink, None, CLSCTX_INPROC_SERVER) {
                    let loaded = link
                        .cast::<IPersistFile>()
                        .ok()
                        .is_some_and(|f| f.Load(PCWSTR(wide(path).as_ptr()), STGM_READ).is_ok());
                    if loaded {
                        let mut loc = [0u16; 1024];
                        let mut index = 0i32;
                        if link.GetIconLocation(&mut loc, &mut index).is_ok() {
                            let loc = expand_env(&from_wide(&loc));
                            if !loc.is_empty() && Path::new(&loc).exists() {
                                out.push((loc, index));
                            }
                        }
                        let mut target = [0u16; 1024];
                        if link.GetPath(&mut target, std::ptr::null_mut(), 0).is_ok() {
                            let target = from_wide(&target);
                            if !target.is_empty() && Path::new(&target).exists() {
                                out.push((target, 0));
                            }
                        }
                    }
                }
            }
        }
        out.push((path.to_string(), 0));
        out
    }

    /// %SystemRoot%oo.ico -> C:Windowsoo.ico
    fn expand_env(s: &str) -> String {
        let mut out = String::new();
        let mut parts = s.split('%');
        out.push_str(parts.next().unwrap_or(""));
        let rest: Vec<&str> = parts.collect();
        let mut i = 0;
        while i < rest.len() {
            if i + 1 < rest.len() {
                match std::env::var(rest[i]) {
                    Ok(v) => out.push_str(&v),
                    Err(_) => {
                        out.push('%');
                        out.push_str(rest[i]);
                        out.push('%');
                    }
                }
                out.push_str(rest[i + 1]);
                i += 2;
            } else {
                out.push('%');
                out.push_str(rest[i]);
                i += 1;
            }
        }
        out
    }

    fn extract(src: &str, index: i32) -> Option<HICON> {
        let mut large = HICON::default();
        let ok = unsafe {
            SHDefExtractIconW(PCWSTR(wide(src).as_ptr()), index, 0, Some(&mut large), None, ICON_PX | (16 << 16))
        };
        if ok.is_ok() && !large.is_invalid() {
            return Some(large);
        }
        // Files without embedded icons (or odd formats): ask the shell, which never adds an
        // overlay for a plain file path.
        let mut info = SHFILEINFOW::default();
        let ok = unsafe {
            SHGetFileInfoW(
                PCWSTR(wide(src).as_ptr()),
                FILE_FLAGS_AND_ATTRIBUTES(0),
                Some(&mut info),
                std::mem::size_of::<SHFILEINFOW>() as u32,
                SHGFI_ICON | SHGFI_LARGEICON,
            )
        };
        (ok != 0 && !info.hIcon.is_invalid()).then_some(info.hIcon)
    }

    /// App icon for an exe or shortcut as a PNG data URL, without the shortcut arrow.
    pub fn icon_data_url(path: &str) -> Option<String> {
        use base64::Engine;
        let _com = Com::init();
        let icon = icon_sources(path).into_iter().find_map(|(src, index)| extract(&src, index))?;
        let png = icon_to_png(icon);
        unsafe {
            let _ = DestroyIcon(icon);
        }
        let png = png?;
        Some(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png)))
    }

    fn icon_to_png(icon: HICON) -> Option<Vec<u8>> {
        unsafe {
            let mut ii = ICONINFO::default();
            GetIconInfo(icon, &mut ii).ok()?;
            let cleanup = |ii: &ICONINFO| {
                let _ = DeleteObject(HGDIOBJ(ii.hbmColor.0));
                let _ = DeleteObject(HGDIOBJ(ii.hbmMask.0));
            };
            let mut bm = BITMAP::default();
            if ii.hbmColor.is_invalid()
                || GetObjectW(HGDIOBJ(ii.hbmColor.0), std::mem::size_of::<BITMAP>() as i32, Some(&mut bm as *mut _ as *mut _)) == 0
            {
                cleanup(&ii);
                return None;
            }
            let (w, h) = (bm.bmWidth, bm.bmHeight);
            let mut bmi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: w,
                    biHeight: -h, // top-down
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut buf = vec![0u8; (w * h * 4) as usize];
            let mut mask = vec![0u8; (w * h * 4) as usize];
            let dc = GetDC(None);
            let lines = GetDIBits(dc, ii.hbmColor, 0, h as u32, Some(buf.as_mut_ptr() as *mut _), &mut bmi, DIB_RGB_COLORS);
            let mask_lines = GetDIBits(dc, ii.hbmMask, 0, h as u32, Some(mask.as_mut_ptr() as *mut _), &mut bmi, DIB_RGB_COLORS);
            ReleaseDC(None, dc);
            cleanup(&ii);
            if lines == 0 {
                return None;
            }
            // BGRA -> RGBA. Old icons carry no alpha channel; their transparency is in the
            // AND mask (white = transparent), so use that instead of painting them opaque.
            let has_alpha = buf.chunks(4).any(|p| p[3] != 0);
            for (i, p) in buf.chunks_mut(4).enumerate() {
                p.swap(0, 2);
                if !has_alpha {
                    let transparent = mask_lines != 0 && mask[i * 4] != 0;
                    p[3] = if transparent { 0 } else { 255 };
                }
            }
            let img = image::RgbaImage::from_raw(w as u32, h as u32, buf)?;
            let mut out = std::io::Cursor::new(Vec::new());
            img.write_to(&mut out, image::ImageFormat::Png).ok()?;
            Some(out.into_inner())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_exe_from_targets() {
        assert_eq!(exe_from_target("C:\\Program Files\\Microsoft VS Code\\Code.exe", "").as_deref(), Some("code.exe"));
        assert_eq!(
            exe_from_target("C:\\Users\\r\\AppData\\Local\\Discord\\Update.exe", "--processStart Discord.exe").as_deref(),
            Some("discord.exe")
        );
        assert_eq!(exe_from_target("C:\\docs\\manual.pdf", ""), None);
        assert_eq!(exe_from_target("", ""), None);
    }

    /// Writes every scanned app's icon into one contact sheet (on a checkerboard, so missing
    /// alpha shows up) at $SANCTUM_ICON_SHEET. Run with `cargo test icon_sheet -- --ignored`.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn icon_sheet() {
        use base64::Engine;
        let apps = scan();
        let (cell, cols) = (56u32, 10u32);
        let rows = (apps.len() as u32).div_ceil(cols);
        let mut sheet = image::RgbaImage::from_fn(cell * cols, cell * rows, |x, y| {
            if (x / 4 + y / 4) % 2 == 0 { image::Rgba([90, 90, 90, 255]) } else { image::Rgba([160, 160, 160, 255]) }
        });
        let mut missing = Vec::new();
        for (i, a) in apps.iter().enumerate() {
            let Some(url) = icon_data_url(&a.launch) else {
                missing.push(a.name.clone());
                continue;
            };
            let png = base64::engine::general_purpose::STANDARD.decode(url.trim_start_matches("data:image/png;base64,")).unwrap();
            let icon = image::load_from_memory(&png).unwrap().to_rgba8();
            let (x, y) = ((i as u32 % cols) * cell + 4, (i as u32 / cols) * cell + 4);
            image::imageops::overlay(&mut sheet, &icon, x as i64, y as i64);
            println!("{i:>2} {:<34} {}x{}", a.name, icon.width(), icon.height());
        }
        println!("missing: {missing:?}");
        sheet.save(std::env::var("SANCTUM_ICON_SHEET").unwrap()).unwrap();
    }

    /// Touches the real Start menu and registry. Run with `cargo test -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn scans_this_machine() {
        let apps = scan();
        println!("{} apps", apps.len());
        for a in apps.iter() {
            println!("  {:<32} {:<24} {}", a.name, a.exe, a.launch);
        }
        assert!(!apps.is_empty());
        let icon = icon_data_url(&apps[0].launch);
        println!("icon for {}: {} bytes", apps[0].name, icon.as_ref().map_or(0, |s| s.len()));
        assert!(icon.is_some_and(|s| s.starts_with("data:image/png;base64,")));
    }

    #[test]
    fn drops_noise_and_duplicates() {
        let app = |name: &str, exe: &str| InstalledApp { name: name.into(), exe: exe.into(), launch: String::new(), running: false };
        let out = merge(
            vec![
                app("Zoom", "zoom.exe"),
                app("Uninstall Zoom", "unins000.exe"),
                app("discord", "discord.exe"),
                app("Discord (copy)", "discord.exe"),
                app("Steam Support Center", "steam.exe"),
                app("Visual Studio Installer", "setup.exe"),
                app("Roblox Studio", "robloxstudioinstaller.exe"),
                app("Windows Software Development Kit", "explorer.exe"),
            ],
            vec![],
        );
        let names: Vec<_> = out.iter().map(|a| a.name.as_str()).collect();
        assert_eq!(names, vec!["discord", "Zoom"]);
    }

    #[test]
    fn skips_windows_folders() {
        for rel in ["Accessories", "Administrative Tools", "Windows Kits\\Windows App Certification Kit", "Startup", "Windows PowerShell"] {
            assert!(skip_folder(rel), "{rel}");
        }
        for rel in ["", "Discord Inc", "Riot Games", "Python 3.12"] {
            assert!(!skip_folder(rel), "{rel}");
        }
    }

    #[test]
    fn adds_running_apps_without_shortcuts() {
        let shortcut = InstalledApp { name: "Discord".into(), exe: "discord.exe".into(), launch: "Discord.lnk".into(), running: false };
        let running = |exe: &str, desc: Option<&str>| RunningApp { exe: exe.into(), path: format!("C:\\Games\\{exe}"), description: desc.map(Into::into) };
        let out = merge(
            vec![shortcut, InstalledApp { name: "Zoom".into(), exe: "zoom.exe".into(), launch: "Zoom.lnk".into(), running: false }],
            vec![
                running("discord.exe", Some("Discord")),
                running("leagueclient.exe", Some("League of Legends")),
                running("portable.exe", None),
                running("msedgewebview2.exe", Some("Microsoft Edge WebView2")),
                running("sanctum.exe", Some("Sanctum")),
            ],
        );
        let rows: Vec<_> = out.iter().map(|a| (a.name.as_str(), a.exe.as_str(), a.running)).collect();
        assert_eq!(
            rows,
            vec![
                ("Discord", "discord.exe", true),
                ("League of Legends", "leagueclient.exe", true),
                ("Portable", "portable.exe", true),
                ("Zoom", "zoom.exe", false),
            ]
        );
    }
}
