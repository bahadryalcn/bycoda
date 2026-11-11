//! Optional Host tool grants for a provider child. Isolation from stale grant
//! state always runs; issuance needs a stored conversation to grant against.
use serde_json::Value;
use std::process::Command;
use std::time::Instant;
use tauri::AppHandle;

type Issued = Result<Vec<(&'static str, String)>, String>;

/// A child without a stored conversation of its own: a management or utility
/// process, or a helper whose route is derived from another session's turn.
/// The Host can only answer "session not found" for it.
pub(super) fn sessionless(management: bool, authority_target: &str, source_target: &str) -> bool {
    management || authority_target != source_target
}

/// The social, runtime-log and conversation tool grants are optional: a
/// provider still starts without them. Issue them in parallel, each bounded by
/// a short Host budget, and skip them while the Host is in its unhealthy
/// back-off. Every worker finishes by its deadline, so no grant is pinned or
/// cached after the spawn proceeds. A sessionless child gets the same
/// isolation and no issuance.
pub(super) fn configure_optional_tool_grants(
    app: &AppHandle,
    session_id: &str,
    cmd: &mut Command,
    stamp: (u64, u64),
    sessionless: bool,
) {
    configure(session_id, cmd, stamp, sessionless, |fallback, deadline| {
        std::thread::scope(|scope| {
            let social = scope.spawn(|| {
                crate::social_bridge::issue_child_grant(app, session_id, stamp, deadline)
            });
            let logs = scope.spawn(|| {
                crate::runtime_logs_bridge::issue_child_grant(app, session_id, stamp, deadline)
            });
            let conversation = crate::conversation_tools_bridge::issue_child_grant(
                app, session_id, stamp, fallback, deadline,
            );
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
}

fn configure(
    session_id: &str,
    cmd: &mut Command,
    stamp: (u64, u64),
    sessionless: bool,
    issue: impl FnOnce(&Value, Instant) -> [(&'static str, Issued); 3],
) {
    // Before any early return: no child inherits another session's grants.
    crate::social_bridge::strip_child_env(cmd);
    crate::runtime_logs_bridge::strip_child_env(cmd);
    let fallback = crate::conversation_tools_bridge::prepare_child(session_id, cmd, stamp);
    if sessionless {
        return;
    }
    let Some(deadline) = crate::session_tools_bridge::optional_host_deadline() else {
        log::warn!("Host is unhealthy; starting the provider without Host tools");
        return;
    };
    let mut healthy = true;
    for (group, issued) in issue(&fallback, deadline) {
        match issued {
            Ok(env) => {
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;

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
