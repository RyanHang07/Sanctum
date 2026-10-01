//! App blocking (SPEC 3, 4.4). `Blocker` keeps OS-specific code behind one trait; the
//! decision of what to close is pure and tested, the Windows side just enumerates and kills.
//! What to seal comes from the one Distractions list (distractions.rs); the profile only adds
//! what it opens, which is never closed.

use crate::distractions::Distraction;
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
    "magnify.exe", "osk.exe", "tabtip.exe", "msedgewebview2.exe", "sanctum.exe", "sanctum-bridge.exe",
];

pub fn is_protected(exe: &str) -> bool {
    PROTECTED.contains(&exe) || own_exe().as_deref() == Some(exe)
}

fn own_exe() -> Option<String> {
    std::env::current_exe().ok()?.file_name().map(|n| n.to_string_lossy().to_lowercase())
}

/// What a running session seals.
#[derive(Clone, Debug, Default)]
pub struct SealSet {
    /// Lowercase exe names to close.
    pub apps: HashSet<String>,
    /// Lowercase window-title keywords to minimize.
    pub titles: Vec<String>,
    /// Sites and links, sealed in the browser by the extension.
    pub sites: usize,
    /// Apps the profile opens are never closed, even if also flagged.
    pub opens: HashSet<String>,
}

impl SealSet {
    pub fn new(flags: &[Distraction], profile: Option<&Profile>) -> Self {
        fn of<'a>(flags: &'a [Distraction], kind: &'a str) -> impl Iterator<Item = String> + 'a {
            flags.iter().filter(move |d| d.kind == kind).map(|d| d.value.to_lowercase())
        }
        let opens = profile
            .map(|p| p.rules.iter().filter(|r| r.kind == "launch_app").map(|r| r.value.to_lowercase()).collect())
            .unwrap_or_default();
        SealSet { apps: of(flags, "app").collect(), titles: of(flags, "keyword").collect(), sites: of(flags, "site").count(), opens }
    }

    /// Everything this seal blocks: apps, keywords, and sites.
    pub fn enforced_count(&self) -> usize {
        self.apps.len() + self.titles.len() + self.sites
    }
}

/// "a.exe, B.EXE; notes" -> {"a.exe", "b.exe"}.
pub fn parse_exes(list: &str) -> HashSet<String> {
    list.split([',', ';', '\n']).map(|s| s.trim().to_lowercase()).filter(|s| s.ends_with(".exe")).collect()
}

#[derive(Clone, Debug, PartialEq)]
pub struct Proc {
    pub pid: u32,
    pub exe: String,
}

/// Sanctum's own process and everything above it (in dev: the terminal, npm, cargo). Closing
/// any of them would close Sanctum.
pub fn ancestors(procs: &[Proc], parents: &HashMap<u32, u32>, me: u32) -> HashSet<u32> {
    let mut out = HashSet::from([me]);
    let mut pid = me;
    while let Some(&parent) = parents.get(&pid) {
        if !procs.iter().any(|p| p.pid == parent) || !out.insert(parent) {
            break;
        }
        pid = parent;
    }
    out
}

/// Flagged apps to close. `keep` holds pids never touched.
pub fn targets<'a>(procs: &'a [Proc], seal: &SealSet, keep: &HashSet<u32>) -> Vec<&'a Proc> {
    procs
        .iter()
        .filter(|p| !keep.contains(&p.pid) && !is_protected(&p.exe) && !seal.opens.contains(&p.exe) && seal.apps.contains(&p.exe))
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
    /// Closes flagged apps. Returns what was blocked this pass.
    fn block_apps(&mut self) -> Vec<Blocked>;
    /// Minimizes the foreground window if its title matches a flagged keyword.
    fn check_title(&mut self) -> Option<TitleHit>;
    /// Site blocking lives in the extension (4b) and the watchdog service (M8).
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

    /// Sanctum and what runs it: never touched.
    fn keep(&self, procs: &[Proc]) -> HashSet<u32> {
        let parents: HashMap<u32, u32> =
            self.sys.processes().iter().filter_map(|(pid, p)| Some((pid.as_u32(), p.parent()?.as_u32()))).collect();
        ancestors(procs, &parents, std::process::id())
    }

    pub fn exe_of(&self, pid: u32) -> Option<String> {
        self.sys.process(sysinfo::Pid::from_u32(pid)).map(|p| p.name().to_string_lossy().to_lowercase())
    }

    /// The exes this seal closes (minus what the profile opens), or None when nothing is sealed.
    pub fn watch_list(&self) -> Option<HashSet<String>> {
        let seal = self.seal.as_ref()?;
        Some(seal.apps.iter().filter(|a| !seal.opens.contains(*a) && !is_protected(a)).cloned().collect())
    }

    pub fn is_sealed(&self, exe: &str) -> bool {
        self.seal.as_ref().is_some_and(|s| s.apps.contains(exe))
    }

    /// Names of running apps this seal set would close right now (the pre-flight warning).
    pub fn preview(&mut self, seal: &SealSet) -> Vec<String> {
        let procs = self.refresh();
        let keep = self.keep(&procs);
        let mut exes: Vec<String> = targets(&procs, seal, &keep).into_iter().map(|p| p.exe.clone()).collect();
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
        let keep = self.keep(&procs);
        let mut by_exe: BTreeMap<String, Blocked> = BTreeMap::new();
        for p in targets(&procs, &seal, &keep) {
            let killed = self.sys.process(sysinfo::Pid::from_u32(p.pid)).is_some_and(|proc_| proc_.kill());
            let entry = by_exe.entry(p.exe.clone()).or_insert(Blocked { exe: p.exe.clone(), kind: "app", closed: false });
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

    fn flag(id: i64, kind: &str, value: &str) -> Distraction {
        Distraction { id, kind: kind.into(), value: value.into(), label: None, path: None, allow: Vec::new() }
    }

    fn opens(exes: &[&str]) -> Profile {
        let rules = exes
            .iter()
            .map(|e| Rule { id: 0, profile_id: 1, kind: "launch_app".into(), value: e.to_string(), label: None, path: None })
            .collect();
        Profile { id: 1, name: "P".into(), default_minutes: 60, work_types: vec![], created_at: 0, rules }
    }

    #[test]
    fn closes_flagged_apps_but_never_protected_or_opened_ones() {
        let flags = vec![flag(1, "app", "discord.exe"), flag(2, "app", "explorer.exe"), flag(3, "app", "code.exe"), flag(4, "site", "youtube.com")];
        let seal = SealSet::new(&flags, Some(&opens(&["code.exe"])));
        let procs = vec![proc_(1, "discord.exe"), proc_(2, "discord.exe"), proc_(3, "explorer.exe"), proc_(4, "code.exe"), proc_(5, "notepad.exe")];
        let hit: Vec<_> = targets(&procs, &seal, &HashSet::new()).into_iter().map(|p| p.pid).collect();
        assert_eq!(hit, vec![1, 2]);
        assert_eq!(seal.enforced_count(), 4);
    }

    #[test]
    fn never_touches_sanctum_or_what_runs_it() {
        let seal = SealSet::new(&[flag(1, "app", "node.exe")], None);
        let procs = vec![proc_(5, "windowsterminal.exe"), proc_(6, "powershell.exe"), proc_(7, "node.exe"), proc_(9, "sanctum.exe")];
        // Terminal 5 > PowerShell 6 > npm 7 > Sanctum 9.
        let parents: HashMap<u32, u32> = [(9, 7), (7, 6), (6, 5), (5, 1)].into();
        let keep = ancestors(&procs, &parents, 9);
        assert_eq!(keep, HashSet::from([9, 7, 6, 5]));
        assert!(targets(&procs, &seal, &keep).is_empty());
    }

    #[test]
    fn matches_title_keywords_case_insensitively() {
        let seal = SealSet::new(&[flag(1, "keyword", "shorts"), flag(2, "site", "youtube.com")], None);
        assert_eq!(title_hit("Funny cats - YouTube SHORTS", &seal.titles), Some("shorts"));
        assert_eq!(title_hit("Graph algorithms - YouTube", &seal.titles), None);
    }

    #[test]
    fn protects_windows_and_sanctum() {
        for exe in ["explorer.exe", "msedgewebview2.exe", "sanctum.exe", "dwm.exe"] {
            assert!(is_protected(exe), "{exe}");
        }
        assert!(!is_protected("discord.exe"));
    }
}
