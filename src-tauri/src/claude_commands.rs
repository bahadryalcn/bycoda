//! Read-only discovery of Claude Code's custom slash commands, for the composer
//! menu. Only the fixed `commands` folders below are read (user, project and
//! installed plugins), only `*.md` files, and only name, description and
//! argument hint ever leave this module.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::dirs_home;
use crate::fs::expand_home;
use crate::skills::{claude_plugin_skill_roots, read_prefix, unquote, yaml_value};

const MAX_COMMANDS: usize = 300;
const MAX_DEPTH: usize = 4;
const MAX_HEAD_BYTES: usize = 16 * 1024;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCommand {
    /// What follows the `/`: sub folders become `:` segments (`gsd:help`).
    pub name: String,
    pub description: String,
    pub argument_hint: String,
    /// `project`, `user` or `plugin`.
    pub scope: String,
}

/// Commands visible for `cwd`: project first, then user, then plugins. Same
/// name: the earlier one wins, as in Claude Code.
#[tauri::command(async)]
pub fn list_claude_commands(cwd: String) -> Result<Vec<ClaudeCommand>, String> {
    let project = expand_home(&cwd);
    let home = dirs_home().map(PathBuf::from);
    Ok(list_claude_commands_from(&project, home.as_deref()))
}

fn list_claude_commands_from(project: &Path, home: Option<&Path>) -> Vec<ClaudeCommand> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let mut add = |root: PathBuf, prefix: &str, scope: &str| {
        scan_dir(&root, prefix, scope, 0, &mut out, &mut seen);
    };
    add(project.join(".claude/commands"), "", "project");
    if let Some(home) = home {
        add(home.join(".claude/commands"), "", "user");
        for (skills_root, _, namespace) in claude_plugin_skill_roots(home, project) {
            if let Some(plugin) = skills_root.parent() {
                add(plugin.join("commands"), &namespace, "plugin");
            }
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

fn scan_dir(
    dir: &Path,
    prefix: &str,
    scope: &str,
    depth: usize,
    out: &mut Vec<ClaudeCommand>,
    seen: &mut HashSet<String>,
) {
    if depth > MAX_DEPTH {
        return;
    }
    let Ok(reader) = std::fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<_> = reader.flatten().collect();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        if out.len() >= MAX_COMMANDS {
            return;
        }
        // `file_type` does not follow links, so a symlink cannot lead the walk
        // out of the commands folder.
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        let path = entry.path();
        let Some(file) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if file.starts_with('.') {
            continue;
        }
        if kind.is_dir() {
            let child = if prefix.is_empty() {
                file.to_string()
            } else {
                format!("{prefix}:{file}")
            };
            scan_dir(&path, &child, scope, depth + 1, out, seen);
            continue;
        }
        let Some(stem) = kind.is_file().then(|| file.strip_suffix(".md")).flatten() else {
            continue;
        };
        let name = if prefix.is_empty() {
            stem.to_string()
        } else {
            format!("{prefix}:{stem}")
        };
        if !is_command_name(&name) || !seen.insert(name.clone()) {
            continue;
        }
        let head = read_prefix(&path, MAX_HEAD_BYTES)
            .ok()
            .and_then(|bytes| String::from_utf8(bytes).ok())
            .unwrap_or_default();
        let (description, argument_hint) = parse_command_head(&head);
        out.push(ClaudeCommand {
            name,
            description,
            argument_hint,
            scope: scope.to_string(),
        });
    }
}

/// Names the composer can type after `/`: letters, digits and `._-` per
/// segment, segments joined by `:`.
fn is_command_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 100
        && name.split(':').all(|segment| {
            !segment.is_empty()
                && segment
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
        })
}

/// Frontmatter `description` and `argument-hint`; without a description, the
/// first body line that is not a heading or blank.
fn parse_command_head(text: &str) -> (String, String) {
    let text = text.trim_start_matches('\u{feff}');
    let mut description = String::new();
    let mut hint = String::new();
    let mut body = text;
    if let Some(rest) = text.strip_prefix("---") {
        let rest = rest.trim_start_matches(['\r', '\n']);
        let end = rest.find("\n---").unwrap_or(rest.len());
        for line in rest[..end].lines() {
            let line = line.trim_end();
            if let Some(value) = yaml_value(line, "description") {
                description = unquote(&value);
            } else if let Some(value) = yaml_value(line, "argument-hint") {
                hint = unquote(&value);
            }
        }
        body = rest.get(end..).unwrap_or("");
        body = body
            .trim_start_matches(['\r', '\n'])
            .strip_prefix("---")
            .unwrap_or(body);
    }
    if description.is_empty() {
        description = body
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty() && !line.starts_with('#') && *line != "---")
            .unwrap_or("")
            .chars()
            .take(200)
            .collect();
    }
    (description, hint)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Tmp(PathBuf);
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn tmp(label: &str) -> Tmp {
        let dir = std::env::temp_dir().join(format!(
            "bycoda-claude-commands-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        Tmp(dir)
    }

    fn write(root: &Path, relative: &str, body: &str) {
        let path = root.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }

    #[test]
    fn reads_description_and_hint_from_frontmatter_or_first_line() {
        let (d, h) = parse_command_head(
            "---\ndescription: \"Fix an issue\"\nargument-hint: [issue-number]\n---\nBody",
        );
        assert_eq!((d.as_str(), h.as_str()), ("Fix an issue", "[issue-number]"));
        let (d, h) = parse_command_head("# Title\n\nDo the thing.\nMore");
        assert_eq!((d.as_str(), h.as_str()), ("Do the thing.", ""));
        let (d, _) = parse_command_head("---\nallowed-tools: Bash\n---\n\nRun it");
        assert_eq!(d, "Run it");
    }

    #[test]
    fn namespaces_sub_folders_and_prefers_project_over_user() {
        let home = tmp("home");
        let project = tmp("project");
        write(&home.0, ".claude/commands/gsd/help.md", "Show help");
        write(&home.0, ".claude/commands/ship.md", "User ship");
        write(&project.0, ".claude/commands/ship.md", "Project ship");
        write(&project.0, ".claude/commands/notes.txt", "ignored");
        write(&project.0, ".claude/commands/bad name.md", "ignored");
        write(&project.0, ".claude/commands/.hidden.md", "ignored");
        let found = list_claude_commands_from(&project.0, Some(&home.0));
        let names: Vec<_> = found.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, ["gsd:help", "ship"]);
        let ship = found.iter().find(|c| c.name == "ship").unwrap();
        assert_eq!(
            (ship.scope.as_str(), ship.description.as_str()),
            ("project", "Project ship")
        );
    }

    #[test]
    fn includes_enabled_plugin_commands_under_the_plugin_namespace() {
        let home = tmp("plugin-home");
        let project = tmp("plugin-project");
        let install = home.0.join("plugins/demo");
        write(&install, "commands/hello.md", "Say hello");
        write(
            &home.0,
            ".claude/plugins/installed_plugins.json",
            &format!(
                "{{\"plugins\":{{\"demo@market\":[{{\"scope\":\"user\",\"installPath\":{:?}}}]}}}}",
                install.to_string_lossy()
            ),
        );
        let found = list_claude_commands_from(&project.0, Some(&home.0));
        assert_eq!(found.len(), 1);
        assert_eq!(
            (found[0].name.as_str(), found[0].scope.as_str()),
            ("demo:hello", "plugin")
        );
    }

    #[test]
    fn caps_the_number_of_commands() {
        let project = tmp("cap");
        for i in 0..(MAX_COMMANDS + 20) {
            write(&project.0, &format!(".claude/commands/c{i}.md"), "x");
        }
        assert_eq!(
            list_claude_commands_from(&project.0, None).len(),
            MAX_COMMANDS
        );
    }
}
