use crate::remote_ssh::SshTarget;
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashSet,
    fs,
    io::Read,
    net::IpAddr,
    path::PathBuf,
    process::{Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineCandidate {
    key: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    os: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    online: Option<bool>,
    sources: Vec<String>,
    routes: Vec<Route>,
    #[serde(skip_serializing_if = "Option::is_none")]
    environment_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ssh_user: Option<String>,
    already_added: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    group: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
struct Route {
    address: String,
    kind: String,
}

fn normalized(s: &str) -> String {
    let s = s
        .trim()
        .rsplit('@')
        .next()
        .unwrap_or("")
        .trim_end_matches('.');
    let s = if let Ok(url) = url::Url::parse(s) {
        url.host_str().unwrap_or(s).to_owned()
    } else {
        s.to_owned()
    };
    let s = if s.matches(':').count() == 1 {
        s.rsplit_once(':')
            .filter(|(_, port)| port.parse::<u16>().is_ok())
            .map(|(host, _)| host.to_owned())
            .unwrap_or(s)
    } else {
        s
    };
    let s = s
        .strip_prefix('[')
        .and_then(|v| v.split_once(']'))
        .map(|v| v.0)
        .unwrap_or(&s);
    s.to_ascii_lowercase()
}
fn route(address: &str) -> Route {
    let address = normalized(address);
    let kind = match address.parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) if ip.octets()[0] == 100 && (64..=127).contains(&ip.octets()[1]) => {
            "tailscale"
        }
        Ok(_) => "lan",
        Err(_) if address.ends_with(".ts.net") => "tailscale",
        Err(_) if address.ends_with(".trycloudflare.com") => "tunnel",
        Err(_) => "name",
    };
    Route {
        address,
        kind: kind.into(),
    }
}
fn candidate(host: &str, source: &str) -> MachineCandidate {
    let host = normalized(host);
    MachineCandidate {
        key: host.clone(),
        name: host.clone(),
        os: None,
        online: None,
        sources: vec![source.into()],
        routes: vec![route(&host)],
        environment_id: None,
        ssh_user: None,
        already_added: false,
        group: None,
    }
}
fn parse_tailscale(text: &str) -> Vec<MachineCandidate> {
    let Ok(value) = serde_json::from_str::<Value>(text) else {
        return vec![];
    };
    let owner = value.pointer("/Self/UserID").and_then(Value::as_i64);
    let self_id = value.pointer("/Self/ID").and_then(Value::as_str);
    let Some(peers) = value.get("Peer").and_then(Value::as_object) else {
        return vec![];
    };
    peers
        .values()
        .filter_map(|p| {
            let id = p.get("ID")?.as_str()?;
            if Some(id) == self_id {
                return None;
            }
            let name = p
                .get("HostName")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .or_else(|| p.get("DNSName").and_then(Value::as_str))?;
            let mut c = candidate(name, "tailscale");
            c.key = id.into();
            c.name = name.trim_end_matches('.').into();
            c.routes.clear();
            c.routes.push(route(name));
            if let Some(dns) = p
                .get("DNSName")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
            {
                c.routes.push(route(dns));
            }
            if let Some(ips) = p.get("TailscaleIPs").and_then(Value::as_array) {
                for ip in ips.iter().filter_map(Value::as_str) {
                    c.routes.push(route(ip));
                }
            }
            let os = p
                .get("OS")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_ascii_lowercase();
            c.os = match os.as_str() {
                "macos" | "darwin" => Some("macos"),
                "windows" => Some("windows"),
                "linux" => Some("linux"),
                _ => None,
            }
            .map(str::to_owned);
            c.group = if os == "ios" || os == "android" {
                Some("mobile".into())
            } else if owner.is_some()
                && p.get("UserID")
                    .and_then(Value::as_i64)
                    .is_some_and(|id| Some(id) != owner)
            {
                Some("shared".into())
            } else {
                None
            };
            c.online = p.get("Online").and_then(Value::as_bool);
            Some(c)
        })
        .collect()
}
fn config_hosts(text: &str) -> Vec<String> {
    text.lines()
        .filter_map(|line| {
            let line = line.split('#').next()?.trim();
            let (key, rest) = line
                .split_once(char::is_whitespace)
                .or_else(|| line.split_once('='))?;
            key.eq_ignore_ascii_case("host")
                .then_some(rest.trim_start_matches('=').trim())
        })
        .flat_map(str::split_whitespace)
        .filter(|s| !s.contains(['*', '?', '!']))
        .map(str::to_owned)
        .collect()
}
fn known_hosts(text: &str) -> Vec<String> {
    text.lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let first = parts.next()?;
            if first.starts_with('#') {
                return None;
            }
            if first.starts_with('@') {
                parts.next()
            } else {
                Some(first)
            }
        })
        .flat_map(|s| s.split(','))
        .filter(|s| !s.starts_with('|') && !s.contains(['*', '?', '!']))
        .map(|s| {
            if let Some(v) = s.strip_prefix('[') {
                v.split(']').next().unwrap_or(v).to_owned()
            } else {
                s.to_owned()
            }
        })
        .collect()
}
fn executable() -> Option<PathBuf> {
    let name = if cfg!(windows) {
        "tailscale.exe"
    } else {
        "tailscale"
    };
    let mut paths = Vec::new();
    if cfg!(windows) {
        paths.push(
            PathBuf::from(
                std::env::var_os("ProgramFiles").unwrap_or_else(|| "C:\\Program Files".into()),
            )
            .join("Tailscale")
            .join(name),
        );
    } else {
        paths.extend(
            [
                "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
                "/usr/local/bin/tailscale",
                "/opt/homebrew/bin/tailscale",
                "/usr/bin/tailscale",
            ]
            .iter()
            .map(PathBuf::from),
        );
    }
    if let Some(path) = std::env::var_os("PATH") {
        paths.extend(std::env::split_paths(&path).map(|p| p.join(name)));
    }
    paths.into_iter().find(|p| p.is_file())
}
fn tailscale() -> Vec<MachineCandidate> {
    let Some(exe) = executable() else {
        return vec![];
    };
    let mut cmd = Command::new(exe);
    cmd.args(["status", "--json"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    crate::hide_window_console(&mut cmd);
    let Ok(mut child) = cmd.spawn() else {
        return vec![];
    };
    let Some(mut stdout) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return vec![];
    };
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = (&mut stdout).take(4 * 1024 * 1024).read_to_end(&mut buf);
        let _ = tx.send(buf);
    });
    let end = Instant::now() + Duration::from_millis(1500);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return vec![];
                }
                break;
            }
            Ok(None) if Instant::now() < end => std::thread::sleep(Duration::from_millis(10)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return vec![];
            }
        }
    }
    rx.recv_timeout(end.saturating_duration_since(Instant::now()))
        .ok()
        .map(|v| parse_tailscale(&String::from_utf8_lossy(&v)))
        .unwrap_or_default()
}
fn ssh_sources() -> Vec<MachineCandidate> {
    let Some(home) = crate::dirs_home() else {
        return vec![];
    };
    let dir = PathBuf::from(home).join(".ssh");
    let mut out = Vec::new();
    let deadline = Instant::now() + Duration::from_millis(2700);
    if let Ok(text) = fs::read_to_string(dir.join("config")) {
        for host in config_hosts(&text) {
            if Instant::now() >= deadline {
                break;
            }
            let mut c = candidate(&host, "ssh-config");
            let target = SshTarget {
                target: host,
                identity_file: None,
                port: None,
                remote_port: 0,
                alternate: None,
                host_key_alias: None,
            };
            if let Some(dump) = crate::remote_ssh::ssh_config_dump(&target) {
                let mut resolved_host = None;
                let mut resolved_port = None;
                for line in dump.lines() {
                    if let Some((key, value)) = line.split_once(' ') {
                        match key {
                            "hostname" => resolved_host = Some(value.to_owned()),
                            "port" => resolved_port = value.parse::<u16>().ok(),
                            "user" => c.ssh_user = Some(value.into()),
                            _ => {}
                        }
                    }
                }
                if let Some(host) = resolved_host {
                    let mut resolved = route(&host);
                    if let Some(port) = resolved_port.filter(|port| *port != 22) {
                        resolved.address = if host.contains(':') {
                            format!("[{host}]:{port}")
                        } else {
                            format!("{host}:{port}")
                        };
                    }
                    c.routes.push(resolved);
                }
            }
            out.push(c);
        }
    }

    out
}
fn known_hosts_source() -> Vec<MachineCandidate> {
    let Some(home) = crate::dirs_home() else {
        return vec![];
    };
    fs::read_to_string(PathBuf::from(home).join(".ssh").join("known_hosts"))
        .map(|text| {
            known_hosts(&text)
                .iter()
                .map(|host| candidate(host, "known-hosts"))
                .collect()
        })
        .unwrap_or_default()
}

fn merge(mut all: Vec<MachineCandidate>) -> Vec<MachineCandidate> {
    let mut out: Vec<MachineCandidate> = Vec::new();
    while let Some(mut c) = all.pop() {
        let mut index = 0;
        while index < out.len() {
            if c.routes.iter().any(|a| {
                out[index]
                    .routes
                    .iter()
                    .any(|b| normalized(&a.address) == normalized(&b.address))
            }) || c.key == out[index].key
            {
                let other = out.remove(index);
                if other.sources.iter().any(|s| s == "tailscale")
                    && !c.sources.iter().any(|s| s == "tailscale")
                {
                    let mut preferred = other;
                    std::mem::swap(&mut c, &mut preferred);
                    combine(&mut c, preferred);
                } else {
                    combine(&mut c, other);
                }
                index = 0;
            } else {
                index += 1;
            }
        }
        out.push(c);
    }
    out.sort_by_key(|a| a.name.to_lowercase());
    out
}
fn combine(a: &mut MachineCandidate, b: MachineCandidate) {
    for source in b.sources {
        if !a.sources.contains(&source) {
            a.sources.push(source);
        }
    }
    for r in b.routes {
        if !a.routes.iter().any(|x| x.address == r.address) {
            a.routes.push(r);
        }
    }
    if a.ssh_user.is_none() {
        a.ssh_user = b.ssh_user;
    }
    if a.environment_id.is_none() {
        a.environment_id = b.environment_id;
    }
    a.already_added |= b.already_added;
}
#[derive(Debug)]
enum Source {
    Candidates(Vec<MachineCandidate>),
    Inventory(Vec<MachineCandidate>, HashSet<String>, HashSet<String>),
}
fn discover(app: AppHandle) -> Vec<MachineCandidate> {
    let (tx, rx) = mpsc::channel();
    for source in [
        tailscale as fn() -> Vec<MachineCandidate>,
        ssh_sources,
        known_hosts_source,
    ] {
        let tx = tx.clone();
        std::thread::spawn(move || {
            let _ = tx.send(Source::Candidates(source()));
        });
    }
    let tx2 = tx.clone();
    std::thread::spawn(move || {
        let state = app.state::<crate::remote::RemoteConnections>();
        let servers =
            crate::server_inventory::server_inventory_list(app.clone(), state).unwrap_or_default();
        let state = app.state::<crate::remote::RemoteConnections>();
        let machines = crate::remote::remote_machines(app.clone(), state).unwrap_or_default();
        let mut added = HashSet::new();
        let mut environments = HashSet::new();
        for m in machines {
            environments.insert(m.environment_id);
            added.insert(normalized(&m.endpoint));
            if let Some(ssh) = m.ssh {
                added.insert(normalized(&ssh.target));
                if let Some(alternate) = &ssh.alternate {
                    added.insert(normalized(alternate));
                }
                for learned in crate::remote_routes::learned(&ssh) {
                    added.insert(normalized(&learned.target));
                }
            }
        }
        let mut list = Vec::new();
        for server in servers {
            if let Some(ssh) = server.effective_ssh_endpoint.or(server.ssh_endpoint) {
                let mut c = candidate(&ssh.host, "servers");
                c.name = server.name;
                c.ssh_user = ssh.user;
                list.push(c);
            }
        }
        let _ = tx2.send(Source::Inventory(list, added, environments));
    });
    drop(tx);
    collect_sources(rx, Duration::from_millis(2900))
}
fn collect_sources(rx: mpsc::Receiver<Source>, timeout: Duration) -> Vec<MachineCandidate> {
    let end = Instant::now() + timeout;
    let mut all = Vec::new();
    let mut added = HashSet::new();
    let mut environments = HashSet::new();
    while let Ok(source) = rx.recv_timeout(end.saturating_duration_since(Instant::now())) {
        match source {
            Source::Candidates(c) => all.extend(c),
            Source::Inventory(c, a, e) => {
                all.extend(c);
                added = a;
                environments = e;
            }
        }
    }
    let mut result = merge(all);
    for c in &mut result {
        c.already_added = c
            .environment_id
            .as_ref()
            .is_some_and(|id| environments.contains(id))
            || c.routes
                .iter()
                .any(|r| added.contains(&normalized(&r.address)));
    }
    result
}
#[tauri::command]
pub async fn discover_machine_candidates(app: AppHandle) -> Result<Vec<MachineCandidate>, String> {
    // A failed blocking task is an error, not "no machines": the UI keeps its last list.
    tauri::async_runtime::spawn_blocking(move || discover(app))
        .await
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn slow_source_does_not_block_other_results() {
        let (tx, rx) = mpsc::channel();
        tx.send(Source::Candidates(vec![candidate("ready", "known-hosts")]))
            .unwrap();
        let started = Instant::now();
        let results = collect_sources(rx, Duration::from_millis(30));
        assert_eq!(results.len(), 1);
        assert!(started.elapsed() < Duration::from_secs(1));
        drop(tx);
    }
    #[test]
    fn saved_address_marks_merged_candidate() {
        let (tx, rx) = mpsc::channel();
        let mut alias = candidate("alias", "ssh-config");
        alias.routes.push(route("100.64.0.9"));
        tx.send(Source::Candidates(vec![alias])).unwrap();
        tx.send(Source::Inventory(
            vec![],
            HashSet::from(["100.64.0.9".into()]),
            HashSet::new(),
        ))
        .unwrap();
        drop(tx);
        assert!(collect_sources(rx, Duration::from_millis(50))[0].already_added);
        assert_eq!(normalized("[2001:db8::1]:2222"), "2001:db8::1");
        assert_eq!(normalized("Example.org:2222"), "example.org");
    }
    #[test]
    fn tailscale_peers_and_groups() {
        let peers = parse_tailscale(include_str!("tailscale-fixture.json"));
        assert_eq!(peers.len(), 4);
        assert_eq!(
            peers.iter().find(|p| p.key == "a").unwrap().os.as_deref(),
            Some("windows")
        );
        assert_eq!(
            peers.iter().find(|p| p.key == "b").unwrap().os.as_deref(),
            Some("macos")
        );
        assert_eq!(
            peers
                .iter()
                .find(|p| p.key == "c")
                .unwrap()
                .group
                .as_deref(),
            Some("mobile")
        );
        assert_eq!(
            peers
                .iter()
                .find(|p| p.key == "d")
                .unwrap()
                .group
                .as_deref(),
            Some("shared")
        );
    }
    #[test]
    fn ssh_aliases_and_known_hosts_skip_patterns() {
        assert_eq!(
            config_hosts("Host foo bar *.example !bad\n Include other\nHost=baz\n"),
            vec!["foo", "bar", "baz"]
        );
        assert_eq!(
            known_hosts("|1|hash key\nfoo,bar key\n[server]:2222 key\n"),
            vec!["foo", "bar", "server"]
        );
    }
    #[test]
    fn merges_transitive_routes_and_preserves_tailscale_identity() {
        let mut peer = candidate("device", "tailscale");
        peer.key = "node-id".into();
        peer.routes.push(route("100.64.0.1"));
        let mut alias = candidate("alias", "ssh-config");
        alias.routes.push(route("100.64.0.1"));
        let known = candidate("alias", "known-hosts");
        let result = merge(vec![peer, alias, known]);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].key, "node-id");
        assert_eq!(result[0].sources.len(), 3);
    }
}
