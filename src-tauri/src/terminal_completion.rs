//! Local, bounded completion catalog. Never executes a suggested command or records PTY input.
use std::collections::{BTreeSet, HashMap};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const MAX_HISTORY: usize = 2000;
const MAX_BYTES: u64 = 256 * 1024;
const MAX_COMMANDS: usize = 12000;

struct Catalog {
    at: Instant,
    history_at: Instant,
    commands: Vec<String>,
    history: Vec<String>,
}
static CACHE: Mutex<Option<HashMap<String, Catalog>>> = Mutex::new(None);

pub(crate) fn safe_line(value: &str) -> bool {
    if value.is_empty() || value.len() > 2048 || value.chars().any(char::is_control) {
        return false;
    }
    let lower = value.to_ascii_lowercase();
    ![
        "password",
        "passwd",
        "token",
        "secret",
        "credential",
        "authorization",
        "api_key",
        "apikey",
        "private key",
        "://",
        ".env",
        ".ssh/",
    ]
    .iter()
    .any(|word| lower.contains(word))
        && !value
            .split_whitespace()
            .any(|word| word.contains('=') && !word.starts_with('-'))
}

pub(crate) fn suggestions(shell: &str, prefix: &str) -> Vec<String> {
    if prefix.trim().is_empty() || !safe_line(prefix) {
        return Vec::new();
    }
    let mut cache = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    let entries = cache.get_or_insert_with(HashMap::new);
    if !entries
        .get(shell)
        .is_some_and(|entry| entry.at.elapsed() < Duration::from_secs(300))
    {
        if entries.len() >= 16 {
            entries.clear();
        }
        entries.insert(shell.to_string(), load(shell));
    }
    let catalog = entries.get_mut(shell).expect("catalog was inserted");
    if catalog.history_at.elapsed() >= Duration::from_secs(20) {
        catalog.history = crate::dirs_home()
            .map(|home| history(Path::new(&home), kind(shell)))
            .unwrap_or_default();
        catalog.history_at = Instant::now();
    }
    matching(&entries[shell], prefix, kind(shell))
}

fn matching(catalog: &Catalog, prefix: &str, family: &str) -> Vec<String> {
    let query = prefix.trim_start();
    let leading = &prefix[..prefix.len() - query.len()];
    let insensitive = ["powershell", "pwsh", "cmd"].contains(&family);
    let mut seen = BTreeSet::new();
    catalog
        .history
        .iter()
        .chain(catalog.commands.iter())
        .filter(|value| value.as_str() != query)
        .filter(|value| {
            if insensitive {
                value
                    .get(..query.len())
                    .is_some_and(|start| start.eq_ignore_ascii_case(query))
            } else {
                value.starts_with(query)
            }
        })
        // Preserve exactly what the owner typed; completion appends a suffix only.
        .filter_map(|value| {
            value
                .get(query.len()..)
                .map(|suffix| format!("{leading}{query}{suffix}"))
        })
        .filter(|value| seen.insert(value.clone()))
        .take(24)
        .collect()
}

fn kind(shell: &str) -> &str {
    Path::new(shell)
        .file_stem()
        .and_then(|v| v.to_str())
        .unwrap_or(shell)
}

fn load(shell: &str) -> Catalog {
    let family = kind(shell);
    if family == "wsl" {
        return Catalog {
            at: Instant::now(),
            history_at: Instant::now(),
            commands: Vec::new(),
            history: Vec::new(),
        };
    }
    let mut commands = BTreeSet::new();
    let builtins = match family {
        "cmd" => "assoc break call cd chdir cls color copy date del dir echo endlocal erase exit for ftype goto if md mkdir mklink move path pause popd prompt pushd rd rem ren rename rmdir set setlocal shift start time title type ver verify vol",
        "powershell" | "pwsh" => "cd clear cls copy del dir echo exit foreach gc gci Get-ChildItem Get-Command Get-Content Get-Help Get-History Get-Location Get-Process Get-Service Get-Item ls mkdir move popd pushd pwd Remove-Item Select-Object Set-Location Test-Path Where-Object Write-Output",
        "bash" | "zsh" | "sh" | "fish" => "alias bg bind break builtin cd command continue declare dirs disown echo enable eval exec exit export false fc fg getopts hash help history jobs kill let local logout popd printf pushd pwd read readonly return set shift source test times trap true type typeset ulimit umask unalias unset wait",
        _ => "",
    };
    commands.extend(builtins.split_whitespace().map(str::to_string));
    commands.extend(shell_commands(shell));
    let mut paths: Vec<PathBuf> =
        std::env::split_paths(&crate::harness::gui_search_path()).collect();
    // Git Bash prepends these directories at startup; the GUI's Windows PATH does not.
    if family == "bash" && cfg!(windows) {
        if let Some(root) = Path::new(shell).parent().and_then(Path::parent) {
            paths.extend([
                root.join("usr/bin"),
                root.join("mingw64/bin"),
                root.join("bin"),
            ]);
        }
    }
    for dir in paths.into_iter().take(128) {
        let Ok(files) = std::fs::read_dir(dir) else {
            continue;
        };
        for file in files.flatten().take(20000) {
            if commands.len() >= MAX_COMMANDS {
                break;
            }
            let path = file.path();
            if !path.is_file() {
                continue;
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if !path
                    .metadata()
                    .is_ok_and(|meta| meta.permissions().mode() & 0o111 != 0)
                {
                    continue;
                }
            }
            let Some(name) = path.file_name().and_then(|v| v.to_str()) else {
                continue;
            };
            #[cfg(windows)]
            let name = {
                let ext = path
                    .extension()
                    .and_then(|v| v.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                if !["exe", "com", "cmd", "bat", "ps1"].contains(&ext.as_str()) {
                    continue;
                }
                if ext == "ps1" && !["powershell", "pwsh"].contains(&family) {
                    continue;
                }
                path.file_stem().and_then(|v| v.to_str()).unwrap_or(name)
            };
            if safe_line(name) {
                commands.insert(name.to_string());
            }
        }
    }
    let history = crate::dirs_home()
        .map(|home| history(Path::new(&home), family))
        .unwrap_or_default();
    Catalog {
        at: Instant::now(),
        history_at: Instant::now(),
        commands: commands.into_iter().collect(),
        history,
    }
}

/// Fixed enumeration programs, never user input or programmable completion hooks.
/// Profiles are skipped: discovery must not run the owner's startup tasks a second time.
fn shell_commands(shell: &str) -> Vec<String> {
    use std::process::{Command, Stdio};
    let args: &[&str] = match kind(shell) {
        "bash" => &["--noprofile", "--norc", "-c", "compgen -b"],
        "zsh" => &["-f", "-c", "print -rl -- ${(k)builtins}"],
        "powershell" | "pwsh" => &["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); Get-Command -CommandType Cmdlet,Function,Alias -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name"],
        _ => return Vec::new(),
    };
    let mut cmd = Command::new(shell);
    cmd.args(args)
        .env("PATH", crate::harness::gui_search_path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let Ok(mut child) = cmd.spawn() else {
        return Vec::new();
    };
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Vec::new();
    };
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout.take(MAX_BYTES).read_to_end(&mut bytes);
        let _ = send.send(bytes);
    });
    let bytes = receive
        .recv_timeout(Duration::from_secs(3))
        .unwrap_or_default();
    let _ = child.kill();
    let _ = child.wait();
    String::from_utf8_lossy(&bytes)
        .lines()
        .filter(|name| safe_line(name) && !name.contains(char::is_whitespace))
        .take(MAX_COMMANDS)
        .map(str::to_string)
        .collect()
}

fn history(home: &Path, family: &str) -> Vec<String> {
    let path = match family {
        "bash" => home.join(".bash_history"),
        "zsh" => home.join(".zsh_history"),
        "fish" => home.join(".local/share/fish/fish_history"),
        "powershell" | "pwsh" => {
            #[cfg(windows)]
            let root = std::env::var_os("APPDATA")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join("AppData/Roaming"));
            #[cfg(not(windows))]
            let root = home.join(".local/share");
            root.join(if cfg!(windows) {
                "Microsoft/Windows/PowerShell/PSReadLine/ConsoleHost_history.txt"
            } else {
                "powershell/PSReadLine/ConsoleHost_history.txt"
            })
        }
        _ => return Vec::new(),
    };
    let Ok(mut file) = std::fs::File::open(path) else {
        return Vec::new();
    };
    let Ok(meta) = file.metadata() else {
        return Vec::new();
    };
    let offset = meta.len().saturating_sub(MAX_BYTES);
    if file.seek(SeekFrom::Start(offset)).is_err() {
        return Vec::new();
    }
    let mut bytes = Vec::new();
    if file.take(MAX_BYTES).read_to_end(&mut bytes).is_err() {
        return Vec::new();
    }
    parse_history(&String::from_utf8_lossy(&bytes), family, offset > 0)
}

fn parse_history(raw: &str, family: &str, truncated: bool) -> Vec<String> {
    let mut seen = BTreeSet::new();
    // Discard continuation records as well as their first line. A multiline command
    // must never be flattened into an unrelated executable suggestion.
    let mut records = Vec::new();
    let mut continuing = false;
    for (index, line) in raw.lines().enumerate() {
        if index == 0 && truncated {
            continuing = line.ends_with('\\') || line.ends_with('`');
            continue;
        }
        let was_continuing = continuing;
        continuing = line.ends_with('\\')
            || (["pwsh", "powershell"].contains(&family) && line.ends_with('`'));
        if continuing || was_continuing {
            continue;
        }
        let value = if family == "zsh" && line.starts_with(": ") {
            line.split_once(';').map(|(_, value)| value).unwrap_or("")
        } else if family == "fish" {
            line.strip_prefix("- cmd: ").unwrap_or("")
        } else {
            line
        };
        if value.starts_with('#') || value.starts_with(' ') || !safe_line(value) {
            continue;
        }
        records.push(value.to_string());
    }
    records
        .into_iter()
        .rev()
        .filter(|v| seen.insert(v.clone()))
        .take(MAX_HISTORY)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn matching_prefers_history_preserves_draft_case_and_bounds_results() {
        let catalog = Catalog {
            at: Instant::now(),
            history_at: Instant::now(),
            history: vec!["Get-Process bycoda".into(), "Get-Process bycoda".into()],
            commands: vec!["Get-Process".into(), "Get-Service".into()],
        };
        assert_eq!(
            matching(&catalog, "  get-p", "pwsh"),
            ["  get-process bycoda", "  get-process"]
        );
        assert!(matching(&catalog, "get-p", "bash").is_empty());
        assert!(matching(&catalog, "K", "pwsh").is_empty());
    }
    #[test]
    fn bounded_history_reader_uses_the_selected_shell_file() {
        let root = std::env::temp_dir().join(format!(
            "bycoda-completion-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        std::fs::write(
            root.join(".bash_history"),
            "custom-tool --check\ngit status\n",
        )
        .unwrap();
        assert_eq!(
            history(&root, "bash"),
            ["git status", "custom-tool --check"]
        );
        assert!(history(&root, "zsh").is_empty());
        std::fs::remove_file(root.join(".bash_history")).unwrap();
        std::fs::remove_dir(root).unwrap();
    }

    #[test]
    fn installed_shell_command_catalog_is_real_and_never_evaluates_a_draft() {
        // Exercise profile-free enumeration on the local installed shell, not a mocked PTY.
        let Some(profile) = crate::terminal_profiles::resolve(None) else {
            return;
        };
        if ["bash", "zsh", "powershell", "pwsh"].contains(&kind(&profile.path)) {
            let names = shell_commands(&profile.path);
            assert!(
                !names.is_empty(),
                "installed shell command catalog should be readable"
            );
            assert!(names
                .iter()
                .all(|name| safe_line(name) && !name.contains(char::is_whitespace)));
        }
    }
    #[test]
    fn recent_history_is_deduplicated_and_secrets_and_continuations_are_omitted() {
        let raw = "git status\npnpm dev\ngit status\nexport API_KEY=abc\ncurl https://a:b@example.com\ngit diff \\\n--staged\n # ignored\n";
        assert_eq!(
            parse_history(raw, "bash", false),
            ["git status", "pnpm dev"]
        );
        assert_eq!(
            parse_history(": 1:0;git status\n: 2:0;pnpm test", "zsh", false),
            ["pnpm test", "git status"]
        );
        assert_eq!(
            parse_history("- cmd: git status\n  when: 2", "fish", false),
            ["git status"]
        );
        assert!(parse_history("partial\n", "bash", true).is_empty());
    }
}
