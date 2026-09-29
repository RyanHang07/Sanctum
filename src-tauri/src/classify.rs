//! Classifies activity as productive / neutral / distracting (SPEC 4.7), and redacts
//! private window titles before they're stored.

use crate::profiles::Profile;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const CATEGORIES: [&str; 3] = ["productive", "neutral", "distracting"];
pub const PRIVATE_TITLE: &str = "(private)";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClassRule {
    #[serde(default)]
    pub id: i64,
    /// exe | title | domain
    pub match_kind: String,
    pub pattern: String,
    pub category: String,
    #[serde(default = "user_source")]
    pub source: String,
}

fn user_source() -> String {
    "user".into()
}

/// Browsers, where a site shows up in the window title rather than the exe.
const BROWSERS: &[&str] = &[
    "chrome.exe", "msedge.exe", "firefox.exe", "brave.exe", "opera.exe", "opera_gx.exe", "vivaldi.exe", "arc.exe",
    "comet.exe", "zen.exe", "librewolf.exe", "waterfox.exe", "iexplore.exe",
];

pub fn is_browser(exe: &str) -> bool {
    BROWSERS.contains(&exe)
}

/// Does a browser title belong to this site? Titles carry site names ("Shorts - YouTube"),
/// so match the name as a whole word. Names under 3 letters ("x") are too ambiguous and
/// only match the full domain.
pub fn title_matches_domain(title: &str, domain: &str) -> bool {
    let t = title.to_lowercase();
    let host = domain.split('/').next().unwrap_or(domain).to_lowercase();
    if t.contains(&host) {
        return true;
    }
    let labels: Vec<&str> = host.split('.').collect();
    // "open.spotify.com" -> "spotify", "youtube.com" -> "youtube"
    let name = if labels.len() >= 2 { labels[labels.len() - 2] } else { labels[0] };
    if name.len() < 3 {
        return false;
    }
    t.split(|c: char| !c.is_alphanumeric()).any(|w| w == name)
}

fn rule_matches(r: &ClassRule, exe: &str, title: &str) -> bool {
    match r.match_kind.as_str() {
        "exe" => r.pattern.eq_ignore_ascii_case(exe),
        "title" => !r.pattern.is_empty() && title.to_lowercase().contains(&r.pattern.to_lowercase()),
        "domain" => is_browser(exe) && title_matches_domain(title, &r.pattern),
        _ => false,
    }
}

/// Rules implied by a profile: what it opens is productive, what it seals is distracting.
pub fn profile_rules(p: &Profile) -> Vec<ClassRule> {
    let host = |url: &str| url.split("://").nth(1).unwrap_or(url).trim_start_matches("www.").split('/').next().unwrap_or("").to_string();
    p.rules
        .iter()
        .filter_map(|r| {
            let (kind, pattern, category) = match r.kind.as_str() {
                "launch_app" => ("exe", r.value.clone(), "productive"),
                "launch_url" => ("domain", host(&r.value), "productive"),
                "app" => ("exe", r.value.clone(), "distracting"),
                "domain" => ("domain", r.value.clone(), "distracting"),
                "title" => ("title", r.value.clone(), "distracting"),
                _ => return None,
            };
            Some(ClassRule { id: 0, match_kind: kind.into(), pattern, category: category.into(), source: "profile".into() })
        })
        .collect()
}

/// Everything classification needs, loaded once and refreshed periodically.
#[derive(Clone, Debug, Default)]
pub struct Classifier {
    /// The running session's profile rules (checked first).
    pub session: Vec<ClassRule>,
    /// Rules from Setup (seeded from the catalog, editable).
    pub user: Vec<ClassRule>,
    /// Every profile's implied rules (checked last).
    pub profiles: Vec<ClassRule>,
}

impl Classifier {
    pub fn classify(&self, exe: &str, title: &str) -> &'static str {
        for layer in [&self.session, &self.user, &self.profiles] {
            // Within a layer, an exact app rule beats a title or site match.
            let hit = layer
                .iter()
                .filter(|r| r.match_kind == "exe")
                .chain(layer.iter().filter(|r| r.match_kind != "exe"))
                .find(|r| rule_matches(r, exe, title));
            if let Some(r) = hit {
                return CATEGORIES.iter().copied().find(|c| *c == r.category).unwrap_or("neutral");
            }
        }
        "neutral"
    }
}

/// Private and incognito browser windows, and apps marked private, keep only their app name.
pub fn is_private(exe: &str, title: &str, private_apps: &HashSet<String>) -> bool {
    if private_apps.contains(exe) {
        return true;
    }
    if !is_browser(exe) {
        return false;
    }
    let t = title.to_lowercase();
    // Edge "[InPrivate]", Chrome "(Incognito)", Firefox "Private Browsing", Brave/Opera "Private".
    ["inprivate", "incognito", "private browsing", "(private)", "- private"].iter().any(|m| t.contains(m))
}

pub fn redact(exe: &str, title: &str, private_apps: &HashSet<String>) -> String {
    if is_private(exe, title, private_apps) {
        PRIVATE_TITLE.to_string()
    } else {
        title.to_string()
    }
}

// --- storage ---

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<ClassRule>> {
    let mut stmt = conn.prepare(
        "SELECT id, match_kind, pattern, category, source FROM classification_rules ORDER BY category, match_kind, pattern",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(ClassRule { id: r.get(0)?, match_kind: r.get(1)?, pattern: r.get(2)?, category: r.get(3)?, source: r.get(4)? })
    })?;
    rows.collect()
}

/// Validates and normalizes a rule typed in Setup. Returns the stored row.
pub fn add(conn: &Connection, rule: ClassRule) -> Result<ClassRule, String> {
    let kind = rule.match_kind.trim().to_lowercase();
    if !["exe", "title", "domain"].contains(&kind.as_str()) {
        return Err(format!("Unknown rule kind: {kind}."));
    }
    if !CATEGORIES.contains(&rule.category.as_str()) {
        return Err(format!("Unknown category: {}.", rule.category));
    }
    let pattern = match kind.as_str() {
        "exe" => {
            let p = rule.pattern.trim().to_lowercase();
            if !p.ends_with(".exe") {
                return Err(format!("{p} is not an app name."));
            }
            p
        }
        "domain" => crate::profiles::normalize_domain(&rule.pattern).ok_or_else(|| format!("{} is not a site.", rule.pattern.trim()))?,
        _ => rule.pattern.trim().to_string(),
    };
    if pattern.is_empty() {
        return Err("A rule needs a value.".into());
    }
    // Re-adding a pattern changes its category instead of failing.
    conn.execute(
        "INSERT INTO classification_rules (match_kind, pattern, category, source) VALUES (?1, ?2, ?3, 'user')
         ON CONFLICT(match_kind, pattern) DO UPDATE SET category = excluded.category, source = 'user'",
        params![kind, pattern, rule.category],
    )
    .map_err(|e| e.to_string())?;
    let id: i64 = conn
        .query_row("SELECT id FROM classification_rules WHERE match_kind = ?1 AND pattern = ?2", params![kind, pattern], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    Ok(ClassRule { id, match_kind: kind, pattern, category: rule.category, source: "user".into() })
}

pub fn set_category(conn: &Connection, id: i64, category: &str) -> Result<(), String> {
    if !CATEGORIES.contains(&category) {
        return Err(format!("Unknown category: {category}."));
    }
    conn.execute("UPDATE classification_rules SET category = ?1, source = 'user' WHERE id = ?2", params![category, id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn remove(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM classification_rules WHERE id = ?1", [id])?;
    Ok(())
}

/// Seeds the rules once from the work-type catalog (src/data/catalog.json, shared with the UI):
/// what work types open is productive, what they seal is distracting.
pub fn seed_from_catalog(conn: &Connection) -> rusqlite::Result<()> {
    if crate::db::get_setting(conn, "classification_seeded")?.is_some() {
        return Ok(());
    }
    for (kind, pattern, category) in catalog_rules() {
        conn.execute(
            "INSERT OR IGNORE INTO classification_rules (match_kind, pattern, category, source) VALUES (?1, ?2, ?3, 'catalog')",
            params![kind, pattern, category],
        )?;
    }
    crate::db::set_setting(conn, "classification_seeded", "1")
}

pub fn catalog_rules() -> Vec<(&'static str, String, &'static str)> {
    let catalog: serde_json::Value = serde_json::from_str(include_str!("../../src/data/catalog.json")).unwrap_or_default();
    let items = &catalog["items"];
    let ids = |key: &str| -> Vec<String> {
        let mut out = Vec::new();
        if let Some(types) = catalog["workTypes"].as_object() {
            for wt in types.values() {
                for id in wt[key].as_array().into_iter().flatten().filter_map(|v| v.as_str()) {
                    out.push(id.to_string());
                }
            }
        }
        out
    };
    let mut seal_ids = ids("seal");
    seal_ids.extend(catalog["alwaysSeal"].as_array().into_iter().flatten().filter_map(|v| v.as_str()).map(String::from));

    let mut out: Vec<(&'static str, String, &'static str)> = Vec::new();
    let mut seen = HashSet::new();
    let mut push = |kind: &'static str, pattern: String, category: &'static str| {
        if seen.insert((kind, pattern.clone())) {
            out.push((kind, pattern, category));
        }
    };
    for id in ids("open") {
        let it = &items[id.as_str()];
        if let Some(url) = it["url"].as_str() {
            let host = url.split("://").nth(1).unwrap_or(url).trim_start_matches("www.").split('/').next().unwrap_or("").to_string();
            push("domain", host, "productive");
        }
        if let Some(app) = it["app"].as_str() {
            push("exe", app.to_string(), "productive");
        }
    }
    for id in seal_ids {
        let it = &items[id.as_str()];
        for app in it["apps"].as_array().into_iter().flatten().filter_map(|v| v.as_str()) {
            push("exe", app.to_string(), "distracting");
        }
        for d in it["domains"].as_array().into_iter().flatten().filter_map(|v| v.as_str()) {
            push("domain", d.to_string(), "distracting");
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::profiles::Rule;

    fn rule(kind: &str, pattern: &str, category: &str) -> ClassRule {
        ClassRule { id: 0, match_kind: kind.into(), pattern: pattern.into(), category: category.into(), source: "user".into() }
    }

    #[test]
    fn matches_sites_in_browser_titles() {
        assert!(title_matches_domain("Shorts - YouTube — Mozilla Firefox", "youtube.com"));
        assert!(title_matches_domain("Liked Songs - open.spotify.com", "open.spotify.com"));
        assert!(title_matches_domain("Two Sum - LeetCode", "leetcode.com/problemset"));
        assert!(!title_matches_domain("youtuber drama recap.txt", "youtube.com"));
        // Too short to match as a word; only the full domain counts.
        assert!(!title_matches_domain("Box Office - Google Chrome", "x.com"));
        assert!(title_matches_domain("Home / x.com - Google Chrome", "x.com"));
    }

    #[test]
    fn layers_win_in_order() {
        let c = Classifier {
            session: vec![rule("domain", "youtube.com", "productive")],
            user: vec![rule("domain", "youtube.com", "distracting"), rule("exe", "code.exe", "productive"), rule("title", "netflix", "distracting")],
            profiles: vec![rule("exe", "discord.exe", "distracting")],
        };
        // The session's profile says YouTube is work right now.
        assert_eq!(c.classify("chrome.exe", "System design lecture - YouTube"), "productive");
        assert_eq!(c.classify("code.exe", "netflix-clone.ts - Code"), "productive"); // exe beats title within a layer
        assert_eq!(c.classify("vlc.exe", "Netflix Originals.mkv"), "distracting");
        assert_eq!(c.classify("discord.exe", "Friends"), "distracting");
        assert_eq!(c.classify("notepad.exe", "todo.txt"), "neutral");
        // Site rules only apply to browsers.
        assert_eq!(Classifier { user: vec![rule("domain", "youtube.com", "distracting")], ..Default::default() }.classify("code.exe", "youtube.ts"), "neutral");
    }

    #[test]
    fn derives_rules_from_profiles() {
        let r = |kind: &str, value: &str| Rule { id: 0, profile_id: 1, kind: kind.into(), value: value.into(), label: None, path: None };
        let p = Profile {
            id: 1,
            name: "P".into(),
            allowlist_mode: false,
            default_minutes: 60,
            work_types: vec![],
            created_at: 0,
            rules: vec![r("launch_app", "code.exe"), r("launch_url", "https://www.leetcode.com/problemset/"), r("domain", "reddit.com"), r("title", "Shorts")],
        };
        let c = Classifier { profiles: profile_rules(&p), ..Default::default() };
        assert_eq!(c.classify("code.exe", "x"), "productive");
        assert_eq!(c.classify("msedge.exe", "Two Sum - LeetCode"), "productive");
        assert_eq!(c.classify("msedge.exe", "r/all - Reddit"), "distracting");
        assert_eq!(c.classify("vlc.exe", "Shorts compilation"), "distracting");
    }

    #[test]
    fn redacts_private_windows() {
        let private: HashSet<String> = ["1password.exe".to_string()].into();
        assert_eq!(redact("msedge.exe", "New tab - [InPrivate] - Microsoft Edge", &private), PRIVATE_TITLE);
        assert_eq!(redact("chrome.exe", "Gmail - Google Chrome (Incognito)", &private), PRIVATE_TITLE);
        assert_eq!(redact("firefox.exe", "Mozilla Firefox Private Browsing", &private), PRIVATE_TITLE);
        assert_eq!(redact("1password.exe", "Bank login", &private), PRIVATE_TITLE);
        assert_eq!(redact("code.exe", "incognito.rs - Code", &private), "incognito.rs - Code"); // not a browser
        assert_eq!(redact("chrome.exe", "Two Sum - LeetCode", &private), "Two Sum - LeetCode");
    }

    #[test]
    fn seeds_from_catalog_once_and_edits() {
        let mut conn = Connection::open_in_memory().unwrap();
        db::prepare(&mut conn).unwrap();
        seed_from_catalog(&conn).unwrap();
        let rules = list(&conn).unwrap();
        let has = |k: &str, p: &str, c: &str| rules.iter().any(|r| r.match_kind == k && r.pattern == p && r.category == c);
        assert!(has("domain", "leetcode.com", "productive"));
        assert!(has("exe", "code.exe", "productive"));
        assert!(has("exe", "discord.exe", "distracting"));
        assert!(has("domain", "tiktok.com", "distracting"));
        let n = rules.len();

        // Deleting a seeded rule sticks: seeding never runs twice.
        let tiktok = rules.iter().find(|r| r.pattern == "tiktok.com").unwrap().id;
        remove(&conn, tiktok).unwrap();
        seed_from_catalog(&conn).unwrap();
        assert_eq!(list(&conn).unwrap().len(), n - 1);

        let added = add(&conn, rule("domain", "https://www.Twitch.tv/", "distracting")).unwrap();
        assert_eq!(added.pattern, "twitch.tv");
        // Re-adding updates the category.
        let again = add(&conn, rule("domain", "twitch.tv", "neutral")).unwrap();
        assert_eq!(again.id, added.id);
        set_category(&conn, added.id, "productive").unwrap();
        assert!(list(&conn).unwrap().iter().any(|r| r.id == added.id && r.category == "productive"));
        assert!(add(&conn, rule("exe", "notepad", "neutral")).is_err());
        assert!(add(&conn, rule("title", "x", "fun")).is_err());
        assert!(set_category(&conn, added.id, "fun").is_err());
    }
}
