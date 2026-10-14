//! Existing OS WebDAV clients only. Never installs, configures services, or maps drives.
use std::ffi::OsString;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Platform {
    Windows,
    Mac,
    Linux,
}

impl Platform {
    fn current() -> Result<Self, String> {
        match std::env::consts::OS {
            "windows" => Ok(Self::Windows),
            "macos" => Ok(Self::Mac),
            "linux" => Ok(Self::Linux),
            _ => Err("Live remote folders are unavailable on this operating system.".into()),
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
struct Invocation {
    program: &'static str,
    args: Vec<OsString>,
}

fn invocation(program: &'static str, args: &[&str]) -> Invocation {
    Invocation {
        program,
        args: args.iter().map(OsString::from).collect(),
    }
}

/// Only the local gateway's opaque root is allowed here, never a remote URL or a shell fragment.
fn gateway_url(input: &str) -> Result<url::Url, String> {
    let url = url::Url::parse(input).map_err(|_| "Invalid private folder address")?;
    let capability = url.path().trim_matches('/');
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port().is_none_or(|port| port == 0)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !(16..=128).contains(&capability.len())
        || !capability
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        || url.path() != format!("/{capability}/")
    {
        return Err("Invalid private folder address".into());
    }
    Ok(url)
}

fn client_address(platform: Platform, input: &str) -> Result<String, String> {
    let url = gateway_url(input)?;
    match platform {
        Platform::Windows => Ok(format!(
            r"\\127.0.0.1@{}\DavWWWRoot\{}",
            url.port().unwrap(),
            url.path().trim_matches('/')
        )),
        Platform::Mac => Ok(url.to_string()),
        Platform::Linux => Ok(format!(
            "dav://127.0.0.1:{}{}",
            url.port().unwrap(),
            url.path()
        )),
    }
}

fn mount_plan(
    platform: Platform,
    input: &str,
    directory: &Path,
) -> Result<Option<Invocation>, String> {
    let address = client_address(platform, input)?;
    match platform {
        Platform::Windows => Ok(None),
        Platform::Mac => {
            // Apple's -S suppresses credential and disconnect dialogs. rdonly is explicit.
            let mut command = invocation(
                "/sbin/mount_webdav",
                &[
                    "-S",
                    "-o",
                    "rdonly,nobrowse",
                    "-v",
                    "bycoda Remote",
                    &address,
                ],
            );
            command.args.push(directory.as_os_str().to_owned());
            Ok(Some(command))
        }
        // Read-only is also enforced by the gateway; -a avoids interactive authentication.
        Platform::Linux => Ok(Some(invocation("gio", &["mount", "-a", &address]))),
    }
}

fn open_plan(platform: Platform, input: &str, directory: &Path) -> Result<Invocation, String> {
    let address = client_address(platform, input)?;
    Ok(match platform {
        Platform::Windows => invocation("explorer.exe", &[&address]),
        Platform::Mac => Invocation {
            program: "/usr/bin/open",
            args: vec![directory.as_os_str().to_owned()],
        },
        Platform::Linux => invocation("gio", &["open", &address]),
    })
}

fn cleanup_plan(
    platform: Platform,
    input: &str,
    directory: &Path,
) -> Result<Option<Invocation>, String> {
    let address = client_address(platform, input)?;
    Ok(match platform {
        Platform::Windows => None,
        Platform::Mac => Some(Invocation {
            program: "/sbin/umount",
            args: vec![directory.as_os_str().to_owned()],
        }),
        Platform::Linux => Some(invocation("gio", &["mount", "-u", &address])),
    })
}

fn command(plan: &Invocation) -> Command {
    #[cfg(windows)]
    let executable = if matches!(plan.program, "sc.exe" | "explorer.exe") {
        std::env::var_os("SystemRoot")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .map(|root| {
                if plan.program == "sc.exe" {
                    root.join("System32").join(plan.program)
                } else {
                    root.join(plan.program)
                }
            })
            .unwrap_or_else(|| PathBuf::from(plan.program))
    } else {
        PathBuf::from(plan.program)
    };
    #[cfg(not(windows))]
    let executable = PathBuf::from(plan.program);
    let mut command = Command::new(executable);
    command
        .args(&plan.args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
}

/// Helper output is bounded and never interpolated into errors (URLs carry an opaque capability).
fn run(plan: &Invocation, limit: Duration, capture: bool) -> Result<Vec<u8>, String> {
    let mut command = command(plan);
    if capture {
        command.stdout(Stdio::piped());
    }
    let mut child = command
        .spawn()
        .map_err(|_| "The operating system's WebDAV helper is unavailable.".to_owned())?;
    let reader = child.stdout.take().map(|stdout| {
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = stdout.take(16 * 1024).read_to_end(&mut bytes);
            bytes
        })
    });
    let started = Instant::now();
    let result = loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                break if status.success() {
                    Ok(())
                } else {
                    Err("The operating system could not access this WebDAV folder.".to_owned())
                }
            }
            Ok(None) if started.elapsed() < limit => std::thread::sleep(Duration::from_millis(25)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err("The operating system's WebDAV helper timed out.".to_owned());
            }
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err("The operating system's WebDAV helper failed.".to_owned());
            }
        }
    };
    let output = reader
        .and_then(|reader| reader.join().ok())
        .unwrap_or_default();
    result.map(|()| output)
}

fn webclient_running(output: &[u8]) -> bool {
    String::from_utf8_lossy(output).lines().any(|line| {
        line.split_once(':').is_some_and(|(_, state)| {
            let mut words = state.split_whitespace();
            words.next() == Some("4") && words.next().is_some()
        })
    })
}

pub(super) fn check_available() -> Result<(), String> {
    match Platform::current()? {
        Platform::Windows => {
            let output = run(&invocation("sc.exe", &["query", "WebClient"]), Duration::from_secs(5), true)
                .map_err(|_| "Live remote folders require the existing Windows WebClient service to be running. No service settings were changed.".to_owned())?;
            if !webclient_running(&output) {
                return Err("Live remote folders require the existing Windows WebClient service to be running. No service settings were changed.".into());
            }
            Ok(())
        }
        Platform::Mac => {
            if !Path::new("/sbin/mount_webdav").is_file() {
                return Err("The built-in macOS WebDAV client is unavailable.".into());
            }
            Ok(())
        }
        Platform::Linux => run(&invocation("gio", &["version"]), Duration::from_secs(5), false)
            .map(|_| ()).map_err(|_| "Live remote folders require an existing GIO/GVfs WebDAV client. No software was installed.".into()),
    }
}

struct OwnedDirectory {
    path: PathBuf,
    #[cfg(target_os = "macos")]
    device: u64,
    #[cfg(target_os = "macos")]
    inode: u64,
}

impl OwnedDirectory {
    fn create(path: &Path) -> Result<Self, String> {
        if !path.is_absolute() {
            return Err("The private mount directory must be absolute.".into());
        }
        let parent = path
            .parent()
            .ok_or("The private mount directory has no parent")?
            .canonicalize()
            .map_err(|_| "The private mount directory is unavailable")?;
        let leaf = path
            .file_name()
            .ok_or("The private mount directory has no name")?;
        let path = parent.join(leaf);
        // Exclusive creation prevents adoption or removal of an existing directory or mount.
        std::fs::create_dir(&path)
            .map_err(|_| "The private mount directory already exists or cannot be created.")?;
        #[cfg(target_os = "macos")]
        {
            use std::os::unix::fs::{MetadataExt, PermissionsExt};
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700));
            let metadata = std::fs::symlink_metadata(&path)
                .map_err(|_| "The private mount directory is unavailable")?;
            Ok(Self {
                path,
                device: metadata.dev(),
                inode: metadata.ino(),
            })
        }
        #[cfg(not(target_os = "macos"))]
        Ok(Self { path })
    }

    fn remove_if_owned(&self) {
        #[cfg(target_os = "macos")]
        {
            use std::os::unix::fs::MetadataExt;
            if let Ok(metadata) = std::fs::symlink_metadata(&self.path) {
                if metadata.file_type().is_dir()
                    && metadata.dev() == self.device
                    && metadata.ino() == self.inode
                {
                    // Only an empty, originally-created directory is removed; never recursive.
                    let _ = std::fs::remove_dir(&self.path);
                }
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn is_owned_mount(path: &Path, input: &str) -> bool {
    use std::os::unix::ffi::OsStrExt;
    let Ok(name) = std::ffi::CString::new(path.as_os_str().as_bytes()) else {
        return false;
    };
    let mut stat = std::mem::MaybeUninit::<libc::statfs>::uninit();
    // statfs writes one fixed-size structure for an existing mount point.
    if unsafe { libc::statfs(name.as_ptr(), stat.as_mut_ptr()) } != 0 {
        return false;
    }
    let stat = unsafe { stat.assume_init() };
    let bytes = |input: &[libc::c_char]| {
        input
            .iter()
            .take_while(|byte| **byte != 0)
            .map(|byte| *byte as u8)
            .collect::<Vec<_>>()
    };
    bytes(&stat.f_fstypename) == b"webdav"
        && bytes(&stat.f_mntonname) == path.as_os_str().as_bytes()
        && bytes(&stat.f_mntfromname) == input.as_bytes()
}

#[cfg(not(target_os = "macos"))]
fn is_owned_mount(_path: &Path, _input: &str) -> bool {
    false
}

pub(super) struct Mount {
    platform: Platform,
    address: String,
    directory: Option<OwnedDirectory>,
}

impl Mount {
    fn directory(&self) -> &Path {
        self.directory
            .as_ref()
            .map(|directory| directory.path.as_path())
            .unwrap_or_else(|| Path::new(""))
    }

    pub(super) fn open(&self) -> Result<(), String> {
        let plan = open_plan(self.platform, &self.address, self.directory())?;
        if self.platform == Platform::Windows {
            // Explorer is the user's long-lived shell, not a mount helper. Never timeout-kill it.
            let mut child = command(&plan)
                .spawn()
                .map_err(|_| "File Explorer could not be opened.".to_owned())?;
            std::thread::spawn(move || {
                let _ = child.wait();
            });
            Ok(())
        } else {
            run(&plan, Duration::from_secs(10), false).map(|_| ())
        }
    }

    pub(super) fn cleanup(&self) {
        if self.platform == Platform::Mac {
            if let Some(directory) = &self.directory {
                if is_owned_mount(&directory.path, &self.address) {
                    if let Ok(Some(plan)) =
                        cleanup_plan(self.platform, &self.address, &directory.path)
                    {
                        if run(&plan, Duration::from_secs(5), false).is_err() {
                            return;
                        }
                    }
                }
                directory.remove_if_owned();
            }
        } else if self.platform == Platform::Linux {
            if let Ok(Some(plan)) = cleanup_plan(self.platform, &self.address, self.directory()) {
                let _ = run(&plan, Duration::from_secs(5), false);
            }
        }
    }
}

pub(super) fn mount_and_open(input: &str, mount_dir: &Path) -> Result<Mount, String> {
    let platform = Platform::current()?;
    let address = gateway_url(input)?.to_string();
    check_available()?;
    let directory = if platform == Platform::Mac {
        Some(OwnedDirectory::create(mount_dir)?)
    } else {
        None
    };
    let mount = Mount {
        platform,
        address,
        directory,
    };
    let result = (|| {
        if let Some(plan) = mount_plan(platform, &mount.address, mount.directory())? {
            run(&plan, Duration::from_secs(15), false)?;
        }
        mount.open()
    })();
    if let Err(error) = result {
        mount.cleanup();
        return Err(error);
    }
    Ok(mount)
}

#[cfg(test)]
mod tests {
    use super::*;
    const URL: &str = "http://127.0.0.1:49123/0123456789abcdef0123456789abcdef/";

    #[test]
    fn windows_opens_unc_without_mapping_or_changing_a_service() {
        assert!(mount_plan(Platform::Windows, URL, Path::new("unused"))
            .unwrap()
            .is_none());
        let plan = open_plan(Platform::Windows, URL, Path::new("unused")).unwrap();
        assert_eq!(
            plan,
            invocation(
                "explorer.exe",
                &[r"\\127.0.0.1@49123\DavWWWRoot\0123456789abcdef0123456789abcdef"]
            )
        );
        assert!(cleanup_plan(Platform::Windows, URL, Path::new("unused"))
            .unwrap()
            .is_none());
    }

    #[test]
    fn macos_mount_is_readonly_and_noninteractive_with_exact_path_arguments() {
        let directory = Path::new("/Users/me/Application Support/bycoda/remote-live-folders/id");
        let mount = mount_plan(Platform::Mac, URL, directory).unwrap().unwrap();
        assert_eq!(mount.program, "/sbin/mount_webdav");
        assert_eq!(
            mount.args,
            [
                "-S",
                "-o",
                "rdonly,nobrowse",
                "-v",
                "bycoda Remote",
                URL,
                directory.to_str().unwrap()
            ]
            .map(OsString::from)
        );
        assert_eq!(
            cleanup_plan(Platform::Mac, URL, directory)
                .unwrap()
                .unwrap()
                .args,
            [directory.as_os_str()]
        );
    }

    #[test]
    fn linux_uses_only_the_single_owned_gio_mount() {
        let address = "dav://127.0.0.1:49123/0123456789abcdef0123456789abcdef/";
        assert_eq!(
            mount_plan(Platform::Linux, URL, Path::new("")).unwrap(),
            Some(invocation("gio", &["mount", "-a", address]))
        );
        assert_eq!(
            open_plan(Platform::Linux, URL, Path::new("")).unwrap(),
            invocation("gio", &["open", address])
        );
        assert_eq!(
            cleanup_plan(Platform::Linux, URL, Path::new("")).unwrap(),
            Some(invocation("gio", &["mount", "-u", address]))
        );
    }

    #[test]
    fn rejects_nonlocal_addresses_or_paths_outside_the_opaque_gateway_root() {
        for input in [
            "https://127.0.0.1:49123/0123456789abcdef/",
            "http://remote.example:49123/0123456789abcdef/",
            "http://127.0.0.1:49123/",
            "http://user:secret@127.0.0.1:49123/0123456789abcdef/",
            "http://127.0.0.1:49123/0123456789abcdef/subfolder/",
            "http://127.0.0.1:49123/0123456789abcdef/?x=1",
            "http://127.0.0.1:49123/0123456789abcdef/%2e%2e/",
            "http://127.0.0.1:49123/0123456789abcdef/#fragment",
        ] {
            assert!(gateway_url(input).is_err(), "{input}");
        }
    }

    #[test]
    fn service_query_requires_the_running_state_without_starting_it() {
        assert!(webclient_running(
            b"SERVICE_NAME: WebClient\r\n TYPE : 20 WIN32_SHARE_PROCESS\r\n STATE : 4 RUNNING\r\n"
        ));
        assert!(!webclient_running(
            b"SERVICE_NAME: WebClient\r\n STATE : 1 STOPPED\r\n"
        ));
        assert!(!webclient_running(b"[SC] OpenService FAILED 1060"));
    }
}
