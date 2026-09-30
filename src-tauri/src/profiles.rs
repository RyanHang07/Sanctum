//! Profiles and their rules (SPEC 4.2, 5.1). Values are normalized here so blocking (M3/M8)
//! can match them directly: exe names lowercase, domains bare hosts, URLs absolute.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fmt;

pub const DURATIONS: [i64; 4] = [30, 60, 90, 120];
pub const DEFAULT_MINUTES: i64 = 60;
const KINDS: [&str; 5] = ["app", "domain", "title", "launch_app", "launch_url"];

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub id: i64,
    pub profile_id: i64,
    pub kind: String,
    pub value: String,
    pub label: Option<String>,
    pub path: Option<String>,
    /// Sealed sites only: pages under the site that stay open (4b).
    pub allow: Vec<SiteAllow>,
}

/// An exception under a sealed site: a bare host plus path ("youtube.com/@mitocw").
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SiteAllow {
    pub id: i64,
    pub prefix: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: i64,
    pub name: String,
    pub allowlist_mode: bool,
    pub default_minutes: i64,
    pub work_types: Vec<String>,
    pub created_at: i64,
    pub rules: Vec<Rule>,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct NewRule {
    pub kind: String,
    pub value: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProfileDraft {
    pub name: String,
    #[serde(default)]
    pub default_minutes: Option<i64>,
    #[serde(default)]
    pub allowlist_mode: bool,
    #[serde(default)]
    pub work_types: Vec<String>,
    #[serde(default)]
    pub rules: Vec<NewRule>,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProfilePatch {
    pub name: Option<String>,
    pub default_minutes: Option<i64>,
    pub allowlist_mode: Option<bool>,
}

#[derive(Debug)]
pub enum Error {
    Db(rusqlite::Error),
    Invalid(String),
    NotFound,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Db(e) => write!(f, "{e}"),
            Error::Invalid(msg) => f.write_str(msg),
            Error::NotFound => f.write_str("That profile no longer exists."),
        }
    }
}

impl From<rusqlite::Error> for Error {
    fn from(e: rusqlite::Error) -> Self {
        Error::Db(e)
    }
}

pub type Result<T> = std::result::Result<T, Error>;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Bare host (plus optional path) from anything a person might paste: "https://www.YouTube.com/" -> "youtube.com".
pub fn normalize_domain(input: &str) -> Option<String> {
    let s = input.trim().to_lowercase();
    let s = s.split_once("://").map(|(_, rest)| rest.to_string()).unwrap_or(s);
    let s = s.strip_prefix("www.").unwrap_or(&s).trim_end_matches('/').to_string();
    let host = s.split('/').next().unwrap_or("");
    let valid = host.contains('.')
        && !host.starts_with('.')
        && !host.ends_with('.')
        && host.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.');
    valid.then_some(s)
}

/// A page (or section) under `domain` that stays open while the site is sealed. It must be on
/// the site or one of its subdomains, and more specific than the whole site.
pub fn normalize_allow(domain: &str, input: &str) -> Option<String> {
    let s = normalize_domain(input)?;
    let host = s.split('/').next().unwrap_or("");
    let site = domain.split('/').next().unwrap_or(domain);
    let on_site = host == site || host.ends_with(&format!(".{site}"));
    (on_site && s != domain && s.len() > site.len()).then_some(s)
}

fn normalize_rule(rule: NewRule) -> Result<NewRule> {
    let kind = rule.kind.trim().to_string();
    if !KINDS.contains(&kind.as_str()) {
        return Err(Error::Invalid(format!("Unknown rule kind: {kind}.")));
    }
    let raw = rule.value.trim();
    if raw.is_empty() {
        return Err(Error::Invalid("A rule needs a value.".into()));
    }
    let value = match kind.as_str() {
        "app" | "launch_app" => {
            let exe = raw.to_lowercase();
            if !exe.ends_with(".exe") || exe.contains(['/', '\\']) {
                return Err(Error::Invalid(format!("{raw} is not an app name.")));
            }
            exe
        }
        "domain" => normalize_domain(raw).ok_or_else(|| Error::Invalid(format!("{raw} is not a site.")))?,
        "launch_url" => {
            let lower = raw.to_lowercase();
            if !(lower.starts_with("https://") || lower.starts_with("http://")) || !raw.contains('.') {
                return Err(Error::Invalid(format!("{raw} is not a URL.")));
            }
            raw.to_string()
        }
        _ => raw.to_string(),
    };
    let clean = |s: Option<String>| s.map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
    Ok(NewRule { kind, value, label: clean(rule.label), path: clean(rule.path) })
}

fn check_minutes(m: i64) -> Result<i64> {
    if DURATIONS.contains(&m) {
        Ok(m)
    } else {
        Err(Error::Invalid(format!("Focus length must be one of 30, 60, 90, or 120 minutes, not {m}.")))
    }
}

fn name_taken(conn: &Connection, name: &str, except: Option<i64>) -> Result<bool> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM profiles WHERE name = ?1 COLLATE NOCASE AND id != ?2",
        params![name, except.unwrap_or(-1)],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

/// "New profile", then "New profile 2", "New profile 3", ...
fn unique_name(conn: &Connection, base: &str) -> Result<String> {
    let base = if base.trim().is_empty() { "New profile" } else { base.trim() };
    if !name_taken(conn, base, None)? {
        return Ok(base.to_string());
    }
    for i in 2.. {
        let candidate = format!("{base} {i}");
        if !name_taken(conn, &candidate, None)? {
            return Ok(candidate);
        }
    }
    unreachable!()
}

fn rules_for(conn: &Connection, profile_id: Option<i64>) -> Result<Vec<Rule>> {
    let mut stmt = conn.prepare(
        "SELECT id, profile_id, kind, value, label, path FROM profile_rules
         WHERE ?1 IS NULL OR profile_id = ?1 ORDER BY sort, id",
    )?;
    let rows = stmt.query_map([profile_id], |r| {
        Ok(Rule {
            id: r.get(0)?,
            profile_id: r.get(1)?,
            kind: r.get(2)?,
            value: r.get(3)?,
            label: r.get(4)?,
            path: r.get(5)?,
            allow: Vec::new(),
        })
    })?;
    let mut rules: Vec<Rule> = rows.collect::<rusqlite::Result<_>>()?;
    let mut stmt = conn.prepare(
        "SELECT e.id, e.rule_id, e.prefix FROM site_exceptions e JOIN profile_rules r ON r.id = e.rule_id
         WHERE ?1 IS NULL OR r.profile_id = ?1 ORDER BY e.prefix",
    )?;
    let allows = stmt.query_map([profile_id], |r| Ok((r.get::<_, i64>(1)?, SiteAllow { id: r.get(0)?, prefix: r.get(2)? })))?;
    for a in allows {
        let (rule_id, allow) = a?;
        if let Some(rule) = rules.iter_mut().find(|r| r.id == rule_id) {
            rule.allow.push(allow);
        }
    }
    Ok(rules)
}

fn read_profiles(conn: &Connection, id: Option<i64>) -> Result<Vec<Profile>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, allowlist_mode, default_minutes, work_types, created_at FROM profiles
         WHERE ?1 IS NULL OR id = ?1 ORDER BY id",
    )?;
    let mut profiles = stmt
        .query_map([id], |r| {
            let types: String = r.get(4)?;
            Ok(Profile {
                id: r.get(0)?,
                name: r.get(1)?,
                allowlist_mode: r.get::<_, i64>(2)? != 0,
                default_minutes: r.get(3)?,
                work_types: serde_json::from_str(&types).unwrap_or_default(),
                created_at: r.get(5)?,
                rules: Vec::new(),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let rules = rules_for(conn, id)?;
    for p in &mut profiles {
        p.rules = rules.iter().filter(|r| r.profile_id == p.id).cloned().collect();
    }
    Ok(profiles)
}

pub fn list(conn: &Connection) -> Result<Vec<Profile>> {
    read_profiles(conn, None)
}

pub fn get(conn: &Connection, id: i64) -> Result<Profile> {
    read_profiles(conn, Some(id))?.pop().ok_or(Error::NotFound)
}

fn insert_rule(conn: &Connection, profile_id: i64, rule: NewRule) -> Result<()> {
    let rule = normalize_rule(rule)?;
    let sort: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort), -1) + 1 FROM profile_rules WHERE profile_id = ?1",
        [profile_id],
        |r| r.get(0),
    )?;
    // The unique index makes re-adding an existing rule a no-op.
    conn.execute(
        "INSERT OR IGNORE INTO profile_rules (profile_id, kind, value, label, path, sort)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![profile_id, rule.kind, rule.value, rule.label, rule.path, sort],
    )?;
    Ok(())
}

/// Creates a profile and its rules in one transaction (used by "New profile", dev seeding, and onboarding).
pub fn create(conn: &mut Connection, draft: ProfileDraft) -> Result<Profile> {
    let minutes = check_minutes(draft.default_minutes.unwrap_or(DEFAULT_MINUTES))?;
    let tx = conn.transaction()?;
    let name = unique_name(&tx, &draft.name)?;
    tx.execute(
        "INSERT INTO profiles (name, allowlist_mode, default_minutes, work_types, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            name,
            draft.allowlist_mode as i64,
            minutes,
            serde_json::to_string(&draft.work_types).unwrap_or_else(|_| "[]".into()),
            now_ms()
        ],
    )?;
    let id = tx.last_insert_rowid();
    for rule in draft.rules {
        insert_rule(&tx, id, rule)?;
    }
    tx.commit()?;
    get(conn, id)
}

pub fn update(conn: &Connection, id: i64, patch: ProfilePatch) -> Result<Profile> {
    get(conn, id)?;
    if let Some(name) = patch.name {
        let name = name.trim();
        if name.is_empty() {
            return Err(Error::Invalid("A profile needs a name.".into()));
        }
        if name_taken(conn, name, Some(id))? {
            return Err(Error::Invalid(format!("Another profile is already named {name}.")));
        }
        conn.execute("UPDATE profiles SET name = ?1 WHERE id = ?2", params![name, id])?;
    }
    if let Some(m) = patch.default_minutes {
        conn.execute("UPDATE profiles SET default_minutes = ?1 WHERE id = ?2", params![check_minutes(m)?, id])?;
    }
    if let Some(a) = patch.allowlist_mode {
        conn.execute("UPDATE profiles SET allowlist_mode = ?1 WHERE id = ?2", params![a as i64, id])?;
    }
    get(conn, id)
}

pub fn delete(conn: &Connection, id: i64) -> Result<()> {
    if conn.execute("DELETE FROM profiles WHERE id = ?1", [id])? == 0 {
        return Err(Error::NotFound);
    }
    Ok(())
}

pub fn add_rule(conn: &Connection, profile_id: i64, rule: NewRule) -> Result<Profile> {
    get(conn, profile_id)?;
    insert_rule(conn, profile_id, rule)?;
    get(conn, profile_id)
}

pub fn remove_rule(conn: &Connection, rule_id: i64) -> Result<Profile> {
    let profile_id: i64 = conn
        .query_row("SELECT profile_id FROM profile_rules WHERE id = ?1", [rule_id], |r| r.get(0))
        .optional()?
        .ok_or(Error::NotFound)?;
    conn.execute("DELETE FROM profile_rules WHERE id = ?1", [rule_id])?;
    get(conn, profile_id)
}

/// Adds a page that stays open under a sealed site.
pub fn add_site_allow(conn: &Connection, rule_id: i64, input: &str) -> Result<Profile> {
    let (profile_id, kind, domain): (i64, String, String) = conn
        .query_row("SELECT profile_id, kind, value FROM profile_rules WHERE id = ?1", [rule_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .optional()?
        .ok_or(Error::NotFound)?;
    if kind != "domain" {
        return Err(Error::Invalid("Only sealed sites take exceptions.".into()));
    }
    let prefix = normalize_allow(&domain, input)
        .ok_or_else(|| Error::Invalid(format!("{} is not a page on {domain}.", input.trim())))?;
    conn.execute("INSERT OR IGNORE INTO site_exceptions (rule_id, prefix) VALUES (?1, ?2)", params![rule_id, prefix])?;
    get(conn, profile_id)
}

pub fn remove_site_allow(conn: &Connection, id: i64) -> Result<Profile> {
    let profile_id: i64 = conn
        .query_row("SELECT r.profile_id FROM site_exceptions e JOIN profile_rules r ON r.id = e.rule_id WHERE e.id = ?1", [id], |r| r.get(0))
        .optional()?
        .ok_or(Error::NotFound)?;
    conn.execute("DELETE FROM site_exceptions WHERE id = ?1", [id])?;
    get(conn, profile_id)
}

/// Remembers where an app was last launched from, so the next launch skips the app scan.
pub fn set_rule_path(conn: &Connection, rule_id: i64, path: &str) -> Result<()> {
    conn.execute("UPDATE profile_rules SET path = ?1 WHERE id = ?2", params![path, rule_id])?;
    Ok(())
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

    fn rule(kind: &str, value: &str) -> NewRule {
        NewRule { kind: kind.into(), value: value.into(), ..Default::default() }
    }

    #[test]
    fn creates_profile_with_normalized_rules() {
        let mut conn = fresh();
        let p = create(
            &mut conn,
            ProfileDraft {
                name: "Interview Prep".into(),
                default_minutes: Some(90),
                work_types: vec!["DSA practice".into()],
                rules: vec![
                    rule("domain", "https://www.YouTube.com/"),
                    rule("app", "Discord.exe"),
                    rule("launch_url", "https://leetcode.com/problemset/"),
                    rule("title", "Shorts"),
                    rule("domain", "youtube.com"), // duplicate after normalizing
                ],
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(p.name, "Interview Prep");
        assert_eq!(p.default_minutes, 90);
        assert_eq!(p.work_types, vec!["DSA practice"]);
        let values: Vec<_> = p.rules.iter().map(|r| (r.kind.as_str(), r.value.as_str())).collect();
        assert_eq!(
            values,
            vec![
                ("domain", "youtube.com"),
                ("app", "discord.exe"),
                ("launch_url", "https://leetcode.com/problemset/"),
                ("title", "Shorts"),
            ]
        );
    }

    #[test]
    fn names_are_unique() {
        let mut conn = fresh();
        let a = create(&mut conn, ProfileDraft::default()).unwrap();
        let b = create(&mut conn, ProfileDraft::default()).unwrap();
        assert_eq!(a.name, "New profile");
        assert_eq!(b.name, "New profile 2");
        let err = update(&conn, b.id, ProfilePatch { name: Some("new PROFILE".into()), ..Default::default() }).unwrap_err();
        assert!(err.to_string().contains("already named"));
    }

    #[test]
    fn update_validates_duration() {
        let mut conn = fresh();
        let p = create(&mut conn, ProfileDraft { name: "Study".into(), ..Default::default() }).unwrap();
        assert_eq!(p.default_minutes, 60);
        assert!(update(&conn, p.id, ProfilePatch { default_minutes: Some(45), ..Default::default() }).is_err());
        let p = update(
            &conn,
            p.id,
            ProfilePatch { default_minutes: Some(120), allowlist_mode: Some(true), name: Some(" Deep Study ".into()) },
        )
        .unwrap();
        assert_eq!((p.default_minutes, p.allowlist_mode, p.name.as_str()), (120, true, "Deep Study"));
    }

    #[test]
    fn rejects_bad_rules() {
        let mut conn = fresh();
        let p = create(&mut conn, ProfileDraft { name: "X".into(), ..Default::default() }).unwrap();
        for (kind, value) in [("app", "discord"), ("domain", "not a site"), ("launch_url", "leetcode.com"), ("bogus", "x"), ("title", "  ")] {
            assert!(add_rule(&conn, p.id, rule(kind, value)).is_err(), "{kind} {value}");
        }
    }

    #[test]
    fn add_remove_rules_and_delete_cascades() {
        let mut conn = fresh();
        let p = create(&mut conn, ProfileDraft { name: "Deep Work".into(), ..Default::default() }).unwrap();
        let p = add_rule(
            &conn,
            p.id,
            NewRule { kind: "launch_app".into(), value: "Code.exe".into(), label: Some("VS Code".into()), path: Some("C:\\x\\Code.lnk".into()) },
        )
        .unwrap();
        assert_eq!(p.rules[0].label.as_deref(), Some("VS Code"));
        let p = remove_rule(&conn, p.rules[0].id).unwrap();
        assert!(p.rules.is_empty());
        add_rule(&conn, p.id, rule("app", "steam.exe")).unwrap();
        delete(&conn, p.id).unwrap();
        assert!(matches!(get(&conn, p.id), Err(Error::NotFound)));
        let left: i64 = conn.query_row("SELECT COUNT(*) FROM profile_rules", [], |r| r.get(0)).unwrap();
        assert_eq!(left, 0);
    }

    #[test]
    fn normalizes_domains() {
        assert_eq!(normalize_domain("https://www.reddit.com/r/all/").as_deref(), Some("reddit.com/r/all"));
        assert_eq!(normalize_domain("X.com").as_deref(), Some("x.com"));
        assert_eq!(normalize_domain("localhost"), None);
        assert_eq!(normalize_domain("two words.com"), None);
    }

    #[test]
    fn site_exceptions_stay_under_their_site() {
        assert_eq!(normalize_allow("youtube.com", "https://www.youtube.com/@mitocw/"), Some("youtube.com/@mitocw".into()));
        assert_eq!(normalize_allow("youtube.com", "music.youtube.com"), Some("music.youtube.com".into()));
        assert_eq!(normalize_allow("youtube.com", "youtube.com"), None, "the whole site isn't an exception");
        assert_eq!(normalize_allow("youtube.com", "notyoutube.com/x"), None);
        assert_eq!(normalize_allow("reddit.com", "youtube.com/x"), None);

        let mut conn = Connection::open_in_memory().unwrap();
        db::prepare(&mut conn).unwrap();
        let p = create(
            &mut conn,
            ProfileDraft { name: "Study".into(), rules: vec![NewRule { kind: "domain".into(), value: "youtube.com".into(), ..Default::default() }, NewRule { kind: "app".into(), value: "steam.exe".into(), ..Default::default() }], ..Default::default() },
        )
        .unwrap();
        let site = p.rules.iter().find(|r| r.kind == "domain").unwrap().id;
        let app = p.rules.iter().find(|r| r.kind == "app").unwrap().id;
        add_site_allow(&conn, site, "youtube.com/@mitocw").unwrap();
        let p = add_site_allow(&conn, site, "https://youtube.com/@mitocw").unwrap(); // no duplicate
        let allow = &p.rules.iter().find(|r| r.id == site).unwrap().allow;
        assert_eq!(allow.iter().map(|a| a.prefix.as_str()).collect::<Vec<_>>(), vec!["youtube.com/@mitocw"]);
        assert!(add_site_allow(&conn, app, "youtube.com/x").is_err());
        assert!(add_site_allow(&conn, site, "twitch.tv").is_err());
        let p = remove_site_allow(&conn, allow[0].id).unwrap();
        assert!(p.rules.iter().find(|r| r.id == site).unwrap().allow.is_empty());
        // Exceptions go with their rule.
        add_site_allow(&conn, site, "youtube.com/@mitocw").unwrap();
        remove_rule(&conn, site).unwrap();
        let left: i64 = conn.query_row("SELECT COUNT(*) FROM site_exceptions", [], |r| r.get(0)).unwrap();
        assert_eq!(left, 0);
    }
}
