//! One list of distractions for every focus session (decided 2026-09-29): apps, sites and links,
//! and title keywords. Flagged means blocked while sealed and counted as distracting time.
//! Sites can keep pages open ("youtube.com/@mitocw").

use crate::classify::{self, ClassRule};
use crate::profiles::{normalize_allow, normalize_domain};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Allow {
    pub id: i64,
    pub prefix: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Distraction {
    pub id: i64,
    /// "app", "site", or "keyword".
    pub kind: String,
    pub value: String,
    pub label: Option<String>,
    pub path: Option<String>,
    /// Sites only: pages that stay open.
    pub allow: Vec<Allow>,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct NewDistraction {
    /// "app", "site", "keyword", or "auto" to work it out from the text.
    pub kind: String,
    pub value: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
}

/// What a typed entry is: "discord.exe" an app, anything URL-shaped a site or link, else a keyword.
pub fn guess_kind(input: &str) -> &'static str {
    let s = input.trim();
    if s.to_lowercase().ends_with(".exe") {
        "app"
    } else if !s.contains(char::is_whitespace) && normalize_domain(s).is_some() {
        "site"
    } else {
        "keyword"
    }
}

fn normalize(kind: &str, value: &str) -> Result<(String, String), String> {
    let kind = if kind == "auto" { guess_kind(value) } else { kind };
    let v = value.trim();
    let out = match kind {
        "app" => {
            let p = v.to_lowercase();
            if !p.ends_with(".exe") || p.len() < 5 {
                return Err(format!("{v} is not an app name."));
            }
            p
        }
        "site" => normalize_domain(v).ok_or_else(|| format!("{v} is not a site or link."))?,
        "keyword" => {
            if v.chars().count() < 3 {
                return Err("A keyword needs at least 3 characters.".into());
            }
            v.to_lowercase()
        }
        _ => return Err(format!("Unknown kind: {kind}.")),
    };
    Ok((kind.to_string(), out))
}

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<Distraction>> {
    let mut stmt = conn.prepare("SELECT id, kind, value, label, path FROM distractions ORDER BY kind, COALESCE(label, value) COLLATE NOCASE")?;
    let mut out: Vec<Distraction> = stmt
        .query_map([], |r| Ok(Distraction { id: r.get(0)?, kind: r.get(1)?, value: r.get(2)?, label: r.get(3)?, path: r.get(4)?, allow: Vec::new() }))?
        .collect::<rusqlite::Result<_>>()?;
    let mut stmt = conn.prepare("SELECT id, distraction_id, prefix FROM distraction_allows ORDER BY prefix")?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, i64>(1)?, Allow { id: r.get(0)?, prefix: r.get(2)? })))? {
        let (did, a) = row?;
        if let Some(d) = out.iter_mut().find(|d| d.id == did) {
            d.allow.push(a);
        }
    }
    Ok(out)
}

/// Flags something. Flagging it again only updates its label.
pub fn add(conn: &Connection, d: NewDistraction, now: i64) -> Result<Vec<Distraction>, String> {
    let (kind, value) = normalize(&d.kind, &d.value)?;
    let label = d.label.map(|l| l.trim().to_string()).filter(|l| !l.is_empty());
    conn.execute(
        "INSERT INTO distractions (kind, value, label, path, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(kind, value) DO UPDATE SET label = COALESCE(excluded.label, label), path = COALESCE(excluded.path, path)",
        params![kind, value, label, d.path, now],
    )
    .map_err(|e| e.to_string())?;
    list(conn).map_err(|e| e.to_string())
}

pub fn remove(conn: &Connection, id: i64) -> Result<Vec<Distraction>, String> {
    conn.execute("DELETE FROM distractions WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
    list(conn).map_err(|e| e.to_string())
}

pub fn add_allow(conn: &Connection, id: i64, input: &str) -> Result<Vec<Distraction>, String> {
    let site: Option<(String, String)> =
        conn.query_row("SELECT kind, value FROM distractions WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?))).optional().map_err(|e| e.to_string())?;
    let Some((kind, domain)) = site else { return Err("That distraction is gone.".into()) };
    if kind != "site" {
        return Err("Only sites can keep pages open.".into());
    }
    let prefix = normalize_allow(&domain, input).ok_or_else(|| format!("{} is not a page on {domain}.", input.trim()))?;
    conn.execute("INSERT OR IGNORE INTO distraction_allows (distraction_id, prefix) VALUES (?1, ?2)", params![id, prefix]).map_err(|e| e.to_string())?;
    list(conn).map_err(|e| e.to_string())
}

pub fn remove_allow(conn: &Connection, id: i64) -> Result<Vec<Distraction>, String> {
    conn.execute("DELETE FROM distraction_allows WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
    list(conn).map_err(|e| e.to_string())
}

/// Flags as classification rules: always distracting, checked before anything else.
pub fn as_rules(list: &[Distraction]) -> Vec<ClassRule> {
    list.iter()
        .map(|d| ClassRule {
            id: 0,
            match_kind: match d.kind.as_str() {
                "app" => "exe",
                "site" => "domain",
                _ => "title",
            }
            .into(),
            pattern: d.value.clone(),
            category: "distracting".into(),
            source: "flag".into(),
        })
        .collect()
}

// --- Suggestions --------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    pub kind: String,
    pub value: String,
    pub label: String,
    /// Minutes in front over the last week (activity suggestions only).
    pub minutes: Option<i64>,
}

/// The common distractions from the work-type catalog, as (label, kind, value).
fn catalog() -> Vec<(String, &'static str, String)> {
    let catalog: serde_json::Value = serde_json::from_str(include_str!("../../src/data/catalog.json")).unwrap_or_default();
    let mut ids: Vec<String> = catalog["alwaysSeal"].as_array().into_iter().flatten().filter_map(|v| v.as_str()).map(String::from).collect();
    if let Some(types) = catalog["workTypes"].as_object() {
        for wt in types.values() {
            ids.extend(wt["seal"].as_array().into_iter().flatten().filter_map(|v| v.as_str()).map(String::from));
        }
    }
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for id in ids {
        if !seen.insert(id.clone()) {
            continue;
        }
        let it = &catalog["items"][id.as_str()];
        let label = it["label"].as_str().unwrap_or(&id).to_string();
        for d in it["domains"].as_array().into_iter().flatten().filter_map(|v| v.as_str()) {
            out.push((label.clone(), "site", d.to_string()));
        }
        for a in it["apps"].as_array().into_iter().flatten().filter_map(|v| v.as_str()) {
            out.push((label.clone(), "app", a.to_string()));
        }
    }
    out
}

/// The site a browser title ends with, when the extension reported it ("Title — youtube.com").
pub fn site_in_title(title: &str) -> Option<String> {
    let tail = title.rsplit(" — ").next().filter(|t| t.len() < title.len())?;
    normalize_domain(tail).filter(|d| !d.contains('/'))
}

/// What to offer for flagging: your most-used apps and sites from the last week that aren't
/// flagged or known productive, then the common distractions from the catalog.
pub fn suggestions(conn: &Connection, since: i64) -> rusqlite::Result<Vec<Suggestion>> {
    let flagged: HashSet<(String, String)> = list(conn)?.into_iter().map(|d| (d.kind, d.value)).collect();
    let productive: HashSet<(String, String)> = classify::list(conn)?
        .into_iter()
        .filter(|r| r.category == "productive")
        .map(|r| (if r.match_kind == "exe" { "app".into() } else { "site".into() }, r.pattern))
        .collect();
    let mut stmt = conn.prepare("SELECT exe, title, duration_s FROM activity WHERE ts >= ?1")?;
    let mut apps: BTreeMap<String, i64> = BTreeMap::new();
    let mut sites: BTreeMap<String, i64> = BTreeMap::new();
    for row in stmt.query_map([since], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?)))? {
        let (exe, title, secs) = row?;
        if classify::is_browser(&exe) {
            if let Some(site) = site_in_title(&title) {
                *sites.entry(site).or_default() += secs;
            }
        } else if !crate::blocker::is_protected(&exe) {
            *apps.entry(exe).or_default() += secs;
        }
    }
    let mut used: Vec<(String, String, i64)> = apps
        .into_iter()
        .map(|(v, s)| ("app".to_string(), v, s))
        .chain(sites.into_iter().map(|(v, s)| ("site".to_string(), v, s)))
        .filter(|(k, v, s)| *s >= 120 && !flagged.contains(&(k.clone(), v.clone())) && !productive.contains(&(k.clone(), v.clone())))
        .collect();
    used.sort_by_key(|u| std::cmp::Reverse(u.2));
    let mut out: Vec<Suggestion> = used
        .into_iter()
        .take(8)
        .map(|(kind, value, secs)| Suggestion { label: pretty(&kind, &value), kind, value, minutes: Some(secs / 60) })
        .collect();
    for (label, kind, value) in catalog() {
        if !flagged.contains(&(kind.to_string(), value.clone())) && !out.iter().any(|s| s.value == value) {
            out.push(Suggestion { kind: kind.into(), value, label, minutes: None });
        }
    }
    Ok(out)
}

/// "discord.exe" -> "Discord"; sites stay as they are.
fn pretty(kind: &str, value: &str) -> String {
    if kind != "app" {
        return value.to_string();
    }
    let stem = value.trim_end_matches(".exe");
    let mut c = stem.chars();
    c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn fresh() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        db::prepare(&mut conn).unwrap();
        conn
    }

    #[test]
    fn works_out_what_you_typed() {
        assert_eq!(guess_kind("Discord.exe"), "app");
        assert_eq!(guess_kind("https://www.youtube.com/shorts"), "site");
        assert_eq!(guess_kind("reddit.com/r/all"), "site");
        assert_eq!(guess_kind("Shorts"), "keyword");
        assert_eq!(guess_kind("league of legends"), "keyword");
    }

    #[test]
    fn flags_apps_sites_links_and_keywords() {
        let conn = fresh();
        let add_ = |kind: &str, value: &str| add(&conn, NewDistraction { kind: kind.into(), value: value.into(), ..Default::default() }, 0);
        add_("auto", "Discord.exe").unwrap();
        add_("auto", "https://www.YouTube.com/shorts/").unwrap();
        add_("auto", "Shorts").unwrap();
        let all = add_("site", "reddit.com").unwrap();
        let got: Vec<_> = all.iter().map(|d| (d.kind.as_str(), d.value.as_str())).collect();
        assert_eq!(got, vec![("app", "discord.exe"), ("keyword", "shorts"), ("site", "reddit.com"), ("site", "youtube.com/shorts")]);
        // Flagging again doesn't duplicate.
        assert_eq!(add_("app", "discord.exe").unwrap().len(), 4);
        assert!(add_("app", "discord").is_err());
        assert!(add_("keyword", "ab").is_err());

        let reddit = all.iter().find(|d| d.value == "reddit.com").unwrap().id;
        let with = add_allow(&conn, reddit, "reddit.com/r/rust").unwrap();
        assert_eq!(with.iter().find(|d| d.id == reddit).unwrap().allow[0].prefix, "reddit.com/r/rust");
        assert!(add_allow(&conn, reddit, "youtube.com/x").is_err());
        let app = all.iter().find(|d| d.kind == "app").unwrap().id;
        assert!(add_allow(&conn, app, "discord.com/x").is_err());

        let rules = as_rules(&remove(&conn, app).unwrap());
        assert!(rules.iter().all(|r| r.category == "distracting"));
        assert_eq!(rules.iter().map(|r| r.match_kind.as_str()).collect::<Vec<_>>(), vec!["title", "domain", "domain"]);
    }

    #[test]
    fn suggests_what_you_use_then_common_distractions() {
        let conn = fresh();
        for (exe, title, secs) in [
            ("steam.exe", "Steam", 3600),
            ("code.exe", "main.rs", 7200),
            ("chrome.exe", "Funny cats — youtube.com", 1800),
            ("chrome.exe", "Docs", 900),
            ("notepad.exe", "x", 60),
        ] {
            conn.execute("INSERT INTO activity (ts, exe, title, duration_s) VALUES (10, ?1, ?2, ?3)", params![exe, title, secs]).unwrap();
        }
        conn.execute("INSERT INTO classification_rules (match_kind, pattern, category, source) VALUES ('exe', 'code.exe', 'productive', 'user')", []).unwrap();
        add(&conn, NewDistraction { kind: "app".into(), value: "discord.exe".into(), ..Default::default() }, 0).unwrap();
        let s = suggestions(&conn, 0).unwrap();
        let used: Vec<_> = s.iter().filter(|x| x.minutes.is_some()).map(|x| (x.label.as_str(), x.minutes.unwrap())).collect();
        assert_eq!(used, vec![("Steam", 60), ("youtube.com", 30)], "productive and short stints are skipped");
        assert!(s.iter().any(|x| x.minutes.is_none() && x.value == "reddit.com"));
        assert!(!s.iter().any(|x| x.value == "discord.exe"), "already flagged");
        assert_eq!(site_in_title("Home — x.com"), Some("x.com".into()));
        assert_eq!(site_in_title("Just a title"), None);
    }

    #[test]
    fn migration_moves_profile_seals_into_the_list() {
        let mut conn = Connection::open_in_memory().unwrap();
        // Up to 0007, with a profile that seals things.
        for (_, sql) in &db::MIGRATIONS[..7] {
            conn.execute_batch(sql).unwrap();
        }
        conn.execute("INSERT INTO profiles (id, name, allowlist_mode, default_minutes, created_at) VALUES (1, 'P', 1, 60, 0)", []).unwrap();
        for (id, kind, value) in [(1, "app", "discord.exe"), (2, "domain", "youtube.com"), (3, "title", "shorts"), (4, "launch_app", "code.exe")] {
            conn.execute("INSERT INTO profile_rules (id, profile_id, kind, value) VALUES (?1, 1, ?2, ?3)", params![id, kind, value]).unwrap();
        }
        conn.execute("INSERT INTO site_exceptions (rule_id, prefix) VALUES (2, 'youtube.com/@mitocw')", []).unwrap();
        conn.pragma_update(None, "user_version", 7).unwrap();
        db::migrate(&mut conn).unwrap();
        let all = list(&conn).unwrap();
        assert_eq!(all.iter().map(|d| (d.kind.as_str(), d.value.as_str())).collect::<Vec<_>>(), vec![("app", "discord.exe"), ("keyword", "shorts"), ("site", "youtube.com")]);
        assert_eq!(all[2].allow[0].prefix, "youtube.com/@mitocw");
        let left: i64 = conn.query_row("SELECT COUNT(*) FROM profile_rules", [], |r| r.get(0)).unwrap();
        assert_eq!(left, 1, "only what profiles open stays");
    }
}
