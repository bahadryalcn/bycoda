//! One authenticated control request per machine, shared by renderer windows.
//! Content and commands never wait on this lane. Registrations expire after a
//! crashed window; an empty subscription explicitly releases a healthy window.
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

/// Git cursors a host answers per poll.
const GIT_CURSOR_LIMIT: usize = 32;

#[derive(Default)]
pub(super) struct Changes {
    entries: Mutex<HashMap<String, Arc<Entry>>>,
}
#[derive(Default)]
pub(super) struct Reads {
    entries: Mutex<HashMap<String, Arc<ReadEntry>>>,
}
#[derive(Default)]
struct ReadEntry {
    result: Mutex<Option<Result<Value, String>>>,
    changed: Condvar,
}
impl Reads {
    pub(super) fn request(
        &self,
        key: String,
        timeout: Duration,
        send: impl FnOnce() -> Result<Value, String>,
    ) -> Result<Value, String> {
        let (entry, leader) = {
            let mut entries = self.entries.lock().map_err(|_| "Read sharing is locked")?;
            if let Some(entry) = entries.get(&key) {
                (entry.clone(), false)
            } else {
                if entries.len() >= 64 {
                    return Err("Too many concurrent remote reads".into());
                }
                let entry = Arc::new(ReadEntry::default());
                entries.insert(key.clone(), entry.clone());
                (entry, true)
            }
        };
        if !leader {
            let state = entry.result.lock().map_err(|_| "Read sharing is locked")?;
            let (result, timeout) = entry
                .changed
                .wait_timeout_while(state, timeout, |result| result.is_none())
                .map_err(|_| "Read sharing is locked")?;
            if timeout.timed_out() {
                return Err("Shared remote read timed out".into());
            }
            return result
                .clone()
                .unwrap_or_else(|| Err("Shared remote read ended".into()));
        }
        let result = send();
        *entry.result.lock().map_err(|_| "Read sharing is locked")? = Some(result.clone());
        entry.changed.notify_all();
        let mut entries = self.entries.lock().map_err(|_| "Read sharing is locked")?;
        if entries
            .get(&key)
            .is_some_and(|current| Arc::ptr_eq(current, &entry))
        {
            entries.remove(&key);
        }
        result
    }
}
#[derive(Default)]
struct Entry {
    state: Mutex<Shared>,
    changed: Condvar,
}
#[derive(Default)]
struct Shared {
    windows: HashMap<String, (Value, Instant)>,
    running: bool,
    generation: u64,
    result: Option<Result<Value, String>>,
}

impl Changes {
    pub(super) fn request(
        &self,
        machine: &str,
        window: &str,
        params: Value,
        send: impl FnOnce(Value) -> Result<Value, String>,
    ) -> Result<Value, String> {
        let entry = {
            let mut entries = self.entries.lock().map_err(|_| "Control lane is locked")?;
            // Machine entries with no consumers are discarded on the next use.
            entries.retain(|_, entry| {
                entry.state.lock().is_ok_and(|state| {
                    state.running
                        || state
                            .windows
                            .values()
                            .any(|(_, at)| at.elapsed() < Duration::from_secs(45))
                })
            });
            if !entries.contains_key(machine) && entries.len() >= 64 {
                return Err("Too many remote control connections".into());
            }
            entries.entry(machine.to_owned()).or_default().clone()
        };
        let mut state = entry.state.lock().map_err(|_| "Control lane is locked")?;
        state
            .windows
            .retain(|_, (_, at)| at.elapsed() < Duration::from_secs(45));
        let empty = params.get("tasksKnown").is_none()
            && ["sessions", "projects", "git"].iter().all(|key| {
                params.get(key).map_or(*key == "git", |value| {
                    value.as_array().is_some_and(Vec::is_empty)
                })
            });
        if empty {
            let release_id = params.get("subscriptionId");
            let matches = state.windows.get(window).is_none_or(|(registered, _)| {
                release_id.is_none() || registered.get("subscriptionId") == release_id
            });
            if matches {
                state.windows.remove(window);
            }
            return Ok(
                json!({"instanceId":params.get("instanceId").cloned().unwrap_or(Value::Null),
                "reset":false,"sessions":[],"projects":[]}),
            );
        }
        if !state.windows.contains_key(window) && state.windows.len() >= 32 {
            return Err("Too many remote window subscriptions".into());
        }
        state
            .windows
            .insert(window.to_owned(), (params, Instant::now()));
        if state.running {
            let generation = state.generation;
            let (next, timeout) = entry
                .changed
                .wait_timeout_while(state, Duration::from_secs(35), |state| {
                    state.generation == generation
                })
                .map_err(|_| "Control lane is locked")?;
            if timeout.timed_out() {
                return Err("Remote control request timed out".into());
            }
            return next
                .result
                .clone()
                .unwrap_or_else(|| Err("Remote control request ended".into()));
        }
        let request = scheduled_request(
            union(state.windows.values().map(|(value, _)| value))?,
            state.generation,
        )?;
        let checked_sessions = request["sessions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| entry["sessionId"].clone())
            .collect::<Vec<_>>();
        let checked_projects = request["projects"]
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| entry["projectId"].clone())
            .collect::<Vec<_>>();
        state.running = true;
        drop(state);
        let result = send(request).and_then(|mut response| {
            let object = response
                .as_object_mut()
                .ok_or("Invalid machine changes response")?;
            object.insert("checkedSessions".into(), json!(checked_sessions));
            object.insert("checkedProjects".into(), json!(checked_projects));
            Ok(response)
        });
        let mut state = entry.state.lock().map_err(|_| "Control lane is locked")?;
        state.running = false;
        state.generation += 1;
        state.result = Some(result.clone());
        entry.changed.notify_all();
        result
    }
}

fn union<'a>(requests: impl Iterator<Item = &'a Value>) -> Result<Value, String> {
    let mut sessions: HashMap<String, u64> = HashMap::new();
    let mut projects: HashMap<String, Option<String>> = HashMap::new();
    let mut git: HashMap<String, Option<String>> = HashMap::new();
    let mut instances = Vec::new();
    let mut tasks: Option<String> = None;
    let mut inline_sync = false;
    let mut inline_sessions = HashSet::<String>::new();
    let mut active_projects: HashMap<String, u64> = HashMap::new();
    let mut active_sessions: HashMap<String, u64> = HashMap::new();
    for request in requests {
        for (key, id, priorities) in [
            ("activeProjects", "projectId", &mut active_projects),
            ("activeSessions", "sessionId", &mut active_sessions),
        ] {
            for hint in request
                .get(key)
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                if let (Some(id), Some(at)) = (hint[id].as_str(), hint["lastActiveAt"].as_u64()) {
                    priorities
                        .entry(id.to_owned())
                        .and_modify(|previous| *previous = (*previous).max(at))
                        .or_insert(at);
                }
            }
        }
        let wants_inline = request.get("inlineSync").and_then(Value::as_bool) == Some(true);
        inline_sync |= wants_inline;
        if let Some(known) = request.get("tasksKnown").and_then(Value::as_str) {
            match &mut tasks {
                Some(previous) if previous != known => *previous = String::new(),
                None => tasks = Some(known.to_owned()),
                _ => {}
            }
        }
        instances.push(request.get("instanceId").and_then(Value::as_str));
        for session in request
            .get("sessions")
            .and_then(Value::as_array)
            .ok_or("Invalid subscriptions")?
        {
            let id = session
                .get("sessionId")
                .and_then(Value::as_str)
                .ok_or("Invalid session subscription")?;
            let revision = session
                .get("revision")
                .and_then(Value::as_u64)
                .ok_or("Invalid session revision")?;
            let selected = match request.get("inlineSessionIds") {
                None => true, // Legacy opt-in covers only that window's own subscriptions.
                Some(Value::Array(ids)) => ids.iter().any(|value| value.as_str() == Some(id)),
                _ => false,
            };
            if wants_inline && selected {
                inline_sessions.insert(id.to_owned());
            }
            sessions
                .entry(id.to_owned())
                .and_modify(|known| *known = (*known).min(revision))
                .or_insert(revision);
        }
        for project in request
            .get("projects")
            .and_then(Value::as_array)
            .ok_or("Invalid subscriptions")?
        {
            let id = project
                .get("projectId")
                .and_then(Value::as_str)
                .ok_or("Invalid project subscription")?;
            let known = project
                .get("known")
                .and_then(Value::as_str)
                .map(str::to_owned);
            projects
                .entry(id.to_owned())
                .and_modify(|previous| {
                    if *previous != known {
                        *previous = None;
                    }
                })
                .or_insert(known);
        }
        for checkout in request.get("git").map_or(Ok(&[][..]), |value| {
            value
                .as_array()
                .map(Vec::as_slice)
                .ok_or("Invalid subscriptions")
        })? {
            let cwd = checkout
                .get("cwd")
                .and_then(Value::as_str)
                .ok_or("Invalid git subscription")?;
            let known = checkout
                .get("known")
                .and_then(Value::as_str)
                .map(str::to_owned);
            git.entry(cwd.to_owned())
                .and_modify(|previous| {
                    if *previous != known {
                        *previous = None;
                    }
                })
                .or_insert(known);
        }
    }
    // Git watching is an optimization: past the host's limit, the rest keep
    // their own refresh triggers instead of failing the whole lane.
    let mut git: Vec<_> = git.into_iter().collect();
    git.sort();
    git.truncate(GIT_CURSOR_LIMIT);
    let instance = instances
        .first()
        .copied()
        .flatten()
        .filter(|first| instances.iter().all(|instance| *instance == Some(*first)));
    let mut result = json!({"instanceId":instance,"waitMs":10000,
        "sessions":sessions.into_iter().map(|(session_id, revision)|json!({"sessionId":session_id,"revision":revision})).collect::<Vec<_>>(),
        "projects":projects.into_iter().map(|(project_id, known)| {
            let mut project=json!({"projectId":project_id});
            if let Some(known)=known {project["known"]=Value::String(known);}
            project
        }).collect::<Vec<_>>() });
    for (key, id, priorities) in [
        ("activeProjects", "projectId", active_projects),
        ("activeSessions", "sessionId", active_sessions),
    ] {
        if !priorities.is_empty() {
            result[key] = json!(priorities
                .into_iter()
                .map(|(value, at)| {
                    let mut hint = json!({"lastActiveAt":at});
                    hint[id] = json!(value);
                    hint
                })
                .collect::<Vec<_>>());
        }
    }
    if inline_sync {
        result["inlineSync"] = Value::Bool(true);
        let mut ids: Vec<_> = inline_sessions.into_iter().collect();
        ids.sort();
        result["inlineSessionIds"] = json!(ids);
    }
    if !git.is_empty() {
        result["git"] = Value::Array(
            git.into_iter()
                .map(|(cwd, known)| {
                    let mut checkout = json!({"cwd":cwd});
                    if let Some(known) = known {
                        checkout["known"] = Value::String(known);
                    }
                    checkout
                })
                .collect(),
        );
    }
    if let Some(known) = tasks {
        result["tasksKnown"] = Value::String(known);
    }
    Ok(result)
}

// Keep visible sessions and recently active projects in the frequent lane. A
// bounded rotating share guarantees older subscriptions still get verified.
fn scheduled_request(mut request: Value, generation: u64) -> Result<Value, String> {
    let mut overflow = false;
    let has_sessions = request["sessions"]
        .as_array()
        .is_some_and(|v| !v.is_empty());
    for (key, hints, id, limit, hot_limit) in [
        ("sessions", "activeSessions", "sessionId", 64, 48),
        (
            "projects",
            "activeProjects",
            "projectId",
            if has_sessions { 8 } else { 32 },
            4,
        ),
    ] {
        let priorities: HashMap<String, u64> = request
            .get(hints)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|hint| {
                Some((
                    hint[id].as_str()?.to_owned(),
                    hint["lastActiveAt"].as_u64()?,
                ))
            })
            .collect();
        let values = request[key].as_array_mut().ok_or("Invalid subscriptions")?;
        values.sort_by(|a, b| {
            let a = a[id].as_str().unwrap_or_default();
            let b = b[id].as_str().unwrap_or_default();
            priorities
                .get(b)
                .unwrap_or(&0)
                .cmp(priorities.get(a).unwrap_or(&0))
                .then_with(|| a.cmp(b))
        });
        if values.len() > limit {
            overflow = true;
            let hot = values
                .iter()
                .take_while(|value| priorities.contains_key(value[id].as_str().unwrap_or_default()))
                .count()
                .min(hot_limit);
            let rest = &values[hot..];
            let slots = limit - hot;
            let start = (generation as usize % rest.len()) * slots % rest.len();
            let selected = values[..hot]
                .iter()
                .cloned()
                .chain(rest.iter().cycle().skip(start).take(slots).cloned())
                .collect();
            *values = selected;
        }
        request.as_object_mut().unwrap().remove(hints);
    }
    if overflow {
        request["waitMs"] = json!(1000);
    }
    if let Some(ids) = request.get("inlineSessionIds").and_then(Value::as_array) {
        let sessions: HashSet<&str> = request["sessions"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|session| session["sessionId"].as_str())
            .collect();
        let selected: Vec<_> = ids
            .iter()
            .filter(|id| id.as_str().is_some_and(|id| sessions.contains(id)))
            .cloned()
            .collect();
        request["inlineSessionIds"] = Value::Array(selected);
    }
    Ok(request)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn visible_sessions_and_recent_projects_are_frequent_without_starving_older_entries() {
        let request = json!({"instanceId":"boot","inlineSync":true,"tasksKnown":"tasks","waitMs":10000,
            "activeSessions":[{"sessionId":"s69","lastActiveAt":20}],
            "activeProjects":[{"projectId":"p69","lastActiveAt":20},{"projectId":"p68","lastActiveAt":10}],
            "sessions":(0..70).map(|i| json!({"sessionId":format!("s{i}"),"revision":i})).collect::<Vec<_>>(),
            "projects":(0..70).map(|i| json!({"projectId":format!("p{i}"),"known":"old"})).collect::<Vec<_>>()});
        let mut sessions = std::collections::HashSet::new();
        let mut projects = std::collections::HashSet::new();
        for generation in 0..70 {
            let batch = scheduled_request(request.clone(), generation).unwrap();
            assert_eq!(batch["sessions"][0]["sessionId"], "s69");
            assert_eq!(batch["projects"][0]["projectId"], "p69");
            assert_eq!(batch["projects"][1]["projectId"], "p68");
            assert_eq!(batch["sessions"].as_array().unwrap().len(), 64);
            assert_eq!(batch["projects"].as_array().unwrap().len(), 8);
            assert_eq!(batch["waitMs"], 1000);
            assert_eq!(batch["tasksKnown"], "tasks");
            assert_eq!(batch["inlineSync"], true);
            assert_eq!(batch["instanceId"], "boot");
            assert!(batch.get("activeSessions").is_none());
            assert!(batch.get("activeProjects").is_none());
            sessions.extend(
                batch["sessions"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|s| s["sessionId"].as_str().unwrap().to_owned()),
            );
            projects.extend(
                batch["projects"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|s| s["projectId"].as_str().unwrap().to_owned()),
            );
        }
        assert_eq!(sessions.len(), 70);
        assert_eq!(projects.len(), 70);
    }

    #[test]
    fn small_demands_keep_long_poll_and_background_only_demands_rotate_at_host_limit() {
        let request = json!({"sessions":[],"projects":[{"projectId":"p"}],"waitMs":10000});
        assert_eq!(scheduled_request(request.clone(), 0).unwrap(), request);
        let request = json!({"sessions":[],"projects":(0..70).map(|i| json!({"projectId":format!("p{i}")})).collect::<Vec<_>>()});
        let first = scheduled_request(request.clone(), 0).unwrap();
        let next = scheduled_request(request, 1).unwrap();
        assert_eq!(first["projects"].as_array().unwrap().len(), 32);
        assert_ne!(first["projects"], next["projects"]);
    }
    #[test]
    fn inline_sync_survives_window_union_with_the_minimum_revision() {
        let a =
            json!({"sessions":[{"sessionId":"s","revision":2}],"projects":[],"inlineSync":true});
        let b = json!({"sessions":[{"sessionId":"s","revision":1}],"projects":[]});
        let result = union([&a, &b].into_iter()).unwrap();
        assert_eq!(result["inlineSync"], true);
        assert_eq!(result["sessions"][0]["revision"], 1);
        assert!(union([&b].into_iter()).unwrap().get("inlineSync").is_none());
    }
    #[test]
    fn inline_selection_keeps_visible_peers_and_legacy_windows_without_hidden_payloads() {
        let visible = json!({"sessions":[{"sessionId":"visible","revision":2},{"sessionId":"hidden","revision":2}],
            "projects":[],"inlineSync":true,"inlineSessionIds":["visible"]});
        let hidden = json!({"sessions":[{"sessionId":"hidden","revision":1}],"projects":[]});
        let legacy = json!({"sessions":[{"sessionId":"legacy","revision":3}],"projects":[],"inlineSync":true});
        let result = union([&visible, &hidden, &legacy].into_iter()).unwrap();
        assert_eq!(result["inlineSessionIds"], json!(["legacy", "visible"]));
        assert_eq!(result["sessions"].as_array().unwrap().len(), 3);
        let duplicate_hidden =
            json!({"sessions":[{"sessionId":"visible","revision":1}],"projects":[]});
        let result = union([&visible, &duplicate_hidden].into_iter()).unwrap();
        assert_eq!(result["inlineSessionIds"], json!(["visible"]));
        assert!(union([&hidden].into_iter())
            .unwrap()
            .get("inlineSync")
            .is_none());
    }

    #[test]
    fn inline_selection_is_bounded_to_each_rotating_session_batch() {
        let request = json!({"sessions":(0..130).map(|i| json!({"sessionId":format!("s{i}"),"revision":1})).collect::<Vec<_>>(),
            "projects":[],"inlineSync":true,"inlineSessionIds":(0..130).map(|i| format!("s{i}")).collect::<Vec<_>>()});
        for generation in 0..3 {
            let batch = scheduled_request(request.clone(), generation).unwrap();
            let sessions: HashSet<_> = batch["sessions"]
                .as_array()
                .unwrap()
                .iter()
                .map(|value| value["sessionId"].as_str().unwrap())
                .collect();
            let selected: HashSet<_> = batch["inlineSessionIds"]
                .as_array()
                .unwrap()
                .iter()
                .map(|value| value.as_str().unwrap())
                .collect();
            assert_eq!(sessions.len(), 64);
            assert_eq!(selected, sessions);
        }
    }
    #[test]
    fn stale_release_keeps_the_new_registration_and_tasks_only_is_a_demand() {
        let changes = Changes::default();
        let request = |id| json!({"subscriptionId":id,"sessions":[],"projects":[],"tasksKnown":""});
        changes
            .request("m", "w", request("old"), |value| {
                assert_eq!(value["tasksKnown"], "");
                Ok(json!({}))
            })
            .unwrap();
        changes
            .request("m", "w", request("new"), |_| Ok(json!({})))
            .unwrap();
        changes
            .request(
                "m",
                "w",
                json!({"subscriptionId":"old","sessions":[],"projects":[]}),
                |_| panic!("release must be local"),
            )
            .unwrap();
        let entries = changes.entries.lock().unwrap();
        let state = entries["m"].state.lock().unwrap();
        assert_eq!(state.windows["w"].0["subscriptionId"], "new");
    }
    #[test]
    fn duplicate_content_reads_share_but_completed_reads_are_not_cached() {
        let reads = Arc::new(Reads::default());
        let barrier = Arc::new(std::sync::Barrier::new(2));
        let first = reads.clone();
        let entered = barrier.clone();
        let worker = std::thread::spawn(move || {
            first.request("same".into(), Duration::from_secs(35), || {
                entered.wait();
                std::thread::sleep(Duration::from_millis(100));
                Ok(json!(1))
            })
        });
        barrier.wait();
        let shared = reads.request("same".into(), Duration::from_secs(35), || {
            panic!("duplicate content read")
        });
        assert_eq!(shared.unwrap(), worker.join().unwrap().unwrap());
        assert_eq!(
            reads
                .request("same".into(), Duration::from_secs(35), || Ok(json!(2)))
                .unwrap(),
            json!(2)
        );
        assert!(reads.entries.lock().unwrap().is_empty());
    }
    #[test]
    fn union_uses_oldest_cursor_and_invalidates_differing_epochs() {
        let a = json!({"instanceId":"a","sessions":[{"sessionId":"s","revision":4}],"projects":[{"projectId":"p","known":"old"}]});
        let b = json!({"instanceId":"b","sessions":[{"sessionId":"s","revision":8}],"projects":[{"projectId":"p","known":"new"}]});
        let result = union([&a, &b].into_iter()).unwrap();
        assert!(result["instanceId"].is_null());
        assert_eq!(result["sessions"][0]["revision"], 4);
        assert!(result["projects"][0].get("known").is_none());
    }
    #[test]
    fn union_merges_git_cursors_like_projects() {
        let a = json!({"sessions":[],"projects":[],"git":[{"cwd":"/r","known":"1.0"},{"cwd":"/s","known":"2.2"}]});
        let b = json!({"sessions":[],"projects":[],"git":[{"cwd":"/r","known":"1.1"},{"cwd":"/s","known":"2.2"},{"cwd":"/t"}]});
        let result = union([&a, &b].into_iter()).unwrap();
        let git = result["git"].as_array().unwrap();
        let find = |cwd: &str| git.iter().find(|entry| entry["cwd"] == cwd).unwrap();
        assert_eq!(git.len(), 3);
        assert!(find("/r").get("known").is_none());
        assert_eq!(find("/s")["known"], "2.2");
        assert!(find("/t").get("known").is_none());
        let none = union([&json!({"sessions":[],"projects":[]})].into_iter()).unwrap();
        assert!(none.get("git").is_none());
    }
    #[test]
    fn union_limits_git_entries_to_thirty_two() {
        let entries = |count: usize| json!({"sessions":[],"projects":[],"git":(0..count).map(|index| json!({"cwd":format!("/r{index}")})).collect::<Vec<_>>()});
        assert_eq!(
            union([&entries(32)].into_iter()).unwrap()["git"]
                .as_array()
                .unwrap()
                .len(),
            32
        );
        assert_eq!(
            union([&entries(40)].into_iter()).unwrap()["git"]
                .as_array()
                .unwrap()
                .len(),
            32
        );
    }
    #[test]
    fn git_only_registration_is_a_demand() {
        let changes = Changes::default();
        let sent = std::cell::Cell::new(false);
        changes
            .request(
                "m",
                "w",
                json!({"sessions":[],"projects":[],"git":[{"cwd":"/r"}]}),
                |value| {
                    sent.set(true);
                    assert_eq!(value["git"][0]["cwd"], "/r");
                    Ok(json!({}))
                },
            )
            .unwrap();
        assert!(sent.get());
    }
    #[test]
    fn empty_registration_does_not_send() {
        let changes = Changes::default();
        let result = changes
            .request("m", "w", json!({"sessions":[],"projects":[]}), |_| {
                panic!("must not send")
            })
            .unwrap();
        assert_eq!(result["sessions"], json!([]));
    }
    #[test]
    fn simultaneous_windows_share_one_request() {
        let changes = Arc::new(Changes::default());
        let barrier = Arc::new(std::sync::Barrier::new(2));
        let first = changes.clone();
        let entered = barrier.clone();
        let params = json!({"sessions":[{"sessionId":"s","revision":1}],"projects":[]});
        let other_params = params.clone();
        let worker = std::thread::spawn(move || {
            first.request("m", "a", params, |_| {
                entered.wait();
                std::thread::sleep(Duration::from_millis(100));
                Ok(json!({"instanceId":"boot"}))
            })
        });
        barrier.wait();
        let second = changes.request("m", "b", other_params, |_| panic!("duplicate request"));
        assert_eq!(worker.join().unwrap().unwrap(), second.unwrap());
    }
}
