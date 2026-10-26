//! Opt-in debug-run identity. Release builds never consume development profile variables.
use std::path::PathBuf;

pub fn profile_id() -> Option<String> {
    if !cfg!(debug_assertions) {
        return None;
    }
    std::env::var("BYCODA_DEV_PROFILE_ID")
        .ok()
        .filter(|value| !value.trim().is_empty())
}

pub fn host_data_dir() -> Option<PathBuf> {
    profile_id()?;
    std::env::var_os("BYCODA_HOST_DIR").map(PathBuf::from)
}

fn identifier(profile: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = format!("{:x}", Sha256::digest(profile.as_bytes()));
    format!("com.bycoda.desktop.dev.{}", &digest[..20])
}

pub fn context(mut context: tauri::Context<tauri::Wry>) -> tauri::Context<tauri::Wry> {
    if let Some(profile) = profile_id() {
        let config = context.config_mut();
        // Tauri resolves every desktop store, window-state file and WebView profile
        // from the identifier. Changing just the session database leaves shared data.
        config.identifier = identifier(&profile);
        for window in &mut config.app.windows {
            window.title = format!("bycoda Dev · {profile}");
        }
    }
    context
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profiles_have_stable_distinct_valid_application_identifiers() {
        assert_eq!(identifier("workspace/run"), identifier("workspace/run"));
        assert_ne!(identifier("workspace/run1"), identifier("workspace/run2"));
        assert!(identifier("../../ unsafe ✓")
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.'));
    }
}
