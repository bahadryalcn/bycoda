use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::dirs_home;
use crate::fs::expand_home;

const MAX_SKILLS: usize = 5_000;
const MAX_FRONTMATTER_BYTES: usize = 16 * 1024;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredSkill {
    pub name: String,
    pub description: String,
    pub path: String,
    pub scope: String,
    pub source: String,
}

struct DisabledFilter {
    normalized: HashSet<String>,
    canonical: HashSet<PathBuf>,
}

impl DisabledFilter {
    fn new(paths: Option<&[String]>) -> Option<Self> {
        let paths = paths?;
        if paths.is_empty() {
            return None;
        }
        let normalized = paths
            .iter()
            .map(|p| normalize_path_for_compare(p))
            .collect();
        let canonical = paths
            .iter()
            .filter_map(|p| std::fs::canonicalize(expand_home(p)).ok())
            .collect();
        Some(Self {
            normalized,
            canonical,
        })
    }

    fn is_disabled(&self, path: &str) -> bool {
        let normalized = normalize_path_for_compare(path);
        if self.normalized.contains(&normalized) {
            return true;
        }
        if !self.canonical.is_empty() {
            if let Ok(canon) = std::fs::canonicalize(path) {
                if self.canonical.contains(&canon) {
                    return true;
                }
            }
        }
        false
    }
}

#[cfg(windows)]
fn normalize_path_for_compare(path: &str) -> String {
    let mut s = path.replace('\\', "/");
    if let Some(stripped) = s.strip_prefix("//?/") {
        s = stripped.to_string();
    }
    while s.contains("//") {
        s = s.replace("//", "/");
    }
    s.to_lowercase()
}

#[cfg(not(windows))]
fn normalize_path_for_compare(path: &str) -> String {
    path.to_string()
}

/// Skills visible for the open project: `.agents/skills` first, then native
/// harness folders. Same name: earlier roots win.
/// Excludes disabled paths before deduplication so lower-priority enabled
/// same-name files can fall through.
#[tauri::command(async)]
pub fn list_skills(
    cwd: String,
    disabled_paths: Option<Vec<String>>,
) -> Result<Vec<DiscoveredSkill>, String> {
    // No folder: this computer's own skills only, as for a project that
    // lives on another machine.
    let project = (!cwd.trim().is_empty()).then(|| expand_home(&cwd));
    let home = dirs_home().map(PathBuf::from);
    Ok(list_skills_from(
        project.as_deref(),
        home.as_deref(),
        disabled_paths.as_deref(),
    ))
}

pub(crate) fn list_skills_from(
    project: Option<&Path>,
    home: Option<&Path>,
    disabled_paths: Option<&[String]>,
) -> Vec<DiscoveredSkill> {
    let disabled_filter = DisabledFilter::new(disabled_paths);
    let mut by_name: HashMap<String, DiscoveredSkill> = HashMap::new();
    let mut seen_roots: HashSet<PathBuf> = HashSet::new();

    let mut add_root = |root: PathBuf, scope: &str, source: &str| {
        if by_name.len() >= MAX_SKILLS {
            return;
        }
        let key = std::fs::canonicalize(&root).unwrap_or(root.clone());
        if !seen_roots.insert(key) {
            return;
        }
        for skill in scan_root(&root, scope, source) {
            if disabled_filter
                .as_ref()
                .is_some_and(|f| f.is_disabled(&skill.path))
            {
                continue;
            }
            if by_name.len() >= MAX_SKILLS {
                break;
            }
            by_name.entry(skill.name.clone()).or_insert(skill);
        }
    };

    // Highest priority first so later roots cannot replace a name.
    if let Some(project) = project {
        add_root(project.join(".agents/skills"), "project", "agents");
    }
    if let Some(home) = home {
        add_root(home.join(".agents/skills"), "user", "agents");
    }

    for (dir, source) in [
        (".claude/skills", "claude"),
        (".cursor/skills", "cursor"),
        (".codex/skills", "codex"),
        (".opencode/skills", "opencode"),
        (".pi/skills", "pi"),
        (".omp/skills", "omp"),
        (".fx/skills", "fx"),
        (".grok/skills", "grok"),
        (".hermes/skills", "hermes"),
    ] {
        if let Some(project) = project {
            add_root(project.join(dir), "project", source);
        }
        if let Some(home) = home {
            add_root(home.join(dir), "user", source);
        }
    }
    if let Some(home) = home {
        add_root(home.join(".pi/agent/skills"), "user", "pi");
        add_root(home.join(".omp/agent/skills"), "user", "omp");
        // Codex ships its own skills (imagegen, ...) in a dot folder that the
        // generic scan skips, so name it directly.
        add_root(home.join(".codex/skills/.system"), "user", "codex");
        // New-provider roots come after every pre-existing root so an
        // identically named skill can never shadow an established provider.
        let root = home.join(".gemini/antigravity/skills");
        if root.is_dir() {
            add_root(root, "user", "antigravity");
        }
        let no_project = PathBuf::new();
        for (root, scope, namespace) in
            claude_plugin_skill_roots(home, project.unwrap_or(&no_project))
        {
            add_namespaced_root(
                &mut by_name,
                root,
                scope,
                "claude",
                &namespace,
                disabled_filter.as_ref(),
            );
        }
    }

    let mut out: Vec<DiscoveredSkill> = by_name.into_values().collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

fn add_namespaced_root(
    by_name: &mut HashMap<String, DiscoveredSkill>,
    root: PathBuf,
    scope: &str,
    source: &str,
    namespace: &str,
    disabled_filter: Option<&DisabledFilter>,
) {
    if by_name.len() >= MAX_SKILLS {
        return;
    }
    for mut skill in scan_root(&root, scope, source) {
        if disabled_filter.is_some_and(|f| f.is_disabled(&skill.path)) {
            continue;
        }
        if by_name.len() >= MAX_SKILLS {
            break;
        }
        skill.name = format!("{namespace}:{}", skill.name);
        by_name.entry(skill.name.clone()).or_insert(skill);
    }
}

pub(crate) fn claude_plugin_skill_roots(
    home: &Path,
    project: &Path,
) -> Vec<(PathBuf, &'static str, String)> {
    let registry = home.join(".claude/plugins/installed_plugins.json");
    let Ok(raw) = std::fs::read_to_string(registry) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return Vec::new();
    };
    let Some(plugins) = value.get("plugins").and_then(|value| value.as_object()) else {
        return Vec::new();
    };

    let mut roots = Vec::new();
    for (plugin_id, installed) in plugins {
        if !claude_plugin_enabled(home, project, plugin_id) {
            continue;
        }
        let namespace = plugin_id
            .rsplit_once('@')
            .map(|(name, _)| name)
            .unwrap_or(plugin_id);
        if !is_valid_skill_name(namespace) {
            continue;
        }
        let entries: Vec<&serde_json::Value> = match installed.as_array() {
            Some(entries) => entries.iter().collect(),
            None if installed.is_object() => vec![installed],
            None => continue,
        };
        for entry in entries {
            let Some(install_path) = entry.get("installPath").and_then(|value| value.as_str())
            else {
                continue;
            };
            let scope = match entry.get("scope").and_then(|value| value.as_str()) {
                Some("project" | "local") => {
                    let Some(project_path) =
                        entry.get("projectPath").and_then(|value| value.as_str())
                    else {
                        continue;
                    };
                    if !path_is_within(project, &resolve_home_path(project_path, home)) {
                        continue;
                    }
                    "project"
                }
                Some("user") | None => "user",
                Some(_) => continue,
            };
            roots.push((
                resolve_home_path(install_path, home).join("skills"),
                scope,
                namespace.to_string(),
            ));
        }
    }
    roots.sort_by_key(|(_, scope, _)| if *scope == "project" { 0 } else { 1 });
    roots
}

fn resolve_home_path(raw: &str, home: &Path) -> PathBuf {
    if raw == "~" {
        return home.to_path_buf();
    }
    if let Some(rest) = raw.strip_prefix("~/") {
        return home.join(rest);
    }
    let path = PathBuf::from(raw);
    if path.is_absolute() {
        path
    } else {
        home.join(path)
    }
}

fn claude_plugin_enabled(home: &Path, project: &Path, plugin_id: &str) -> bool {
    if let Some(enabled) = managed_plugin_setting(plugin_id) {
        return enabled;
    }
    let project_root = claude_settings_project_root(project);
    for settings in [
        project_root.join(".claude/settings.local.json"),
        project_root.join(".claude/settings.json"),
        home.join(".claude/settings.json"),
    ] {
        if let Some(enabled) = plugin_setting(&settings, plugin_id) {
            return enabled;
        }
    }
    true
}

fn claude_settings_project_root(project: &Path) -> PathBuf {
    for candidate in project.ancestors() {
        let claude = candidate.join(".claude");
        if claude.join("settings.local.json").is_file() || claude.join("settings.json").is_file() {
            return candidate.to_path_buf();
        }
    }
    project.to_path_buf()
}

fn plugin_setting(path: &Path, plugin_id: &str) -> Option<bool> {
    let raw = std::fs::read_to_string(path).ok()?;
    let value = serde_json::from_str::<serde_json::Value>(&raw).ok()?;
    value.get("enabledPlugins")?.get(plugin_id)?.as_bool()
}

fn managed_plugin_setting(plugin_id: &str) -> Option<bool> {
    let root = managed_settings_root()?;
    managed_plugin_setting_from_root(&root, plugin_id)
}

fn managed_plugin_setting_from_root(root: &Path, plugin_id: &str) -> Option<bool> {
    let mut value = plugin_setting(&root.join("managed-settings.json"), plugin_id);
    let dir = root.join("managed-settings.d");
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension().and_then(|ext| ext.to_str()) == Some("json")
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| !name.starts_with('.'))
        })
        .collect();
    files.sort();
    for file in files {
        if let Some(enabled) = plugin_setting(&file, plugin_id) {
            value = Some(enabled);
        }
    }
    value
}

fn managed_settings_root() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        return Some(PathBuf::from("/Library/Application Support/ClaudeCode"));
    }
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        return Some(PathBuf::from("/etc/claude-code"));
    }
    #[cfg(target_os = "windows")]
    {
        return Some(PathBuf::from(r"C:\Program Files\ClaudeCode"));
    }
    #[allow(unreachable_code)]
    None
}

fn path_is_within(path: &Path, root: &Path) -> bool {
    let Ok(path) = std::fs::canonicalize(path) else {
        return false;
    };
    let Ok(root) = std::fs::canonicalize(root) else {
        return false;
    };
    path == root || path.starts_with(root)
}

fn scan_root(root: &Path, scope: &str, source: &str) -> Vec<DiscoveredSkill> {
    let Ok(reader) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for ent in reader.flatten() {
        let dir = ent.path();
        if !dir.is_dir() {
            continue;
        }
        let Some(folder) = dir.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if folder.starts_with('.') || folder == "skills-cursor" {
            continue;
        }
        let skill_md = skill_md_path(&dir);
        let Some(skill_md) = skill_md else { continue };
        let Ok(bytes) = read_prefix(&skill_md, MAX_FRONTMATTER_BYTES) else {
            continue;
        };
        let Ok(text) = String::from_utf8(bytes) else {
            continue;
        };
        let fallback = slug_name(folder);
        if fallback.is_empty() {
            continue;
        }
        let (name, description) = parse_frontmatter(&text, &fallback);
        if name.is_empty() {
            continue;
        }
        out.push(DiscoveredSkill {
            name,
            description,
            path: crate::fs::path_to_js(&skill_md),
            scope: scope.to_string(),
            source: source.to_string(),
        });
    }
    out
}

fn skill_md_path(dir: &Path) -> Option<PathBuf> {
    let upper = dir.join("SKILL.md");
    if upper.is_file() {
        return Some(upper);
    }
    let lower = dir.join("skill.md");
    if lower.is_file() {
        return Some(lower);
    }
    None
}

pub(crate) fn read_prefix(path: &Path, max: usize) -> std::io::Result<Vec<u8>> {
    use std::io::Read;
    let file = std::fs::File::open(path)?;
    let mut buf = Vec::with_capacity(max.min(4096));
    file.take(max as u64).read_to_end(&mut buf)?;
    Ok(buf)
}

fn parse_frontmatter(text: &str, fallback: &str) -> (String, String) {
    let trimmed = text.trim_start_matches('\u{feff}');
    let Some(rest) = trimmed.strip_prefix("---") else {
        return (fallback.to_string(), String::new());
    };
    let rest = rest.strip_prefix('\r').unwrap_or(rest);
    let rest = rest.strip_prefix('\n').unwrap_or(rest);
    let end = rest
        .find("\n---")
        .or_else(|| rest.find("\r\n---"))
        .unwrap_or(rest.len());
    let yaml = &rest[..end];

    let mut name: Option<String> = None;
    let mut description = String::new();
    let mut in_desc = false;
    let mut fold_desc = false;

    for raw in yaml.lines() {
        if in_desc {
            if is_yaml_indent(raw) {
                let piece = raw.trim();
                if piece.is_empty() {
                    continue;
                }
                if !description.is_empty() {
                    description.push(if fold_desc { ' ' } else { '\n' });
                }
                description.push_str(piece);
                continue;
            }
            in_desc = false;
        }

        let line = raw.trim_end();
        if let Some(value) = yaml_value(line, "name") {
            name = Some(unquote(&value));
        } else if let Some(value) = yaml_value(line, "description") {
            let value = value.trim();
            if is_folded_scalar(value) {
                in_desc = true;
                fold_desc = value.starts_with('>');
                description.clear();
            } else {
                description = unquote(value);
            }
        }
    }

    let folder = fallback.to_string();
    let name = name.filter(|n| is_valid_skill_name(n)).unwrap_or(folder);
    (name, description.trim().to_string())
}

pub(crate) fn yaml_value(line: &str, key: &str) -> Option<String> {
    let line = line.trim_start();
    let prefix = format!("{key}:");
    line.strip_prefix(&prefix)
        .map(|rest| rest.trim().to_string())
}

fn is_folded_scalar(value: &str) -> bool {
    value.starts_with('>') || value.starts_with('|')
}

fn is_yaml_indent(line: &str) -> bool {
    line.starts_with(' ') || line.starts_with('\t')
}

pub(crate) fn unquote(value: &str) -> String {
    let value = value.trim();
    let bytes = value.as_bytes();
    if bytes.len() >= 2 {
        let first = bytes[0];
        let last = bytes[bytes.len() - 1];
        if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
            return value[1..value.len() - 1].to_string();
        }
    }
    value.to_string()
}

fn is_valid_skill_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 64 {
        return false;
    }
    let mut prev_dash = true;
    for (i, ch) in name.chars().enumerate() {
        if ch.is_ascii_lowercase() || ch.is_ascii_digit() {
            prev_dash = false;
            continue;
        }
        if ch == '-' && i > 0 && !prev_dash {
            prev_dash = true;
            continue;
        }
        return false;
    }
    !prev_dash
}

fn slug_name(raw: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for ch in raw.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            dash = false;
        } else if !out.is_empty() && !dash {
            out.push('-');
            dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.len() > 64 {
        out.truncate(64);
        while out.ends_with('-') {
            out.pop();
        }
    }
    out
}

// ---- Copying a skill between machines -------------------------------------
// `skill_export` / `skill_import` have the same names, arguments and results as
// the host's workspace commands (host/skills.ts), so one UI call works on
// either machine.

const MAX_TRANSFER_FILES: usize = 200;
const MAX_TRANSFER_FILE_BYTES: usize = 2 * 1024 * 1024;
const MAX_TRANSFER_TOTAL_BYTES: usize = 8 * 1024 * 1024;
const MAX_TRANSFER_PATH_LEN: usize = 240;
const MAX_TRANSFER_DEPTH: usize = 16;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct SkillFile {
    /// Relative, `/`-separated.
    pub path: String,
    /// Base64 of the file's bytes.
    pub data: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct SkillBundle {
    pub name: String,
    pub files: Vec<SkillFile>,
}

/// Every regular file of one listed skill's folder. Only folders that
/// `list_skills` itself returns for this project can be read.
#[tauri::command(async)]
pub fn skill_export(path: String, cwd: String) -> Result<SkillBundle, String> {
    let project = (!cwd.trim().is_empty()).then(|| expand_home(&cwd));
    let home = dirs_home().map(PathBuf::from);
    skill_export_from(&path, project.as_deref(), home.as_deref())
}

#[tauri::command(async)]
pub fn skill_delete(path: String, cwd: String) -> Result<(), String> {
    let project = (!cwd.trim().is_empty()).then(|| expand_home(&cwd));
    let home = dirs_home().map(PathBuf::from);
    skill_delete_from(&path, project.as_deref(), home.as_deref())
}

pub(crate) fn skill_delete_from(
    path: &str,
    project: Option<&Path>,
    home: Option<&Path>,
) -> Result<(), String> {
    let requested = expand_home(path);
    let listed = list_skills_from(project, home, None)
        .into_iter()
        .find(|skill| {
            normalize_path_for_compare(&skill.path)
                == normalize_path_for_compare(&requested.to_string_lossy())
        })
        .ok_or_else(|| "That skill is not one of the skills found on this machine.".to_string())?;
    let file = Path::new(&listed.path);
    if listed.name.contains(':')
        || file.components().any(|part| {
            let name = part.as_os_str().to_string_lossy();
            name.eq_ignore_ascii_case(".system") || name.eq_ignore_ascii_case("plugins")
        })
    {
        return Err(
            "System and plugin skills are managed by their provider and cannot be deleted here."
                .into(),
        );
    }
    let dir = file.parent().ok_or("Could not find the skill folder.")?;
    let root = dir.parent().ok_or("Could not find the skills root.")?;
    let inspect = |path| {
        std::fs::symlink_metadata(path).map_err(|e| format!("Could not inspect the skill: {e}"))
    };
    // Links above the project or home folder (such as macOS's /var) are the
    // system's own layout and do not redirect a skill.
    let boundary = [project, home]
        .into_iter()
        .flatten()
        .find(|base| dir.starts_with(base) && dir != *base);
    for ancestor in dir.ancestors() {
        if boundary.is_some_and(|base| ancestor == base) {
            break;
        }
        if inspect(ancestor)?.file_type().is_symlink() {
            return Err("Linked skill folders cannot be deleted here.".into());
        }
    }
    let real_root = std::fs::canonicalize(root).map_err(|e| e.to_string())?;
    let real_dir = std::fs::canonicalize(dir).map_err(|e| e.to_string())?;
    if inspect(dir)?.file_type().is_symlink()
        || inspect(file)?.file_type().is_symlink()
        || real_dir != real_root.join(dir.file_name().ok_or("Invalid skill folder.")?)
    {
        return Err("Linked skill folders cannot be deleted here.".into());
    }
    std::fs::remove_dir_all(dir).map_err(|e| format!("Could not delete the skill: {e}"))
}

/// Writes a skill to `~/.agents/skills/<name>` and returns its SKILL.md path.
/// Fails with a `SKILL_EXISTS:` message when it is already there, unless
/// `overwrite`. Any `cwd` argument is only used to route the call.
#[tauri::command(async)]
pub fn skill_import(
    name: String,
    files: Vec<SkillFile>,
    overwrite: Option<bool>,
) -> Result<String, String> {
    let home = dirs_home()
        .map(PathBuf::from)
        .ok_or_else(|| "Could not find the home folder.".to_string())?;
    skill_import_into(&home, &name, &files, overwrite == Some(true))
}

fn same_file_for_compare(a: &Path, b: &Path) -> bool {
    let (Ok(a), Ok(b)) = (std::fs::canonicalize(a), std::fs::canonicalize(b)) else {
        return false;
    };
    normalize_path_for_compare(&a.to_string_lossy())
        == normalize_path_for_compare(&b.to_string_lossy())
}

pub(crate) fn skill_export_from(
    path: &str,
    project: Option<&Path>,
    home: Option<&Path>,
) -> Result<SkillBundle, String> {
    let requested = expand_home(path);
    let listed = list_skills_from(project, home, None)
        .into_iter()
        .find(|skill| same_file_for_compare(Path::new(&skill.path), &requested))
        .ok_or_else(|| "That skill is not one of the skills found on this machine.".to_string())?;
    if !is_valid_skill_name(&listed.name) {
        return Err(format!(
            "{} cannot be copied: plugin skills are managed by their plugin.",
            listed.name
        ));
    }
    // Resolve first so a skill folder that is itself a link is read in place.
    let dir = std::fs::canonicalize(&requested)
        .map_err(|e| format!("Could not read the skill: {e}"))?
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Could not find the skill folder.".to_string())?;
    let mut files = Vec::new();
    let mut total = 0usize;
    collect_skill_files(&dir, "", 0, &mut files, &mut total)?;
    Ok(SkillBundle {
        name: listed.name,
        files,
    })
}

fn collect_skill_files(
    dir: &Path,
    rel: &str,
    depth: usize,
    out: &mut Vec<SkillFile>,
    total: &mut usize,
) -> Result<(), String> {
    use base64::Engine as _;
    if depth > MAX_TRANSFER_DEPTH {
        return Err(format!(
            "This skill has folders nested deeper than {MAX_TRANSFER_DEPTH} levels."
        ));
    }
    let mut entries = std::fs::read_dir(dir)
        .map_err(|e| format!("Could not read the skill folder: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Could not read the skill folder: {e}"))?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let file_name = entry.file_name();
        let Some(name) = file_name.to_str() else {
            return Err(format!(
                "A file name in this skill is not valid text: {}",
                file_name.to_string_lossy()
            ));
        };
        if name == ".DS_Store" {
            continue;
        }
        let full = entry.path();
        let meta =
            std::fs::symlink_metadata(&full).map_err(|e| format!("Could not read {name}: {e}"))?;
        // Links could lead out of the skill folder; they are not copied.
        if meta.file_type().is_symlink() {
            continue;
        }
        let rel_path = if rel.is_empty() {
            name.to_string()
        } else {
            format!("{rel}/{name}")
        };
        if meta.is_dir() {
            collect_skill_files(&full, &rel_path, depth + 1, out, total)?;
        } else if meta.is_file() {
            validate_transfer_path(&rel_path)?;
            if out.len() >= MAX_TRANSFER_FILES {
                return Err(format!(
                    "This skill has more than {MAX_TRANSFER_FILES} files, which is the most that can be copied."
                ));
            }
            if meta.len() > MAX_TRANSFER_FILE_BYTES as u64 {
                return Err(too_large_file(&rel_path));
            }
            let bytes =
                std::fs::read(&full).map_err(|e| format!("Could not read {rel_path}: {e}"))?;
            if bytes.len() > MAX_TRANSFER_FILE_BYTES {
                return Err(too_large_file(&rel_path));
            }
            *total += bytes.len();
            if *total > MAX_TRANSFER_TOTAL_BYTES {
                return Err(too_large_total());
            }
            out.push(SkillFile {
                path: rel_path,
                data: base64::engine::general_purpose::STANDARD.encode(bytes),
            });
        }
    }
    Ok(())
}

fn too_large_file(path: &str) -> String {
    format!("{path} is larger than 2 MiB, which is the most one file can be when copying a skill.")
}

fn too_large_total() -> String {
    "This skill is more than 8 MiB in total, which is the most that can be copied.".to_string()
}

const WINDOWS_DEVICE_NAMES: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// A relative, `/`-separated path that stays inside the skill folder on every
/// platform (the same rules as host/skills.ts).
fn validate_transfer_path(path: &str) -> Result<(), String> {
    let bad = |why: &str| Err(format!("Cannot copy file \"{path}\": {why}."));
    if path.is_empty() || path.len() > MAX_TRANSFER_PATH_LEN {
        return bad("its path is empty or too long");
    }
    if path.starts_with('/') {
        return bad("its path is not relative");
    }
    for segment in path.split('/') {
        if segment.is_empty() || segment == "." || segment == ".." {
            return bad("its path has an empty, \".\" or \"..\" part");
        }
        if segment.len() > 255 {
            return bad("a name in its path is too long");
        }
        if segment
            .chars()
            .any(|c| c.is_control() || matches!(c, '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        {
            return bad("its name has a character that is not allowed");
        }
        if segment.ends_with('.') || segment.ends_with(' ') {
            return bad("a name in its path ends with a dot or space");
        }
        let stem = segment.split('.').next().unwrap_or("").to_ascii_uppercase();
        if WINDOWS_DEVICE_NAMES.contains(&stem.as_str()) {
            return bad("its name is reserved on Windows");
        }
    }
    Ok(())
}

pub(crate) fn skill_import_into(
    home: &Path,
    name: &str,
    files: &[SkillFile],
    overwrite: bool,
) -> Result<String, String> {
    use base64::Engine as _;
    if !is_valid_skill_name(name) {
        return Err(
            "Use a lowercase name with letters, numbers, and single hyphens (at most 64 characters)."
                .to_string(),
        );
    }
    if files.len() > MAX_TRANSFER_FILES {
        return Err(format!(
            "This skill has more than {MAX_TRANSFER_FILES} files, which is the most that can be copied."
        ));
    }
    let mut decoded: Vec<(&str, Vec<u8>)> = Vec::with_capacity(files.len());
    let mut seen = HashSet::new();
    let mut total = 0usize;
    for file in files {
        validate_transfer_path(&file.path)?;
        if !seen.insert(file.path.to_lowercase()) {
            return Err(format!("The file \"{}\" appears twice.", file.path));
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&file.data)
            .map_err(|_| format!("The file \"{}\" is not valid data.", file.path))?;
        if bytes.len() > MAX_TRANSFER_FILE_BYTES {
            return Err(too_large_file(&file.path));
        }
        total += bytes.len();
        if total > MAX_TRANSFER_TOTAL_BYTES {
            return Err(too_large_total());
        }
        decoded.push((&file.path, bytes));
    }
    let main = ["SKILL.md", "skill.md"]
        .into_iter()
        .find(|candidate| decoded.iter().any(|(path, _)| path == candidate))
        .ok_or_else(|| "A skill needs a SKILL.md file at its top level.".to_string())?;

    let root = home.join(".agents/skills");
    std::fs::create_dir_all(&root)
        .map_err(|e| format!("Could not create {}: {e}", root.display()))?;
    let dest = root.join(name);
    let exists = std::fs::symlink_metadata(&dest).is_ok();
    if exists && !overwrite {
        return Err(format!(
            "SKILL_EXISTS: A skill named {name} already exists."
        ));
    }

    // Dot-prefixed siblings are never listed as skills.
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tag = format!("{}-{stamp}", std::process::id());
    let staging = root.join(format!(".{name}.import-{tag}"));
    let write_all = || -> Result<(), String> {
        std::fs::create_dir(&staging)
            .map_err(|e| format!("Could not create {}: {e}", staging.display()))?;
        for (path, bytes) in &decoded {
            let target = staging.join(path);
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Could not create a folder for {path}: {e}"))?;
            }
            std::fs::write(&target, bytes).map_err(|e| format!("Could not write {path}: {e}"))?;
        }
        Ok(())
    };
    if let Err(error) = write_all() {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(error);
    }

    if exists {
        let old = root.join(format!(".{name}.old-{tag}"));
        if let Err(e) = std::fs::rename(&dest, &old) {
            let _ = std::fs::remove_dir_all(&staging);
            return Err(format!("Could not replace the existing skill: {e}"));
        }
        if let Err(e) = std::fs::rename(&staging, &dest) {
            let _ = std::fs::rename(&old, &dest);
            let _ = std::fs::remove_dir_all(&staging);
            return Err(format!("Could not replace the existing skill: {e}"));
        }
        let _ = std::fs::remove_dir_all(&old);
    } else if let Err(e) = std::fs::rename(&staging, &dest) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(if std::fs::symlink_metadata(&dest).is_ok() {
            format!("SKILL_EXISTS: A skill named {name} already exists.")
        } else {
            format!("Could not save the skill: {e}")
        });
    }
    Ok(crate::fs::path_to_js(&dest.join(main)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::ErrorKind;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TMP_SEQ: AtomicU64 = AtomicU64::new(0);

    struct Tmp(PathBuf);
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn tmp(label: &str) -> Tmp {
        loop {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let seq = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
            let dir = std::env::temp_dir().join(format!(
                "bycoda-skills-{label}-{}-{stamp}-{seq}",
                std::process::id()
            ));
            match std::fs::create_dir(&dir) {
                Ok(()) => return Tmp(dir),
                Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
                Err(error) => panic!("{}", error),
            }
        }
    }

    fn write_skill(root: &Path, folder: &str, body: &str) {
        let dir = root.join(folder);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("SKILL.md"), body).unwrap();
    }

    #[test]
    fn delete_skill_accepts_a_project_below_a_linked_system_folder() {
        // macOS keeps temporary and many user folders under /var -> /private/var.
        let real = tmp("delete-real-parent");
        let linked = PathBuf::from(format!("{}-link", real.0.display()));
        #[cfg(unix)]
        std::os::unix::fs::symlink(&real.0, &linked).unwrap();
        #[cfg(windows)]
        assert!(std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&linked)
            .arg(&real.0)
            .output()
            .unwrap()
            .status
            .success());
        let project = linked.join("project");
        let home = linked.join("home");
        write_skill(&project.join(".agents/skills"), "tool", "# tool");
        std::fs::create_dir_all(&home).unwrap();
        let result = skill_delete_from(
            &project
                .join(".agents/skills/tool/SKILL.md")
                .to_string_lossy(),
            Some(&project),
            Some(&home),
        );
        let removed = !project.join(".agents/skills/tool").exists();
        #[cfg(unix)]
        std::fs::remove_file(&linked).unwrap();
        #[cfg(windows)]
        std::fs::remove_dir(&linked).unwrap();
        result.unwrap();
        assert!(removed);
    }

    #[test]
    fn delete_skill_removes_supporting_files_and_preserves_other_skills() {
        let project = tmp("delete-project");
        let home = tmp("delete-home");
        let root = project.0.join(".agents/skills");
        write_skill(&root, "tool", "# tool");
        write_skill(&root, "keep", "# keep");
        write_skill(&home.0.join(".agents/skills"), "tool", "# fallback");
        std::fs::create_dir_all(root.join("tool/scripts")).unwrap();
        std::fs::write(root.join("tool/scripts/run.sh"), "support").unwrap();
        skill_delete_from(
            &root.join("tool/SKILL.md").to_string_lossy(),
            Some(&project.0),
            Some(&home.0),
        )
        .unwrap();
        assert!(!root.join("tool").exists());
        assert!(root.join("keep/SKILL.md").exists());
        assert_eq!(
            list_skills_from(Some(&project.0), Some(&home.0), None)
                .iter()
                .find(|skill| skill.name == "tool")
                .unwrap()
                .scope,
            "user"
        );
    }

    #[test]
    fn delete_skill_rejects_unlisted_and_provider_managed_paths() {
        let home = tmp("delete-protected");
        let root = home.0.join(".codex/skills/.system");
        write_skill(&root, "tool", "# system");
        std::fs::write(home.0.join("SKILL.md"), "# unrelated").unwrap();
        assert!(skill_delete_from(
            &home.0.join("SKILL.md").to_string_lossy(),
            None,
            Some(&home.0)
        )
        .is_err());
        assert!(skill_delete_from(
            &root.join("tool/SKILL.md").to_string_lossy(),
            None,
            Some(&home.0)
        )
        .unwrap_err()
        .contains("managed by their provider"));
        assert!(root.join("tool/SKILL.md").exists());
    }

    #[cfg(unix)]
    #[test]
    fn delete_skill_refuses_linked_folders_and_documents() {
        let home = tmp("delete-links");
        let outside = tmp("delete-target");
        let root = home.0.join(".agents/skills");
        std::fs::create_dir_all(&root).unwrap();
        write_skill(&outside.0, "tool", "# target");
        std::os::unix::fs::symlink(outside.0.join("tool"), root.join("tool")).unwrap();
        assert!(skill_delete_from(
            &root.join("tool/SKILL.md").to_string_lossy(),
            None,
            Some(&home.0)
        )
        .unwrap_err()
        .contains("Linked"));
        std::fs::create_dir(root.join("document-link")).unwrap();
        std::os::unix::fs::symlink(
            outside.0.join("tool/SKILL.md"),
            root.join("document-link/SKILL.md"),
        )
        .unwrap();
        assert!(skill_delete_from(
            &root.join("document-link/SKILL.md").to_string_lossy(),
            None,
            Some(&home.0)
        )
        .is_err());
        assert!(outside.0.join("tool/SKILL.md").exists());
    }

    fn write_plugin_setting(root: &Path, file: &str, plugin_id: &str, enabled: bool) {
        let dir = root.join(".claude");
        std::fs::create_dir_all(&dir).unwrap();
        let settings = serde_json::json!({
            "enabledPlugins": { plugin_id: enabled }
        });
        std::fs::write(dir.join(file), serde_json::to_vec(&settings).unwrap()).unwrap();
    }

    #[test]
    fn parse_frontmatter_reads_name_and_folded_description() {
        let (name, desc) = parse_frontmatter(
            "---\nname: review-pr\ndescription: >\n  Review pull requests.\n  Use when asked to review.\n---\n\n# hi\n",
            "fallback",
        );
        assert_eq!(name, "review-pr");
        assert_eq!(desc, "Review pull requests. Use when asked to review.");
    }

    #[test]
    fn parse_frontmatter_falls_back_to_folder_name() {
        let (name, desc) = parse_frontmatter("# no yaml\n", "create-skill");
        assert_eq!(name, "create-skill");
        assert_eq!(desc, "");
    }

    #[test]
    fn agents_skills_win_over_provider_dirs() {
        let project = tmp("proj");
        let home = tmp("home");
        write_skill(
            &project.0.join(".agents/skills"),
            "ship",
            "---\nname: ship\ndescription: Bycoda ship\n---\n",
        );
        write_skill(
            &project.0.join(".claude/skills"),
            "ship",
            "---\nname: ship\ndescription: Claude ship\n---\n",
        );
        write_skill(
            &home.0.join(".agents/skills"),
            "greet",
            "---\nname: greet\ndescription: Hello\n---\n",
        );
        write_skill(
            &project.0.join(".cursor/skills"),
            "cursor-only",
            "---\nname: cursor-only\ndescription: Cursor native\n---\n",
        );

        let skills = list_skills_from(Some(&project.0), Some(&home.0), None);
        let ship = skills.iter().find(|s| s.name == "ship").unwrap();
        assert_eq!(ship.description, "Bycoda ship");
        assert_eq!(ship.source, "agents");
        assert_eq!(ship.scope, "project");

        let greet = skills.iter().find(|s| s.name == "greet").unwrap();
        assert_eq!(greet.scope, "user");
        assert_eq!(greet.source, "agents");

        let native = skills.iter().find(|s| s.name == "cursor-only").unwrap();
        assert_eq!(native.source, "cursor");
        assert_eq!(native.scope, "project");
    }

    #[test]
    fn lists_large_catalogs_from_every_root() {
        let project = tmp("proj");
        let home = tmp("home");
        for index in 0..1_400 {
            let name = format!("shared-{index:04}");
            write_skill(
                &home.0.join(".agents/skills"),
                &name,
                &format!("---\nname: {name}\ndescription: Shared skill {index}\n---\n"),
            );
        }
        write_skill(
            &home.0.join(".codex/skills"),
            "codex-only",
            "---\nname: codex-only\ndescription: Codex native\n---\n",
        );

        let skills = list_skills_from(Some(&project.0), Some(&home.0), None);
        assert_eq!(skills.len(), 1_401);
        assert!(skills.iter().any(|s| s.name == "shared-1399"));
        let codex = skills.iter().find(|s| s.name == "codex-only").unwrap();
        assert_eq!(codex.source, "codex");
    }

    #[test]
    fn discovers_pi_project_and_user_skills() {
        let project = tmp("proj-pi");
        let home = tmp("home-pi");
        write_skill(
            &project.0.join(".pi/skills"),
            "pi-review",
            "---\nname: pi-review\ndescription: Pi project skill\n---\n",
        );
        write_skill(
            &home.0.join(".pi/agent/skills"),
            "pi-global",
            "---\nname: pi-global\ndescription: Pi user skill\n---\n",
        );

        let skills = list_skills_from(Some(&project.0), Some(&home.0), None);
        let project_skill = skills.iter().find(|s| s.name == "pi-review").unwrap();
        assert_eq!(project_skill.source, "pi");
        assert_eq!(project_skill.scope, "project");
        let user_skill = skills.iter().find(|s| s.name == "pi-global").unwrap();
        assert_eq!(user_skill.source, "pi");
        assert_eq!(user_skill.scope, "user");
    }

    #[test]
    fn discovers_fx_project_and_user_skills() {
        let project = tmp("proj-fx");
        let home = tmp("home-fx");
        write_skill(
            &project.0.join(".fx/skills"),
            "fx-review",
            "---\nname: fx-review\ndescription: fx project skill\n---\n",
        );
        write_skill(
            &home.0.join(".fx/skills"),
            "fx-global",
            "---\nname: fx-global\ndescription: fx user skill\n---\n",
        );

        let skills = list_skills_from(Some(&project.0), Some(&home.0), None);
        let project_skill = skills.iter().find(|s| s.name == "fx-review").unwrap();
        assert_eq!(project_skill.source, "fx");
        assert_eq!(project_skill.scope, "project");
        let user_skill = skills.iter().find(|s| s.name == "fx-global").unwrap();
        assert_eq!(user_skill.source, "fx");
        assert_eq!(user_skill.scope, "user");
    }

    #[test]
    fn discovers_grok_project_and_user_skills() {
        let project = tmp("proj-grok");
        let home = tmp("home-grok");
        write_skill(
            &project.0.join(".grok/skills"),
            "grok-review",
            "---\nname: grok-review\ndescription: grok project skill\n---\n",
        );
        write_skill(
            &home.0.join(".grok/skills"),
            "grok-global",
            "---\nname: grok-global\ndescription: grok user skill\n---\n",
        );

        let skills = list_skills_from(Some(&project.0), Some(&home.0), None);
        let project_skill = skills.iter().find(|s| s.name == "grok-review").unwrap();
        assert_eq!(project_skill.source, "grok");
        assert_eq!(project_skill.scope, "project");
        let user_skill = skills.iter().find(|s| s.name == "grok-global").unwrap();
        assert_eq!(user_skill.source, "grok");
        assert_eq!(user_skill.scope, "user");
    }

    #[test]
    fn discovers_hermes_project_and_user_skills() {
        let project = tmp("proj-hermes");
        let home = tmp("home-hermes");
        write_skill(
            &project.0.join(".hermes/skills"),
            "hermes-review",
            "---\nname: hermes-review\ndescription: Hermes project skill\n---\n",
        );
        write_skill(
            &home.0.join(".hermes/skills"),
            "hermes-global",
            "---\nname: hermes-global\ndescription: Hermes user skill\n---\n",
        );

        let skills = list_skills_from(Some(&project.0), Some(&home.0), None);
        let project_skill = skills.iter().find(|s| s.name == "hermes-review").unwrap();
        assert_eq!(project_skill.source, "hermes");
        assert_eq!(project_skill.scope, "project");
        let user_skill = skills.iter().find(|s| s.name == "hermes-global").unwrap();
        assert_eq!(user_skill.source, "hermes");
        assert_eq!(user_skill.scope, "user");
    }

    #[test]
    fn discovers_antigravity_user_skills() {
        let project = tmp("proj-agy");
        let home = tmp("home-agy");
        write_skill(
            &home.0.join(".gemini/antigravity/skills"),
            "agy-review",
            "---\nname: agy-review\ndescription: Antigravity user skill\n---\n",
        );
        let skills = list_skills_from(Some(&project.0), Some(&home.0), None);
        let agy = skills.iter().find(|s| s.name == "agy-review").unwrap();
        assert_eq!(agy.source, "antigravity");
        assert_eq!(agy.scope, "user");
    }

    #[test]
    fn antigravity_skills_do_not_shadow_existing_providers() {
        let project = tmp("proj-agy-shadow");
        let home = tmp("home-agy-shadow");
        for (root, desc) in [
            (home.0.join(".omp/agent/skills"), "OMP agent skill"),
            (
                home.0.join(".gemini/antigravity/skills"),
                "Antigravity user skill",
            ),
        ] {
            write_skill(
                &root,
                "shared-name",
                &format!("---\nname: shared-name\ndescription: {desc}\n---\n"),
            );
        }
        let skills = list_skills_from(Some(&project.0), Some(&home.0), None);
        let skill = skills.iter().find(|s| s.name == "shared-name").unwrap();
        assert_eq!(skill.description, "OMP agent skill");
        assert_eq!(skill.source, "omp");
    }

    #[test]
    fn discovers_installed_claude_plugin_skills() {
        let project = tmp("proj-claude-plugin");
        let home = tmp("home-claude-plugin");
        let plugin = home
            .0
            .join(".claude/plugins/cache/community/workflow-kit/1.2.3");
        write_skill(
            &plugin.join("skills"),
            "quick-plan",
            "---\nname: quick-plan\ndescription: Plan from plugin\n---\n",
        );
        write_skill(
            &home.0.join(".claude/skills"),
            "quick-plan",
            "---\nname: quick-plan\ndescription: Personal plan\n---\n",
        );
        std::fs::create_dir_all(home.0.join(".claude/plugins")).unwrap();
        std::fs::write(
            home.0.join(".claude/plugins/installed_plugins.json"),
            r#"{"version":2,"plugins":{"workflow-kit@community":[{"scope":"user","installPath":"~/.claude/plugins/cache/community/workflow-kit/1.2.3","version":"1.2.3"}]}}"#,
        )
        .unwrap();

        let skills = list_skills_from(Some(&project.0), Some(&home.0), None);
        let skill = skills
            .iter()
            .find(|skill| skill.name == "workflow-kit:quick-plan")
            .unwrap();
        assert_eq!(skill.description, "Plan from plugin");
        assert_eq!(skill.source, "claude");
        assert_eq!(skill.scope, "user");
        assert!(skill
            .path
            .ends_with("workflow-kit/1.2.3/skills/quick-plan/SKILL.md"));
        assert!(skills.iter().any(|skill| skill.name == "quick-plan"));
    }

    #[test]
    fn claude_project_plugins_only_apply_to_their_project() {
        let project = tmp("proj-claude-scoped");
        let other = tmp("other-claude-scoped");
        let home = tmp("home-claude-scoped");
        let plugin = home
            .0
            .join(".claude/plugins/cache/community/workflow-kit/2.0.0");
        write_skill(
            &plugin.join("skills"),
            "feature-delivery",
            "---\nname: feature-delivery\ndescription: Deliver feature\n---\n",
        );
        std::fs::create_dir_all(home.0.join(".claude/plugins")).unwrap();
        let registry = serde_json::json!({
            "version": 2,
            "plugins": {
                "workflow-kit@community": [{
                    "scope": "project",
                    "projectPath": project.0.to_string_lossy(),
                    "installPath": plugin.to_string_lossy(),
                    "version": "2.0.0"
                }]
            }
        });
        std::fs::write(
            home.0.join(".claude/plugins/installed_plugins.json"),
            serde_json::to_vec(&registry).unwrap(),
        )
        .unwrap();

        let nested = project.0.join("src");
        std::fs::create_dir_all(&nested).unwrap();
        let matching = list_skills_from(Some(&nested), Some(&home.0), None);
        let skill = matching
            .iter()
            .find(|skill| skill.name == "workflow-kit:feature-delivery")
            .unwrap();
        assert_eq!(skill.scope, "project");

        let unrelated = list_skills_from(Some(&other.0), Some(&home.0), None);
        assert!(!unrelated
            .iter()
            .any(|skill| skill.name == "workflow-kit:feature-delivery"));
    }

    #[test]
    fn disabled_claude_plugin_skills_are_hidden() {
        let project = tmp("proj-claude-disabled");
        let home = tmp("home-claude-disabled");
        let plugin = home
            .0
            .join(".claude/plugins/cache/community/workflow-kit/1.2.3");
        write_skill(
            &plugin.join("skills"),
            "quick-plan",
            "---\nname: quick-plan\ndescription: Plan from plugin\n---\n",
        );
        std::fs::create_dir_all(home.0.join(".claude/plugins")).unwrap();
        std::fs::write(
            home.0.join(".claude/plugins/installed_plugins.json"),
            r#"{"version":2,"plugins":{"workflow-kit@community":[{"scope":"user","installPath":"~/.claude/plugins/cache/community/workflow-kit/1.2.3","version":"1.2.3"}]}}"#,
        )
        .unwrap();
        write_plugin_setting(&home.0, "settings.json", "workflow-kit@community", false);

        let skills = list_skills_from(Some(&project.0), Some(&home.0), None);
        assert!(!skills
            .iter()
            .any(|skill| skill.name == "workflow-kit:quick-plan"));
    }

    #[test]
    fn claude_plugin_enablement_uses_local_project_user_precedence() {
        let project = tmp("proj-claude-precedence");
        let nested = project.0.join("src");
        let home = tmp("home-claude-precedence");
        std::fs::create_dir_all(&nested).unwrap();
        write_plugin_setting(&home.0, "settings.json", "workflow-kit@community", false);
        write_plugin_setting(&project.0, "settings.json", "workflow-kit@community", true);
        assert!(claude_plugin_enabled(
            &home.0,
            &nested,
            "workflow-kit@community"
        ));
        write_plugin_setting(
            &project.0,
            "settings.local.json",
            "workflow-kit@community",
            false,
        );
        assert!(!claude_plugin_enabled(
            &home.0,
            &nested,
            "workflow-kit@community"
        ));
    }

    #[test]
    fn managed_plugin_settings_apply_dropins_in_order() {
        let root = tmp("managed-settings");
        let plugin_id = "workflow-kit@community";
        let base = serde_json::json!({ "enabledPlugins": { plugin_id: true } });
        std::fs::write(
            root.0.join("managed-settings.json"),
            serde_json::to_vec(&base).unwrap(),
        )
        .unwrap();
        let dropins = root.0.join("managed-settings.d");
        std::fs::create_dir_all(&dropins).unwrap();
        let earlier = serde_json::json!({ "enabledPlugins": { plugin_id: true } });
        let later = serde_json::json!({ "enabledPlugins": { plugin_id: false } });
        std::fs::write(
            dropins.join("10-enable.json"),
            serde_json::to_vec(&earlier).unwrap(),
        )
        .unwrap();
        std::fs::write(
            dropins.join("20-disable.json"),
            serde_json::to_vec(&later).unwrap(),
        )
        .unwrap();

        assert_eq!(
            managed_plugin_setting_from_root(&root.0, plugin_id),
            Some(false)
        );
    }

    #[test]
    fn without_a_project_only_this_computers_own_skills_are_listed() {
        let project = tmp("no-project-skills-project");
        let home = tmp("no-project-skills-home");
        write_skill(
            &project.0.join(".agents/skills"),
            "in-project",
            "# in project",
        );
        write_skill(&home.0.join(".agents/skills"), "personal", "# personal");
        let skills = list_skills_from(None, Some(&home.0), None);
        let names: Vec<_> = skills.iter().map(|skill| skill.name.as_str()).collect();
        assert_eq!(names, ["personal"]);
        assert_eq!(skills[0].scope, "user");
    }

    #[test]
    fn path_is_within_fails_closed_when_either_path_is_missing() {
        let root = tmp("path-root");
        let nested = root.0.join("src");
        std::fs::create_dir_all(&nested).unwrap();
        assert!(path_is_within(&nested, &root.0));
        assert!(!path_is_within(&root.0.join("missing"), &root.0));
        assert!(!path_is_within(&nested, &root.0.join("missing")));
    }

    #[test]
    fn ignores_unregistered_claude_plugin_cache_versions() {
        let project = tmp("proj-claude-stale");
        let home = tmp("home-claude-stale");
        let stale = home
            .0
            .join(".claude/plugins/cache/community/workflow-kit/0.9.0");
        write_skill(
            &stale.join("skills"),
            "stale-skill",
            "---\nname: stale-skill\ndescription: Old cached skill\n---\n",
        );
        std::fs::create_dir_all(home.0.join(".claude/plugins")).unwrap();
        std::fs::write(
            home.0.join(".claude/plugins/installed_plugins.json"),
            r#"{"version":2,"plugins":{}}"#,
        )
        .unwrap();

        let skills = list_skills_from(Some(&project.0), Some(&home.0), None);
        assert!(!skills.iter().any(|skill| skill.name == "stale-skill"));
    }

    #[test]
    fn skips_dirs_without_skill_md() {
        let project = tmp("empty");
        std::fs::create_dir_all(project.0.join(".agents/skills/nope")).unwrap();
        let skills = list_skills_from(Some(&project.0), None, None);
        assert!(skills.is_empty());
    }
    #[test]
    fn disabled_project_skill_falls_back_to_same_name_personal_skill() {
        let project = tmp("proj-fallback");
        let home = tmp("home-fallback");
        write_skill(
            &project.0.join(".agents/skills"),
            "review",
            "---\nname: review\ndescription: Project review\n---\n",
        );
        write_skill(
            &home.0.join(".agents/skills"),
            "review",
            "---\nname: review\ndescription: Personal review\n---\n",
        );

        let project_skill_path =
            crate::fs::path_to_js(&project.0.join(".agents/skills/review/SKILL.md"));
        let personal_skill_path =
            crate::fs::path_to_js(&home.0.join(".agents/skills/review/SKILL.md"));

        // 1. When neither is disabled, project skill wins.
        let enabled_skills = list_skills_from(Some(&project.0), Some(&home.0), None);
        let review = enabled_skills.iter().find(|s| s.name == "review").unwrap();
        assert_eq!(review.description, "Project review");
        assert_eq!(review.path, project_skill_path);
        assert_eq!(review.scope, "project");

        // 2. When only project skill is disabled, personal skill is active fallback.
        let fallback_skills = list_skills_from(
            Some(&project.0),
            Some(&home.0),
            Some(std::slice::from_ref(&project_skill_path)),
        );
        let review = fallback_skills.iter().find(|s| s.name == "review").unwrap();
        assert_eq!(review.description, "Personal review");
        assert_eq!(review.path, personal_skill_path);
        assert_eq!(review.scope, "user");

        // 3. When project skill is re-enabled, project skill wins again.
        let restored_skills = list_skills_from(Some(&project.0), Some(&home.0), Some(&[]));
        let review = restored_skills.iter().find(|s| s.name == "review").unwrap();
        assert_eq!(review.description, "Project review");
        assert_eq!(review.path, project_skill_path);

        // 4. When both are disabled, skill is omitted from catalog.
        let none_skills = list_skills_from(
            Some(&project.0),
            Some(&home.0),
            Some(&[project_skill_path.clone(), personal_skill_path.clone()]),
        );
        assert!(none_skills.iter().all(|s| s.name != "review"));

        // 5. When lower-priority personal skill is disabled, project winner is unaffected.
        let winner_skills = list_skills_from(
            Some(&project.0),
            Some(&home.0),
            Some(std::slice::from_ref(&personal_skill_path)),
        );
        let review = winner_skills.iter().find(|s| s.name == "review").unwrap();
        assert_eq!(review.description, "Project review");
        assert_eq!(review.path, project_skill_path);
    }

    #[cfg(windows)]
    #[test]
    fn disabled_skill_matching_handles_windows_separators_and_case() {
        let project = tmp("proj-sep");
        let home = tmp("home-sep");
        write_skill(
            &project.0.join(".agents/skills"),
            "fmt",
            "---\nname: fmt\ndescription: Project fmt\n---\n",
        );
        write_skill(
            &home.0.join(".agents/skills"),
            "fmt",
            "---\nname: fmt\ndescription: Personal fmt\n---\n",
        );

        // Windows: verify both backslash separator handling and case-insensitivity
        let raw_project_path = project
            .0
            .join(".agents/skills/fmt/SKILL.md")
            .to_string_lossy()
            .replace('/', "\\")
            .to_uppercase();
        let skills = list_skills_from(Some(&project.0), Some(&home.0), Some(&[raw_project_path]));
        let fmt = skills.iter().find(|s| s.name == "fmt").unwrap();
        assert_eq!(fmt.description, "Personal fmt");
        assert_eq!(fmt.scope, "user");
    }

    #[cfg(unix)]
    #[test]
    fn disabled_skill_matching_preserves_distinct_unix_paths_with_backslashes() {
        let project = tmp("proj-unix-bs");
        let skill_with_bs_dir = project.0.join(".agents/skills/a\\b");
        write_skill(
            skill_with_bs_dir.parent().unwrap(),
            "a\\b",
            "---\nname: slash-skill\ndescription: Slash skill\n---\n",
        );
        let nested_file = project.0.join(".agents/skills/a/b/SKILL.md");
        std::fs::create_dir_all(nested_file.parent().unwrap()).unwrap();
        std::fs::write(
            &nested_file,
            "---\nname: nested-skill\ndescription: Nested\n---\n",
        )
        .unwrap();

        assert!(skill_with_bs_dir.join("SKILL.md").exists());
        assert!(nested_file.exists());

        let nested_path = crate::fs::path_to_js(&nested_file);
        let skills = list_skills_from(Some(&project.0), None, Some(&[nested_path]));
        let slash_skill = skills.iter().find(|s| s.name == "slash-skill");
        assert!(
            slash_skill.is_some(),
            "distinct backslash path on Unix must not be disabled by colliding slash path"
        );
    }

    #[test]
    fn lists_codex_system_skills_from_the_hidden_folder() {
        let project = tmp("codex-proj");
        let home = tmp("codex-home");
        write_skill(
            &home.0.join(".codex/skills/.system"),
            "imagegen",
            "---
name: imagegen
description: Make images
---
",
        );
        let skills = list_skills_from(Some(&project.0), Some(&home.0), None);
        let imagegen = skills
            .iter()
            .find(|skill| skill.name == "imagegen")
            .unwrap();
        assert_eq!(
            (imagegen.source.as_str(), imagegen.scope.as_str()),
            ("codex", "user")
        );
    }

    fn b64(bytes: &[u8]) -> String {
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes)
    }

    fn file(path: &str, bytes: &[u8]) -> SkillFile {
        SkillFile {
            path: path.to_string(),
            data: b64(bytes),
        }
    }

    fn skill_md_in(home: &Path, folder: &str) -> String {
        crate::fs::path_to_js(&home.join(".agents/skills").join(folder).join("SKILL.md"))
    }

    #[test]
    fn export_returns_every_file_with_relative_paths() {
        let project = tmp("exp-proj");
        let home = tmp("exp-home");
        let root = home.0.join(".agents/skills");
        write_skill(&root, "tool", "---\nname: tool\n---\nbody");
        std::fs::create_dir_all(root.join("tool/scripts/deep")).unwrap();
        std::fs::write(root.join("tool/scripts/run.sh"), b"echo hi").unwrap();
        std::fs::write(root.join("tool/scripts/deep/data.bin"), [0u8, 255, 7]).unwrap();
        std::fs::write(root.join("tool/.DS_Store"), b"junk").unwrap();

        let bundle = skill_export_from(
            &skill_md_in(&home.0, "tool"),
            Some(&project.0),
            Some(&home.0),
        )
        .unwrap();
        assert_eq!(bundle.name, "tool");
        let paths: Vec<_> = bundle.files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(
            paths,
            ["SKILL.md", "scripts/deep/data.bin", "scripts/run.sh"]
        );
        let data = bundle
            .files
            .iter()
            .find(|f| f.path.ends_with("data.bin"))
            .unwrap();
        assert_eq!(data.data, b64(&[0u8, 255, 7]));
    }

    #[test]
    fn export_refuses_paths_that_are_not_listed_skills() {
        let project = tmp("exp-ref-proj");
        let home = tmp("exp-ref-home");
        std::fs::write(home.0.join("secret.md"), "x").unwrap();
        let stray = project.0.join("notes");
        write_skill(&stray, "idea", "# idea");
        for path in [
            crate::fs::path_to_js(&home.0.join("secret.md")),
            crate::fs::path_to_js(&stray.join("idea/SKILL.md")),
        ] {
            let error = skill_export_from(&path, Some(&project.0), Some(&home.0)).unwrap_err();
            assert!(error.contains("not one of the skills"), "{error}");
        }
    }

    #[test]
    fn export_without_a_project_covers_personal_skills_only() {
        let project = tmp("exp-nop-proj");
        let home = tmp("exp-nop-home");
        write_skill(&home.0.join(".agents/skills"), "mine", "# mine");
        write_skill(&project.0.join(".agents/skills"), "theirs", "# theirs");
        let mine = skill_md_in(&home.0, "mine");
        assert_eq!(
            skill_export_from(&mine, None, Some(&home.0)).unwrap().name,
            "mine"
        );
        let theirs = skill_md_in(&project.0, "theirs");
        let error = skill_export_from(&theirs, None, Some(&home.0)).unwrap_err();
        assert!(error.contains("not one of the skills"), "{error}");
        assert!(skill_export_from(&theirs, Some(&project.0), Some(&home.0)).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn export_does_not_follow_links_out_of_the_skill_folder() {
        let project = tmp("exp-link-proj");
        let home = tmp("exp-link-home");
        let outside = tmp("exp-link-outside");
        std::fs::write(outside.0.join("secret.txt"), "secret").unwrap();
        let root = home.0.join(".agents/skills");
        write_skill(&root, "linked", "# linked");
        std::os::unix::fs::symlink(outside.0.join("secret.txt"), root.join("linked/leak.txt"))
            .unwrap();
        std::os::unix::fs::symlink(&outside.0, root.join("linked/dir")).unwrap();
        let bundle = skill_export_from(
            &skill_md_in(&home.0, "linked"),
            Some(&project.0),
            Some(&home.0),
        )
        .unwrap();
        let paths: Vec<_> = bundle.files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, ["SKILL.md"]);
    }

    #[test]
    fn export_enforces_count_and_size_limits() {
        let project = tmp("exp-lim-proj");
        let home = tmp("exp-lim-home");
        let root = home.0.join(".agents/skills");
        let export = |folder: &str| {
            skill_export_from(
                &skill_md_in(&home.0, folder),
                Some(&project.0),
                Some(&home.0),
            )
        };

        write_skill(&root, "many", "# many");
        for i in 0..200 {
            std::fs::write(root.join(format!("many/f{i:03}.txt")), "x").unwrap();
        }
        assert!(export("many").unwrap_err().contains("more than 200 files"));

        write_skill(&root, "big", "# big");
        std::fs::write(root.join("big/blob.bin"), vec![1u8; 2 * 1024 * 1024 + 1]).unwrap();
        assert!(export("big").unwrap_err().contains("larger than 2 MiB"));

        write_skill(&root, "huge", "# huge");
        for i in 0..5 {
            std::fs::write(
                root.join(format!("huge/p{i}.bin")),
                vec![1u8; 2 * 1024 * 1024],
            )
            .unwrap();
        }
        assert!(export("huge").unwrap_err().contains("8 MiB in total"));
    }

    #[test]
    fn import_writes_under_the_personal_agents_folder_and_round_trips() {
        let project = tmp("imp-proj");
        let source = tmp("imp-src");
        let target = tmp("imp-dst");
        let root = source.0.join(".agents/skills");
        write_skill(&root, "tool", "---\nname: tool\n---\nbody");
        std::fs::create_dir_all(root.join("tool/refs")).unwrap();
        let blob: Vec<u8> = (0..=255u8).collect();
        std::fs::write(root.join("tool/refs/blob.bin"), &blob).unwrap();
        let bundle = skill_export_from(
            &skill_md_in(&source.0, "tool"),
            Some(&project.0),
            Some(&source.0),
        )
        .unwrap();

        let written = skill_import_into(&target.0, &bundle.name, &bundle.files, false).unwrap();
        assert_eq!(written, skill_md_in(&target.0, "tool"));
        let dest = target.0.join(".agents/skills/tool");
        assert_eq!(std::fs::read(dest.join("refs/blob.bin")).unwrap(), blob);
        assert_eq!(
            std::fs::read_to_string(dest.join("SKILL.md")).unwrap(),
            "---\nname: tool\n---\nbody"
        );
        let listed = list_skills_from(None, Some(&target.0), None);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].path, written);
    }

    #[test]
    fn import_rejects_bad_names_paths_and_missing_skill_md() {
        let home = tmp("imp-bad");
        let ok = file("SKILL.md", b"# x");
        let import =
            |name: &str, files: &[SkillFile]| skill_import_into(&home.0, name, files, false);
        for name in ["", "Bad", "a--b", "-a", "a/b", "..", &"a".repeat(65)] {
            assert!(
                import(name, std::slice::from_ref(&ok)).is_err(),
                "name {name:?}"
            );
        }
        for path in [
            "../evil.md",
            "a/../../evil.md",
            "/abs.md",
            "C:/abs.md",
            "C:evil.md",
            "a//b.md",
            "./a.md",
            "a\\b.md",
            "nul\0.md",
            "",
            "a/",
            "CON.txt",
        ] {
            let result = import("tool", &[ok.clone(), file(path, b"x")]);
            assert!(result.is_err(), "path {path:?}");
        }
        assert!(import("tool", &[file("docs/SKILL.md", b"x")])
            .unwrap_err()
            .contains("top level"));
        let dup = import(
            "tool",
            &[ok.clone(), file("a.md", b"1"), file("A.md", b"2")],
        );
        assert!(dup.is_err());
        let invalid = SkillFile {
            path: "SKILL.md".into(),
            data: "***".into(),
        };
        assert!(import("tool", &[invalid]).is_err());
        assert!(!home.0.join(".agents/skills/tool").exists());
        assert!(!home.0.join("evil.md").exists());
    }

    #[test]
    fn import_enforces_limits_on_decoded_bytes() {
        let home = tmp("imp-lim");
        let ok = file("SKILL.md", b"# x");
        let mut many = vec![ok.clone()];
        many.extend((0..200).map(|i| file(&format!("f{i}.txt"), b"x")));
        assert!(skill_import_into(&home.0, "tool", &many, false)
            .unwrap_err()
            .contains("more than 200 files"));
        let big = file("blob.bin", &vec![1u8; 2 * 1024 * 1024 + 1]);
        assert!(
            skill_import_into(&home.0, "tool", &[ok.clone(), big], false)
                .unwrap_err()
                .contains("2 MiB")
        );
        let mut all = vec![ok];
        all.extend((0..5).map(|i| file(&format!("p{i}.bin"), &vec![1u8; 2 * 1024 * 1024])));
        assert!(skill_import_into(&home.0, "tool", &all, false)
            .unwrap_err()
            .contains("8 MiB in total"));
    }

    #[test]
    fn import_refuses_an_existing_skill_unless_overwriting_and_swaps_cleanly() {
        let home = tmp("imp-over");
        let first = [file("SKILL.md", b"# one"), file("old.txt", b"old")];
        skill_import_into(&home.0, "tool", &first, false).unwrap();

        let second = [file("SKILL.md", b"# two"), file("new.txt", b"new")];
        let error = skill_import_into(&home.0, "tool", &second, false).unwrap_err();
        assert!(error.starts_with("SKILL_EXISTS:"), "{error}");
        let dest = home.0.join(".agents/skills/tool");
        assert_eq!(
            std::fs::read_to_string(dest.join("SKILL.md")).unwrap(),
            "# one"
        );

        skill_import_into(&home.0, "tool", &second, true).unwrap();
        assert_eq!(
            std::fs::read_to_string(dest.join("SKILL.md")).unwrap(),
            "# two"
        );
        assert!(dest.join("new.txt").exists());
        assert!(!dest.join("old.txt").exists());
        let leftovers: Vec<_> = std::fs::read_dir(home.0.join(".agents/skills"))
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(leftovers, ["tool"]);
    }

    #[test]
    fn a_failed_import_leaves_the_existing_skill_untouched() {
        let home = tmp("imp-fail");
        skill_import_into(&home.0, "tool", &[file("SKILL.md", b"# one")], false).unwrap();
        // A file and a folder with the same name cannot both be written.
        let broken = [
            file("SKILL.md", b"# two"),
            file("a", b"file"),
            file("a/b.txt", b"nested"),
        ];
        assert!(skill_import_into(&home.0, "tool", &broken, true).is_err());
        let dest = home.0.join(".agents/skills/tool");
        assert_eq!(
            std::fs::read_to_string(dest.join("SKILL.md")).unwrap(),
            "# one"
        );
        let entries = std::fs::read_dir(home.0.join(".agents/skills"))
            .unwrap()
            .count();
        assert_eq!(entries, 1);
    }
}
