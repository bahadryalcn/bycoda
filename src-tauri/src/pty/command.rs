use super::LaunchShell;
use crate::terminal_profiles::ShellProfile;

/// Dedicated IPC prevents older native builds from ignoring one-shot arguments.
#[tauri::command(async)]
pub fn pty_spawn_command(
    app: tauri::AppHandle,
    window: tauri::Window,
    host: tauri::State<'_, super::PtyHost>,
    id: String,
    cwd: String,
    cols: u16,
    rows: u16,
    profile: String,
    command: String,
    shell_kind: String,
) -> Result<(), String> {
    super::pty_spawn(
        app,
        window,
        host,
        id,
        cwd,
        cols,
        rows,
        Some(profile),
        Some(command),
        Some(shell_kind),
    )
}

/// Bounded reader acknowledgement: child exit alone does not prove output drain.
pub(super) fn await_drain(one_shot: bool, drain: std::sync::mpsc::Receiver<bool>) -> Option<bool> {
    one_shot.then(|| {
        drain
            .recv_timeout(std::time::Duration::from_secs(3))
            .unwrap_or(false)
    })
}

/// One-shot PTYs require an exact catalog profile, never a default-shell fallback.
pub(super) fn launch(
    profile_id: Option<&str>,
    command: Option<&str>,
    shell_kind: Option<&str>,
) -> Result<Option<LaunchShell>, String> {
    let Some(command) = command else {
        return if shell_kind.is_some() {
            Err("A command is required for a command terminal.".into())
        } else {
            Ok(None)
        };
    };
    let profile_id = profile_id.ok_or("An explicit command terminal profile is required.")?;
    let profile = crate::terminal_profiles::resolve(Some(profile_id))
        .filter(|profile| profile.id == profile_id)
        .ok_or("The command terminal profile is unavailable.")?;
    let args = command_args(&profile, command, shell_kind)?;
    Ok(Some((
        profile.path.clone(),
        args,
        crate::terminal_profiles::profile_env(&profile),
    )))
}

fn command_args(
    profile: &ShellProfile,
    command: &str,
    shell_kind: Option<&str>,
) -> Result<Vec<String>, String> {
    if command.trim().is_empty() || command.chars().count() > 10_000 || command.contains('\0') {
        return Err("Invalid terminal command.".into());
    }
    let args: Vec<&str> = match (shell_kind, profile.kind.as_str()) {
        (Some("powershell"), "pwsh" | "powershell") => {
            vec!["-NoLogo", "-NoProfile", "-Command", command]
        }
        (Some("posix"), "bash" | "zsh" | "sh") => vec!["-c", command],
        (Some("cmd"), "cmd") => {
            return Err("Command Prompt command terminals are not supported.".into())
        }
        _ => return Err("The terminal profile does not support this command language.".into()),
    };
    Ok(args.into_iter().map(str::to_owned).collect())
}

#[cfg(test)]
#[path = "command_tests.rs"]
mod tests;
