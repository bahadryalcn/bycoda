//! SSH-only terminals. Opt-in Bash setup is ephemeral and never replays input.
use tauri::{AppHandle, Manager, State};

#[tauri::command(async)]
pub fn ssh_agent_forwarding_review(
    app: AppHandle,
    window: tauri::Window,
    reviews: State<'_, crate::ssh_agent_forwarding::AgentForwardingReviews>,
    connection_id: Option<String>,
    endpoint: Option<crate::ssh_security::SshEndpoint>,
) -> Result<crate::ssh_agent_forwarding::AgentForwardingReview, String> {
    let owner_lease = crate::ssh_window_lifecycle::capture(window.label())?;
    let endpoint = match (&connection_id, endpoint) {
        (Some(id), None) => crate::server_inventory::resolve_ssh_endpoint(&app, id)?,
        (None, Some(endpoint)) => endpoint,
        _ => return Err("Choose exactly one saved or quick SSH target".into()),
    };
    owner_lease.with_live(|| reviews.review(window.label(), connection_id.as_deref(), &endpoint))
}

fn reviewed_interactive_args(
    reviews: &crate::ssh_agent_forwarding::AgentForwardingReviews,
    owner: &str,
    review_id: Option<&str>,
    connection_id: Option<&str>,
    endpoint: &crate::ssh_security::SshEndpoint,
) -> Result<Vec<String>, String> {
    match review_id {
        Some(id) => reviews
            .consume(owner, id, connection_id, endpoint)?
            .interactive_args(endpoint),
        None => crate::ssh_security::interactive_args(endpoint),
    }
}

fn terminal_identity(id: &str, connection_id: &str, args: &[String]) -> Result<String, String> {
    if id.is_empty() || id.len() > 200 || id.chars().any(char::is_control) {
        return Err("Invalid terminal identifier".into());
    }
    if connection_id.is_empty()
        || connection_id.len() > 200
        || connection_id.chars().any(char::is_control)
    {
        return Err("Invalid connection identifier".into());
    }
    // Saved endpoint changes cannot silently reattach an old target under its
    // previous terminal id. This string stays native; it contains no credentials.
    serde_json::to_string(&(connection_id, args)).map_err(|_| "Invalid SSH target".into())
}

pub(crate) fn validate_configuration_review(
    endpoint: &crate::ssh_security::SshEndpoint,
    expected: Option<&str>,
    agent_review: Option<&str>,
) -> Result<(), String> {
    if let Some(configuration) = &endpoint.runtime_configuration {
        // Agent tickets independently bind and consume this effective digest.
        if agent_review.is_none() && expected != Some(configuration.digest.as_str()) {
            return Err("SSH group defaults changed or have not been reviewed. Request a current configuration preview".into());
        }
    }
    Ok(())
}

#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
pub fn ssh_terminal_spawn(
    app: AppHandle,
    window: tauri::Window,
    host: State<'_, crate::pty::PtyHost>,
    reviews: State<'_, crate::ssh_agent_forwarding::AgentForwardingReviews>,
    id: String,
    connection_id: String,
    cols: u16,
    rows: u16,
    shell_integration: Option<String>,
    agent_forwarding_review_id: Option<String>,
    expected_configuration_digest: Option<String>,
    http_proxy_ticket_id: Option<String>,
) -> Result<(), String> {
    let owner_lease = crate::ssh_window_lifecycle::capture(window.label())?;
    let endpoint = crate::server_inventory::resolve_ssh_endpoint(&app, &connection_id)?;
    let proxy_grant = http_proxy_ticket_id
        .as_deref()
        .map(|ticket| {
            app.state::<crate::ssh_http_proxy_credentials::HttpProxyCredentials>()
                .consume(
                    window.label(),
                    ticket,
                    Some(&connection_id),
                    &endpoint,
                    &crate::ssh_http_proxy_credentials::ProxyOperation::Terminal {
                        id: id.clone(),
                        shell_integration: shell_integration.clone(),
                    },
                )
        })
        .transpose()?;
    validate_configuration_review(
        &endpoint,
        expected_configuration_digest.as_deref(),
        agent_forwarding_review_id.as_deref(),
    )?;
    let integration = crate::pty::integration_for_spawn(
        &host,
        &id,
        window.label(),
        crate::ssh_environment::integration_mode(&endpoint, shell_integration.as_deref()),
    )?;
    let mut args = reviewed_interactive_args(
        &reviews,
        window.label(),
        agent_forwarding_review_id.as_deref(),
        Some(&connection_id),
        &endpoint,
    )?;
    let integration_guard = integration
        .as_ref()
        .map(|integration| integration.lock().unwrap_or_else(|e| e.into_inner()));
    if let Some(command) =
        crate::ssh_environment::remote_command(&endpoint, integration_guard.as_deref())?
    {
        args.push(command);
    }
    drop(integration_guard);
    let identity = terminal_identity(
        &id,
        &connection_id,
        &crate::ssh_security::stable_args(&endpoint, &args),
    )?;
    owner_lease.with_live(|| {
        crate::pty::spawn_ssh(
            app.clone(),
            window,
            host,
            id,
            identity,
            args,
            cols,
            rows,
            integration,
            endpoint.prepared_jump_config.clone(),
            crate::ssh_security::start_http_proxy_authorized(&endpoint, proxy_grant.as_ref())?,
        )
    })?;
    let _ = crate::server_inventory::mark_used(&app, &connection_id);
    Ok(())
}

#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
pub fn ssh_terminal_quick_spawn(
    app: AppHandle,
    window: tauri::Window,
    host: State<'_, crate::pty::PtyHost>,
    reviews: State<'_, crate::ssh_agent_forwarding::AgentForwardingReviews>,
    id: String,
    endpoint: crate::ssh_security::SshEndpoint,
    cols: u16,
    rows: u16,
    shell_integration: Option<String>,
    agent_forwarding_review_id: Option<String>,
    http_proxy_ticket_id: Option<String>,
) -> Result<(), String> {
    let owner_lease = crate::ssh_window_lifecycle::capture(window.label())?;
    let endpoint = crate::ssh_security::prepare_endpoint(endpoint)?;
    let proxy_grant = http_proxy_ticket_id
        .as_deref()
        .map(|ticket| {
            app.state::<crate::ssh_http_proxy_credentials::HttpProxyCredentials>()
                .consume(
                    window.label(),
                    ticket,
                    None,
                    &endpoint,
                    &crate::ssh_http_proxy_credentials::ProxyOperation::Terminal {
                        id: id.clone(),
                        shell_integration: shell_integration.clone(),
                    },
                )
        })
        .transpose()?;
    let integration = crate::pty::integration_for_spawn(
        &host,
        &id,
        window.label(),
        crate::ssh_environment::integration_mode(&endpoint, shell_integration.as_deref()),
    )?;
    let mut args = reviewed_interactive_args(
        &reviews,
        window.label(),
        agent_forwarding_review_id.as_deref(),
        None,
        &endpoint,
    )?;
    let integration_guard = integration
        .as_ref()
        .map(|integration| integration.lock().unwrap_or_else(|e| e.into_inner()));
    if let Some(command) =
        crate::ssh_environment::remote_command(&endpoint, integration_guard.as_deref())?
    {
        args.push(command);
    }
    drop(integration_guard);
    let identity = terminal_identity(
        &id,
        &format!("quick:{id}"),
        &crate::ssh_security::stable_args(&endpoint, &args),
    )?;
    owner_lease.with_live(|| {
        crate::pty::spawn_ssh(
            app,
            window,
            host,
            id,
            identity,
            args,
            cols,
            rows,
            integration,
            endpoint.prepared_jump_config.clone(),
            crate::ssh_security::start_http_proxy_authorized(&endpoint, proxy_grant.as_ref())?,
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn effective_group_configuration_requires_current_review_and_unknown_agent_ticket_still_fails()
    {
        let mut endpoint = crate::ssh_security::SshEndpoint {
            host: "fixture.invalid".into(),
            port: 22,
            ..Default::default()
        };
        assert!(validate_configuration_review(&endpoint, None, None).is_ok());
        endpoint.runtime_configuration = Some(std::sync::Arc::new(
            crate::ssh_security::RuntimeConfiguration {
                digest: "current-group-digest".into(),
                environment: vec![],
                shell_kind: None,
                provenance: Default::default(),
            },
        ));
        assert!(validate_configuration_review(&endpoint, None, None).is_err());
        assert!(validate_configuration_review(&endpoint, Some("stale-digest"), None).is_err());
        assert!(
            validate_configuration_review(&endpoint, Some("current-group-digest"), None).is_ok()
        );
        let reviews = crate::ssh_agent_forwarding::AgentForwardingReviews::default();
        assert!(reviewed_interactive_args(
            &reviews,
            "owner",
            Some("unknown-review"),
            Some("server"),
            &endpoint
        )
        .is_err());
        let original = crate::ssh_security::stable_args(&endpoint, &[]);
        std::sync::Arc::make_mut(endpoint.runtime_configuration.as_mut().unwrap()).digest =
            "updated-group-digest".into();
        assert_ne!(original, crate::ssh_security::stable_args(&endpoint, &[]));
    }

    #[test]
    fn ordinary_terminal_remains_agent_off_and_unknown_review_cannot_enable_it() {
        let reviews = crate::ssh_agent_forwarding::AgentForwardingReviews::default();
        let endpoint = crate::ssh_security::SshEndpoint {
            host: "fixture.invalid".into(),
            port: 22,
            ..Default::default()
        };
        let args =
            reviewed_interactive_args(&reviews, "main", None, Some("server"), &endpoint).unwrap();
        assert_eq!(
            args,
            crate::ssh_security::interactive_args(&endpoint).unwrap()
        );
        assert!(args.contains(&"ForwardAgent=no".into()));
        assert!(reviewed_interactive_args(
            &reviews,
            "main",
            Some("unknown"),
            Some("server"),
            &endpoint
        )
        .is_err());
        assert!(crate::ssh_security::connection_args(&endpoint)
            .unwrap()
            .contains(&"ForwardAgent=no".into()));
    }

    #[test]
    fn endpoint_changes_cannot_reuse_a_different_live_target() {
        let first = terminal_identity("tab", "server", &["one.example".into()]).unwrap();
        let changed = terminal_identity("tab", "server", &["two.example".into()]).unwrap();
        let other_record = terminal_identity("tab", "other", &["one.example".into()]).unwrap();
        assert_ne!(first, changed);
        assert_ne!(first, other_record);
        assert_eq!(
            first,
            terminal_identity("other-tab", "server", &["one.example".into()]).unwrap()
        );
    }

    #[test]
    fn malformed_terminal_or_connection_ids_are_rejected() {
        for invalid in ["", "line\nbreak", "nul\0byte"] {
            assert!(terminal_identity(invalid, "server", &[]).is_err());
            assert!(terminal_identity("tab", invalid, &[]).is_err());
        }
    }

    #[cfg(windows)]
    #[test]
    fn real_openssh_in_conpty_exits_when_peer_closes_without_running_a_command() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::time::{Duration, Instant};
        // A disposable protocol peer, not the owner's running sshd or keys.
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        let peer = std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(10);
            while Instant::now() < deadline {
                if let Ok((mut stream, _)) = listener.accept() {
                    stream
                        .write_all(b"SSH-2.0-bycoda-disposable-test\r\n")
                        .unwrap();
                    return true;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            false
        });
        let endpoint = crate::ssh_security::SshEndpoint {
            host: "127.0.0.1".into(),
            port,
            ..Default::default()
        };
        let pair = portable_pty::native_pty_system()
            .openpty(portable_pty::PtySize::default())
            .unwrap();
        let mut command = portable_pty::CommandBuilder::new("ssh.exe");
        command.args(crate::ssh_security::interactive_args(&endpoint).unwrap());
        command.env("SSH_ASKPASS_REQUIRE", "never");
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut writer = pair.master.take_writer().unwrap();
        let drain = std::thread::spawn(move || {
            let mut buf = [0_u8; 4096];
            let mut matched = 0;
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 {
                    break;
                }
                for byte in &buf[..n] {
                    let query = b"\x1b[6n";
                    matched = if *byte == query[matched] {
                        matched + 1
                    } else {
                        usize::from(*byte == query[0])
                    };
                    if matched == query.len() {
                        let _ = writer.write_all(b"\x1b[1;1R");
                        matched = 0;
                    }
                }
            }
        });
        crate::windows::initialize().unwrap();
        let mut child = crate::windows::spawn_pty(pair.slave.as_ref(), command).unwrap();
        drop(pair.slave);
        let deadline = Instant::now() + Duration::from_secs(10);
        let status = loop {
            if let Some(status) = child.try_wait().unwrap() {
                break status;
            }
            if Instant::now() >= deadline {
                child.kill().unwrap();
                let _ = child.wait();
                panic!("SSH process did not exit after peer closed");
            }
            std::thread::sleep(Duration::from_millis(20));
        };
        assert_ne!(status.exit_code(), 0);
        assert!(
            peer.join().unwrap(),
            "SSH must actually reach the disposable peer"
        );
        drop(pair.master);
        drain.join().unwrap();
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "Requires the disposable sshd fixture specified by BYCODA_SSH_FIXTURE_DIR"]
    fn disposable_remote_shell_history_completion_unicode_and_interrupt() {
        use std::io::{Read, Write};
        use std::sync::mpsc;
        use std::time::{Duration, Instant};
        let root = std::path::PathBuf::from(std::env::var("BYCODA_SSH_FIXTURE_DIR").unwrap());
        let port = std::fs::read_to_string(root.join("port.txt"))
            .unwrap()
            .parse()
            .unwrap();
        let endpoint = crate::ssh_security::SshEndpoint {
            host: "127.0.0.1".into(),
            user: Some(std::env::var("USERNAME").expect("Windows fixture user")),
            port,
            identity_file: Some(root.join("client_key").to_string_lossy().into_owned()),
            jump_host: None,
            jump_hosts: Vec::new(),
            certificate_file: None,
            ..Default::default()
        };
        let pair = portable_pty::native_pty_system()
            .openpty(portable_pty::PtySize::default())
            .unwrap();
        let mut command = portable_pty::CommandBuilder::new("ssh.exe");
        command.args([
            "-o".into(),
            format!("UserKnownHostsFile={}", root.join("known_hosts").display()),
        ]);
        command.args(crate::ssh_security::interactive_args(&endpoint).unwrap());
        command.env("SSH_ASKPASS_REQUIRE", "never");
        let mut reader = pair.master.try_clone_reader().unwrap();
        let writer = std::sync::Arc::new(std::sync::Mutex::new(pair.master.take_writer().unwrap()));
        let response_writer = writer.clone();
        let (tx, rx) = mpsc::channel();
        let drain = std::thread::spawn(move || {
            let mut buf = [0_u8; 8192];
            let mut matched = 0;
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 {
                    break;
                }
                for byte in &buf[..n] {
                    let query = b"\x1b[6n";
                    matched = if *byte == query[matched] {
                        matched + 1
                    } else {
                        usize::from(*byte == query[0])
                    };
                    if matched == query.len() {
                        let _ = response_writer.lock().unwrap().write_all(b"\x1b[1;1R");
                        matched = 0;
                    }
                }
                if tx.send(buf[..n].to_vec()).is_err() {
                    break;
                }
            }
        });
        crate::windows::initialize().unwrap();
        let mut child = crate::windows::spawn_pty(pair.slave.as_ref(), command).unwrap();
        drop(pair.slave);
        let mut transcript = Vec::new();
        let mut search_from = 0;
        let mut wait_for = |marker: &str| {
            let deadline = Instant::now() + Duration::from_secs(15);
            while Instant::now() < deadline {
                if let Ok(chunk) = rx.recv_timeout(Duration::from_millis(100)) {
                    transcript.extend(chunk);
                }
                let text = String::from_utf8_lossy(&transcript);
                if let Some(index) = text[search_from..].find(marker) {
                    search_from += index + marker.len();
                    return true;
                }
            }
            false
        };
        let send = |data: &str| writer.lock().unwrap().write_all(data.as_bytes()).unwrap();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            assert!(wait_for("FIXTURE_READY"), "remote prompt unavailable");
            send("\x1b[A\r");
            assert!(
                wait_for("BYCODA_SEEDED_HISTORY"),
                "remote pre-existing history unavailable"
            );
            send("\x12SEEDED_HISTORY\r");
            assert!(
                wait_for("BYCODA_SEEDED_HISTORY"),
                "Ctrl+R remote history search failed"
            );
            send("\x1b[A\x1b[BWrite-Output ('DOWN_' + 'OK')\r");
            assert!(
                wait_for("DOWN_OK"),
                "Down did not restore the remote editing line"
            );
            send("Get-Content ./bycoda-comple\t\r");
            assert!(
                wait_for("BYCODA_COMPLETION_OK"),
                "remote Tab completion failed"
            );
            send("Write-Output ('UNICODE_' + '日本語')\r");
            assert!(wait_for("UNICODE_日本語"), "Unicode input failed");
            send("Write-Output ('CURSOR_' + 'O')\x1b[D\x1b[DK\r");
            assert!(wait_for("CURSOR_OK"), "cursor-middle insertion failed");
            send("\x1b[200~Write-Output ('MULTI_' + 'ONE')\r\nWrite-Output ('MULTI_' + 'TWO')\x1b[201~\r");
            assert!(wait_for("MULTI_ONE"), "multiline paste first line failed");
            assert!(wait_for("MULTI_TWO"), "multiline paste second line failed");
            send("$fixtureSecure = Read-Host -AsSecureString 'BYCODA_PASSWORD_PROMPT'; Write-Output ('PASSWORD_' + 'DONE')\r");
            assert!(
                wait_for("BYCODA_PASSWORD_PROMPT"),
                "secure prompt unavailable"
            );
            send("FIXTURE_PASSWORD_SENTINEL\r");
            assert!(wait_for("PASSWORD_DONE"), "secure prompt did not complete");
            send("Write-Output ('NEVER_' + 'EXECUTED')\x03");
            send("Write-Output ('INTERRUPT_' + 'OK')\r");
            assert!(wait_for("INTERRUPT_OK"), "Ctrl+C recovery failed");
            pair.master
                .resize(portable_pty::PtySize {
                    rows: 30,
                    cols: 100,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .unwrap();
            send("Write-Output ('RESIZE_' + 'OK')\r");
            assert!(wait_for("RESIZE_OK"), "remote shell did not survive resize");
        }));
        let _ = child.kill();
        let _ = child.wait();
        drop(pair.master);
        drop(writer);
        let _ = drain.join();
        assert!(
            !String::from_utf8_lossy(&transcript).contains("FIXTURE_PASSWORD_SENTINEL"),
            "echo-off input leaked into terminal output"
        );
        std::fs::write(root.join("shell-output.log"), &transcript).unwrap();
        if let Err(error) = result {
            std::panic::resume_unwind(error);
        }
    }
}
