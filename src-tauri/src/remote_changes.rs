//! One authenticated control request per machine, shared by renderer windows.
//! Content and commands never wait on this lane. Registrations expire after a
//! crashed window; an empty subscription explicitly releases a healthy window.
use serde_json::{json, Value};
use std::collections::HashMap;
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
                .wait_timeout_while(state, Duration::from_secs(35), |result| result.is_none())
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
        let request = union(state.windows.values().map(|(value, _)| value))?;
        state.running = true;
        drop(state);
        let result = send(request);
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
    for request in requests {
        inline_sync |= request.get("inlineSync").and_then(Value::as_bool) == Some(true);
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
    if sessions.len() > 64 || projects.len() > 32 {
        return Err("Too many remote subscriptions".into());
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
    if inline_sync {
        result["inlineSync"] = Value::Bool(true);
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

#[cfg(test)]
mod tests {
    use super::*;
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
            first.request("same".into(), || {
                entered.wait();
                std::thread::sleep(Duration::from_millis(100));
                Ok(json!(1))
            })
        });
        barrier.wait();
        let shared = reads.request("same".into(), || panic!("duplicate content read"));
        assert_eq!(shared.unwrap(), worker.join().unwrap().unwrap());
        assert_eq!(
            reads.request("same".into(), || Ok(json!(2))).unwrap(),
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
