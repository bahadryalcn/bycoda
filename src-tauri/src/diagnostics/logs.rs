use super::crash::{self, CrashMarker};
use super::file_log;
use serde::Serialize;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

const KIB: u64 = 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeLogSection {
    pub name: String,
    pub text: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeDiagnosticLogs {
    pub sections: Vec<NativeLogSection>,
    pub home_dir: Option<String>,
    pub crash: Option<CrashMarker>,
    pub host_crash: Option<CrashMarker>,
}

/// Where each report source lives; tests point these at temp directories.
pub(super) struct Sources {
    pub environment: String,
    pub native_marker: Option<PathBuf>,
    pub app_log: Option<PathBuf>,
    pub host_dir: Option<PathBuf>,
}

pub(super) fn host_crash_path() -> Option<PathBuf> {
    crate::local_host::host_data_dir().map(|dir| host_marker_path(&dir))
}

pub(super) fn host_marker_path(host_dir: &Path) -> PathBuf {
    host_dir.join("logs").join("last-crash.json")
}

/// Last `limit` bytes of `path`, whole lines only, decoded lossily (rule rust-bufreader-lines-on-stream).
pub(super) fn read_tail(path: &Path, limit: u64) -> Option<(String, bool)> {
    let mut file = std::fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let truncated = len > limit;
    if truncated {
        file.seek(SeekFrom::Start(len - limit)).ok()?;
    }
    let mut bytes = Vec::with_capacity(len.min(limit) as usize);
    file.take(limit).read_to_end(&mut bytes).ok()?;
    if truncated {
        match bytes.iter().position(|byte| *byte == b'\n') {
            Some(index) => bytes.drain(..=index),
            None => bytes.drain(..),
        };
    }
    Some((String::from_utf8_lossy(&bytes).into_owned(), truncated))
}

fn section(name: &str, path: &Path, limit: u64) -> Option<NativeLogSection> {
    let (text, truncated) = read_tail(path, limit)?;
    if text.trim().is_empty() {
        return None;
    }
    Some(NativeLogSection {
        name: name.into(),
        text,
        truncated,
    })
}

fn text_section(name: &str, text: String) -> Option<NativeLogSection> {
    (!text.trim().is_empty()).then(|| NativeLogSection {
        name: name.into(),
        text,
        truncated: false,
    })
}

pub(super) fn collect_from(
    sources: &Sources,
) -> (
    Vec<NativeLogSection>,
    Option<CrashMarker>,
    Option<CrashMarker>,
) {
    let crash = sources
        .native_marker
        .as_deref()
        .and_then(crash::read_marker);
    let host_crash = sources
        .host_dir
        .as_deref()
        .and_then(|dir| crash::read_marker(&host_marker_path(dir)));
    let mut sections = Vec::new();
    sections.extend(text_section("environment", sources.environment.clone()));
    if let Some(marker) = &crash {
        sections.extend(text_section("native", crash::render_marker(marker)));
    }
    if let Some(marker) = &host_crash {
        sections.extend(text_section("host-crash", crash::render_marker(marker)));
    }
    if let Some(base) = &sources.app_log {
        sections.extend(section("app", base, 400 * KIB));
        sections.extend(section(
            "app-previous",
            &file_log::rotated_path(base, 1),
            100 * KIB,
        ));
    }
    if let Some(dir) = &sources.host_dir {
        let logs = dir.join("logs");
        sections.extend(section("host", &logs.join("host.log"), 500 * KIB));
        sections.extend(section(
            "host-previous",
            &logs.join("host.1.log"),
            150 * KIB,
        ));
        sections.extend(section("host-stdout", &dir.join("host.log"), 100 * KIB));
    }
    (sections, crash, host_crash)
}

pub(super) fn collect() -> NativeDiagnosticLogs {
    let sources = Sources {
        environment: super::environment::render(),
        native_marker: crash::installed_path().cloned(),
        app_log: file_log::log_dir().map(|dir| dir.join("bycoda.log")),
        host_dir: crate::local_host::host_data_dir(),
    };
    let (sections, crash, host_crash) = collect_from(&sources);
    NativeDiagnosticLogs {
        sections,
        home_dir: crate::dirs_home(),
        crash,
        host_crash,
    }
}
