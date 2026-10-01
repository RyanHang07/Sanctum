//! Thin blocking client for the Calendar v3 endpoints Sanctum uses. Events stay as JSON
//! values; sync.rs reads the fields it needs.

use reqwest::blocking::{Client, RequestBuilder};
use reqwest::{Method, Url};
use serde_json::Value;

const BASE: &str = "https://www.googleapis.com/calendar/v3";

#[derive(Debug)]
pub enum ApiError {
    /// 401: the access token expired early; refresh and retry.
    Unauthorized,
    NotFound,
    /// 410: a sync token or an event is gone.
    Gone,
    Offline,
    Other(String),
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ApiError::Unauthorized => write!(f, "Google sign-in expired. Reconnect in Setup."),
            ApiError::NotFound | ApiError::Gone => write!(f, "That event no longer exists in Google Calendar."),
            ApiError::Offline => write!(f, "Google Calendar is unreachable. Check your connection."),
            ApiError::Other(e) => write!(f, "{e}"),
        }
    }
}

pub type Result<T> = std::result::Result<T, ApiError>;

pub struct Api<'a> {
    http: &'a Client,
    token: String,
}

/// `/calendars/{id}/events/{event}`, with each id percent-encoded as a path segment.
fn url(segments: &[&str]) -> Url {
    let mut u = Url::parse(BASE).expect("static base URL");
    u.path_segments_mut().expect("base URL has a path").extend(segments);
    u
}

pub struct EventPage {
    pub items: Vec<Value>,
    pub next_sync_token: Option<String>,
}

impl<'a> Api<'a> {
    pub fn new(http: &'a Client, token: String) -> Self {
        Api { http, token }
    }

    fn send(&self, req: RequestBuilder) -> Result<Value> {
        let res = req.bearer_auth(&self.token).send().map_err(|_| ApiError::Offline)?;
        let status = res.status().as_u16();
        let text = res.text().map_err(|_| ApiError::Offline)?;
        match status {
            200..=299 => Ok(if text.is_empty() { Value::Null } else { serde_json::from_str(&text).unwrap_or(Value::Null) }),
            401 => Err(ApiError::Unauthorized),
            404 => Err(ApiError::NotFound),
            410 => Err(ApiError::Gone),
            _ => {
                let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
                let msg = v["error"]["message"].as_str().unwrap_or("request failed");
                Err(ApiError::Other(format!("Google Calendar: {msg} ({status}).")))
            }
        }
    }

    fn get(&self, u: Url, query: &[(&str, String)]) -> Result<Value> {
        self.send(self.http.request(Method::GET, u).query(query))
    }

    pub fn calendar_list(&self) -> Result<Vec<Value>> {
        let mut out = Vec::new();
        let mut page: Option<String> = None;
        loop {
            let mut q = vec![("maxResults", "250".to_string())];
            if let Some(p) = &page {
                q.push(("pageToken", p.clone()));
            }
            let v = self.get(url(&["users", "me", "calendarList"]), &q)?;
            out.extend(v["items"].as_array().cloned().unwrap_or_default());
            match v["nextPageToken"].as_str() {
                Some(p) => page = Some(p.to_string()),
                None => return Ok(out),
            }
        }
    }

    pub fn insert_calendar(&self, summary: &str, description: &str, time_zone: &str) -> Result<String> {
        let body = serde_json::json!({ "summary": summary, "description": description, "timeZone": time_zone });
        let v = self.send(self.http.post(url(&["calendars"])).json(&body))?;
        v["id"].as_str().map(str::to_string).ok_or_else(|| ApiError::Other("Google didn't create the calendar.".into()))
    }

    pub fn delete_calendar(&self, id: &str) -> Result<()> {
        self.send(self.http.delete(url(&["calendars", id]))).map(|_| ())
    }

    /// Every page of an events.list call.
    pub fn list_events(&self, calendar: &str, query: &[(&str, String)]) -> Result<EventPage> {
        let mut items = Vec::new();
        let mut page: Option<String> = None;
        loop {
            let mut q: Vec<(&str, String)> = query.to_vec();
            q.push(("maxResults", "2500".into()));
            if let Some(p) = &page {
                q.push(("pageToken", p.clone()));
            }
            let v = self.get(url(&["calendars", calendar, "events"]), &q)?;
            items.extend(v["items"].as_array().cloned().unwrap_or_default());
            match v["nextPageToken"].as_str() {
                Some(p) => page = Some(p.to_string()),
                None => return Ok(EventPage { items, next_sync_token: v["nextSyncToken"].as_str().map(str::to_string) }),
            }
        }
    }

    pub fn instances(&self, calendar: &str, id: &str, time_min: &str, time_max: &str) -> Result<Vec<Value>> {
        let q = [("timeMin", time_min.to_string()), ("timeMax", time_max.to_string())];
        let v = self.get(url(&["calendars", calendar, "events", id, "instances"]), &q)?;
        Ok(v["items"].as_array().cloned().unwrap_or_default())
    }

    pub fn get_event(&self, calendar: &str, id: &str) -> Result<Value> {
        self.get(url(&["calendars", calendar, "events", id]), &[])
    }

    pub fn insert_event(&self, calendar: &str, body: &Value) -> Result<Value> {
        self.send(self.http.post(url(&["calendars", calendar, "events"])).json(body))
    }

    pub fn patch_event(&self, calendar: &str, id: &str, body: &Value) -> Result<Value> {
        self.send(self.http.patch(url(&["calendars", calendar, "events", id])).json(body))
    }

    pub fn delete_event(&self, calendar: &str, id: &str) -> Result<()> {
        match self.send(self.http.delete(url(&["calendars", calendar, "events", id]))) {
            Ok(_) | Err(ApiError::NotFound) | Err(ApiError::Gone) => Ok(()),
            Err(e) => Err(e),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_calendar_ids_in_paths() {
        let u = url(&["calendars", "en.usa#holiday@group.v.calendar.google.com", "events"]);
        assert_eq!(u.as_str(), "https://www.googleapis.com/calendar/v3/calendars/en.usa%23holiday@group.v.calendar.google.com/events");
    }
}
