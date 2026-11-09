//! What a terminal is running. Windows has no terminal foreground process group: a
//! command the shell runs is a descendant of the shell process, so the shallowest
//! descendant that is not a console host, nested shell or prompt helper is the work.

#[cfg(windows)]
use std::collections::HashMap;

use serde::Serialize;
#[cfg(windows)]
use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
#[cfg(windows)]
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PtyStatus {
    pub(super) foreground: Option<String>,
    /// False where no foreground process can be named, so callers stop polling.
    pub(super) supported: bool,
}

/// Unsupported when the process table cannot be read, so callers cannot treat it as idle.
#[cfg(windows)]
pub(super) fn windows_status(shell_pid: u32) -> PtyStatus {
    match snapshot() {
        Ok(processes) => PtyStatus {
            foreground: running_child(shell_pid, &processes),
            supported: true,
        },
        Err(()) => PtyStatus {
            foreground: None,
            supported: false,
        },
    }
}

#[cfg(windows)]
fn snapshot() -> Result<Vec<(u32, u32, String)>, ()> {
    // SAFETY: the snapshot handle is checked and closed below; the entry carries its size.
    unsafe {
        let handle = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if handle == INVALID_HANDLE_VALUE {
            return Err(());
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut processes = Vec::new();
        let mut ok = Process32FirstW(handle, &mut entry) != 0;
        while ok {
            let len = entry
                .szExeFile
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(entry.szExeFile.len());
            let name = String::from_utf16_lossy(&entry.szExeFile[..len]);
            processes.push((entry.th32ProcessID, entry.th32ParentProcessID, name));
            ok = Process32NextW(handle, &mut entry) != 0;
        }
        CloseHandle(handle);
        Ok(processes)
    }
}

/// Breadth-first over the shell's descendants.
#[cfg(windows)]
fn running_child(shell_pid: u32, processes: &[(u32, u32, String)]) -> Option<String> {
    let mut children: HashMap<u32, Vec<(u32, &str)>> = HashMap::new();
    for (pid, parent, name) in processes {
        if pid != parent {
            children.entry(*parent).or_default().push((*pid, name));
        }
    }
    let mut level = vec![shell_pid];
    // Depth cap guards against a cycle in a stale snapshot.
    for _ in 0..8 {
        let mut next = Vec::new();
        for pid in level {
            for (child, name) in children.get(&pid).into_iter().flatten() {
                let label = name.strip_suffix(".exe").unwrap_or(name);
                match classify(label) {
                    Kind::Work => return Some(label.to_string()),
                    Kind::Shell => next.push(*child),
                    Kind::Helper => {}
                }
            }
        }
        if next.is_empty() {
            return None;
        }
        level = next;
    }
    None
}

#[cfg(windows)]
enum Kind {
    Work,
    /// A nested shell: look at what it runs.
    Shell,
    /// Console hosts and prompt renderers that run around every idle prompt.
    Helper,
}

#[cfg(windows)]
fn classify(label: &str) -> Kind {
    match label.to_ascii_lowercase().as_str() {
        "conhost" | "openconsole" | "oh-my-posh" | "starship" | "git-prompt" => Kind::Helper,
        "cmd" | "powershell" | "pwsh" | "bash" | "sh" | "zsh" | "fish" | "nu" | "wsl"
        | "wslhost" => Kind::Shell,
        _ => Kind::Work,
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::running_child;

    fn table(rows: &[(u32, u32, &str)]) -> Vec<(u32, u32, String)> {
        rows.iter()
            .map(|(pid, parent, name)| (*pid, *parent, name.to_string()))
            .collect()
    }

    #[test]
    fn idle_shell_with_console_host_has_no_work() {
        let processes = table(&[(10, 1, "pwsh.exe"), (11, 10, "conhost.exe")]);
        assert_eq!(running_child(10, &processes), None);
    }

    #[test]
    fn names_the_command_the_shell_runs() {
        let processes = table(&[
            (10, 1, "pwsh.exe"),
            (11, 10, "conhost.exe"),
            (12, 10, "node.exe"),
            (13, 12, "esbuild.exe"),
        ]);
        assert_eq!(running_child(10, &processes), Some("node".into()));
    }

    #[test]
    fn looks_through_nested_shells_and_prompt_helpers() {
        let processes = table(&[
            (10, 1, "cmd.exe"),
            (11, 10, "pwsh.exe"),
            (12, 11, "oh-my-posh.exe"),
            (13, 11, "cargo.exe"),
        ]);
        assert_eq!(running_child(10, &processes), Some("cargo".into()));
        let idle = table(&[(10, 1, "cmd.exe"), (11, 10, "pwsh.exe")]);
        assert_eq!(running_child(10, &idle), None);
    }
}
