use super::*;

#[test]
fn codex_discovery_prefers_valid_login_shell_and_retains_fixed_fallback() {
    let home =
        std::env::temp_dir().join(format!("bycoda-codex-discovery-{}", uuid::Uuid::new_v4()));
    let local = home.join(".local/bin");
    let shell = home.join("login/bin");
    std::fs::create_dir_all(&local).unwrap();
    std::fs::create_dir_all(&shell).unwrap();
    let name = if cfg!(windows) { "codex.cmd" } else { "codex" };
    let old = local.join(name);
    let selected = shell.join(name);
    std::fs::write(&old, "old").unwrap();
    std::fs::write(&selected, "selected").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for path in [&old, &selected] {
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
    }
    assert_eq!(
        first_binary(codex_candidates(Some(&home), Some(selected.clone()))),
        Some(selected)
    );
    assert_eq!(
        first_binary(codex_candidates(Some(&home), Some(home.join("missing")))),
        Some(old)
    );
    std::fs::remove_dir_all(home).unwrap();
}
