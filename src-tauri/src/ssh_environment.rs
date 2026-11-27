//! Literal, non-secret remote environment. Never changes the local SSH environment.
use crate::{
    ssh_group_defaults::{self, LiteralEnvironment, RemoteShellKind},
    ssh_security::SshEndpoint,
    ssh_shell_integration::ShellIntegration,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};

pub(crate) fn integration_mode<'a>(
    endpoint: &SshEndpoint,
    requested: Option<&'a str>,
) -> Option<&'a str> {
    if requested == Some("auto")
        && endpoint
            .runtime_configuration
            .as_ref()
            .is_some_and(|config| config.shell_kind == Some(RemoteShellKind::Powershell))
    {
        Some("powershell")
    } else {
        requested
    }
}

pub(crate) fn prologue(
    environment: &[LiteralEnvironment],
    shell: RemoteShellKind,
) -> Result<String, String> {
    ssh_group_defaults::validate_environment(environment, Some(shell))?;
    match shell {
        RemoteShellKind::Posix => Ok(environment
            .iter()
            .map(|entry| {
                format!(
                    "export {}={}\n",
                    entry.name,
                    crate::remote_ssh::shell_quote(&entry.value)
                )
            })
            .collect()),
        RemoteShellKind::Powershell => {
            let values: std::collections::BTreeMap<_, _> = environment
                .iter()
                .map(|entry| (&entry.name, &entry.value))
                .collect();
            let data = STANDARD
                .encode(serde_json::to_vec(&values).map_err(|_| "Invalid remote environment")?);
            Ok(format!("$__bycodaEnv=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{data}'))|Microsoft.PowerShell.Utility\\ConvertFrom-Json -AsHashtable;foreach($__bycodaEntry in $__bycodaEnv.GetEnumerator()){{[Environment]::SetEnvironmentVariable([string]$__bycodaEntry.Key,[string]$__bycodaEntry.Value,'Process')}};\n"))
        }
    }
}

pub(crate) fn remote_command(
    endpoint: &SshEndpoint,
    integration: Option<&ShellIntegration>,
) -> Result<Option<String>, String> {
    let Some(configuration) = &endpoint.runtime_configuration else {
        return Ok(integration.map(ShellIntegration::remote_command));
    };
    if configuration.environment.is_empty() {
        return Ok(integration.map(ShellIntegration::remote_command));
    }
    let shell = configuration
        .shell_kind
        .ok_or("Select the remote environment shell type")?;
    if let Some(integration) = integration {
        let powershell = integration.shell_mode() == "powershell";
        if powershell != (shell == RemoteShellKind::Powershell) {
            return Err(
                "Shell integration and remote environment use different shell types".into(),
            );
        }
    }
    let prologue = prologue(&configuration.environment, shell)?;
    let command = if let Some(integration) = integration {
        integration.remote_command_with_prologue(Some(&prologue))
    } else {
        match shell {
            RemoteShellKind::Posix => format!("sh -c {}", crate::remote_ssh::shell_quote(&format!("{prologue}exec \"${{SHELL:-/bin/sh}}\" -l"))),
            RemoteShellKind::Powershell => format!("pwsh -NoLogo -NoExit -Command \"[ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{}'))).Invoke()\"", STANDARD.encode(prologue.as_bytes())),
        }
    };
    // Windows OpenSSH's default command shell has a smaller limit than the
    // metadata model. Keep margin for its command wrapper; never drop entries.
    if shell == RemoteShellKind::Powershell && command.len() >= 8000 {
        return Err("Remote environment exceeds the supported PowerShell command budget".into());
    }
    Ok(Some(command))
}

/// Start a fresh interactive shell at a literal path on the paired SSH machine.
pub(crate) fn project_command(cwd: &str) -> Result<String, String> {
    if cwd.is_empty() || cwd.len() > 4096 || cwd.chars().any(char::is_control) {
        return Err("Invalid remote terminal directory".into());
    }
    let drive = cwd.as_bytes().first().is_some_and(u8::is_ascii_alphabetic)
        && matches!(
            cwd.as_bytes().get(1..),
            Some([b':']) | Some([b':', b'/' | b'\\', ..])
        );
    if drive || cwd.starts_with("//") {
        let mut path = cwd.replace('/', "\\");
        // The remote project key drops a drive root's trailing slash.
        if path.len() == 2 {
            path.push('\\');
        }
        let literal = STANDARD.encode(path.as_bytes());
        let script = format!(
            "try {{ Set-Location -ErrorAction Stop -LiteralPath ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{literal}'))) }} catch {{ Write-Error -ErrorAction Continue $_; exit 1 }}"
        );
        // EncodedCommand is UTF-16LE. Its fixed syntax works through either CMD or PowerShell.
        let encoded = STANDARD.encode(
            script
                .encode_utf16()
                .flat_map(u16::to_le_bytes)
                .collect::<Vec<_>>(),
        );
        let command = format!("powershell.exe -NoLogo -NoExit -EncodedCommand {encoded}");
        if command.len() >= 8000 {
            return Err("Remote terminal directory exceeds the Windows command budget".into());
        }
        return Ok(command);
    }
    if !cwd.starts_with('/') {
        return Err("Expected an absolute remote terminal directory".into());
    }
    Ok(format!(
        "sh -c {}",
        crate::remote_ssh::shell_quote(&format!(
            "CDPATH= cd -- {} && exec \"${{SHELL:-/bin/sh}}\" -l",
            crate::remote_ssh::shell_quote(cwd)
        ))
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_shell_uses_a_literal_absolute_path_and_a_bounded_windows_command() {
        let windows = project_command("G:/A & B/ç's [1]").unwrap();
        let payload = windows.split_whitespace().last().unwrap();
        let bytes = STANDARD.decode(payload).unwrap();
        let script = String::from_utf16(
            &bytes
                .as_chunks::<2>()
                .0
                .iter()
                .map(|b| u16::from_le_bytes(*b))
                .collect::<Vec<_>>(),
        )
        .unwrap();
        let folder = STANDARD.encode("G:\\A & B\\ç's [1]".as_bytes());
        assert!(script.contains(&format!("FromBase64String('{folder}')")));
        assert!(script.contains("-LiteralPath"));
        assert!(project_command("//server/share")
            .unwrap()
            .starts_with("powershell.exe "));
        assert!(project_command("G:")
            .unwrap()
            .starts_with("powershell.exe "));
        assert!(project_command("/tmp/a ' $()")
            .unwrap()
            .starts_with("sh -c '"));
        assert!(project_command("relative").is_err());
        assert!(project_command("/tmp/\n").is_err());
        assert!(project_command(&format!("G:/{}", "a".repeat(5000))).is_err());
    }
    fn endpoint(shell: RemoteShellKind, value: &str) -> SshEndpoint {
        SshEndpoint {
            host: "remote.example".into(),
            port: 22,
            runtime_configuration: Some(std::sync::Arc::new(
                crate::ssh_security::RuntimeConfiguration {
                    digest: "test-configuration".into(),
                    environment: vec![LiteralEnvironment {
                        name: "APP_MESSAGE".into(),
                        value: value.into(),
                    }],
                    shell_kind: Some(shell),
                    provenance: Default::default(),
                },
            )),
            ..Default::default()
        }
    }
    #[test]
    fn posix_literals_are_quoted_and_never_assumed_to_be_shell_code() {
        let value = "$(printf injected) ' \" ; Unicode-ç";
        let script = prologue(
            &[LiteralEnvironment {
                name: "APP_MESSAGE".into(),
                value: value.into(),
            }],
            RemoteShellKind::Posix,
        )
        .unwrap();
        assert_eq!(
            script,
            format!(
                "export APP_MESSAGE={}\n",
                crate::remote_ssh::shell_quote(value)
            )
        );
        assert!(
            remote_command(&endpoint(RemoteShellKind::Posix, value), None)
                .unwrap()
                .unwrap()
                .starts_with("sh -c ")
        );
    }
    #[test]
    fn powershell_uses_literal_data_and_rejects_incompatible_or_oversized_bootstraps() {
        let target = endpoint(
            RemoteShellKind::Powershell,
            "$([Console]::Write('injected')) ' ç",
        );
        let command = remote_command(&target, None).unwrap().unwrap();
        assert!(!command.contains("injected"));
        assert!(
            remote_command(&target, Some(&ShellIntegration::for_shell("bash").unwrap())).is_err()
        );
        // Larger than the 8000-byte budget on its own, independent of the bootstrap's size.
        let large = endpoint(RemoteShellKind::Powershell, &"x".repeat(8000));
        assert!(remote_command(
            &large,
            Some(&ShellIntegration::for_shell("powershell").unwrap())
        )
        .is_err());
    }
    #[test]
    fn minimal_environment_fits_integrated_powershell_command_budget() {
        let mut target = endpoint(RemoteShellKind::Powershell, "production");
        std::sync::Arc::make_mut(target.runtime_configuration.as_mut().unwrap()).environment[0]
            .name = "APP_ENV".into();
        let integration = ShellIntegration::for_shell("powershell").unwrap();
        let command = remote_command(&target, Some(&integration))
            .unwrap()
            .unwrap();
        assert!(command.len() < 8000);
    }
    #[test]
    fn ordinary_terminals_and_empty_configuration_keep_the_existing_launch_contract() {
        let endpoint = SshEndpoint::default();
        assert_eq!(remote_command(&endpoint, None).unwrap(), None);
        let integration = ShellIntegration::for_shell("bash").unwrap();
        assert_eq!(
            remote_command(&endpoint, Some(&integration)).unwrap(),
            Some(integration.remote_command())
        );
    }
}
