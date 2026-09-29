//! Opens a profile's launch set (SPEC 4.2). Apps that are already running are focused
//! instead of started twice; URLs always open in the default browser.

use crate::profiles::Rule;
use serde::Serialize;
use std::collections::HashSet;

#[derive(Debug, PartialEq)]
pub enum Step {
    Focus { label: String, exe: String },
    OpenApp { label: String, target: String, rule_id: i64 },
    OpenUrl { label: String, url: String },
    Missing { label: String },
}

#[derive(Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LaunchReport {
    pub opened: Vec<String>,
    pub focused: Vec<String>,
    /// Apps in the launch set that are not installed (or moved).
    pub missing: Vec<String>,
    pub failed: Vec<String>,
}

pub fn label(rule: &Rule) -> String {
    rule.label.clone().unwrap_or_else(|| match rule.kind.as_str() {
        "launch_url" => rule.value.split("://").nth(1).unwrap_or(&rule.value).trim_end_matches('/').to_string(),
        _ => rule.value.trim_end_matches(".exe").to_string(),
    })
}

/// Decides what to do for each launch rule. `running` holds lowercase exe names;
/// `resolve` finds a launch target for an app rule (saved path, else the app scan).
pub fn plan(rules: &[Rule], running: &HashSet<String>, mut resolve: impl FnMut(&Rule) -> Option<String>) -> Vec<Step> {
    rules
        .iter()
        .filter_map(|r| {
            let label = label(r);
            match r.kind.as_str() {
                "launch_url" => Some(Step::OpenUrl { label, url: r.value.clone() }),
                "launch_app" if running.contains(&r.value) => Some(Step::Focus { label, exe: r.value.clone() }),
                "launch_app" => Some(match resolve(r) {
                    Some(target) => Step::OpenApp { label, target, rule_id: r.id },
                    None => Step::Missing { label },
                }),
                _ => None,
            }
        })
        .collect()
}

/// Lowercase exe names of running processes, with their pids.
pub fn running_processes() -> Vec<(String, u32)> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    sys.processes()
        .iter()
        .map(|(pid, p)| (p.name().to_string_lossy().to_lowercase(), pid.as_u32()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(id: i64, kind: &str, value: &str, label: Option<&str>) -> Rule {
        Rule { id, profile_id: 1, kind: kind.into(), value: value.into(), label: label.map(Into::into), path: None }
    }

    #[test]
    fn plans_focus_open_and_missing() {
        let rules = vec![
            rule(1, "launch_app", "code.exe", Some("VS Code")),
            rule(2, "launch_app", "notion.exe", Some("Notion")),
            rule(3, "launch_url", "https://leetcode.com/problemset/", Some("LeetCode")),
            rule(4, "launch_app", "zoom.exe", None),
            rule(5, "domain", "youtube.com", None),
        ];
        let running: HashSet<String> = ["code.exe".to_string()].into();
        let steps = plan(&rules, &running, |r| (r.value == "notion.exe").then(|| "C:\\Notion.lnk".to_string()));
        assert_eq!(
            steps,
            vec![
                Step::Focus { label: "VS Code".into(), exe: "code.exe".into() },
                Step::OpenApp { label: "Notion".into(), target: "C:\\Notion.lnk".into(), rule_id: 2 },
                Step::OpenUrl { label: "LeetCode".into(), url: "https://leetcode.com/problemset/".into() },
                Step::Missing { label: "zoom".into() },
            ]
        );
    }

    #[test]
    fn labels_fall_back_to_value() {
        assert_eq!(label(&rule(1, "launch_url", "https://github.com/", None)), "github.com");
        assert_eq!(label(&rule(1, "launch_app", "steam.exe", None)), "steam");
    }
}
