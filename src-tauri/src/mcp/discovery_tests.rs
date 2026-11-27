use super::*;

#[test]
fn global_discovery_ignores_project_configuration_and_opt_outs() {
    let directory =
        std::env::temp_dir().join(format!("bycoda-mcp-global-{}", uuid::Uuid::new_v4()));
    let home = directory.join("home");
    std::fs::create_dir_all(home.join(".codex")).unwrap();
    std::fs::write(
        home.join(".claude.json"),
        serde_json::json!({
            "mcpServers": {"global": {"command": "node"}},
            "projects": "invalid project settings must not block global discovery"
        })
        .to_string(),
    )
    .unwrap();
    std::fs::write(
        home.join(".mcp.json"),
        r#"{"mcpServers":{"project-only":{"command":"node"}}}"#,
    )
    .unwrap();
    std::fs::write(
        home.join(".codex/config.toml"),
        "[mcp_servers.codex]\ncommand = 'node'\nenabled = false\n",
    )
    .unwrap();
    let found = discover(&home, None, None, &home.join("desktop.json"), None).unwrap();
    assert_eq!(found.len(), 2);
    assert!(found.iter().all(|server| server.scope == "user"));
    assert!(
        found
            .iter()
            .find(|server| server.name == "global")
            .unwrap()
            .enabled
    );
    assert!(
        !found
            .iter()
            .find(|server| server.name == "codex")
            .unwrap()
            .enabled
    );
    let project = directory.join("project");
    std::fs::create_dir_all(project.join(".git")).unwrap();
    std::fs::write(
        project.join(".mcp.json"),
        r#"{"mcpServers":{"project-only":{"command":"node"}}}"#,
    )
    .unwrap();
    let project_key = project.to_string_lossy().replace('\\', "/");
    let mut configuration = serde_json::json!({
        "mcpServers": {"global": {"command": "node"}},
        "projects": {&project_key: {
            "disabledMcpServers": ["global"],
            "mcpServers": {"local-only": {"command": "node"}}
        }}
    });
    if cfg!(windows) {
        configuration["projects"][project_key.to_uppercase()] = serde_json::json!({});
    }
    std::fs::write(home.join(".claude.json"), configuration.to_string()).unwrap();
    let global = discover(&home, None, None, &home.join("desktop.json"), None).unwrap();
    assert_eq!(global.len(), 2);
    assert!(global.iter().all(|server| server.scope == "user"));
    assert!(
        global
            .iter()
            .find(|server| server.name == "global")
            .unwrap()
            .enabled
    );
    if cfg!(windows) {
        assert!(discover(
            &home,
            Some(&project),
            None,
            &home.join("desktop.json"),
            None
        )
        .err()
        .unwrap()
        .contains("ambiguous project settings"));
    }
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn unreadable_configuration_is_reported_apart_from_no_servers() {
    let directory =
        std::env::temp_dir().join(format!("bycoda-mcp-warnings-{}", uuid::Uuid::new_v4()));
    let home = directory.join("home");
    std::fs::create_dir_all(home.join(".codex")).unwrap();
    std::fs::create_dir_all(home.join(".cursor")).unwrap();
    // A half-written Claude file and a Codex file whose broken line holds a credential.
    std::fs::write(
        home.join(".claude.json"),
        r#"{"mcpServers": {"docs": {"env": {"TOKEN": "claude-secret""#,
    )
    .unwrap();
    std::fs::write(
        home.join(".codex/config.toml"),
        "[mcp_servers.codex]\ntoken = codex-secret\n",
    )
    .unwrap();
    std::fs::write(home.join(".cursor/mcp.json"), r#"{"mcpServers":{}}"#).unwrap();
    let desktop = home.join("desktop.json");
    let found = discover_with_warnings(&home, None, None, &desktop, None).unwrap();
    assert!(found.connections.is_empty());
    let warned: Vec<_> = found
        .warnings
        .iter()
        .map(|warning| warning.provider.as_str())
        .collect();
    // The valid empty Cursor file and the missing Desktop file are not warnings.
    assert_eq!(warned, ["claude", "codex"]);
    let serialized = serde_json::to_string(&found).unwrap();
    assert!(!serialized.contains("claude-secret") && !serialized.contains("codex-secret"));
    assert!(found.warnings[1].message.contains("line 2"));

    // Repairing the file clears the warning and lists the servers again.
    std::fs::write(
        home.join(".claude.json"),
        r#"{"mcpServers":{"docs":{"command":"node"}}}"#,
    )
    .unwrap();
    let repaired = discover_with_warnings(&home, None, None, &desktop, None).unwrap();
    assert_eq!(repaired.connections.len(), 1);
    assert_eq!(repaired.warnings.len(), 1);
    std::fs::remove_dir_all(directory).unwrap();
}
