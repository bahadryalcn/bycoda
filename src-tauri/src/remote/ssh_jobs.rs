use super::*;

pub(super) fn start_ssh_job(
    app: AppHandle,
    target: SshTarget,
    name: String,
    existing: Option<StoredMachine>,
    upgrade: bool,
) -> Result<String, String> {
    let adding = existing.is_none();
    let named = !name.trim().is_empty();
    let job = Job::new();
    let id = job.view().id;
    {
        let state = app.state::<RemoteConnections>();
        let mut jobs = state
            .jobs
            .lock()
            .map_err(|_| "Connection setup is unavailable")?;
        if jobs.values().any(|job| !job.view().done) {
            return Err(
                "Another SSH connection is being set up. Finish or cancel it first.".into(),
            );
        }
        jobs.retain(|_, job| !job.view().done);
        jobs.insert(id.clone(), job.clone());
    }
    std::thread::spawn(move || {
        let prepared = (|| -> Result<(StoredMachine, Tunnel), String> {
            let askpass = job.askpass()?;
            let mut target = target;
            let mut machine = if let Some(mut existing) = existing {
                if upgrade {
                    let (platform, dial) = remote_ssh::detect_platform(&target, &job, &askpass)?;
                    job.message("Updating bycoda Host on the machine…");
                    let output = remote_ssh::run_script(
                        &dial,
                        platform,
                        remote_ssh::upgrade_script(platform, target.remote_port),
                        &job,
                        &askpass,
                    )?;
                    let info: Value = serde_json::from_str(output.lines().last().unwrap_or(""))
                        .map_err(|_| "Host update returned an invalid response")?;
                    target.remote_port = info
                        .get("port")
                        .and_then(Value::as_u64)
                        .and_then(|v| u16::try_from(v).ok())
                        .filter(|p| *p > 0)
                        .ok_or("Host did not report a valid port")?;
                    existing.ssh = Some(target.clone());
                } else {
                    job.message("Reconnecting to the machine…");
                }
                existing
            } else {
                let (platform, dial) = remote_ssh::detect_platform(&target, &job, &askpass)?;
                job.message("Installing or starting bycoda Host…");
                let output = remote_ssh::run_script(
                    &dial,
                    platform,
                    remote_ssh::bootstrap_script(platform),
                    &job,
                    &askpass,
                )?;
                let info: Value = serde_json::from_str(output.lines().last().unwrap_or(""))
                    .map_err(|_| "Host setup returned an invalid response")?;
                target.remote_port = info
                    .get("port")
                    .and_then(Value::as_u64)
                    .and_then(|v| u16::try_from(v).ok())
                    .filter(|p| *p > 0)
                    .ok_or("Host did not report a valid port")?;
                job.message("Pairing this desktop with the host…");
                let pair = remote_ssh::run_script(
                    &dial,
                    platform,
                    remote_ssh::pairing_script(platform, &remote_ssh::device_name()),
                    &job,
                    &askpass,
                )?;
                let pair: Value = serde_json::from_str(pair.lines().last().unwrap_or(""))
                    .map_err(|_| "Host pairing returned an invalid response")?;
                let token = pair
                    .get("token")
                    .and_then(Value::as_str)
                    .filter(|s| {
                        s.len() == 43
                            && s.bytes()
                                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
                    })
                    .ok_or("Host returned an invalid device credential")?
                    .to_string();
                let environment_id = pair
                    .get("environmentId")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                    .ok_or("Host identity is missing")?
                    .to_string();
                StoredMachine {
                    id: uuid::Uuid::new_v4().to_string(),
                    name,
                    endpoint: format!("ssh://{}", target.target),
                    environment_id,
                    token,
                    ssh: Some(target.clone()),
                    local_host: false,
                }
            };
            job.message("Opening the secure connection…");
            let connect = |target: &SshTarget| -> Result<(Tunnel, Value), String> {
                let tunnel = Tunnel::start(target, Some(&job), Some(&askpass))?;
                let descriptor = rpc(
                    &format!("http://127.0.0.1:{}", tunnel.port),
                    &machine.token,
                    Some(&machine.environment_id),
                    "environment.describe",
                    json!({}),
                )?;
                Ok((tunnel, descriptor))
            };
            let (tunnel, descriptor) = match connect(&target) {
                Ok(connected) => connected,
                // A reconnect to a host that now listens elsewhere (it was
                // reinstalled or updated): ask it over SSH and retry once.
                Err(error) if !adding && !upgrade && port_may_have_moved(&error) => {
                    job.message("Looking for the host on the machine…");
                    let (platform, dial) = remote_ssh::detect_platform(&target, &job, &askpass)?;
                    let output = remote_ssh::run_script(
                        &dial,
                        platform,
                        remote_ssh::connection_info_script(platform),
                        &job,
                        &askpass,
                    )
                    .map_err(|_| error.clone())?;
                    match reported_port(&output) {
                        Some(port) if port != target.remote_port => {
                            target.remote_port = port;
                            machine.ssh = Some(target.clone());
                            job.message("Opening the secure connection…");
                            connect(&target)?
                        }
                        _ => return Err(error),
                    }
                }
                Err(error) => return Err(error),
            };
            if descriptor.get("protocolVersion").and_then(Value::as_u64) != Some(1) {
                return Err("This host uses an incompatible protocol version".into());
            }
            if descriptor.get("environmentId").and_then(Value::as_str)
                != Some(&machine.environment_id)
            {
                return Err(
                    "Host identity changed: this address now answers as a different host, usually after it was reinstalled. Add the machine again with the same address; it replaces this connection."
                        .into(),
                );
            }
            if upgrade {
                let capabilities = descriptor.get("capabilities").and_then(Value::as_array);
                let supports = |name: &str| {
                    capabilities.is_some_and(|entries| {
                        entries.iter().any(|entry| entry.as_str() == Some(name))
                    })
                };
                if !supports("git.index")
                    || !supports("files.list")
                    || !supports("files.create")
                    || !supports("files.searchContent")
                {
                    return Err("The installed host package still lacks Explorer and Changes. Install a newer bycoda release with updated host packages.".into());
                }
            }
            if machine.name.trim().is_empty() {
                machine.name = descriptor
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or(&target.target)
                    .chars()
                    .take(100)
                    .collect();
            }
            Ok((machine, tunnel))
        })();
        job.complete(|| {
            let (mut machine, mut tunnel) = prepared?;
            let state = app.state::<RemoteConnections>();
            let _guard = state
                .store
                .lock()
                .map_err(|_| "Connection store is locked")?;
            let path = store_path(&app)?;
            let mut machines = read(&path)?;
            if let Some(old) = machines
                .iter()
                .find(|m| m.environment_id == machine.environment_id)
            {
                merge_known_machine(&mut machine, old, adding, named);
                if let Some(ssh) = &machine.ssh {
                    tunnel.retarget(ssh.clone());
                }
            } else if let Some(old) = adding
                .then(|| replaced_machine(&machines, &machine))
                .flatten()
            {
                // The same SSH machine whose host was replaced: take over its
                // saved entry instead of leaving a dead duplicate beside it.
                machine.id = old.id.clone();
                if !named {
                    machine.name = old.name.clone();
                }
                state.tunnels.remove(&machine.id);
            }
            machines.retain(|m| m.id != machine.id);
            machines.push(machine.clone());
            write(&path, &machines)?;
            state.invalidate_ws(&machine.id);
            state
                .tunnels
                .insert(machine.id.clone(), &machine.environment_id, tunnel);
            Ok(machine.public())
        });
    });
    Ok(id)
}
