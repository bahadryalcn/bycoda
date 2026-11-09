//! Other ways to reach an SSH machine, learned from its Host. A connected Host
//! reports its home-network and Tailscale IPv4 addresses in
//! `environment.describe`; they are kept per saved address so a later dial can
//! try them when the saved addresses do not answer (Tailscale signed out at
//! home, or the home network unreachable on the road).
//!
//! Saved addresses are never changed. Each report replaces what the machine
//! taught before, so a changed DHCP address replaces the old one. A learned
//! address is a hint: ssh checks it against the host key filed for the saved
//! address, and the Host must answer with the saved environment id, so a
//! different machine that now holds that address is never used.
//!
//! A tunnel that had to use a later address moves back to a preferred one once
//! that answers again (`watch_better_routes`), the way the reference app preflights its
//! earlier routes: the new tunnel signs in completely before it replaces the
//! running one, and an address that stays silent or fails is checked less often.

use crate::remote::RemoteConnections;
use crate::remote_ssh::{LaterRoute, SshTarget, Tunnel};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::io::Write;
use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};
use tauri::Manager;

/// At most this many learned addresses per machine; each is probed on a dial.
const MAX_ROUTES: usize = 6;
const FILE: &str = "remote-routes.json";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LearnedRoute {
    /// `user@address`, ready to dial.
    pub target: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
}

/// Which kind of address a machine is dialed over first. `Saved` keeps the
/// saved address first, then its other address, then reported ones.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Prefer {
    #[default]
    Saved,
    Lan,
    Tailscale,
}

impl Prefer {
    fn is_saved(&self) -> bool {
        *self == Prefer::Saved
    }
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    /// What the Host last reported, so an unchanged report costs nothing.
    #[serde(default)]
    reported: Vec<String>,
    #[serde(default)]
    routes: Vec<LearnedRoute>,
    /// Addresses the owner turned off: never dialed. A new report keeps them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    disabled: Vec<String>,
    #[serde(default, skip_serializing_if = "Prefer::is_saved")]
    prefer: Prefer,
}

#[derive(Default)]
struct Store {
    path: Option<PathBuf>,
    machines: HashMap<String, Entry>,
}

static STORE: Mutex<Option<Store>> = Mutex::new(None);

fn with_store<T>(action: impl FnOnce(&mut Store) -> T) -> T {
    let mut guard = STORE.lock().unwrap_or_else(PoisonError::into_inner);
    action(guard.get_or_insert_with(Store::default))
}

/// Loads what earlier runs learned, so the first dial after a restart can
/// already use it. A missing or unreadable file starts empty.
pub fn init(directory: &Path) {
    let path = directory.join(FILE);
    let machines = std::fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    with_store(|store| {
        store.path = Some(path);
        store.machines = machines;
    });
}

fn key(target: &SshTarget) -> String {
    format!(
        "{}#{}",
        target.target.trim().to_ascii_lowercase(),
        target.port.unwrap_or(0)
    )
}

/// The addresses this machine's Host taught, in the order it reported them.
pub fn learned(target: &SshTarget) -> Vec<LearnedRoute> {
    with_store(|store| {
        store
            .machines
            .get(&key(target))
            .map(|entry| entry.routes.clone())
            .unwrap_or_default()
    })
}

fn address_kind(host: &str) -> Option<Prefer> {
    let ip: Ipv4Addr = host.trim().trim_matches(['[', ']']).parse().ok()?;
    let [a, b, ..] = ip.octets();
    if a == 100 && (64..=127).contains(&b) {
        Some(Prefer::Tailscale)
    } else {
        ip.is_private().then_some(Prefer::Lan)
    }
}

/// Applies the owner's choices to `candidates` (saved address first): drops
/// turned-off addresses the Host reported (never the saved or other address,
/// which the owner edits instead), and moves the preferred kind of
/// address to the front, keeping the order within each group. A saved ssh-config
/// alias has no known kind and keeps its place among the others.
pub fn arrange(target: &SshTarget, candidates: Vec<SshTarget>) -> Vec<SshTarget> {
    let other = target.alternate.as_deref().map(host_of);
    let (disabled, prefer) = with_store(|store| {
        store
            .machines
            .get(&key(target))
            .map(|entry| (entry.disabled.clone(), entry.prefer))
            .unwrap_or_default()
    });
    let mut kept: Vec<SshTarget> = candidates
        .into_iter()
        .enumerate()
        .filter(|(index, dial)| {
            let host = host_of(&dial.target);
            // The saved and other address are the owner's own entries: always tried.
            *index == 0 || other.as_deref() == Some(host.as_str()) || !disabled.contains(&host)
        })
        .map(|(_, dial)| dial)
        .collect();
    if !prefer.is_saved() {
        kept.sort_by_key(|dial| address_kind(&host_of(&dial.target)) != Some(prefer));
    }
    kept
}

/// Home-network (10/8, 172.16/12, 192.168/16) and Tailscale (100.64/10)
/// addresses only: a Host's public or loopback address is never learned.
fn usable(address: &str) -> Option<String> {
    let ip: Ipv4Addr = address.trim().parse().ok()?;
    let [a, b, ..] = ip.octets();
    let tailnet = a == 100 && (64..=127).contains(&b);
    (ip.is_private() || tailnet).then(|| ip.to_string())
}

fn reported_addresses(descriptor: &Value) -> Vec<String> {
    let mut addresses: Vec<String> = Vec::new();
    for address in descriptor
        .get("addresses")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter_map(usable)
    {
        if !addresses.contains(&address) {
            addresses.push(address);
        }
    }
    addresses.truncate(MAX_ROUTES);
    addresses
}

fn host_of(target: &str) -> String {
    let host = target.rsplit_once('@').map_or(target, |(_, host)| host);
    host.trim().trim_matches(['[', ']']).to_ascii_lowercase()
}

/// The user, host name and port ssh would use for the saved address.
fn resolved(target: &SshTarget) -> Option<(String, String, u16)> {
    let dump = crate::remote_ssh::ssh_config_dump(target)?;
    let field = |name: &str| {
        dump.lines()
            .find_map(|line| line.strip_prefix(name)?.strip_prefix(' '))
            .map(|value| value.trim().to_string())
    };
    Some((
        field("user")?,
        field("hostname")?,
        field("port")?.parse().ok()?,
    ))
}

/// Dial targets for the reported addresses, skipping ones the machine is
/// already saved under. They sign in as the saved user on the saved port.
fn routes_for(target: &SshTarget, reported: &[String]) -> Vec<LearnedRoute> {
    let explicit_user = target
        .target
        .rsplit_once('@')
        .map(|(user, _)| user.to_string());
    let (user, hostname, port) = match (resolved(target), explicit_user) {
        (Some((user, hostname, port)), explicit) => {
            (explicit.unwrap_or(user), hostname, Some(port))
        }
        // shortcut: without `ssh -G` only a saved user@host can be reused; an
        // ssh-config alias then learns nothing until ssh can be inspected.
        (None, Some(user)) => (user, host_of(&target.target), target.port),
        (None, None) => return Vec::new(),
    };
    let saved = [
        Some(host_of(&target.target)),
        Some(hostname.to_ascii_lowercase()),
        target.alternate.as_deref().map(host_of),
    ];
    reported
        .iter()
        .filter(|address| !saved.iter().flatten().any(|host| host == *address))
        .map(|address| LearnedRoute {
            target: format!("{user}@{address}"),
            port,
        })
        .collect()
}

fn persist(store: &Store) {
    let Some(path) = &store.path else { return };
    let Some(parent) = path.parent() else { return };
    let Ok(bytes) = serde_json::to_vec_pretty(&store.machines) else {
        return;
    };
    let temporary = parent.join(format!("{FILE}.{}.tmp", uuid::Uuid::new_v4().simple()));
    let written = std::fs::create_dir_all(parent).is_ok()
        && std::fs::File::create(&temporary)
            .and_then(|mut file| {
                file.write_all(&bytes)?;
                file.sync_all()
            })
            .is_ok()
        && std::fs::rename(&temporary, path).is_ok();
    if !written {
        let _ = std::fs::remove_file(&temporary);
    }
}

/// Learns from a successful describe of `environment_id` over `target`. Only
/// a changed report does any work, on a worker thread, since resolving the
/// saved address runs `ssh -G`.
pub fn observe(target: &SshTarget, environment_id: &str, descriptor: &Value) {
    if descriptor.get("environmentId").and_then(Value::as_str) != Some(environment_id) {
        return;
    }
    // An older Host reports nothing; what it taught before stays.
    if descriptor.get("addresses").is_none() {
        return;
    }
    let reported = reported_addresses(descriptor);
    let key = key(target);
    let changed = with_store(|store| {
        let entry = store.machines.entry(key.clone()).or_default();
        if entry.reported == reported {
            return false;
        }
        entry.reported = reported.clone();
        true
    });
    if !changed {
        return;
    }
    let target = target.clone();
    std::thread::spawn(move || {
        let routes = routes_for(&target, &reported);
        with_store(|store| {
            let entry = store.machines.entry(key).or_default();
            // A newer report arrived meanwhile; its own worker writes it.
            if entry.reported != reported {
                return;
            }
            entry.routes = routes;
            persist(store);
        });
    });
}

/// How often a tunnel on a later address checks for a preferred one, and how
/// long a tunnel must have run before it is checked.
const BETTER_ROUTE_CHECK: Duration = Duration::from_secs(60);
/// A preferred address that stays silent, or answers but fails to sign in,
/// is checked half as often each time, up to this.
const BETTER_ROUTE_BACKOFF_MAX: Duration = Duration::from_secs(30 * 60);

/// Per machine and address: failures so far and when to check it next.
static HELD_BACK: Mutex<Option<HashMap<String, (u32, Instant)>>> = Mutex::new(None);

fn held_back_key(id: &str, dial: &SshTarget) -> String {
    format!("{id}\u{0}{}", dial.target)
}

fn backoff(failures: u32) -> Duration {
    BETTER_ROUTE_CHECK
        .saturating_mul(2u32.saturating_pow(failures))
        .min(BETTER_ROUTE_BACKOFF_MAX)
}

fn with_held_back<T>(action: impl FnOnce(&mut HashMap<String, (u32, Instant)>) -> T) -> T {
    let mut guard = HELD_BACK.lock().unwrap_or_else(PoisonError::into_inner);
    action(guard.get_or_insert_with(HashMap::new))
}

fn is_held_back(key: &str) -> bool {
    with_held_back(|held| {
        held.get(key)
            .is_some_and(|(_, until)| Instant::now() < *until)
    })
}

/// `steps` failures more: a silent address costs one, a failed sign-in more.
fn hold_back(key: String, steps: u32) {
    with_held_back(|held| {
        let failures = held.get(&key).map_or(0, |(failures, _)| *failures) + steps;
        held.insert(key, (failures, Instant::now() + backoff(failures)));
    });
}

/// A signed-in tunnel over the best preferred address that answers now.
fn better_tunnel(later: &LaterRoute) -> Option<Tunnel> {
    let due: Vec<SshTarget> = later
        .better
        .iter()
        .filter(|dial| !is_held_back(&held_back_key(&later.id, dial)))
        .cloned()
        .collect();
    let probes: Vec<_> = due
        .iter()
        .cloned()
        .map(|dial| std::thread::spawn(move || crate::remote_ssh::ssh_server_reachable(&dial)))
        .collect();
    let answers: Vec<Option<bool>> = probes
        .into_iter()
        .map(|probe| probe.join().ok().flatten())
        .collect();
    for (dial, answer) in due.into_iter().zip(answers) {
        let key = held_back_key(&later.id, &dial);
        if answer != Some(true) {
            hold_back(key, 1);
            continue;
        }
        match Tunnel::start_route(&dial, &later.saved) {
            Ok(tunnel) => {
                with_held_back(|held| held.remove(&key));
                return Some(tunnel);
            }
            // It answered but did not carry a tunnel: do not let a flaky
            // network bounce the connection between addresses.
            Err(_) => hold_back(key, 3),
        }
    }
    None
}

/// Started once at launch: every minute, each tunnel running over a later
/// address than its machine prefers tries the preferred ones, and moves to the
/// best that signs in. Requests on the old tunnel then reconnect over the new one.
// shortcut: held-back addresses wait out their time even after a network
// change; forget them on a network-change signal once the desktop has one.
pub fn watch_better_routes(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(BETTER_ROUTE_CHECK);
        let Some(state) = app.try_state::<RemoteConnections>() else {
            continue;
        };
        for later in state.tunnels.later_routes(BETTER_ROUTE_CHECK) {
            let Some(tunnel) = better_tunnel(&later) else {
                continue;
            };
            if state.tunnels.switch(&later, tunnel) {
                state.invalidate_ws(&later.id);
            }
        }
    });
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteView {
    address: String,
    /// `tailscale`, `lan`, or `name` for an ssh-config alias or host name.
    kind: &'static str,
    /// `saved`, `other` (the saved other address) or `reported` by the Host.
    source: &'static str,
    /// Turned on; the saved address always is.
    enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineRoutes {
    /// Every address in the order a dial tries them now, turned-off ones last.
    routes: Vec<RouteView>,
    prefer: Prefer,
    /// The address the running tunnel dialed; absent while it is down.
    active: Option<String>,
}

fn route_view(target: &str, source: &'static str, enabled: bool) -> RouteView {
    let address = host_of(target);
    RouteView {
        kind: match address_kind(&address) {
            Some(Prefer::Tailscale) => "tailscale",
            Some(_) => "lan",
            None => "name",
        },
        address,
        source,
        enabled,
    }
}

/// Every address in a fixed order that does not move when one is turned on or
/// off: the saved one, its other address, then the reported ones, with the
/// preferred kind first. Turning a switch never moves another under the pointer.
fn route_list(
    saved: &str,
    other: Option<&str>,
    reported: &[String],
    disabled: &[String],
    prefer: Prefer,
) -> Vec<RouteView> {
    let mut hosts: Vec<(String, &'static str)> = vec![(saved.to_string(), "saved")];
    let others = other
        .map(|host| (host.to_string(), "other"))
        .into_iter()
        .chain(reported.iter().map(|host| (host.clone(), "reported")));
    for (host, source) in others {
        if !hosts.iter().any(|(known, _)| *known == host) {
            hosts.push((host, source));
        }
    }
    let mut routes: Vec<RouteView> = hosts
        .into_iter()
        .map(|(host, source)| {
            let enabled = source != "reported" || !disabled.contains(&host);
            route_view(&host, source, enabled)
        })
        .collect();
    if !prefer.is_saved() {
        routes.sort_by_key(|route| address_kind(&route.address) != Some(prefer));
    }
    routes
}

fn machine_routes(
    machine_id: &str,
    target: &SshTarget,
    state: &RemoteConnections,
) -> MachineRoutes {
    let (disabled, prefer) = with_store(|store| {
        store
            .machines
            .get(&key(target))
            .map(|entry| (entry.disabled.clone(), entry.prefer))
            .unwrap_or_default()
    });
    let reported: Vec<String> = learned(target)
        .iter()
        .map(|route| host_of(&route.target))
        .collect();
    let other = target.alternate.as_deref().map(host_of);
    MachineRoutes {
        routes: route_list(
            &host_of(&target.target),
            other.as_deref(),
            &reported,
            &disabled,
            prefer,
        ),
        prefer,
        active: state
            .tunnels
            .dialed(machine_id)
            .map(|dial| host_of(&dial.target)),
    }
}

/// What Connections settings shows for a machine: every address it can be
/// reached at, the owner's choices and the one in use. `target` only selects
/// what to read.
#[tauri::command]
pub async fn remote_machine_routes(
    app: tauri::AppHandle,
    machine_id: String,
    target: SshTarget,
) -> Result<MachineRoutes, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<RemoteConnections>();
        machine_routes(&machine_id, &target, &state)
    })
    .await
    .map_err(|error| error.to_string())
}

/// Whether each address's SSH port answers now, checked at once (about three
/// seconds at most). `None` when the address cannot be resolved to check.
#[tauri::command]
pub async fn remote_machine_route_check(target: SshTarget) -> Result<Vec<RouteCheck>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let saved = SshTarget {
            alternate: None,
            ..target.clone()
        };
        let mut dials = vec![saved.clone()];
        if let Some(other) = target
            .alternate
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            dials.push(SshTarget {
                target: other.trim().to_string(),
                ..saved.clone()
            });
        }
        for route in learned(&target) {
            dials.push(SshTarget {
                target: route.target,
                port: route.port.or(saved.port),
                ..saved.clone()
            });
        }
        let probes: Vec<_> = dials
            .into_iter()
            .map(|dial| {
                std::thread::spawn(move || RouteCheck {
                    address: host_of(&dial.target),
                    reachable: crate::remote_ssh::ssh_server_reachable(&dial),
                })
            })
            .collect();
        probes
            .into_iter()
            .filter_map(|probe| probe.join().ok())
            .collect()
    })
    .await
    .map_err(|error| error.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteCheck {
    address: String,
    reachable: Option<bool>,
}

/// Saves which reported addresses are turned off and which kind is tried
/// first. The saved and other address cannot be turned off; edit the machine
/// to change them. A
/// connection on an address that is now off or no longer preferred moves to
/// a better one within a minute (`watch_better_routes`); new dials use it at once.
#[tauri::command]
pub async fn remote_machine_route_settings(
    app: tauri::AppHandle,
    machine_id: String,
    target: SshTarget,
    disabled: Vec<String>,
    prefer: Prefer,
) -> Result<MachineRoutes, String> {
    let saved = host_of(&target.target);
    let other = target.alternate.as_deref().map(host_of);
    let mut hosts: Vec<String> = Vec::new();
    for host in disabled.iter().map(|value| host_of(value)) {
        if host.is_empty()
            || host == saved
            || other.as_deref() == Some(host.as_str())
            || hosts.contains(&host)
        {
            continue;
        }
        hosts.push(host);
    }
    if hosts.len() > MAX_ROUTES + 1 {
        return Err("Too many addresses".into());
    }
    with_store(|store| {
        let entry = store.machines.entry(key(&target)).or_default();
        entry.disabled = hosts;
        entry.prefer = prefer;
        persist(store);
    });
    remote_machine_routes(app, machine_id, target).await
}

/// The port a `connection-info` result reports (the script's last line).
pub(crate) fn reported_port(output: &str) -> Option<u16> {
    let info: Value = serde_json::from_str(output.lines().last()?.trim()).ok()?;
    u16::try_from(info.get("port")?.as_u64()?)
        .ok()
        .filter(|port| *port > 0)
}

/// Connection failures that a host listening on another port also produces.
/// Rejected credentials and changed identities are answered, not unreachable.
pub(crate) fn port_may_have_moved(error: &str) -> bool {
    error.starts_with("Machine is unreachable")
        || error.starts_with("The host request did not complete")
}

#[cfg(test)]
pub(crate) fn teach(target: &SshTarget, routes: Vec<LearnedRoute>) {
    with_store(|store| store.machines.entry(key(target)).or_default().routes = routes);
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn target(value: &str) -> SshTarget {
        SshTarget {
            target: value.into(),
            identity_file: None,
            port: Some(2222),
            remote_port: 3774,
            alternate: Some("me@192.168.2.145".into()),
            host_key_alias: None,
        }
    }

    #[test]
    fn only_home_network_and_tailscale_addresses_are_learned() {
        let descriptor = json!({ "addresses": [
            "192.168.2.145", "10.0.0.4", "100.97.82.0", "172.20.1.1", "8.8.8.8",
            "127.0.0.1", "169.254.1.1", "100.128.0.1", "fe80::1", "10.0.0.4", 7
        ]});
        assert_eq!(
            reported_addresses(&descriptor),
            ["192.168.2.145", "10.0.0.4", "100.97.82.0", "172.20.1.1"]
        );
    }

    #[test]
    fn learned_addresses_reuse_the_saved_user_and_skip_saved_addresses() {
        let saved = target("me@100.97.82.0");
        let reported = [
            "100.97.82.0".into(),
            "192.168.2.145".into(),
            "10.0.0.4".into(),
        ];
        let routes = routes_for(&saved, &reported);
        assert_eq!(
            routes
                .iter()
                .map(|route| route.target.as_str())
                .collect::<Vec<_>>(),
            ["me@10.0.0.4"]
        );
        assert_eq!(routes[0].port, Some(2222));
    }

    #[test]
    fn a_report_from_another_environment_or_an_older_host_teaches_nothing() {
        let saved = target("me@learn-test.invalid");
        teach(
            &saved,
            vec![LearnedRoute {
                target: "me@10.0.0.9".into(),
                port: None,
            }],
        );
        observe(
            &saved,
            "env",
            &json!({ "environmentId": "other", "addresses": ["10.0.0.4"] }),
        );
        observe(&saved, "env", &json!({ "environmentId": "env" }));
        assert_eq!(learned(&saved)[0].target, "me@10.0.0.9");
    }

    #[test]
    fn a_failing_preferred_address_is_checked_less_often_up_to_half_an_hour() {
        assert_eq!(backoff(1), Duration::from_secs(120));
        assert_eq!(backoff(4), Duration::from_secs(960));
        assert_eq!(backoff(5), BETTER_ROUTE_BACKOFF_MAX);
        assert_eq!(backoff(40), BETTER_ROUTE_BACKOFF_MAX);
        let key = "backoff-test\u{0}me@10.0.0.4".to_string();
        assert!(!is_held_back(&key));
        hold_back(key.clone(), 1);
        assert!(is_held_back(&key));
    }

    #[test]
    fn routes_are_shown_as_tailscale_home_network_or_name() {
        let tailnet = route_view("me@100.97.82.0", "saved", true);
        assert_eq!(
            (tailnet.address.as_str(), tailnet.kind),
            ("100.97.82.0", "tailscale")
        );
        let lan = route_view("me@192.168.2.145", "other", true);
        assert_eq!((lan.address.as_str(), lan.kind), ("192.168.2.145", "lan"));
        assert_eq!(route_view("macbook", "saved", true).kind, "name");
    }

    fn dial(value: &str) -> SshTarget {
        SshTarget {
            alternate: None,
            ..target(value)
        }
    }

    fn hosts(order: &[SshTarget]) -> Vec<String> {
        order.iter().map(|dial| host_of(&dial.target)).collect()
    }

    #[test]
    fn turned_off_addresses_are_skipped_but_the_saved_one_never_is() {
        let saved = target("me@arrange-off.invalid");
        with_store(|store| {
            let entry = store.machines.entry(key(&saved)).or_default();
            // A stale entry for the saved or other address never drops them.
            entry.disabled = vec![
                "arrange-off.invalid".into(),
                "192.168.2.145".into(),
                "192.168.95.2".into(),
            ];
        });
        let order = arrange(
            &saved,
            vec![
                dial("me@arrange-off.invalid"),
                dial("me@192.168.2.145"),
                dial("me@192.168.95.2"),
            ],
        );
        assert_eq!(hosts(&order), ["arrange-off.invalid", "192.168.2.145"]);
    }

    #[test]
    fn the_preferred_kind_goes_first_and_keeps_its_order() {
        let saved = target("me@100.97.82.0");
        with_store(|store| {
            store.machines.entry(key(&saved)).or_default().prefer = Prefer::Lan;
        });
        let candidates = || {
            vec![
                dial("me@100.97.82.0"),
                dial("me@macbook"),
                dial("me@192.168.2.145"),
                dial("me@10.0.0.4"),
            ]
        };
        assert_eq!(
            hosts(&arrange(&saved, candidates())),
            ["192.168.2.145", "10.0.0.4", "100.97.82.0", "macbook"]
        );
        with_store(|store| {
            store.machines.entry(key(&saved)).or_default().prefer = Prefer::Saved;
        });
        assert_eq!(
            hosts(&arrange(&saved, candidates())),
            ["100.97.82.0", "macbook", "192.168.2.145", "10.0.0.4"]
        );
    }

    #[test]
    fn the_address_list_keeps_its_order_when_an_address_is_turned_off() {
        let reported = ["192.168.95.2".to_string(), "10.0.0.4".to_string()];
        let order = |disabled: &[String], prefer| {
            route_list(
                "100.110.53.9",
                Some("192.168.2.108"),
                &reported,
                disabled,
                prefer,
            )
            .iter()
            .map(|route| (route.address.clone(), route.enabled))
            .collect::<Vec<_>>()
        };
        let on = order(&[], Prefer::Saved);
        let off = order(&["192.168.95.2".to_string()], Prefer::Saved);
        let addresses = |list: &[(String, bool)]| {
            list.iter()
                .map(|(address, _)| address.clone())
                .collect::<Vec<_>>()
        };
        assert_eq!(addresses(&on), addresses(&off));
        assert_eq!(
            addresses(&on),
            ["100.110.53.9", "192.168.2.108", "192.168.95.2", "10.0.0.4"]
        );
        assert!(off[0].1 && off[1].1 && !off[2].1 && off[3].1);
        // The other address is the owner's own entry: never turned off here.
        assert!(order(&["192.168.2.108".to_string()], Prefer::Saved)[1].1);
        // The saved address is always on, even if a stale entry names it.
        assert!(order(&["100.110.53.9".to_string()], Prefer::Saved)[0].1);
        assert_eq!(
            addresses(&order(&[], Prefer::Lan))[..3],
            ["192.168.2.108", "192.168.95.2", "10.0.0.4"]
        );
    }

    #[test]
    fn owner_choices_survive_a_new_report() {
        let saved = target("me@arrange-keep.invalid");
        with_store(|store| {
            let entry = store.machines.entry(key(&saved)).or_default();
            entry.disabled = vec!["10.0.0.9".into()];
            entry.prefer = Prefer::Tailscale;
        });
        observe(
            &saved,
            "env",
            &json!({ "environmentId": "env", "addresses": ["10.0.0.4"] }),
        );
        with_store(|store| {
            let entry = &store.machines[&key(&saved)];
            assert_eq!(entry.disabled, ["10.0.0.9"]);
            assert_eq!(entry.prefer, Prefer::Tailscale);
        });
    }

    #[test]
    fn reported_port_reads_the_last_line() {
        assert_eq!(reported_port("noise\n{\"port\":3776}\n"), Some(3776));
        assert_eq!(reported_port("{\"port\":0}"), None);
        assert!(port_may_have_moved("Machine is unreachable. Check"));
        assert!(!port_may_have_moved("Host identity changed"));
    }
}
