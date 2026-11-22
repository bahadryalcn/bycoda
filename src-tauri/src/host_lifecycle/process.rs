use std::{
    fs::{self, File, OpenOptions},
    io::Read,
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    time::{Duration, Instant},
};

const STOP_WAIT: Duration = Duration::from_secs(60);

fn runtime(base: &Path) -> Result<PathBuf, String> {
    let pointer = fs::read_to_string(base.join("runtime-path"))
        .map_err(|error| format!("Could not read the Host runtime pointer: {error}"))?;
    let path = PathBuf::from(pointer.trim_start_matches('\u{feff}').trim());
    if !path.is_absolute() || !path.join("host.mjs").is_file() {
        return Err("The installed Host runtime is incomplete.".into());
    }
    Ok(path)
}

fn packaged_node(runtime: &Path) -> PathBuf {
    runtime.join(if cfg!(windows) {
        "node.exe"
    } else {
        "bin/node"
    })
}

fn digest(path: &Path) -> std::io::Result<[u8; 32]> {
    use sha2::{Digest, Sha256};
    let mut digest = Sha256::new();
    std::io::copy(&mut File::open(path)?, &mut digest)?;
    Ok(digest.finalize().into())
}

fn serve_command(base: &Path, port: u16) -> Result<Command, String> {
    let runtime = runtime(base)?;
    let packaged = packaged_node(&runtime);
    let stable = base.join(if cfg!(windows) {
        "engine/node.exe"
    } else {
        "engine/node"
    });
    let node = if digest(&stable)
        .ok()
        .is_some_and(|hash| digest(&packaged).ok() == Some(hash))
    {
        stable
    } else {
        // App-mode rollback and packages predating the stable engine can still
        // run the Node binary that belongs to the selected Host runtime.
        packaged
    };
    let mut command = Command::new(node);
    command
        .arg(runtime.join("host.mjs"))
        .arg("serve")
        .arg("--data-dir")
        .arg(base)
        .arg("--port")
        .arg(port.to_string())
        .arg("--parent-pid")
        .arg(std::process::id().to_string());
    Ok(command)
}

pub(super) struct OwnedHost {
    child: Child,
    started: Instant,
    #[cfg(windows)]
    job: Option<std::os::windows::io::OwnedHandle>,
}

impl OwnedHost {
    pub(super) fn spawn(base: &Path, port: u16) -> Result<Self, String> {
        Self::spawn_logged(serve_command(base, port)?, base)
            .map_err(|error| format!("Could not launch the app-owned Host: {error}"))
    }

    fn spawn_logged(mut command: Command, base: &Path) -> std::io::Result<Self> {
        let path = base.join("host.log");
        if fs::metadata(&path).is_ok_and(|meta| meta.len() > 10 * 1024 * 1024) {
            // ast-grep-ignore: rust-rename-without-fsync -- Rotate an existing append-only log.
            let _ = fs::rename(&path, base.join("host.log.old"));
        }
        let mut log = OpenOptions::new();
        log.create(true).append(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            log.mode(0o600);
        }
        let log = log.open(path)?;
        command
            .stdin(Stdio::null())
            .stdout(log.try_clone()?)
            .stderr(log);
        #[cfg(windows)]
        {
            use std::os::windows::{io::AsRawHandle, process::CommandExt};
            use windows_sys::Win32::System::{
                JobObjects::AssignProcessToJobObject,
                Threading::{CREATE_NO_WINDOW, CREATE_SUSPENDED},
            };
            let job = crate::windows::create_job()?;
            command.creation_flags(CREATE_NO_WINDOW | CREATE_SUSPENDED);
            let mut child = command.spawn()?;
            let result =
                if unsafe { AssignProcessToJobObject(job.as_raw_handle(), child.as_raw_handle()) }
                    == 0
                {
                    Err(std::io::Error::last_os_error())
                } else {
                    crate::windows::resume_child(child.id())
                };
            if let Err(error) = result {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
            Ok(Self {
                child,
                started: Instant::now(),
                job: Some(job),
            })
        }
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
            Ok(Self {
                child: command.spawn()?,
                started: Instant::now(),
            })
        }
    }

    pub(super) fn id(&self) -> u32 {
        self.child.id()
    }

    pub(super) fn age(&self) -> Duration {
        self.started.elapsed()
    }

    pub(super) fn exit_status(&mut self) -> Result<Option<ExitStatus>, String> {
        self.child
            .try_wait()
            .map_err(|error| format!("Could not inspect the owned Host: {error}"))
    }

    pub(super) fn drain(&mut self, base: &Path, if_idle: bool) -> Result<(), String> {
        self.drain_for(base, if_idle, STOP_WAIT)
    }

    fn drain_for(&mut self, base: &Path, if_idle: bool, timeout: Duration) -> Result<(), String> {
        let deadline = Instant::now() + timeout;
        let mut requested = false;
        while Instant::now() < deadline {
            if self.exit_status()?.is_some() {
                return Ok(());
            }
            if !requested {
                requested = request_stop(base, self.id(), if_idle)?;
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        if if_idle && !requested {
            return Err("Could not confirm that the owned Host is idle.".into());
        }
        log::warn!("local Host exceeded its graceful shutdown deadline; stopping the owned tree");
        #[cfg(windows)]
        let killed_tree = self.job.take().is_some();
        #[cfg(unix)]
        let killed_tree = unsafe { libc::kill(-(self.id() as libc::pid_t), libc::SIGKILL) == 0 };
        // The job/group is the primary tree boundary. The child handle is also
        // available if the OS reports that tree already gone.
        if !killed_tree && self.exit_status()?.is_none() {
            self.child.kill().map_err(|error| error.to_string())?;
        }
        let reap_deadline = Instant::now() + Duration::from_secs(2);
        while self.exit_status()?.is_none() {
            if Instant::now() >= reap_deadline {
                return Err("The app-owned Host did not exit after the tree stop.".into());
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unresponsive_child_gets_the_grace_period_before_the_owned_tree_is_killed() {
        let base = tempfile::tempdir().unwrap();
        let mut command;
        #[cfg(windows)]
        {
            command = Command::new("ping.exe");
            command.args(["-n", "30", "127.0.0.1"]);
        }
        #[cfg(unix)]
        {
            command = Command::new("/bin/sh");
            command.args(["-c", "sleep 30"]);
        }
        let mut child = OwnedHost::spawn_logged(command, base.path()).unwrap();
        let grace = Duration::from_millis(250);
        let start = Instant::now();
        child.drain_for(base.path(), false, grace).unwrap();
        assert!(start.elapsed() >= grace);
        assert!(child.exit_status().unwrap().is_some());
    }
}

fn request_stop(base: &Path, pid: u32, if_idle: bool) -> Result<bool, String> {
    let Some(state) = fs::read_to_string(base.join("running.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
    else {
        return Ok(false);
    };
    if state["pid"].as_u64() != Some(u64::from(pid)) {
        return Ok(false);
    }
    let (Some(port), Some(secret)) = (
        state["port"]
            .as_u64()
            .and_then(|port| u16::try_from(port).ok())
            .filter(|port| *port != 0),
        state["secret"].as_str(),
    ) else {
        return Ok(false);
    };
    let body = if if_idle {
        r#"{"action":"stop","ifIdle":true}"#
    } else {
        r#"{"action":"stop"}"#
    };
    match ureq::post(&format!("http://127.0.0.1:{port}/lifecycle"))
        .timeout(Duration::from_secs(1))
        .set("Authorization", &format!("Bearer {secret}"))
        .set("Content-Type", "application/json")
        .send_string(body)
    {
        Ok(_) => Ok(true),
        Err(ureq::Error::Status(409, _)) => Err("The Host is still running work.".into()),
        Err(_) => Ok(false),
    }
}

pub(super) fn run_cli(base: &Path, args: &[&str], timeout: Duration) -> Result<String, String> {
    let runtime = runtime(base)?;
    let mut command = Command::new(packaged_node(&runtime));
    command
        .arg(runtime.join("host.mjs"))
        .args(args)
        .arg("--data-dir")
        .arg(base);
    run_command(command, timeout)
}

pub(super) fn run_command(mut command: Command, timeout: Duration) -> Result<String, String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not run the Host CLI: {error}"))?;
    let collect = |mut pipe: Box<dyn Read + Send>| {
        std::thread::spawn(move || {
            let mut kept = Vec::new();
            let _ = (&mut pipe).take(128 * 1024).read_to_end(&mut kept);
            let _ = std::io::copy(&mut pipe, &mut std::io::sink());
            String::from_utf8_lossy(&kept).trim().to_owned()
        })
    };
    let stdout = collect(Box::new(child.stdout.take().expect("piped stdout")));
    let stderr = collect(Box::new(child.stderr.take().expect("piped stderr")));
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(100)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("The Host lifecycle command did not finish.".into());
            }
        }
    };
    if status.success() {
        stdout
            .join()
            .map_err(|_| "Could not read the Host CLI response.".into())
    } else {
        let error = stderr.join().unwrap_or_default();
        Err(if error.is_empty() {
            format!("Host CLI failed with {status}.")
        } else {
            error
        })
    }
}
