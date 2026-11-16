use super::*;
use serde_json::json;

struct Fixture {
    root: PathBuf,
    home: PathBuf,
    project: PathBuf,
    target: Target,
}

impl Fixture {
    fn new(provider: &str, scope: &str, relative: &str, raw: &str) -> Self {
        let root = std::env::temp_dir().join(format!("bycoda-mcp-entry-{}", uuid::Uuid::new_v4()));
        let home = root.join("home");
        let project = root.join("project");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::create_dir_all(project.join(".git")).unwrap();
        let base = if scope == "project" { &project } else { &home };
        let path = base.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, raw).unwrap();
        // Use discovery's exact path spelling, including Windows separators.
        let config_path = super::super::discover(
            &home,
            Some(&project),
            None,
            &home.join("desktop.json"),
            None,
        )
        .unwrap()
        .into_iter()
        .find(|entry| entry.provider == provider && entry.scope == scope && entry.name == "sample")
        .map(|entry| entry.config_path)
        .unwrap_or_else(|| path.to_string_lossy().into_owned());
        let target = Target {
            provider: provider.into(),
            scope: scope.into(),
            name: "sample".into(),
            config_path,
            project: project.clone(),
        };
        Self {
            root,
            home,
            project,
            target,
        }
    }

    fn authorize(&self, global_only: bool) -> Result<(), String> {
        self.target.authorize(&super::super::discover(
            &self.home,
            (!global_only).then_some(self.project.as_path()),
            None,
            &self.home.join("desktop.json"),
            None,
        )?)
    }

    fn raw(&self) -> String {
        std::fs::read_to_string(&self.target.config_path).unwrap()
    }

    fn save(&self, entry: Value) -> McpServerConfig {
        self.authorize(false).unwrap();
        let before = self.target.read().unwrap();
        let saved = self
            .target
            .write(&entry.to_string(), &before.revision)
            .unwrap();
        assert_ne!(before.revision, saved.revision);
        assert_eq!(self.target.read().unwrap().revision, saved.revision);
        assert_eq!(serde_json::from_str::<Value>(&saved.config).unwrap(), entry);
        saved
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[test]
fn claude_user_and_local_entries_stay_separate() {
    let mut fixture = Fixture::new("claude", "user", ".claude.json", "{}");
    let key = fixture.project.to_string_lossy().replace('\\', "/");
    let root = json!({
        "mcpServers": {"sample": {"command": "user"}},
        "projects": {key.clone(): {"mcpServers": {"sample": {"command": "local"}}, "trusted": true}}
    });
    std::fs::write(&fixture.target.config_path, root.to_string()).unwrap();
    fixture.authorize(true).unwrap();
    fixture.save(json!({"command": "new-user", "env": {"TOKEN": "secret"}}));
    fixture.target.scope = "local".into();
    assert_eq!(fixture.authorize(true).unwrap_err(), NOT_FOUND);
    assert!(fixture.target.read().unwrap().config.contains("local"));
    fixture.save(json!({"url": "https://example.test/mcp"}));
    let root: Value = serde_json::from_str(&fixture.raw()).unwrap();
    assert_eq!(root["mcpServers"]["sample"]["command"], "new-user");
    assert_eq!(root["projects"][&key]["trusted"], true);
}

#[test]
fn json_provider_scopes_replace_only_selected_entry() {
    for (provider, scope, file) in [
        ("cursor", "user", ".cursor/mcp.json"),
        ("cursor", "project", ".cursor/mcp.json"),
        ("claude", "project", ".mcp.json"),
        ("claude_desktop", "user", "desktop.json"),
    ] {
        let fixture = Fixture::new(provider, scope, file,
            "{\r\n  // keep comment\r\n  \"mcpServers\": {\"sample\": {\"command\": \"old\", \"args\": [\"gone\"]}, \"other\": {\"command\": \"keep\"}},\r\n  \"setting\": 42\r\n}\r\n");
        let saved = fixture.save(json!({"command": "new"}));
        assert_eq!(saved.config, "{\n  \"command\": \"new\"\n}");
        let raw = fixture.raw();
        assert!(raw.contains("// keep comment"));
        assert!(!raw.replace("\r\n", "").contains('\n'));
        jsonc::edit(&raw, |root| {
            assert_eq!(root["mcpServers"]["other"], json!({"command": "keep"}));
            assert!(root["mcpServers"]["sample"].get("args").is_none());
            assert_eq!(root["setting"], 42);
            Ok(())
        })
        .unwrap();
    }
}

#[test]
fn opencode_one_and_two_keep_native_shape() {
    for nested in [false, true] {
        let servers = json!({"sample": {"type": "local", "command": ["old"], "enabled": true},
            "other": {"type": "remote", "url": "https://keep.test"}});
        let mcp = if nested {
            json!({"servers": servers, "timeout": {"connect": 1000}})
        } else {
            servers
        };
        let fixture = Fixture::new(
            "opencode",
            "user",
            ".config/opencode/opencode.jsonc",
            &json!({"mcp": mcp}).to_string(),
        );
        let replacement = json!({"type": "local", "command": ["new", "--arg"],
            "environment": {"TOKEN": "keep"}, "disabled": true});
        fixture.save(replacement.clone());
        let root: Value = serde_json::from_str(&fixture.raw()).unwrap();
        let servers = if nested {
            &root["mcp"]["servers"]
        } else {
            &root["mcp"]
        };
        assert_eq!(servers["sample"], replacement);
        assert_eq!(servers["other"]["url"], "https://keep.test");
        if nested {
            assert_eq!(root["mcp"]["timeout"]["connect"], 1000);
        }
        fixture.save(json!({"type": "remote", "url": "https://new.test", "oauth": false}));
    }
}

#[test]
fn opencode_server_named_servers_is_not_nested_map() {
    let mut fixture = Fixture::new(
        "opencode",
        "project",
        "opencode.json",
        r#"{"mcp":{"servers":{"type":"local","command":["old"]}}}"#,
    );
    fixture.target.name = "servers".into();
    fixture.save(json!({"type": "local", "command": ["new"]}));
}

#[test]
fn codex_preserves_comments_order_and_unrelated_tables() {
    let fixture = Fixture::new("codex", "user", ".codex/config.toml",
        "# top comment\nmodel = \"keep\"\n\n# server comment\n[mcp_servers.sample]\ncommand = \"old\" # command comment\nargs = [\"remove\"]\n\n[mcp_servers.sample.env]\nTOKEN = \"old\" # token comment\n\n[mcp_servers.other]\ncommand = \"keep\"\n");
    fixture.save(json!({"command": "new", "env": {"TOKEN": "new"}, "enabled": false}));
    let raw = fixture.raw();
    for comment in [
        "# top comment",
        "# server comment",
        "# command comment",
        "# token comment",
    ] {
        assert!(raw.contains(comment), "Missing {comment}: {raw}");
    }
    let root: toml::Value = toml::from_str(&raw).unwrap();
    assert_eq!(root["model"].as_str(), Some("keep"));
    assert_eq!(
        root["mcp_servers"]["other"]["command"].as_str(),
        Some("keep")
    );
    assert!(root["mcp_servers"]["sample"].get("args").is_none());
    assert!(raw.find("command = \"new\"").unwrap() < raw.find("enabled = false").unwrap());
}

#[test]
fn stale_revision_refuses_json_and_toml_without_writing() {
    for (provider, file, raw, changed) in [
        (
            "cursor",
            ".cursor/mcp.json",
            r#"{"mcpServers":{"sample":{"command":"old"}}}"#,
            r#"{"mcpServers":{"sample":{"command":"external"}}}"#,
        ),
        (
            "codex",
            ".codex/config.toml",
            "[mcp_servers.sample]\ncommand = \"old\"\n",
            "[mcp_servers.sample]\ncommand = \"external\"\n",
        ),
    ] {
        let fixture = Fixture::new(provider, "user", file, raw);
        fixture.authorize(false).unwrap();
        let before = fixture.target.read().unwrap();
        std::fs::write(&fixture.target.config_path, changed).unwrap();
        assert_eq!(
            fixture
                .target
                .write(r#"{"command":"new"}"#, &before.revision)
                .unwrap_err(),
            CHANGED
        );
        assert_eq!(fixture.raw(), changed);
    }
}

#[test]
fn unknown_path_and_mismatched_identity_refused() {
    let mut fixture = Fixture::new(
        "cursor",
        "user",
        ".cursor/mcp.json",
        r#"{"mcpServers":{"sample":{"command":"old"}}}"#,
    );
    fixture.authorize(false).unwrap();
    let original = fixture.target.config_path.clone();
    let unknown = fixture.root.join("arbitrary.json");
    std::fs::write(&unknown, fixture.raw()).unwrap();
    fixture.target.config_path = unknown.to_string_lossy().into_owned();
    assert_eq!(fixture.authorize(false).unwrap_err(), NOT_FOUND);
    fixture.target.config_path = original;
    fixture.target.scope = "project".into();
    assert_eq!(fixture.authorize(false).unwrap_err(), NOT_FOUND);
    fixture.target.scope = "user".into();
    fixture.target.provider = "claude".into();
    assert_eq!(fixture.authorize(false).unwrap_err(), NOT_FOUND);
    fixture.target.provider = "cursor".into();
    fixture.target.name = "missing".into();
    assert_eq!(fixture.authorize(false).unwrap_err(), NOT_FOUND);
}

#[test]
fn invalid_submissions_and_invalid_existing_files_refused() {
    let fixture = Fixture::new(
        "cursor",
        "user",
        ".cursor/mcp.json",
        r#"{"mcpServers":{"sample":{"command":"old"}}}"#,
    );
    let original = fixture.raw();
    let revision = fixture.target.read().unwrap().revision;
    for invalid in [
        "{",
        "[]",
        "{}",
        r#"{"command":" "}"#,
        r#"{"command":"x","url":"y"}"#,
        r#"{"command":"x","command":"y"}"#,
    ] {
        assert!(
            fixture.target.write(invalid, &revision).is_err(),
            "Accepted {invalid}"
        );
        assert_eq!(fixture.raw(), original);
    }
    for invalid in [
        "{",
        r#"{"mcpServers":{"sample":{"command":"old","command":"other"}}}"#,
    ] {
        std::fs::write(&fixture.target.config_path, invalid).unwrap();
        assert!(fixture.target.read().is_err());
        assert!(fixture
            .target
            .write(r#"{"command":"new"}"#, &revision)
            .is_err());
        assert_eq!(fixture.raw(), invalid);
    }
}

#[test]
fn revision_ignores_key_order_and_formatting_but_tracks_content() {
    let first: Value = serde_json::from_str(r#"{"command":"x","env":{"B":"b","A":"a"}}"#).unwrap();
    let second: Value =
        serde_json::from_str(r#"{ "env": {"A": "a", "B": "b"}, "command": "x" }"#).unwrap();
    assert_eq!(
        state(&first).unwrap().revision,
        state(&second).unwrap().revision
    );
    assert_ne!(
        state(&first).unwrap().revision,
        state(&json!({"command": "y"})).unwrap().revision
    );
}
