use super::*;

#[test]
fn codex_toggle_preserves_comments_and_other_servers() {
    let raw = "# global\r\nmodel = 'test'\r\n[mcp_servers.docs]\r\ncommand = 'node'\r\nenabled = false # keep\r\n[mcp_servers.other]\r\ncommand = 'stay'\r\n";
    let enabled = edit_codex(raw, "docs", true, false).unwrap();
    assert!(enabled.contains("enabled = true # keep\r\n"));
    assert!(enabled.contains("# global"));
    assert!(enabled.contains("command = 'stay'"));
    assert!(edit_codex(&enabled, "docs", false, false).is_err());
    assert!(edit_codex(&enabled, "missing", false, true).is_err());
    assert!(edit_codex(&enabled, "docs", false, true)
        .unwrap()
        .contains("enabled = false # keep"));
}

#[test]
fn codex_toggle_handles_implicit_enabled_and_inline_tables() {
    for raw in [
        "[mcp_servers.docs]\ncommand = 'node'\n",
        "mcp_servers = { docs = { command = 'node' } }\n",
    ] {
        let disabled = edit_codex(raw, "docs", false, true).unwrap();
        let parsed: toml::Value = toml::from_str(&disabled).unwrap();
        assert_eq!(
            parsed["mcp_servers"]["docs"]["enabled"].as_bool(),
            Some(false)
        );
    }
}

#[test]
fn opencode_toggle_preserves_jsonc_and_both_layouts() {
    for raw in [
        r#"{ // keep
        "mcp": {"docs": {"command": ["node"], "enabled": false}, "other": {"command":["stay"]}} }"#,
        r#"{ // keep
        "mcp": {"servers": {"docs": {"command": ["node"], "disabled": true}, "other": {"command":["stay"]}}, "timeout": {"connect": 1000}} }"#,
    ] {
        let enabled = jsonc::edit(raw, |root| edit_opencode(root, "docs", true, false)).unwrap();
        assert!(enabled.contains("// keep"));
        assert!(enabled.contains("stay"));
        let disabled =
            jsonc::edit(&enabled, |root| edit_opencode(root, "docs", false, true)).unwrap();
        assert!(jsonc::edit(&disabled, |root| edit_opencode(root, "docs", true, true)).is_err());
    }
}

#[test]
fn claude_toggle_uses_project_opt_out_without_deleting_server_or_approval() {
    let project = "C:/work";
    let mut root = serde_json::json!({"mcpServers":{"docs":{"command":"node"}}, "projects":{project:{"disabledMcpServers":["other"], "disabledMcpjsonServers":["unapproved"]}}});
    edit_claude(&mut root, project, "docs", false, true).unwrap();
    assert!(claude_disabled(&root, project, "docs"));
    assert!(!claude_disabled(&root, "C:/other", "docs"));
    assert_eq!(root["mcpServers"]["docs"]["command"], "node");
    assert_eq!(
        root["projects"][project]["disabledMcpjsonServers"][0],
        "unapproved"
    );
    edit_claude(&mut root, project, "docs", true, false).unwrap();
    assert_eq!(
        root["projects"][project]["disabledMcpServers"],
        serde_json::json!(["other"])
    );
}

#[test]
fn discovery_respects_claude_project_opt_out_across_scopes() {
    let directory =
        std::env::temp_dir().join(format!("bycoda-mcp-toggle-{}", uuid::Uuid::new_v4()));
    let home = directory.join("home");
    let project = directory.join("project");
    std::fs::create_dir_all(&home).unwrap();
    std::fs::create_dir_all(&project).unwrap();
    std::fs::create_dir_all(project.join(".git")).unwrap();
    std::fs::write(home.join(".claude.json"), serde_json::json!({"mcpServers":{"docs":{"command":"node"}}, "projects":{project.to_string_lossy().replace('\\', "/"):{"disabledMcpServers":["docs"], "mcpServers":{"docs":{"command":"node"}}}}}).to_string()).unwrap();
    std::fs::write(
        project.join(".mcp.json"),
        r#"{"mcpServers":{"docs":{"command":"node"},"on":{"command":"node"}}}"#,
    )
    .unwrap();
    let connections = discover(
        &home,
        Some(&project),
        None,
        &home.join("desktop.json"),
        None,
    )
    .unwrap();
    let docs: Vec<_> = connections
        .iter()
        .filter(|server| server.provider == "claude" && server.name == "docs")
        .collect();
    assert_eq!(docs.len(), 3);
    assert!(docs.iter().all(|server| !server.enabled));
    assert!(
        connections
            .iter()
            .find(|server| server.name == "on")
            .unwrap()
            .enabled
    );
    std::fs::remove_dir_all(directory).unwrap();
}

#[cfg(windows)]
#[test]
fn claude_windows_project_keys_reuse_existing_slash_and_case_identity() {
    let mut root = serde_json::json!({"projects":{"G:/Projects/App":{"disabledMcpServers":["docs"], "mcpServers":{"local":{"command":"node"}}}}});
    let project = r"g:\Projects\App\";
    assert_eq!(
        claude_project_key(&root, project).unwrap(),
        "G:/Projects/App"
    );
    edit_claude(&mut root, project, "docs", true, false).unwrap();
    assert_eq!(root["projects"].as_object().unwrap().len(), 1);
    assert_eq!(
        root["projects"]["G:/Projects/App"]["disabledMcpServers"],
        serde_json::json!([])
    );
    assert_eq!(
        claude_project_key(&serde_json::json!({}), project).unwrap(),
        "g:/Projects/App"
    );
    root["projects"][r"g:\Projects\App"] = serde_json::json!({});
    let before = root.clone();
    assert!(edit_claude(&mut root, project, "docs", false, true).is_err());
    assert_eq!(root, before);
}

#[test]
fn malformed_enablement_does_not_get_replaced() {
    for key in ["enabled", "disabled"] {
        let mut root = serde_json::json!({"mcp":{"docs":{"command":["node"], key:"invalid"}}});
        let before = root.clone();
        assert!(edit_opencode(&mut root, "docs", false, true).is_err());
        assert_eq!(root, before);
    }
    assert!(edit_codex(
        "[mcp_servers.docs]\nenabled = 'invalid'\n",
        "docs",
        false,
        true
    )
    .is_err());
    let mut root = serde_json::json!({"projects":{"project":{"disabledMcpServers":"invalid"}}});
    let before = root.clone();
    assert!(edit_claude(&mut root, "project", "docs", false, true).is_err());
    assert_eq!(root, before);
}
