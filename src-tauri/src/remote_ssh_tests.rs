#[test]
fn job_remains_readable_and_writable_after_mutex_poison() {
    let job = Job::new();
    let poisoned = job.clone();
    assert!(std::thread::spawn(move || {
        let _guard = poisoned.inner.lock().unwrap();
        panic!("simulate worker panic");
    })
    .join()
    .is_err());
    job.message("Recovered");
    assert_eq!(job.view().message, "Recovered");
}

#[test]
fn setup_falls_back_after_ssh_failure_and_keeps_the_selected_host_key() {
    let primary = SshTarget {
        target: "me@home".into(),
        port: None,
        remote_port: 3774,
        alternate: None,
        host_key_alias: None,
        identity_file: None,
    };
    let alternate = SshTarget {
        target: "me@tailnet".into(),
        host_key_alias: Some("home".into()),
        ..primary.clone()
    };
    let mut attempted = Vec::new();
    let (platform, selected) =
        detect_platform_from_dials(vec![primary, alternate], &Job::new(), |dial| {
            attempted.push(dial.target.clone());
            if dial.target == "me@home" {
                Err("SSH connection refused".into())
            } else {
                Ok(HostPlatform::Unix)
            }
        })
        .unwrap();
    assert_eq!(attempted, ["me@home", "me@tailnet"]);
    assert_eq!(platform, HostPlatform::Unix);
    let script_dial = dial_order(&selected).remove(0);
    assert_eq!(script_dial.target, "me@tailnet");
    assert_eq!(script_dial.host_key_alias.as_deref(), Some("home"));
}

#[test]
fn cancelled_setup_does_not_try_another_address() {
    let job = Job::new();
    job.cancel();
    let target = SshTarget {
        target: "me@home".into(),
        port: None,
        remote_port: 3774,
        alternate: None,
        host_key_alias: None,
        identity_file: None,
    };
    let result = detect_platform_from_dials(vec![target], &job, |_| {
        panic!("cancelled setup must not connect")
    });
    assert_eq!(result.unwrap_err(), "Connection cancelled");
}
use super::*;

#[test]
fn stale_requests_cannot_invalidate_a_newer_tunnel() {
    let tunnels = Tunnels::default();
    let slot = |generation| {
        Arc::new(Mutex::new(Slot {
            tunnel: None,
            failure: Some((Instant::now(), "keep".into())),
            generation,
            ..Slot::default()
        }))
    };
    let old = slot(1);
    tunnels.slots().insert("host".into(), old.clone());
    let old_lease = TunnelLease {
        endpoint: String::new(),
        slot: old,
        generation: 1,
    };
    let newer = slot(2);
    tunnels.slots().insert("host".into(), newer.clone());
    tunnels.invalidate("host", &old_lease);
    assert!(newer.lock().unwrap().failure.is_some());
    let stale_lease = TunnelLease {
        endpoint: String::new(),
        slot: newer.clone(),
        generation: 1,
    };
    tunnels.invalidate("host", &stale_lease);
    assert!(newer.lock().unwrap().failure.is_some());
    tunnels.invalidate(
        "host",
        &TunnelLease {
            generation: 2,
            ..stale_lease
        },
    );
    assert!(newer.lock().unwrap().failure.is_none());
}
#[test]
fn a_requested_reconnect_forgets_the_cached_failure() {
    let tunnels = Tunnels::default();
    let slot = Arc::new(Mutex::new(Slot {
        tunnel: None,
        failure: Some((Instant::now(), "SSH connection failed".into())),
        generation: 1,
        ..Slot::default()
    }));
    tunnels.slots().insert("host".into(), slot.clone());
    tunnels.forget_failure("other");
    assert!(slot.lock().unwrap().failure.is_some());
    tunnels.forget_failure("host");
    assert!(slot.lock().unwrap().failure.is_none());
}
// scripts/checks/test-remote-ssh.py creates an isolated sshd, host and keypair.
// This test uses the production tunnel lifecycle and shell transport.
#[test]
#[ignore = "requires the isolated loopback SSH fixture"]
fn loopback_transport_preserves_host_and_reconnects() {
    let required = |key| std::env::var(key).expect("Run scripts/checks/test-remote-ssh.py");
    let target = SshTarget {
        target: required("BYCODA_TEST_SSH_TARGET"),
        port: Some(required("BYCODA_TEST_SSH_PORT").parse().unwrap()),
        remote_port: required("BYCODA_TEST_HOST_PORT").parse().unwrap(),
        alternate: None,
        host_key_alias: None,
        identity_file: None,
    };
    let make_command = || {
        let mut command = command(&target, false);
        command.args([
            "-F",
            "/dev/null",
            "-i",
            &required("BYCODA_TEST_SSH_KEY"),
            "-o",
            "IdentitiesOnly=yes",
            "-o",
            &format!("UserKnownHostsFile={}", required("BYCODA_TEST_KNOWN_HOSTS")),
        ]);
        command
    };
    let job = Job::new();
    let askpass = job.askpass().unwrap();
    let detected = run_remote_command(
        &target,
        String::new(),
        &job,
        &askpass,
        make_command(),
        PLATFORM_PROBE,
    )
    .unwrap();
    assert_eq!(parse_platform(&detected).unwrap(), HostPlatform::Unix);
    let output = run_script_with_command(
        &target,
        "printf 'remote-script-ok\\n'\n".into(),
        &job,
        &askpass,
        make_command(),
    )
    .unwrap();
    assert_eq!(output.trim(), "remote-script-ok");
    let environment = required("BYCODA_TEST_ENVIRONMENT");
    for _ in 0..2 {
        let tunnel = Tunnel::start_with_command(&target, None, None, make_command()).unwrap();
        let response = ureq::post(&format!("http://127.0.0.1:{}/rpc", tunnel.port))
            .set(
                "Authorization",
                &format!("Bearer {}", required("BYCODA_TEST_TOKEN")),
            )
            .send_string(r#"{"version":1,"method":"environment.describe"}"#)
            .unwrap();
        let value: serde_json::Value = serde_json::from_reader(response.into_reader()).unwrap();
        assert_eq!(value["result"]["environmentId"], environment);
        drop(tunnel);
        // A client disappearing must not kill the independently owned host.
        assert!(TcpStream::connect(("127.0.0.1", target.remote_port)).is_ok());
    }
}
/// A harmless stand-in for ssh: prints `boom` to stderr and exits with 3.
fn short_lived_child() -> Child {
    #[cfg(windows)]
    let mut command = {
        let mut command = Command::new("cmd");
        command.args(["/C", "echo boom 1>&2 & exit 3"]);
        command
    };
    #[cfg(not(windows))]
    let mut command = {
        let mut command = Command::new("sh");
        command.args(["-c", "echo boom >&2; exit 3"]);
        command
    };
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap()
}
/// A stand-in that keeps running until it is killed.
fn long_lived_child() -> Child {
    #[cfg(windows)]
    let mut command = {
        let mut command = Command::new("ping");
        command.args(["-n", "30", "127.0.0.1"]);
        command
    };
    #[cfg(not(windows))]
    let mut command = {
        let mut command = Command::new("sleep");
        command.arg("30");
        command
    };
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap()
}
fn exit_events() -> (Tunnels, std::sync::mpsc::Receiver<TunnelExit>) {
    let tunnels = Tunnels::default();
    let (sender, receiver) = std::sync::mpsc::channel();
    let sender = Mutex::new(sender);
    tunnels.set_exit_sink(Arc::new(move |exit| {
        let _ = sender.lock().unwrap().send(exit);
    }));
    (tunnels, receiver)
}
#[test]
fn an_unexpected_ssh_exit_is_reported_once_with_its_status_and_last_words() {
    let (tunnels, events) = exit_events();
    tunnels.insert("m".into(), "env", Tunnel::adopt(short_lived_child(), 1));
    let exit = events.recv_timeout(Duration::from_secs(10)).unwrap();
    assert_eq!(exit.environment_id, "env");
    assert_eq!(exit.exit_code, Some(3));
    assert_eq!(exit.stderr, "boom");
    // Dropping the dead tunnel afterwards says nothing more.
    tunnels.remove("m");
    assert!(events.recv_timeout(Duration::from_millis(700)).is_err());
}
#[test]
fn closing_replacing_or_clearing_a_tunnel_on_purpose_reports_nothing() {
    let (tunnels, events) = exit_events();
    tunnels.insert("m".into(), "env", Tunnel::adopt(long_lived_child(), 1));
    // Replacement by a fresh tunnel, then a disconnect, then app quit.
    tunnels.insert("m".into(), "env", Tunnel::adopt(long_lived_child(), 2));
    tunnels.remove("m");
    tunnels.insert("n".into(), "env", Tunnel::adopt(long_lived_child(), 3));
    tunnels.clear();
    assert!(events.recv_timeout(Duration::from_millis(900)).is_err());
}
#[test]
fn removing_a_machines_tunnel_clears_its_failure_and_reports_nothing() {
    let (tunnels, events) = exit_events();
    tunnels.insert("m".into(), "env", Tunnel::adopt(long_lived_child(), 1));
    tunnels.slots().get("m").unwrap().lock().unwrap().failure =
        Some((Instant::now(), "old address failed".into()));
    tunnels.remove("m");
    assert!(tunnels.slots().get("m").is_none());
    assert!(events.recv_timeout(Duration::from_millis(700)).is_err());
}
#[test]
fn a_tunnel_started_for_another_address_is_not_reused() {
    let tunnels = Tunnels::default();
    let target = |host: &str| SshTarget {
        target: host.into(),
        port: None,
        remote_port: 3774,
        alternate: None,
        host_key_alias: None,
        identity_file: None,
    };
    let mut tunnel = Tunnel::adopt(long_lived_child(), 4321);
    tunnel.target = Some(target("me@old"));
    tunnels.insert("m".into(), "env", tunnel);
    let Ok(lease) = tunnels.endpoint("m", "env", &target("me@old"), false) else {
        panic!("same address reuses the tunnel")
    };
    assert_eq!(lease.endpoint, "http://127.0.0.1:4321");
    let error = tunnels
        .endpoint("m", "env", &target("me@new"), false)
        .err()
        .expect("the old tunnel is dropped, not reused");
    assert!(error.starts_with("Machine is unreachable"));
    let slot = tunnels.slots().get("m").unwrap().clone();
    assert!(slot.lock().unwrap().tunnel.is_none());
}
#[test]
fn a_pinned_lease_cannot_authorize_a_replaced_removed_or_reconnected_tunnel() {
    let tunnels = Tunnels::default();
    let target = SshTarget {
        target: "fixture@host".into(),
        port: None,
        remote_port: 3774,
        alternate: None,
        host_key_alias: None,
        identity_file: None,
    };
    tunnels.insert("m".into(), "env", Tunnel::adopt(long_lived_child(), 4321));
    let lease = tunnels.endpoint("m", "env", &target, false).unwrap();
    assert!(tunnels.is_current("m", &lease));
    tunnels.insert("m".into(), "env", Tunnel::adopt(long_lived_child(), 4321));
    assert!(
        !tunnels.is_current("m", &lease),
        "even equal port/generation has a different actual slot"
    );
    let current = tunnels.endpoint("m", "env", &target, false).unwrap();
    assert!(tunnels.is_current("m", &current));
    tunnels.remove("m");
    assert!(!tunnels.is_current("m", &current));
    tunnels.insert("m".into(), "env", Tunnel::adopt(long_lived_child(), 4321));
    let clearing = tunnels.endpoint("m", "env", &target, false).unwrap();
    tunnels.clear();
    assert!(!tunnels.is_current("m", &clearing));
}
#[test]
fn a_slot_held_by_a_tunnel_start_reads_as_busy_without_waiting() {
    let tunnels = Tunnels::default();
    tunnels.insert("m".into(), "env", Tunnel::adopt(long_lived_child(), 4321));
    let slot = tunnels.slots().get("m").unwrap().clone();
    let lease = TunnelLease {
        endpoint: String::new(),
        slot: slot.clone(),
        generation: 1,
    };
    assert!(tunnels.is_current("m", &lease));
    let (locked_tx, locked_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel::<()>();
    let holder = std::thread::spawn(move || {
        let _guard = slot.lock().unwrap();
        locked_tx.send(()).unwrap();
        let _ = release_rx.recv();
    });
    locked_rx.recv().unwrap();
    let started = Instant::now();
    assert!(!tunnels.is_current("m", &lease));
    assert!(!tunnels.take_host_refusal("m"));
    assert!(
        started.elapsed() < Duration::from_secs(1),
        "waited for the slot"
    );
    release_tx.send(()).unwrap();
    holder.join().unwrap();
}
#[test]
fn a_tunnel_dropped_after_its_ssh_died_still_reports_the_exit() {
    let (tunnels, events) = exit_events();
    let tunnel = Tunnel::adopt(short_lived_child(), 1);
    tunnels.watch("env", &tunnel);
    std::thread::sleep(Duration::from_millis(300));
    drop(tunnel);
    let exit = events.recv_timeout(Duration::from_secs(10)).unwrap();
    assert_eq!(exit.exit_code, Some(3));
    assert_eq!(exit.stderr, "boom");
}
#[test]
fn ssh_stderr_keeps_its_newest_bytes() {
    let mut text = String::new();
    for _ in 0..10 {
        append_stderr_tail(&mut text, "n".repeat(1024).as_bytes());
    }
    append_stderr_tail(&mut text, b"\nfinal line\n");
    assert!(text.len() <= 8192);
    assert!(text.ends_with("final line\n"));
    // The cut lands on a character boundary even inside multi-byte text.
    append_stderr_tail(&mut text, "é".repeat(6000).as_bytes());
    assert!(text.len() <= 8192 && text.ends_with('é'));
}
#[test]
fn a_missing_tunnel_is_not_started_when_connecting_is_not_allowed() {
    let tunnels = Tunnels::default();
    let target = SshTarget {
        target: "nowhere.invalid".into(),
        port: None,
        remote_port: 3774,
        alternate: None,
        host_key_alias: None,
        identity_file: None,
    };
    let started = Instant::now();
    let error = tunnels
        .endpoint("m", "env", &target, false)
        .err()
        .expect("no tunnel exists");
    assert!(error.starts_with("Machine is unreachable. Automatic reconnect is off"));
    assert!(started.elapsed() < Duration::from_secs(1), "spawned ssh");
    // Nothing is cached, so a user-initiated attempt is not answered with it.
    let slot = tunnels.slots().get("m").unwrap().clone();
    assert!(slot.lock().unwrap().failure.is_none());
}
#[test]
fn saved_identity_is_used_for_setup_tunnels_and_alternate_addresses() {
    let target = SshTarget {
        target: "alice@host.invalid".into(),
        port: Some(2222),
        remote_port: 3776,
        alternate: Some("alice@alternate.invalid".into()),
        host_key_alias: None,
        identity_file: Some("C:/keys/saved key".into()),
    };
    let decoded: SshTarget =
        serde_json::from_str(&serde_json::to_string(&target).unwrap()).unwrap();
    for interactive in [false, true] {
        let command = command(&decoded, interactive);
        let args: Vec<String> = command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-i", "C:/keys/saved key"]));
        assert!(args.contains(&"IdentitiesOnly=yes".into()));
    }
    assert!(dial_order(&decoded)
        .iter()
        .all(|dial| dial.identity_file == target.identity_file));
    let legacy: SshTarget =
        serde_json::from_str(r#"{"target":"host.invalid","port":22,"remotePort":3776}"#).unwrap();
    assert!(legacy.identity_file.is_none());
    let mut tunnel = Tunnel::adopt(long_lived_child(), 4321);
    tunnel.target = Some(decoded.clone());
    let tunnels = Tunnels::default();
    tunnels.insert("saved".into(), "env", tunnel);
    let changed_key = SshTarget {
        identity_file: Some("C:/keys/replacement".into()),
        ..decoded
    };
    assert_eq!(
        tunnels
            .endpoint("saved", "env", &changed_key, false)
            .unwrap()
            .endpoint,
        "http://127.0.0.1:4321"
    );
}

#[test]
fn tunnels_use_fast_keepalives_without_blocking_interactive_auth() {
    let target = SshTarget {
        target: "me@host".into(),
        port: Some(2222),
        remote_port: 3774,
        alternate: None,
        host_key_alias: None,
        identity_file: None,
    };
    let args = |command: &Command| -> Vec<String> {
        command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect()
    };
    let tunnel = args(&command_with_keepalive(
        &target,
        false,
        TUNNEL_KEEPALIVE_SECS,
    ));
    for option in [
        "ServerAliveInterval=5",
        "ServerAliveCountMax=3",
        "ExitOnForwardFailure=yes",
        "ConnectTimeout=15",
        "BatchMode=yes",
    ] {
        assert!(tunnel.contains(&option.to_string()), "{option}");
    }
    // Setup commands keep the slower probes; an interactive attempt may prompt.
    let setup = args(&command(&target, true));
    assert!(setup.contains(&"ServerAliveInterval=15".to_string()));
    assert!(setup.contains(&"BatchMode=no".to_string()));
    let probe = command(&target, false);
    let env = |name: &str| {
        probe
            .get_envs()
            .find(|(key, _)| *key == name)
            .and_then(|(_, value)| value.map(|v| v.to_string_lossy().into_owned()))
    };
    assert_eq!(env("LC_ALL").as_deref(), Some("C"));
    assert_eq!(env("LANG").as_deref(), Some("C"));
}
#[test]
fn ssh_stderr_is_reduced_to_a_few_safe_lines() {
    let noisy = "one\ntwo\x07\nBearer abc.def\nthree\nfour\nfive\nsix\nPASSWORD=hunter2\n";
    assert_eq!(stderr_tail(noisy), "two\nthree\nfour\nfive\nsix");
    assert_eq!(stderr_tail(&"x".repeat(500)).len(), 200);
    assert_eq!(stderr_tail(""), "");
}
#[test]
fn a_refused_forward_is_told_from_a_dead_tunnel() {
    assert!(host_refused(
        "channel 2: open failed: connect failed: Connection refused\n"
    ));
    assert!(host_refused(
        "channel 0: open failed: connect failed: No connection could be made because the target machine actively refused it.\n"
    ));
    assert!(!host_refused(
        "ssh: connect to host mini port 22: Connection refused\n"
    ));
    assert!(!host_refused(""));
    let tunnels = Tunnels::default();
    let tunnel = Tunnel::adopt(long_lived_child(), 1);
    tunnel
        .stderr
        .lock()
        .unwrap()
        .push_str("channel 3: open failed: connect failed: Connection refused\n");
    tunnels.insert("m".into(), "env", tunnel);
    assert!(tunnels.take_host_refusal("m"));
    assert!(!tunnels.take_host_refusal("m"), "a report is used once");
    assert!(!tunnels.take_host_refusal("other"));
}
#[test]
fn ssh_config_dumps_give_the_address_ssh_would_dial() {
    let dump = "user me\nhostname 10.0.0.7\nport 2200\nidentityfile ~/.ssh/id_ed25519\n";
    assert_eq!(parse_ssh_config_dump(dump), Some(("10.0.0.7".into(), 2200)));
    assert_eq!(
        parse_ssh_config_dump("hostname a\nport 22\nproxycommand none\nproxyjump none\n"),
        Some(("a".into(), 22))
    );
    for proxied in ["proxyjump bastion", "proxycommand nc %h %p"] {
        assert_eq!(
            parse_ssh_config_dump(&format!("hostname a\nport 22\n{proxied}\n")),
            None
        );
    }
    assert_eq!(parse_ssh_config_dump("hostname a\n"), None);
    assert_eq!(parse_ssh_config_dump(""), None);
}
#[test]
fn a_machine_with_two_addresses_dials_the_one_that_answers_first() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let target = SshTarget {
        target: "me@nowhere.invalid".into(),
        port: Some(port),
        remote_port: 3774,
        alternate: Some("me@127.0.0.1".into()),
        host_key_alias: None,
        identity_file: None,
    };
    let order = dial_order(&target);
    assert_eq!(
        order
            .iter()
            .map(|dial| dial.target.as_str())
            .collect::<Vec<_>>(),
        ["me@127.0.0.1", "me@nowhere.invalid"]
    );
    // The other address checks the host key filed for the saved one.
    assert_eq!(order[0].host_key_alias.as_deref(), Some("nowhere.invalid"));
    assert_eq!(order[1].host_key_alias, None);
    assert!(order.iter().all(|dial| dial.alternate.is_none()));

    drop(listener);
    let order = dial_order(&target);
    assert_eq!(order[0].target, "me@nowhere.invalid");

    let single = SshTarget {
        alternate: None,
        ..target.clone()
    };
    assert_eq!(dial_order(&single).len(), 1);
    let blank = SshTarget {
        alternate: Some("  ".into()),
        ..target
    };
    assert_eq!(dial_order(&blank).len(), 1);
}

#[test]
fn an_address_the_host_taught_is_dialed_when_the_saved_ones_are_silent() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let silent = TcpListener::bind("127.0.0.1:0").unwrap();
    let silent_port = silent.local_addr().unwrap().port();
    drop(silent);
    let target = SshTarget {
        target: "me@learned-route.invalid".into(),
        port: Some(silent_port),
        remote_port: 3774,
        alternate: None,
        host_key_alias: None,
        identity_file: None,
    };
    crate::remote_routes::teach(
        &target,
        vec![
            crate::remote_routes::LearnedRoute {
                target: "me@learned-route.invalid".into(),
                port: None,
            },
            crate::remote_routes::LearnedRoute {
                target: "me@127.0.0.1".into(),
                port: Some(port),
            },
        ],
    );
    let order = dial_order(&target);
    // The saved address taught as a route again is not dialed twice.
    assert_eq!(
        order
            .iter()
            .map(|dial| (dial.target.as_str(), dial.port))
            .collect::<Vec<_>>(),
        [
            ("me@127.0.0.1", Some(port)),
            ("me@learned-route.invalid", Some(silent_port))
        ]
    );
    // It checks the host key filed for the saved address.
    assert_eq!(
        order[0].host_key_alias.as_deref(),
        Some("learned-route.invalid")
    );
    drop(listener);
}

#[test]
fn the_other_address_is_checked_like_the_first() {
    assert_eq!(validate_alternate(None, None), Ok(None));
    assert_eq!(validate_alternate(Some("  "), None), Ok(None));
    assert_eq!(
        validate_alternate(Some(" me@100.64.0.5 "), None),
        Ok(Some("me@100.64.0.5".into()))
    );
    assert!(validate_alternate(Some("-oProxyCommand=x"), None).is_err());
}

#[test]
fn tcp_reachability_and_failure_tags() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    assert!(tcp_reachable("127.0.0.1", port, Duration::from_secs(2)));
    // A released ephemeral port can be reused by another parallel test.
    // Port zero never has a listener, so the negative dial is deterministic.
    assert!(!tcp_reachable("127.0.0.1", 0, Duration::from_secs(2)));
    assert_eq!(
        failure_tag(Some(255), Some(true)),
        " (exit 255, host reachable)"
    );
    assert_eq!(
        failure_tag(Some(255), Some(false)),
        " (exit 255, host unreachable)"
    );
    assert_eq!(failure_tag(None, None), "");
}
#[test]
fn ssh_targets_cannot_inject_options_or_shell_commands() {
    for target in [
        "home",
        "me@mac-mini.local",
        "user@192.168.1.4",
        "user@[::1]",
    ] {
        assert!(validate_target(target, None).is_ok());
    }
    for target in [
        "",
        "-oProxyCommand=bad",
        "host;touch /tmp/x",
        "host\nname",
        "$(whoami)",
        "user@host command",
        "host/../../x",
        "ssh://user@host",
        "a@b@c",
    ] {
        assert!(validate_target(target, None).is_err(), "{target}");
    }
    assert!(validate_target("host", Some(0)).is_err());
    assert_eq!(shell_quote("a'b"), "'a'\\''b'");
}
#[test]
fn unix_bootstrap_accepts_windows_checkout_line_endings() {
    let lf_template = include_str!("remote_bootstrap.sh").replace("\r\n", "\n");
    let crlf_template = lf_template.replace('\n', "\r\n");
    let script = bootstrap_script_from_template(HostPlatform::Unix, &crlf_template);
    assert!(script.starts_with("set -eu\n"));
    assert!(!script.contains('\r'));
    assert_eq!(
        script,
        bootstrap_script_from_template(HostPlatform::Unix, &lf_template)
    );
}
#[test]
fn bootstrap_is_versioned_and_only_explicit_upgrade_restarts_the_host() {
    let script = bootstrap_script(HostPlatform::Unix);
    assert!(script.contains("BASE=\"$HOME/.bycoda-host\""));
    assert!(script.contains("ENTRY=\"$BASE/bin/bycoda-host\""));
    assert!(script.contains("BYCODA_HOST_PORT:-3776"));
    assert!(script.contains("bycoda host distribution is not configured"));
    assert!(!script.contains("github.com/bahadryalcn/bycoda"));
    assert!(!script.contains('\r'));
    assert!(!script.contains("@@"));
    assert!(script.contains("--proto '=https'"));
    assert!(script.contains("checksum mismatch"));
    assert!(script.contains("\"$FORCE_UPGRADE\" = 1"));
    assert!(script.contains("service uninstall"));
    assert!(upgrade_script(HostPlatform::Unix, 3774).starts_with("BYCODA_HOST_FORCE_UPGRADE=1"));
    assert!(!upgrade_script(HostPlatform::Unix, 3774).contains('\r'));
    assert!(upgrade_script(HostPlatform::Windows, 3774)
        .starts_with("$env:BYCODA_HOST_FORCE_UPGRADE = '1'"));
}
#[test]
fn remote_platform_probe_handles_cmd_powershell_and_unix() {
    assert_eq!(
        parse_platform("BYCODA_PLATFORM $env:OS Windows_NT $OS\r\n").unwrap(),
        HostPlatform::Windows
    );
    assert_eq!(
        parse_platform("BYCODA_PLATFORM\r\nWindows_NT\r\n%OS%\r\n").unwrap(),
        HostPlatform::Windows
    );
    assert_eq!(
        parse_platform("BYCODA_PLATFORM :OS %OS%\n").unwrap(),
        HostPlatform::Unix
    );
    assert!(parse_platform("unrecognized shell").is_err());
    assert!(powershell_reader().len() < 4096);
    let script = bootstrap_script(HostPlatform::Windows);
    assert!(!script.contains("@@"));
    assert!(script.contains("checksum mismatch"));
    assert!(script.contains("Protect-BycodaDirectory"));
    assert!(pairing_script(HostPlatform::Windows, "Nick's $PC").contains("'Nick''s $PC'"));
}
#[cfg(windows)]
#[test]
fn windows_shells_detect_the_platform_and_accept_utf8_scripts() {
    for (program, args) in [
        ("cmd.exe", vec!["/D", "/C"]),
        (
            "powershell.exe",
            vec!["-NoProfile", "-NonInteractive", "-Command"],
        ),
    ] {
        let output = Command::new(program)
            .env_remove("PSModulePath")
            .args(args)
            .arg(PLATFORM_PROBE.join(" "))
            .output()
            .unwrap();
        assert!(output.status.success());
        assert_eq!(
            parse_platform(&String::from_utf8_lossy(&output.stdout)).unwrap(),
            HostPlatform::Windows
        );
    }
    let mut child = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            &powershell_reader(),
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all("Write-Output '日本語 🖥'\n".as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(String::from_utf8(output.stdout).unwrap().trim(), "日本語 🖥");
}
#[test]
fn device_names_are_bounded_single_lines() {
    let name = device_name();
    assert!(name.starts_with("bycoda"));
    assert!(name.chars().count() <= 100);
    assert!(!name.chars().any(char::is_control));
}
#[test]
fn answers_must_match_the_current_prompt() {
    let job = Job::new();
    assert!(job.answer("old", "yes".into()).is_err());
    let waiter = job.clone();
    let thread = std::thread::spawn(move || waiter.prompt("Trust this host?".into(), true));
    while job.view().prompt.is_none() {
        std::thread::sleep(Duration::from_millis(5));
    }
    let prompt = job.view().prompt.unwrap();
    assert!(job.answer(&prompt.id, "arbitrary".into()).is_err());
    job.answer(&prompt.id, "yes".into()).unwrap();
    assert_eq!(thread.join().unwrap(), Some("yes".into()));
    assert!(job.answer(&prompt.id, "yes".into()).is_err());
}

#[test]
fn a_tunnel_on_a_later_address_moves_to_a_preferred_one_only_while_unchanged() {
    let tunnels = Tunnels::default();
    let saved = SshTarget {
        target: "me@preferred-route.invalid".into(),
        port: Some(22),
        remote_port: 3774,
        alternate: Some("me@later-route.invalid".into()),
        host_key_alias: None,
        identity_file: None,
    };
    let on = |dial: &str| {
        let mut tunnel = Tunnel::adopt(long_lived_child(), 4321);
        tunnel.target = Some(saved.clone());
        tunnel.dialed = Some(SshTarget {
            target: dial.into(),
            ..saved.clone()
        });
        tunnel
    };
    tunnels.insert("m".into(), "env", on("me@preferred-route.invalid"));
    assert!(tunnels.later_routes(Duration::ZERO).is_empty());

    tunnels.insert("m".into(), "env", on("me@later-route.invalid"));
    // A tunnel that only just came up is left alone.
    assert!(tunnels.later_routes(Duration::from_secs(60)).is_empty());
    let later = tunnels.later_routes(Duration::ZERO);
    assert_eq!(later.len(), 1);
    assert_eq!(
        later[0]
            .better
            .iter()
            .map(|dial| dial.target.as_str())
            .collect::<Vec<_>>(),
        ["me@preferred-route.invalid"]
    );
    let lease = tunnels.endpoint("m", "env", &saved, false).unwrap();
    assert!(tunnels.switch(&later[0], on("me@preferred-route.invalid")));
    assert!(
        !tunnels.is_current("m", &lease),
        "requests move to the new tunnel"
    );
    assert_eq!(
        tunnels.dialed("m").map(|dial| dial.target),
        Some("me@preferred-route.invalid".into())
    );
    // The tunnel it saw is gone, so a second switch from the same check is refused.
    assert!(!tunnels.switch(&later[0], on("me@preferred-route.invalid")));
}
