use crate::remote_ssh::SshTarget;
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashSet,
    fs,
    io::Read,
    net::{IpAddr, TcpStream, ToSocketAddrs},
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
    /// Names that identify this machine for merging and "already added" without being routes.
    #[serde(skip)]
    aliases: Vec<String>,
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
/// A route that keeps an SSH port other than 22 in its address: `host:2222` or `[v6]:2222`.
fn route_on_port(host: &str, port: u16) -> Route {
    let mut route = route(host);
    if port != 22 {
        route.address = if route.address.contains(':') {
            format!("[{}]:{port}", route.address)
        } else {
            format!("{}:{port}", route.address)
        };
    }
    route
}
/// A candidate for `host`, which may carry an SSH port (`host:2222`, `[v6]:2222`).
fn candidate(host: &str, source: &str) -> MachineCandidate {
    let port = socket_target(host.trim().rsplit('@').next().unwrap_or("")).1;
    let host = normalized(host);
    MachineCandidate {
        key: host.clone(),
        name: host.clone(),
        os: None,
        online: None,
        sources: vec![source.into()],
        routes: vec![route_on_port(&host, port)],
        environment_id: None,
        ssh_user: None,
        already_added: false,
        group: None,
        aliases: Vec::new(),
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
            // HostName is a display name ("Jane's MacBook Pro"); only MagicDNS and the
            // tailnet addresses are names SSH can dial.
            c.routes.clear();
            if let Some(dns) = p
                .get("DNSName")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
            {
                c.routes.push(route(dns));
                // known_hosts and ~/.ssh/config usually hold the short MagicDNS label. It joins
                // those rows to this peer but is no route of its own: the full name already
                // dials the peer without a search domain, and a row that used the short name
                // brings it along as a route.
                if let Some(label) = normalized(dns).split('.').next().filter(|s| !s.is_empty()) {
                    c.aliases.push(label.to_owned());
                }
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
        .map(str::to_owned)
        .collect()
}

/// Match saved SSH peers that changed addresses using exact public keys already on disk.
/// This is a discovery hint only and never authorizes a connection to another address.
fn known_ssh_addresses(text: &str, saved: &HashSet<String>) -> HashSet<String> {
    let records: Vec<_> = text
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let hosts = fields.next()?;
            let kind = fields.next()?;
            let key = fields.next()?;
            if hosts.starts_with(['@', '#', '|'])
                || !["ssh-", "ecdsa-", "sk-"]
                    .iter()
                    .any(|prefix| kind.starts_with(*prefix))
            {
                return None;
            }
            let addresses: Vec<_> = hosts
                .split(',')
                .filter(|host| {
                    !host.starts_with('|')
                        && !host.contains(['*', '?', '!'])
                        && (!host.starts_with('[') || host.ends_with("]:22"))
                })
                .map(normalized)
                .collect();
            Some(((kind, key), addresses))
        })
        .collect();
    let saved_keys: HashSet<_> = records
        .iter()
        .filter(|(_, hosts)| hosts.iter().any(|host| saved.contains(host)))
        .map(|(key, _)| *key)
        .collect();
    records
        .into_iter()
        .filter(|(key, _)| saved_keys.contains(key))
        .flat_map(|(_, hosts)| hosts)
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
                    c.routes
                        .push(route_on_port(&host, resolved_port.unwrap_or(22)));
                }
            }
            out.push(c);
        }
    }

    out
}
fn known_hosts_source() -> Source {
    let Some(home) = crate::dirs_home() else {
        return Source::KnownHosts(String::new());
    };
    Source::KnownHosts(
        fs::read_to_string(PathBuf::from(home).join(".ssh").join("known_hosts"))
            .unwrap_or_default(),
    )
}

fn merge(mut all: Vec<MachineCandidate>) -> Vec<MachineCandidate> {
    let mut out: Vec<MachineCandidate> = Vec::new();
    while let Some(mut c) = all.pop() {
        let mut index = 0;
        while index < out.len() {
            if same_machine(&c, &out[index]) {
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
/// Two rows are one machine when they share a key or a route host, or when one's alias is a
/// route host of the other. Two aliases alone never match: they are not addresses anyone dialed.
fn same_machine(a: &MachineCandidate, b: &MachineCandidate) -> bool {
    let hosts = |c: &MachineCandidate| -> Vec<String> {
        c.routes.iter().map(|r| normalized(&r.address)).collect()
    };
    let (a_hosts, b_hosts) = (hosts(a), hosts(b));
    a.key == b.key
        || a_hosts.iter().any(|host| b_hosts.contains(host))
        || a.aliases.iter().any(|alias| b_hosts.contains(alias))
        || b.aliases.iter().any(|alias| a_hosts.contains(alias))
}
fn combine(a: &mut MachineCandidate, b: MachineCandidate) {
    for alias in b.aliases {
        if !a.aliases.contains(&alias) {
            a.aliases.push(alias);
        }
    }
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
    KnownHosts(String),
    Inventory(Vec<MachineCandidate>, HashSet<String>, HashSet<String>),
}
fn discover(app: AppHandle) -> Vec<MachineCandidate> {
    let (tx, rx) = mpsc::channel();
    for source in [tailscale as fn() -> Vec<MachineCandidate>, ssh_sources] {
        let tx = tx.clone();
        std::thread::spawn(move || {
            let _ = tx.send(Source::Candidates(source()));
        });
    }
    let known_hosts_tx = tx.clone();
    std::thread::spawn(move || {
        let _ = known_hosts_tx.send(known_hosts_source());
    });
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
    let mut result = collect_sources(rx, Duration::from_millis(2900));
    probe_reachability(&mut result, Instant::now() + PROBE_TIMEOUT);
    result
}

/// Git hosting services answer SSH for repositories, not as computers to add.
const CODE_HOSTS: &[&str] = &[
    "github.com",
    "ssh.github.com",
    "gitlab.com",
    "altssh.gitlab.com",
    "bitbucket.org",
    "altssh.bitbucket.org",
    "codeberg.org",
    "ssh.dev.azure.com",
    "vs-ssh.visualstudio.com",
];
fn is_code_host(c: &MachineCandidate) -> bool {
    c.routes
        .iter()
        .any(|r| CODE_HOSTS.contains(&normalized(&r.address).as_str()))
}

/// How long one discovery pass waits for SSH ports to answer.
const PROBE_TIMEOUT: Duration = Duration::from_millis(1200);
/// shortcut: at most this many rows are probed per pass; raise it when a real list is longer.
const PROBE_LIMIT: usize = 32;

/// Host and port of a route address: `host`, `host:2222`, `[v6]:2222` or a bare IPv6 address.
fn socket_target(address: &str) -> (String, u16) {
    if let Some(rest) = address.strip_prefix('[') {
        return match rest.split_once("]:") {
            Some((host, port)) => (host.into(), port.parse().unwrap_or(22)),
            None => (rest.trim_end_matches(']').into(), 22),
        };
    }
    if address.matches(':').count() == 1 {
        if let Some((host, port)) = address.rsplit_once(':') {
            if let Ok(port) = port.parse() {
                return (host.into(), port);
            }
        }
    }
    (address.into(), 22)
}
/// At most this many addresses of one row are probed, so a pass starts a bounded number of threads.
const PROBE_ROUTES: usize = 4;
fn ssh_port_answers(address: &str, deadline: Instant) -> bool {
    let (host, port) = socket_target(address);
    let Ok(resolved) = (host.as_str(), port).to_socket_addrs() else {
        return false;
    };
    for socket in resolved {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return false;
        }
        if TcpStream::connect_timeout(&socket, left).is_ok() {
            return true;
        }
    }
    false
}
/// Marks rows no other source vouched for as online when one of their SSH ports accepts a
/// connection before `deadline`. A row whose addresses do not answer in time (closed port, other
/// network, stalled name lookup) is offline for this pass. Each address is probed on its own
/// thread: an SSH alias that is no DNS name can stall its lookup past the deadline and must not
/// hide the answering HostName beside it. Saved rows, rows with a known state and rows without
/// an address to probe are skipped.
fn probe_reachability(list: &mut [MachineCandidate], deadline: Instant) {
    let (tx, rx) = mpsc::channel();
    let mut probed = Vec::new();
    for (index, c) in list
        .iter()
        .enumerate()
        .filter(|(_, c)| c.online.is_none() && !c.already_added)
        .take(PROBE_LIMIT)
    {
        let mut addresses: Vec<&str> = Vec::new();
        for r in c.routes.iter().filter(|r| r.kind != "tunnel") {
            if addresses.len() < PROBE_ROUTES && !addresses.contains(&r.address.as_str()) {
                addresses.push(&r.address);
            }
        }
        if addresses.is_empty() {
            continue;
        }
        for address in addresses {
            let address = address.to_owned();
            let tx = tx.clone();
            std::thread::spawn(move || {
                let _ = tx.send((index, ssh_port_answers(&address, deadline)));
            });
        }
        probed.push(index);
    }
    drop(tx);
    for index in probed {
        list[index].online = Some(false);
    }
    let grace = deadline + Duration::from_millis(50);
    while let Ok((index, answered)) =
        rx.recv_timeout(grace.saturating_duration_since(Instant::now()))
    {
        if answered {
            list[index].online = Some(true);
        }
    }
}
fn collect_sources(rx: mpsc::Receiver<Source>, timeout: Duration) -> Vec<MachineCandidate> {
    let end = Instant::now() + timeout;
    let mut all = Vec::new();
    let mut added = HashSet::new();
    let mut environments = HashSet::new();
    let mut known = String::new();
    while let Ok(source) = rx.recv_timeout(end.saturating_duration_since(Instant::now())) {
        match source {
            Source::Candidates(c) => all.extend(c),
            Source::KnownHosts(text) => {
                all.extend(
                    known_hosts(&text)
                        .iter()
                        .map(|host| candidate(host, "known-hosts")),
                );
                known = text;
            }
            Source::Inventory(c, a, e) => {
                all.extend(c);
                added = a;
                environments = e;
            }
        }
    }
    added.extend(known_ssh_addresses(&known, &added));
    let mut result = merge(all);
    result.retain(|c| !is_code_host(c));
    for c in &mut result {
        c.already_added = c
            .environment_id
            .as_ref()
            .is_some_and(|id| environments.contains(id))
            || c.routes
                .iter()
                .any(|r| added.contains(&normalized(&r.address)))
            || c.aliases.iter().any(|alias| added.contains(alias));
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
    fn saved_ssh_key_marks_a_tailscale_peer_after_its_address_changes() {
        let (tx, rx) = mpsc::channel();
        tx.send(Source::Candidates(vec![candidate(
            "100.64.0.20",
            "tailscale",
        )]))
        .unwrap();
        tx.send(Source::KnownHosts(
            "100.64.0.10 ssh-ed25519 a2V5\n100.64.0.20 ssh-ed25519 a2V5\n100.64.0.30 ssh-ed25519 b3RoZXI\n@revoked 100.64.0.30 ssh-ed25519 a2V5\n".into(),
        ))
        .unwrap();
        tx.send(Source::Inventory(
            vec![],
            HashSet::from(["100.64.0.10".into()]),
            HashSet::new(),
        ))
        .unwrap();
        drop(tx);
        let results = collect_sources(rx, Duration::from_millis(50));
        assert!(
            results
                .iter()
                .find(|row| row.key == "100.64.0.20")
                .unwrap()
                .already_added
        );
        assert!(
            !results
                .iter()
                .find(|row| row.key == "100.64.0.30")
                .unwrap()
                .already_added
        );
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
            vec!["foo", "bar", "[server]:2222"]
        );
    }
    #[test]
    fn known_hosts_entry_keeps_its_port_for_route_and_probe() {
        let open = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = open.local_addr().unwrap().port();
        let (tx, rx) = mpsc::channel();
        tx.send(Source::KnownHosts(format!(
            "[127.0.0.1]:{port} ssh-ed25519 a2V5\n[2001:db8::1]:2200 ssh-ed25519 b3RoZXI\n[plain]:22 ssh-ed25519 Yw\n"
        )))
        .unwrap();
        drop(tx);
        let mut rows = collect_sources(rx, Duration::from_millis(50));
        let address = |rows: &[MachineCandidate], key: &str| {
            let row = rows.iter().find(|row| row.key == key).unwrap();
            (row.name.clone(), row.routes[0].address.clone())
        };
        assert_eq!(
            address(&rows, "127.0.0.1"),
            ("127.0.0.1".into(), format!("127.0.0.1:{port}"))
        );
        assert_eq!(
            address(&rows, "2001:db8::1"),
            ("2001:db8::1".into(), "[2001:db8::1]:2200".into())
        );
        assert_eq!(address(&rows, "plain"), ("plain".into(), "plain".into()));
        rows.retain(|row| row.key == "127.0.0.1");
        probe_reachability(&mut rows, Instant::now() + Duration::from_secs(2));
        assert_eq!(rows[0].online, Some(true));
    }
    #[test]
    fn tailscale_peer_joins_the_ssh_rows_that_use_its_short_name() {
        let peers = parse_tailscale(
            r#"{"Self":{"ID":"s","UserID":1},"Peer":{"m":{"ID":"m","HostName":"Jane MacBook Pro","DNSName":"jane-mbp.tail.ts.net.","OS":"macOS","UserID":1,"TailscaleIPs":["100.64.0.9"]},"n":{"ID":"n","HostName":"Jane MacBook Pro","DNSName":"jane-mbp-1.tail.ts.net.","OS":"macOS","UserID":1,"TailscaleIPs":["100.64.0.10"]}}}"#,
        );
        let (tx, rx) = mpsc::channel();
        tx.send(Source::Candidates(peers)).unwrap();
        tx.send(Source::Candidates(vec![candidate("Jane-MBP", "ssh-config")]))
            .unwrap();
        tx.send(Source::KnownHosts(
            "jane-mbp ssh-ed25519 a2V5\nother ssh-ed25519 b3RoZXI\n".into(),
        ))
        .unwrap();
        tx.send(Source::Inventory(
            vec![],
            HashSet::from(["jane-mbp-1".into()]),
            HashSet::new(),
        ))
        .unwrap();
        drop(tx);
        let rows = collect_sources(rx, Duration::from_millis(50));
        assert_eq!(rows.len(), 3);
        let find = |key: &str| rows.iter().find(|row| row.key == key).unwrap();
        assert!(find("other").aliases.is_empty());
        let row = find("m");
        assert_eq!(row.name, "Jane MacBook Pro");
        let mut sources = row.sources.clone();
        sources.sort();
        assert_eq!(sources, vec!["known-hosts", "ssh-config", "tailscale"]);
        // The short name is a route only because an SSH source vouches for it.
        let routes: Vec<_> = row.routes.iter().map(|r| r.address.as_str()).collect();
        assert_eq!(routes, vec!["jane-mbp.tail.ts.net", "100.64.0.9", "jane-mbp"]);
        assert!(!row.already_added);
        // A machine saved under the short name marks its peer, which has no such route.
        assert!(find("n").already_added);
        assert_eq!(find("n").routes.len(), 2);
    }
    #[test]
    fn a_tailscale_display_name_is_never_an_ssh_route() {
        let peers = parse_tailscale(
            r#"{"Self":{"ID":"s","UserID":1},"Peer":{"m":{"ID":"m","HostName":"Jane MacBook Pro","DNSName":"jane-macbook-pro.tail.ts.net.","OS":"macOS","UserID":1,"TailscaleIPs":["100.64.0.9"]}}}"#,
        );
        assert_eq!(peers[0].name, "Jane MacBook Pro");
        let routes: Vec<_> = peers[0].routes.iter().map(|r| r.address.as_str()).collect();
        assert_eq!(routes, vec!["jane-macbook-pro.tail.ts.net", "100.64.0.9"]);
    }
    #[test]
    fn git_hosts_are_not_computers() {
        let (tx, rx) = mpsc::channel();
        let mut alias = candidate("github-work", "ssh-config");
        alias.routes.push(route("ssh.github.com"));
        tx.send(Source::Candidates(vec![
            alias,
            candidate("box", "ssh-config"),
        ]))
        .unwrap();
        tx.send(Source::KnownHosts("github.com ssh-ed25519 a2V5\n".into()))
            .unwrap();
        drop(tx);
        let keys: Vec<_> = collect_sources(rx, Duration::from_millis(50))
            .into_iter()
            .map(|c| c.key)
            .collect();
        assert_eq!(keys, vec!["box"]);
    }
    #[test]
    fn route_addresses_split_into_host_and_port() {
        assert_eq!(socket_target("box"), ("box".into(), 22));
        assert_eq!(socket_target("box:2222"), ("box".into(), 2222));
        assert_eq!(
            socket_target("[2001:db8::1]:2200"),
            ("2001:db8::1".into(), 2200)
        );
        assert_eq!(socket_target("2001:db8::1"), ("2001:db8::1".into(), 22));
    }
    #[test]
    fn probe_marks_answering_ports_online_and_others_offline() {
        let open = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let closed_port = closed.local_addr().unwrap().port();
        drop(closed);
        let mut up = candidate("up", "known-hosts");
        up.routes = vec![route("127.0.0.1")];
        up.routes[0].address = format!("127.0.0.1:{}", open.local_addr().unwrap().port());
        let mut down = candidate("down", "known-hosts");
        down.routes[0].address = format!("127.0.0.1:{closed_port}");
        let mut known = candidate("known", "tailscale");
        known.online = Some(true);
        let mut saved = candidate("saved", "known-hosts");
        saved.already_added = true;
        let mut list = vec![up, down, known, saved];
        probe_reachability(&mut list, Instant::now() + Duration::from_secs(2));
        let online: Vec<_> = list.iter().map(|c| c.online).collect();
        assert_eq!(online, vec![Some(true), Some(false), Some(true), None]);
    }
    #[test]
    fn probe_is_not_held_up_by_an_alias_that_is_no_dns_name() {
        let open = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        // An SSH config row: the alias first, then the HostName it resolves to.
        let mut alias = candidate("bycoda-probe-alias-that-is-no-dns-name", "ssh-config");
        alias.routes.push(route("127.0.0.1"));
        alias.routes[1].address = format!("127.0.0.1:{}", open.local_addr().unwrap().port());
        let mut list = vec![alias, candidate("box.trycloudflare.com", "ssh-config")];
        probe_reachability(&mut list, Instant::now() + Duration::from_millis(1000));
        assert_eq!(list[0].online, Some(true));
        // A row without an address to probe stays unknown instead of offline.
        assert_eq!(list[1].online, None);
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
