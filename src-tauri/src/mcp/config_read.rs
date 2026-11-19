//! Discovery reads of MCP configuration files: a missing file is "not configured",
//! an unusable one is an error the caller reports, and an unchanged file is parsed once.
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex, PoisonError};
use std::time::{Duration, SystemTime};

use serde_json::{Map, Value};

/// A file modified this recently is read again: its writer may still be rewriting it,
/// and a coarse timestamp cannot tell two same-size writes apart.
const SETTLE: Duration = Duration::from_secs(2);
const MAX_CACHED: usize = 32;

type Parsed = Result<Arc<Value>, String>;
/// Keeps only what discovery needs from a large file before it is cached.
pub(super) type Reduce = fn(Value) -> Value;

struct Cached {
    modified: SystemTime,
    len: u64,
    parsed: Parsed,
}

static CACHE: LazyLock<Mutex<HashMap<(PathBuf, bool), Cached>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// `Ok(None)` means the file does not exist. `Err` carries a reason that never
/// includes file content, so it is safe to show next to the path.
pub(super) fn read_json(path: &Path, reduce: Option<Reduce>) -> Result<Option<Arc<Value>>, String> {
    let metadata = match std::fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let key = (path.to_path_buf(), reduce.is_some());
    let stamp = metadata.modified().ok().map(|modified| (modified, metadata.len()));
    if let Some((modified, len)) = stamp {
        let cache = CACHE.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(hit) = cache
            .get(&key)
            .filter(|hit| hit.modified == modified && hit.len == len)
        {
            return hit.parsed.clone().map(Some);
        }
    }
    let parsed = parse(path, reduce);
    if let Some((modified, len)) = stamp {
        let settled = SystemTime::now()
            .duration_since(modified)
            .is_ok_and(|age| age >= SETTLE);
        if settled {
            let mut cache = CACHE.lock().unwrap_or_else(PoisonError::into_inner);
            if cache.len() >= MAX_CACHED && !cache.contains_key(&key) {
                cache.clear();
            }
            cache.insert(
                key,
                Cached {
                    modified,
                    len,
                    parsed: parsed.clone(),
                },
            );
        }
    }
    parsed.map(Some)
}

fn parse(path: &Path, reduce: Option<Reduce>) -> Parsed {
    let raw = std::fs::read_to_string(path).map_err(|error| error.to_string())?;
    if raw.trim().is_empty() {
        return Err("The file is empty".into());
    }
    // serde_json syntax errors name a line and column, never the text itself.
    let value: Value = serde_json::from_str(&raw)
        .or_else(|_| serde_json::from_str(&super::strip_jsonc(&raw)))
        .map_err(|error| format!("Invalid JSON ({error})"))?;
    if !value.is_object() {
        return Err("The top level must be a JSON object".into());
    }
    Ok(Arc::new(match reduce {
        Some(reduce) => reduce(value),
        None => value,
    }))
}

/// `~/.claude.json` also holds every project's history and can be many megabytes;
/// discovery reads only the server lists and the per-project opt-outs.
pub(super) fn claude_view(mut root: Value) -> Value {
    let mut view = Map::new();
    if let Some(servers) = root.get_mut("mcpServers") {
        view.insert("mcpServers".into(), servers.take());
    }
    if let Some(projects) = root.get_mut("projects") {
        let projects = match projects.take() {
            Value::Object(entries) => Value::Object(
                entries
                    .into_iter()
                    .map(|(key, mut entry)| {
                        let mut kept = Map::new();
                        for field in ["mcpServers", "disabledMcpServers"] {
                            if let Some(value) = entry.get_mut(field) {
                                kept.insert(field.into(), value.take());
                            }
                        }
                        (key, Value::Object(kept))
                    })
                    .collect(),
            ),
            // A malformed `projects` stays visible so project lookups still report it.
            other => other,
        };
        view.insert("projects".into(), projects);
    }
    Value::Object(view)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_file(name: &str, content: &str) -> (PathBuf, PathBuf) {
        let directory = std::env::temp_dir().join(format!("bycoda-mcp-read-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join(name);
        std::fs::write(&path, content).unwrap();
        (directory, path)
    }

    #[test]
    fn distinguishes_missing_empty_malformed_and_valid_files() {
        let (directory, path) = temp_file("config.json", r#"{"mcpServers":{}}"#);
        assert!(read_json(&path, None).unwrap().is_some());
        assert!(read_json(&directory.join("absent.json"), None)
            .unwrap()
            .is_none());
        std::fs::write(&path, "  \n").unwrap();
        assert_eq!(read_json(&path, None).unwrap_err(), "The file is empty");
        std::fs::write(&path, r#"{"mcpServers": {"token": "super-secret-value""#).unwrap();
        let error = read_json(&path, None).unwrap_err();
        assert!(error.starts_with("Invalid JSON"));
        assert!(!error.contains("super-secret-value"));
        std::fs::write(&path, "[]").unwrap();
        assert!(read_json(&path, None).unwrap_err().contains("JSON object"));
        std::fs::write(&path, "{\n // comment\n \"a\": 1,\n}").unwrap();
        assert!(read_json(&path, None).unwrap().is_some());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn settled_files_are_parsed_once_until_they_change() {
        let (directory, path) = temp_file("settled.json", r#"{"mcpServers":{"a":{}}}"#);
        let old = SystemTime::now() - Duration::from_secs(60);
        std::fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(old)
            .unwrap();
        let first = read_json(&path, None).unwrap().unwrap();
        let second = read_json(&path, None).unwrap().unwrap();
        assert!(Arc::ptr_eq(&first, &second));
        // Same size, newer timestamp: the cached parse must not be reused.
        std::fs::write(&path, r#"{"mcpServers":{"b":{}}}"#).unwrap();
        let third = read_json(&path, None).unwrap().unwrap();
        assert!(third["mcpServers"].get("b").is_some());
        // A freshly written file is never trusted from the cache.
        let fourth = read_json(&path, None).unwrap().unwrap();
        assert!(!Arc::ptr_eq(&third, &fourth));
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn claude_view_drops_project_history_but_keeps_servers_and_opt_outs() {
        let view = claude_view(serde_json::json!({
            "history": ["a very long conversation"],
            "mcpServers": {"global": {"command": "node"}},
            "projects": {"/repo": {
                "history": ["x"],
                "mcpServers": {"local": {"command": "node"}},
                "disabledMcpServers": ["global"]
            }}
        }));
        assert!(view.get("history").is_none());
        assert!(view["projects"]["/repo"].get("history").is_none());
        assert_eq!(view["projects"]["/repo"]["disabledMcpServers"][0], "global");
        assert!(view["projects"]["/repo"]["mcpServers"].get("local").is_some());
        assert!(claude_view(serde_json::json!({"projects": "bad"}))["projects"].is_string());
    }
}
