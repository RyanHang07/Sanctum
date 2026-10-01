//! Profiles and their rules (SPEC 4.2, 5.1). Values are normalized here so blocking (M3/M8)
//! can match them directly: exe names lowercase, domains bare hosts, URLs absolute.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fmt;

pub const DURATIONS: [i64; 8] = [15, 30, 45, 60, 75, 90, 105, 120];
pub const DEFAULT_MINUTES: i64 = 60;
/// What a profile opens. What it seals lives in the one Distractions list (distractions.rs).
const KINDS: [&str; 2] = ["launch_app", "launch_url"];

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub id: i64,
    pub profile_id: i64,
    pub kind: String,
    pub value: String,
    pub label: Option<String>,
    pub path: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: i64,
    pub name: String,
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
    pub work_types: Vec<String>,
    #[serde(default)]
    pub rules: Vec<NewRule>,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProfilePatch {
    pub name: Option<String>,
    pub default_minutes: Option<i64>,
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
    if ["app", "domain", "title"].contains(&kind.as_str()) {
        return Err(Error::Invalid("Seals live in Distractions now, for every profile.".into()));
    }
    if !KINDS.contains(&kind.as_str()) {
        return Err(Error::Invalid(format!("Unknown rule kind: {kind}.")));
    }
    let raw = rule.value.trim();
    if raw.is_empty() {
        return Err(Error::Invalid("A rule needs a value.".into()));
    }
    let value = match kind.as_str() {
        "launch_app" => {
            let exe = raw.to_lowercase();
            if !exe.ends_with(".exe") || exe.contains(['/', '\\']) {
                return Err(Error::Invalid(format!("{raw} is not an app name.")));
            }
            exe
        }
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
        Err(Error::Invalid(format!("Focus length must be 15 minutes to 2 hours, in 15-minute steps, not {m}.")))
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
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

fn read_profiles(conn: &Connection, id: Option<i64>) -> Result<Vec<Profile>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, default_minutes, work_types, created_at FROM profiles
         WHERE ?1 IS NULL OR id = ?1 ORDER BY id",
    )?;
    let mut profiles = stmt
        .query_map([id], |r| {
            let types: String = r.get(3)?;
            Ok(Profile {
                id: r.get(0)?,
                name: r.get(1)?,
                default_minutes: r.get(2)?,
                work_types: serde_json::from_str(&types).unwrap_or_default(),
                created_at: r.get(4)?,
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
        "INSERT INTO profiles (name, default_minutes, work_types, created_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![
            name,
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
                    rule("launch_app", "Code.exe"),
                    rule("launch_url", "https://leetcode.com/problemset/"),
                    rule("launch_app", "code.exe"), // duplicate after normalizing
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
            vec![("launch_app", "code.exe"), ("launch_url", "https://leetcode.com/problemset/")]
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
        assert!(update(&conn, p.id, ProfilePatch { default_minutes: Some(50), ..Default::default() }).is_err());
        let p = update(
            &conn,
            p.id,
            ProfilePatch { default_minutes: Some(120), name: Some(" Deep Study ".into()) },
        )
        .unwrap();
        assert_eq!((p.default_minutes, p.name.as_str()), (120, "Deep Study"));
    }

    #[test]
    fn rejects_bad_rules() {
        let mut conn = fresh();
        let p = create(&mut conn, ProfileDraft { name: "X".into(), ..Default::default() }).unwrap();
        for (kind, value) in [("launch_app", "discord"), ("launch_url", "leetcode.com"), ("bogus", "x")] {
            assert!(add_rule(&conn, p.id, rule(kind, value)).is_err(), "{kind} {value}");
        }
        // Seals live in Distractions now.
        let err = add_rule(&conn, p.id, rule("app", "discord.exe")).unwrap_err();
        assert!(err.to_string().contains("Distractions"));
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
        add_rule(&conn, p.id, rule("launch_url", "https://leetcode.com/")).unwrap();
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
    }
}
