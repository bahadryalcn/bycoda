//! Optional Host tool grants for a provider child. Isolation from stale grant
//! state always runs; issuance needs a stored conversation to grant against.
use serde_json::Value;
use std::collections::HashMap;
use std::process::Command;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;
use tauri::{AppHandle, Manager};

type Issued = Result<Vec<(&'static str, String)>, String>;

struct PreparedConversation {
    stamp: (u64, u64),
    expires: Instant,
    issued: Issued,
    grant: Value,
}

type Preparation = Arc<Mutex<Option<PreparedConversation>>>;
fn preparations() -> &'static Mutex<HashMap<String, Preparation>> {
    static PREPARED: OnceLock<Mutex<HashMap<String, Preparation>>> = OnceLock::new();
    PREPARED.get_or_init(Mutex::default)
}

/// Reserve only the next spawn's grant. Existing processes retain their original authority.
pub(crate) fn prepare_conversation_spawn(app: &AppHandle, session: &str) {
    let host = app.state::<super::HarnessHost>();
    if host.upcoming_tool_spawn(session).is_none() {
        return;
    }
    let slot = {
        let mut entries = preparations()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        entries.retain(|id, slot| {
            let Ok(entry) = slot.try_lock() else {
                return true;
            };
            let keep = Arc::strong_count(slot) > 1
                || entry
                    .as_ref()
                    .is_some_and(|entry| entry.expires > Instant::now());
            if !keep {
                if let Some(entry) = entry.as_ref() {
                    crate::session_tools_bridge::revoke_spawn(id, entry.stamp);
                }
            }
            keep
        });
        if entries.len() >= 512 && !entries.contains_key(session) {
            return;
        }
        entries.entry(session.into()).or_default().clone()
    };
    // Only this session waits for its network request; unrelated first turns stay parallel.
    let mut prepared = slot
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let Some(stamp) = host.upcoming_tool_spawn(session) else {
        return;
    };
    if prepared
        .as_ref()
        .is_some_and(|entry| entry.stamp == stamp && entry.expires > Instant::now())
    {
        return;
    }
    if let Some(previous) = prepared.take() {
        crate::session_tools_bridge::revoke_spawn(session, previous.stamp);
    }
    crate::session_tools_bridge::begin_session(session, stamp);
    let issued = match crate::session_tools_bridge::optional_host_deadline() {
        Some(deadline) => crate::conversation_tools_bridge::issue_child_grant(
            app,
            session,
            stamp,
            &serde_json::json!({}),
            deadline,
        ),
        None => Err("Host backoff".into()),
    };
    if host.upcoming_tool_spawn(session) != Some(stamp) {
        crate::session_tools_bridge::revoke_spawn(session, stamp);
        return;
    }
    *prepared = Some(PreparedConversation {
        stamp,
        expires: Instant::now() + std::time::Duration::from_secs(60),
        issued,
        grant: crate::conversation_tools_bridge::cached_spawn_grant(session),
    });
}

fn take_prepared(session: &str, stamp: (u64, u64)) -> Option<PreparedConversation> {
    let slot = preparations()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .get(session)
        .cloned()?;
    let mut entry = slot
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    entry.take().filter(|entry| entry.stamp == stamp)
}

/// A child without a stored conversation of its own: a management or utility
/// process, or a helper whose route is derived from another session's turn.
/// The Host can only answer "session not found" for it.
pub(super) fn sessionless(management: bool, authority_target: &str, source_target: &str) -> bool {
    management || authority_target != source_target
}

/// The social, runtime-log and conversation tool grants are optional: a
/// provider still starts without them. Issue them in parallel, each bounded by
/// a short Host budget, and skip them while the Host is in its unhealthy
/// back-off. Reuse a preflight reservation exactly once, including a refusal;
/// all other workers finish by their deadline. A sessionless child gets the
/// same isolation and no issuance.
pub(super) fn configure_optional_tool_grants(
    app: &AppHandle,
    session_id: &str,
    cmd: &mut Command,
    stamp: (u64, u64),
    sessionless: bool,
    provider: &str,
) -> bool {
    let prepared = take_prepared(session_id, stamp);
    let reason = configure(session_id, cmd, stamp, sessionless, |fallback, deadline| {
        std::thread::scope(|scope| {
            let social = scope.spawn(|| {
                crate::social_bridge::issue_child_grant(app, session_id, stamp, deadline)
            });
            let logs = scope.spawn(|| {
                crate::runtime_logs_bridge::issue_child_grant(app, session_id, stamp, deadline)
            });
            let conversation = match prepared {
                Some(prepared) => {
                    if prepared.issued.is_ok() {
                        crate::conversation_tools_bridge::restore_spawn_grant(
                            session_id,
                            stamp,
                            prepared.grant,
                            fallback,
                        );
                    }
                    prepared.issued
                }
                None => crate::conversation_tools_bridge::issue_child_grant(
                    app, session_id, stamp, fallback, deadline,
                ),
            };
            let joined = |handle: std::thread::ScopedJoinHandle<'_, Issued>| {
                handle
                    .join()
                    .unwrap_or_else(|_| Err("tool grant worker panicked".into()))
            };
            [
                ("social", joined(social)),
                ("runtime logs", joined(logs)),
                ("conversation", conversation),
            ]
        })
    });
    let ok = reason == "issued";
    log::warn!("[session tools] provider={provider} session={session_id} conversation grant={} reason={reason}", if ok { "ok" } else { "failed" });
    ok
}

/// Remove only app-owned conversation MCP settings when this spawn has no grant.
pub(super) fn without_conversation_bridge(args: Vec<String>) -> Vec<String> {
    let mut result = Vec::new();
    let mut iter = args.into_iter();
    while let Some(arg) = iter.next() {
        if matches!(arg.as_str(), "-c" | "--mcp-config") {
            if let Some(value) = iter.next() {
                if arg == "-c" && value.starts_with("mcp_servers.bycoda-conversation.") {
                    continue;
                }
                let value = if arg == "--mcp-config" {
                    serde_json::from_str::<Value>(&value)
                        .ok()
                        .and_then(|mut config| {
                            config
                                .get_mut("mcpServers")?
                                .as_object_mut()?
                                .remove("bycoda-conversation");
                            Some(config.to_string())
                        })
                        .unwrap_or(value)
                } else {
                    value
                };
                result.extend([arg, value]);
            } else {
                result.push(arg);
            }
        } else {
            result.push(arg);
        }
    }
    result
}

fn configure(
    session_id: &str,
    cmd: &mut Command,
    stamp: (u64, u64),
    sessionless: bool,
    issue: impl FnOnce(&Value, Instant) -> [(&'static str, Issued); 3],
) -> &'static str {
    // Before any early return: no child inherits another session's grants.
    crate::social_bridge::strip_child_env(cmd);
    crate::runtime_logs_bridge::strip_child_env(cmd);
    let fallback = crate::conversation_tools_bridge::prepare_child(session_id, cmd, stamp);
    if sessionless {
        return "sessionless child";
    }
    let Some(deadline) = crate::session_tools_bridge::optional_host_deadline().or_else(|| {
        crate::session_tools_bridge::conversation_grant(session_id)
            .map(|_| Instant::now() + crate::session_tools_bridge::OPTIONAL_HOST_BUDGET)
    }) else {
        log::warn!("Host is unhealthy; starting the provider without Host tools");
        return "Host backoff";
    };
    let mut conversation_ok = false;
    let mut healthy = true;
    for (group, issued) in issue(&fallback, deadline) {
        match issued {
            Ok(env) => {
                if group == "conversation" {
                    conversation_ok = env.iter().any(|(key, value)| {
                        *key == "BYCODA_CONVERSATION_TOKEN" && !value.is_empty()
                    });
                }
                for (key, value) in env {
                    cmd.env(key, value);
                }
            }
            Err(error) => {
                healthy = false;
                // An unpaired local Host is the ordinary no-tools setup.
                if !error.starts_with("Connect the local bycoda Host") {
                    log::warn!("continuing without {group} tools: {error}");
                }
            }
        }
    }
    crate::session_tools_bridge::note_optional_host_outcome(deadline, healthy);
    if conversation_ok {
        "issued"
    } else {
        "grant issuance failed"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;

    #[test]
    fn first_turn_preparation_refuses_an_in_progress_spawn() {
        let host = super::super::HarnessHost::new();
        let stamp = host.upcoming_tool_spawn("first-turn-pending").unwrap();
        let pending = host.reserve_process("first-turn-pending").unwrap();
        assert!(host.upcoming_tool_spawn("first-turn-pending").is_none());
        drop(pending);
        assert_eq!(host.upcoming_tool_spawn("first-turn-pending"), Some(stamp));
        let (epoch, generation, _) = host.begin_spawn("first-turn-pending");
        assert_eq!((epoch, generation), stamp);
    }

    #[test]
    fn first_turn_spawn_consumes_one_exact_success_or_failed_preparation() {
        for (session, issued) in [
            (
                "prepared-success",
                Ok(vec![(
                    "BYCODA_CONVERSATION_TOKEN",
                    "same-capability".into(),
                )]),
            ),
            ("prepared-failure", Err("grant refused".into())),
        ] {
            preparations().lock().unwrap().insert(
                session.into(),
                Arc::new(Mutex::new(Some(PreparedConversation {
                    stamp: (7, 2),
                    expires: Instant::now() + std::time::Duration::from_secs(60),
                    issued: issued.clone(),
                    grant: Value::Null,
                }))),
            );
            assert_eq!(take_prepared(session, (7, 2)).unwrap().issued, issued);
            assert!(take_prepared(session, (7, 2)).is_none());
        }
        preparations().lock().unwrap().insert(
            "cancelled-preparation".into(),
            Arc::new(Mutex::new(Some(PreparedConversation {
                stamp: (7, 2),
                expires: Instant::now(),
                issued: Err("refused".into()),
                grant: Value::Null,
            }))),
        );
        assert!(take_prepared("cancelled-preparation", (8, 2)).is_none());
    }

    const STALE: [&str; 2] = ["BYCODA_RUNTIME_LOGS_TOKEN", "BYCODA_CONVERSATION_TOKEN"];

    fn stale_command() -> Command {
        let mut command = Command::new("provider");
        for key in STALE {
            command.env(key, "another-session");
        }
        command
    }

    fn value<'a>(command: &'a Command, key: &str) -> Option<Option<&'a OsStr>> {
        command
            .get_envs()
            .find(|(name, _)| *name == OsStr::new(key))
            .map(|(_, value)| value)
    }

    #[test]
    fn failed_grant_preserves_claude_custom_servers_and_user_files() {
        let args = vec!["--print".into(), "--mcp-config".into(),
            serde_json::json!({"mcpServers":{"bycoda-conversation":{"command":"node"},"custom":{"command":"keep"}}}).to_string(),
            "--mcp-config".into(), "user.json".into()];
        let clean = without_conversation_bridge(args);
        let config: Value = serde_json::from_str(&clean[2]).unwrap();
        assert_eq!(
            config,
            serde_json::json!({"mcpServers":{"custom":{"command":"keep"}}})
        );
        assert_eq!(&clean[3..], &["--mcp-config", "user.json"]);
    }

    #[test]
    fn failed_grant_removes_only_conversation_launch_config() {
        let args = vec![
            "-c",
            "mcp_servers.bycoda-conversation.url=\"http://localhost\"",
            "-c",
            "mcp_servers.other.url=\"keep\"",
            "app-server",
        ]
        .into_iter()
        .map(str::to_owned)
        .collect::<Vec<_>>();
        assert_eq!(
            without_conversation_bridge(args),
            vec!["-c", "mcp_servers.other.url=\"keep\"", "app-server"]
        );
    }

    #[test]
    fn sessionless_children_are_isolated_without_any_host_issuance() {
        let mut command = stale_command();
        let mut issued = false;
        configure("bycoda-codex-text", &mut command, (1, 0), true, |_, _| {
            issued = true;
            [
                ("social", Ok(vec![("BYCODA_SOCIAL_TOKEN", "fresh".into())])),
                ("runtime logs", Err("Session not found".into())),
                ("conversation", Err("Session not found".into())),
            ]
        });
        assert!(!issued, "a sessionless child must not reach the Host");
        for key in STALE {
            assert_eq!(value(&command, key), Some(None), "{key} must be removed");
        }
        assert_eq!(value(&command, "BYCODA_SOCIAL_TOKEN").flatten(), None);
    }

    #[test]
    fn conversation_children_keep_isolation_and_receive_issued_grants() {
        let mut command = stale_command();
        let mut issued = false;
        configure("conversation", &mut command, (1, 0), false, |_, _| {
            issued = true;
            [
                ("social", Ok(vec![("BYCODA_SOCIAL_TOKEN", "fresh".into())])),
                ("runtime logs", Ok(Vec::new())),
                ("conversation", Ok(Vec::new())),
            ]
        });
        assert!(issued);
        for key in STALE {
            assert_eq!(value(&command, key), Some(None), "{key} must be removed");
        }
        assert_eq!(
            value(&command, "BYCODA_SOCIAL_TOKEN"),
            Some(Some(OsStr::new("fresh")))
        );
    }

    #[test]
    fn only_a_conversation_route_with_its_own_authority_has_a_session() {
        assert!(!sessionless(false, "conversation", "conversation"));
        // Management and utility children run on a granted route.
        assert!(sessionless(true, "route", "route"));
        // A text helper started under another session's control turn.
        assert!(sessionless(false, "conversation", "bycoda-codex-text"));
    }
}
