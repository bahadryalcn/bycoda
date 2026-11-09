//! The `environment` section of a diagnostic report: `key: value` lines that identify the
//! build and platform. No user names, host names or paths.
use std::sync::OnceLock;
use std::time::Instant;

static STARTED: OnceLock<Instant> = OnceLock::new();

pub(super) fn mark_start() {
    let _ = STARTED.set(Instant::now());
}

fn identity_field(identity: &serde_json::Value, key: &str) -> Option<String> {
    identity
        .get(key)
        .and_then(|value| value.as_str())
        .map(|value| value.chars().take(64).collect())
}

fn host_data_kind() -> &'static str {
    if crate::debug_profile::profile_id().is_some() {
        "debug-isolated"
    } else {
        "default"
    }
}

pub(super) fn render() -> String {
    let device = crate::account::device::current();
    let mut lines: Vec<(&str, String)> = vec![
        ("appVersion", device.app_version),
        ("channel", device.channel.to_string()),
        (
            "build",
            if cfg!(debug_assertions) {
                "debug"
            } else {
                "release"
            }
            .to_string(),
        ),
    ];
    if let Ok(identity) =
        serde_json::from_str::<serde_json::Value>(crate::build_info::BUILD_IDENTITY_JSON)
    {
        for (label, key) in [
            ("buildId", "buildId"),
            ("buildMode", "mode"),
            ("branch", "branch"),
        ] {
            if let Some(value) = identity_field(&identity, key) {
                lines.push((label, value));
            }
        }
        if let Some(head) = identity_field(&identity, "head") {
            lines.push(("head", head.chars().take(12).collect()));
        }
    }
    lines.push(("os", format!("{} {}", device.platform, device.os_version)));
    lines.push(("arch", std::env::consts::ARCH.to_string()));
    if let Ok(threads) = std::thread::available_parallelism() {
        lines.push(("cpuThreads", threads.get().to_string()));
    }
    if let Ok(version) = tauri::webview_version() {
        lines.push(("webview", version.chars().take(64).collect()));
    }
    if let Some(started) = STARTED.get() {
        lines.push(("uptimeSeconds", started.elapsed().as_secs().to_string()));
    }
    lines.push(("hostDataDir", host_data_kind().to_string()));
    lines.push(("logLevel", log::max_level().to_string()));
    lines
        .into_iter()
        .map(|(key, value)| format!("{key}: {value}"))
        .collect::<Vec<_>>()
        .join("\n")
}
