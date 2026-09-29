//! App blocking (SPEC 3, 4.4). `Blocker` keeps OS-specific code behind one trait; the
//! decision of what to close is pure and tested, the Windows side just enumerates and kills.

use crate::profiles::Profile;
use crate::winutil;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::time::{Duration, Instant};

/// Never closed, whatever the rules say: Windows itself, the shell, input and accessibility
/// tools, and Sanctum (including its WebView2 processes).
const PROTECTED: &[&str] = &[
    "system", "registry", "idle", "smss.exe", "csrss.exe", "wininit.exe", "winlogon.exe", "services.exe",
    "lsass.exe", "svchost.exe", "dwm.exe", "fontdrvhost.exe", "sihost.exe", "ctfmon.exe", "conhost.exe",
    "explorer.exe", "taskmgr.exe", "searchhost.exe", "searchapp.exe", "startmenuexperiencehost.exe",
    "shellexperiencehost.exe", "textinputhost.exe", "applicationframehost.exe", "lockapp.exe",
    "runtimebroker.exe", "systemsettings.exe", "securityhealthsystray.exe", "dllhost.exe", "narrator.exe",
    "magnify.exe", "osk.exe", "tabtip.exe", "msedgewebview2.exe", "sanctum.exe",
];

pub fn is_protected(exe: &str) -> bool {
    PROTECTED.contains(&exe) || own_exe().as_deref() == Some(exe)
}

fn own_exe() -> Option<String> {
    std::env::current_exe().ok()?.file_name().map(|n| n.to_string_lossy().to_lowercase())
}

/// What a running session seals, flattened from a profile.
#[derive(Clone, Debug, Default)]
pub struct SealSet {
    /// Lowercase exe names to close.
    pub apps: HashSet<String>,
    /// Lowercase window-title keywords to minimize.
    pub titles: Vec<String>,
    /// Allowlist mode: every windowed app not in here is closed.
    pub allowed: Option<HashSet<String>>,
    /// Apps the profile opens are never closed, even if also sealed.
    pub opens: HashSet<String>,
    /// User-editable exceptions (Setup > Always allowed).
    pub always: HashSet<String>,
}

impl SealSet {
    pub fn from_profile(p: &Profile, browser: Option<String>, always: HashSet<String>) -> Self {
        fn of<'a>(p: &'a Profile, kind: &'a str) -> impl Iterator<Item = String> + 'a {
            p.rules.iter().filter(move |r| r.kind == kind).map(|r| r.value.to_lowercase())
        }
        let opens: HashSet<String> = of(p, "launch_app").collect();
        let allowed = p.allowlist_mode.then(|| {
            let mut a = opens.clone();
            // URLs in the launch set need the browser to stay open.
            if p.rules.iter().any(|r| r.kind == "launch_url") {
                a.extend(browser);
            }
            a
        });
        SealSet { apps: of(p, "app").collect(), titles: of(p, "title").collect(), allowed, opens, always }
    }

    /// Number of enforced app/keyword rules (sites seal with the extension in M8).
    pub fn enforced_count(&self) -> usize {
        self.apps.len() + self.titles.len()
    }
}

pub fn parse_always(list: &str) -> HashSet<String> {
    list.split([',', ';', '\n']).map(|s| s.trim().to_lowercase()).filter(|s| s.ends_with(".exe")).collect()
}

#[derive(Clone, Debug, PartialEq)]
pub struct Proc {
    pub pid: u32,
    pub exe: String,
}

/// Processes to close and why ("app" rule or "allowlist").
pub fn targets<'a>(procs: &'a [Proc], windowed: &HashSet<u32>, seal: &SealSet) -> Vec<(&'a Proc, &'static str)> {
    procs
        .iter()
        .filter(|p| !is_protected(&p.exe) && !seal.always.contains(&p.exe) && !seal.opens.contains(&p.exe))
        .filter_map(|p| {
            if seal.apps.contains(&p.exe) {
                Some((p, "app"))
            } else if seal.allowed.as_ref().is_some_and(|a| !a.contains(&p.exe)) && windowed.contains(&p.pid) {
                Some((p, "allowlist"))
            } else {
                None
            }
        })
        .collect()
}

pub fn title_hit<'a>(title: &str, keywords: &'a [String]) -> Option<&'a str> {
    let t = title.to_lowercase();
    keywords.iter().find(|k| !k.is_empty() && t.contains(k.as_str())).map(|k| k.as_str())
}

/// One blocked app per tick (Discord spawns several processes; that's one attempt).
#[derive(Clone, Debug, PartialEq)]
pub struct Blocked {
    pub exe: String,
    pub kind: &'static str,
    /// False when every kill failed (usually an elevated process).
    pub closed: bool,
}

#[derive(Clone, Debug)]
pub struct TitleHit {
    pub exe: String,
    pub title: String,
    pub keyword: String,
}

pub trait Blocker: Send {
    fn set_rules(&mut self, seal: SealSet);
    /// Closes sealed apps. Returns what was blocked this pass.
    fn block_apps(&mut self) -> Vec<Blocked>;
    /// Minimizes the foreground window if its title matches a sealed keyword.
    fn check_title(&mut self) -> Option<TitleHit>;
    /// Site blocking lives in the watchdog service and extension (M8).
    fn block_sites(&mut self) {}
    fn unblock_all(&mut self);
}

pub struct SystemBlocker {
    seal: Option<SealSet>,
    sys: sysinfo::System,
    title_cooldown: HashMap<isize, Instant>,
}

impl SystemBlocker {
    pub fn new() -> Self {
        SystemBlocker { seal: None, sys: sysinfo::System::new(), title_cooldown: HashMap::new() }
    }

    fn refresh(&mut self) -> Vec<Proc> {
        use sysinfo::{ProcessRefreshKind, ProcessesToUpdate};
        self.sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
        self.sys
            .processes()
            .iter()
            .map(|(pid, p)| Proc { pid: pid.as_u32(), exe: p.name().to_string_lossy().to_lowercase() })
            .collect()
    }

    pub fn exe_of(&self, pid: u32) -> Option<String> {
        self.sys.process(sysinfo::Pid::from_u32(pid)).map(|p| p.name().to_string_lossy().to_lowercase())
    }

    pub fn is_sealed(&self, exe: &str) -> bool {
        self.seal.as_ref().is_some_and(|s| s.apps.contains(exe) || s.allowed.as_ref().is_some_and(|a| !a.contains(exe)))
    }

    /// Names of running apps this seal set would close right now (the pre-flight warning).
    pub fn preview(&mut self, seal: &SealSet) -> Vec<String> {
        let procs = self.refresh();
        let windowed = if seal.allowed.is_some() { winutil::windowed_pids() } else { HashSet::new() };
        let mut exes: Vec<String> = targets(&procs, &windowed, seal).into_iter().map(|(p, _)| p.exe.clone()).collect();
        exes.sort();
        exes.dedup();
        exes
    }
}

impl Blocker for SystemBlocker {
    fn set_rules(&mut self, seal: SealSet) {
        self.seal = Some(seal);
        self.title_cooldown.clear();
    }

    fn block_apps(&mut self) -> Vec<Blocked> {
        let Some(seal) = self.seal.clone() else { return Vec::new() };
        let procs = self.refresh();
        let windowed = if seal.allowed.is_some() { winutil::windowed_pids() } else { HashSet::new() };
        let mut by_exe: BTreeMap<String, Blocked> = BTreeMap::new();
        for (p, kind) in targets(&procs, &windowed, &seal) {
            let killed = self.sys.process(sysinfo::Pid::from_u32(p.pid)).is_some_and(|proc_| proc_.kill());
            let entry = by_exe.entry(p.exe.clone()).or_insert(Blocked { exe: p.exe.clone(), kind, closed: false });
            entry.closed |= killed;
        }
        by_exe.into_values().collect()
    }

    fn check_title(&mut self) -> Option<TitleHit> {
        let seal = self.seal.as_ref()?;
        if seal.titles.is_empty() {
            return None;
        }
        let fg = winutil::foreground()?;
        if fg.pid == std::process::id() {
            return None;
        }
        let keyword = title_hit(&fg.title, &seal.titles)?.to_string();
        winutil::minimize(fg.hwnd);
        // One nudge per window every few seconds, even if it keeps coming back.
        let now = Instant::now();
        let recent = self.title_cooldown.get(&fg.hwnd).is_some_and(|t| now.duration_since(*t) < Duration::from_secs(4));
        self.title_cooldown.insert(fg.hwnd, now);
        if recent {
            return None;
        }
        let exe = self
            .sys
            .process(sysinfo::Pid::from_u32(fg.pid))
            .map(|p| p.name().to_string_lossy().to_lowercase())
            .unwrap_or_default();
        Some(TitleHit { exe, title: fg.title, keyword })
    }

    fn unblock_all(&mut self) {
        self.seal = None;
        self.title_cooldown.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profiles::Rule;

    fn proc_(pid: u32, exe: &str) -> Proc {
        Proc { pid, exe: exe.into() }
    }

    fn rule(kind: &str, value: &str) -> Rule {
        Rule { id: 0, profile_id: 1, kind: kind.into(), value: value.into(), label: None, path: None }
    }

    fn profile(allowlist: bool, rules: Vec<Rule>) -> Profile {
        Profile { id: 1, name: "P".into(), allowlist_mode: allowlist, default_minutes: 60, work_types: vec![], created_at: 0, rules }
    }

    #[test]
    fn closes_sealed_apps_but_never_protected_or_opened_ones() {
        let seal = SealSet::from_profile(
            &profile(false, vec![rule("app", "discord.exe"), rule("app", "explorer.exe"), rule("app", "code.exe"), rule("launch_app", "code.exe")]),
            None,
            HashSet::new(),
        );
        let procs = vec![proc_(1, "discord.exe"), proc_(2, "discord.exe"), proc_(3, "explorer.exe"), proc_(4, "code.exe"), proc_(5, "notepad.exe")];
        let hit: Vec<_> = targets(&procs, &HashSet::new(), &seal).into_iter().map(|(p, k)| (p.pid, k)).collect();
        assert_eq!(hit, vec![(1, "app"), (2, "app")]);
    }

    #[test]
    fn allowlist_closes_only_windowed_apps_outside_the_list() {
        let seal = SealSet::from_profile(
            &profile(true, vec![rule("launch_app", "code.exe"), rule("launch_url", "https://leetcode.com/")]),
            Some("chrome.exe".into()),
            parse_always("1password.exe, notes.txt"),
        );
        let procs = vec![
            proc_(1, "code.exe"),
            proc_(2, "chrome.exe"),
            proc_(3, "spotify.exe"),
            proc_(4, "backgroundhelper.exe"),
            proc_(5, "1password.exe"),
            proc_(6, "explorer.exe"),
        ];
        let windowed: HashSet<u32> = [1, 2, 3, 5, 6].into();
        let hit: Vec<_> = targets(&procs, &windowed, &seal).into_iter().map(|(p, k)| (p.exe.as_str(), k)).collect();
        assert_eq!(hit, vec![("spotify.exe", "allowlist")]);
        assert_eq!(seal.always, HashSet::from(["1password.exe".to_string()]));
    }

    #[test]
    fn allowlist_without_urls_does_not_spare_the_browser() {
        let seal = SealSet::from_profile(&profile(true, vec![rule("launch_app", "code.exe")]), Some("chrome.exe".into()), HashSet::new());
        let procs = vec![proc_(2, "chrome.exe")];
        assert_eq!(targets(&procs, &[2].into(), &seal).len(), 1);
    }

    #[test]
    fn matches_title_keywords_case_insensitively() {
        let seal = SealSet::from_profile(&profile(false, vec![rule("title", "Shorts"), rule("domain", "youtube.com")]), None, HashSet::new());
        assert_eq!(title_hit("Funny cats - YouTube SHORTS", &seal.titles), Some("shorts"));
        assert_eq!(title_hit("Graph algorithms - YouTube", &seal.titles), None);
        assert_eq!(seal.enforced_count(), 1);
    }

    #[test]
    fn protects_windows_and_sanctum() {
        for exe in ["explorer.exe", "msedgewebview2.exe", "sanctum.exe", "dwm.exe"] {
            assert!(is_protected(exe), "{exe}");
        }
        assert!(!is_protected("discord.exe"));
    }
}
