//! Where every provider beyond Claude Code and Codex keeps its history, and
//! which reader turns a stored conversation into entries. Only the default
//! store of each provider is read.
// shortcut: provider account profiles (a second GROK_HOME, a named Hermes
// home) are not scanned; add them here once imports need account binding.

use std::path::{Path, PathBuf};

use super::{
    antigravity, cursor, grok, hermes, openclaw, opencode, pi, scan_db_cached, CodexTranscript,
    ImportCandidate,
};

/// Providers whose history `import_read_entries` can read.
pub(super) const PROVIDERS: [&str; 8] = [
    "cursor",
    "grok",
    "opencode",
    "pi",
    "omp",
    "hermes",
    "antigravity",
    "openclaw",
];

#[derive(Debug, Default, Clone)]
pub(crate) struct ExtraRoots {
    /// `<GROK_HOME>/sessions`.
    pub(crate) grok: Option<PathBuf>,
    /// `~/.cursor`.
    pub(crate) cursor: Option<PathBuf>,
    /// `opencode.db`.
    pub(crate) opencode: Option<PathBuf>,
    /// `<agent dir>/sessions` of Pi and of omp.
    pub(crate) pi: Option<PathBuf>,
    pub(crate) omp: Option<PathBuf>,
    /// Hermes homes; each holds `state.db` and `profiles/`.
    pub(crate) hermes: Vec<PathBuf>,
    /// OpenClaw state folder.
    pub(crate) openclaw: Option<PathBuf>,
    /// `~/.gemini/antigravity-cli`.
    pub(crate) antigravity: Option<PathBuf>,
}

fn env_dir(name: &str) -> Option<PathBuf> {
    let value = std::env::var_os(name).filter(|value| !value.is_empty())?;
    let path = PathBuf::from(value);
    if let Ok(rest) = path.strip_prefix("~") {
        return crate::dirs_home().map(|home| PathBuf::from(home).join(rest));
    }
    path.is_absolute().then_some(path)
}

impl ExtraRoots {
    pub(crate) fn detect() -> Self {
        let Some(home) = crate::dirs_home().map(PathBuf::from) else {
            return Self::default();
        };
        let data = env_dir("XDG_DATA_HOME").unwrap_or_else(|| home.join(".local/share"));
        let mut hermes = Vec::new();
        if let Some(dir) = env_dir("HERMES_HOME") {
            hermes.push(dir);
        } else {
            if cfg!(windows) {
                if let Some(local) = env_dir("LOCALAPPDATA") {
                    hermes.push(local.join("hermes"));
                }
            }
            hermes.push(home.join(".hermes"));
        }
        Self {
            grok: Some(
                env_dir("GROK_HOME")
                    .unwrap_or_else(|| home.join(".grok"))
                    .join("sessions"),
            ),
            cursor: Some(home.join(".cursor")),
            opencode: Some(data.join("opencode").join("opencode.db")),
            pi: Some(
                env_dir("PI_CODING_AGENT_DIR")
                    .unwrap_or_else(|| home.join(".pi/agent"))
                    .join("sessions"),
            ),
            omp: Some(home.join(".omp/agent/sessions")),
            hermes,
            openclaw: Some(env_dir("OPENCLAW_STATE_DIR").unwrap_or_else(|| home.join(".openclaw"))),
            antigravity: Some(home.join(".gemini/antigravity-cli")),
        }
    }

    /// Folders a file of `provider` must be inside to be read.
    pub(super) fn allowed(&self, provider: &str) -> Vec<PathBuf> {
        let parent = |path: &Option<PathBuf>| {
            path.as_ref()
                .and_then(|path| path.parent().map(Path::to_path_buf))
        };
        match provider {
            "grok" => self.grok.iter().cloned().collect(),
            "cursor" => self.cursor.iter().cloned().collect(),
            "opencode" => parent(&self.opencode).into_iter().collect(),
            "pi" => self.pi.iter().cloned().collect(),
            "omp" => self.omp.iter().cloned().collect(),
            "hermes" => self.hermes.clone(),
            "openclaw" => self.openclaw.iter().map(|dir| dir.join("agents")).collect(),
            "antigravity" => self
                .antigravity
                .iter()
                .map(|dir| dir.join("conversations"))
                .collect(),
            _ => Vec::new(),
        }
    }
}

/// What the extra providers hold.
#[derive(Default)]
pub(super) struct ExtraScan {
    pub(super) candidates: Vec<ImportCandidate>,
    pub(super) scanned: usize,
    /// Per-file sources, for the scan cache: their roots and current files.
    pub(super) file_roots: Vec<PathBuf>,
    pub(super) files: Vec<PathBuf>,
}

impl ExtraScan {
    fn files(
        &mut self,
        root: &Path,
        files: Vec<PathBuf>,
        scan: impl FnOnce(&[PathBuf]) -> Vec<ImportCandidate>,
    ) {
        self.scanned += files.len();
        self.candidates.extend(scan(&files));
        self.file_roots.push(root.to_path_buf());
        self.files.extend(files);
    }

    fn database(
        &mut self,
        db: &Path,
        provider: &'static str,
        scan: impl FnOnce() -> (Vec<ImportCandidate>, usize),
    ) {
        let (candidates, scanned) = scan_db_cached(db, provider, scan);
        self.scanned += scanned;
        self.candidates.extend(candidates);
    }
}

pub(super) fn discover(roots: &ExtraRoots) -> ExtraScan {
    let mut scan = ExtraScan::default();
    if let Some(root) = &roots.grok {
        scan.files(root, grok::history_files(root), grok::discover);
    }
    for (provider, root) in [("pi", &roots.pi), ("omp", &roots.omp)] {
        if let Some(root) = root {
            scan.files(root, pi::session_files(root), |files| {
                pi::discover(provider, files, true)
            });
        }
    }
    if let Some(state) = &roots.openclaw {
        let stores = openclaw::stores(state);
        scan.files(&state.join("agents"), stores.transcripts, |files| {
            pi::discover("openclaw", files, false)
        });
        for db in &stores.databases {
            scan.database(db, "openclaw", || openclaw::discover(db));
        }
    }
    if let Some(dir) = &roots.cursor {
        for store in cursor::stores(dir) {
            scan.database(&store, "cursor", || {
                (cursor::discover(&store).into_iter().collect(), 1)
            });
        }
    }
    if let Some(db) = roots.opencode.as_ref().filter(|db| db.is_file()) {
        scan.database(db, "opencode", || opencode::discover(db));
    }
    for db in hermes::databases(&roots.hermes) {
        scan.database(&db, "hermes", || hermes::discover(&db));
    }
    if let Some(root) = roots.antigravity.as_ref() {
        let summaries = root.join("conversation_summaries.db");
        if summaries.is_file() {
            scan.database(&summaries, "antigravity", || antigravity::discover(root));
        }
    }
    scan
}

pub(super) fn read(
    provider: &str,
    path: &Path,
    session_id: &str,
    max_bytes: usize,
) -> Result<CodexTranscript, String> {
    match provider {
        "grok" => grok::read(path, max_bytes),
        "pi" | "omp" => pi::read(path, max_bytes),
        "openclaw" if path.extension().and_then(|ext| ext.to_str()) == Some("jsonl") => {
            pi::read(path, max_bytes)
        }
        "openclaw" => openclaw::read(path, session_id, max_bytes),
        "cursor" => cursor::read(path, max_bytes),
        "opencode" => opencode::read(path, session_id, max_bytes),
        "hermes" => hermes::read(path, session_id, max_bytes),
        "antigravity" => antigravity::read(path, max_bytes),
        _ => Err(format!("History from {provider} cannot be imported")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Reads this machine's real stores and prints counts only, never content:
    /// `cargo test -p bycoda --lib real_extra_stores_dry_run -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_extra_stores_dry_run() {
        let roots = ExtraRoots::detect();
        let scan = discover(&roots);
        println!(
            "scanned: {} candidates: {}",
            scan.scanned,
            scan.candidates.len()
        );
        for provider in PROVIDERS {
            let mut found: Vec<&ImportCandidate> = scan
                .candidates
                .iter()
                .filter(|candidate| candidate.provider == provider)
                .collect();
            found.sort_by_key(|candidate| std::cmp::Reverse(candidate.last_at));
            let resumable = found.iter().filter(|candidate| candidate.resumable).count();
            print!("{provider}: {} (resumable {resumable})", found.len());
            for candidate in found.iter().take(3) {
                let allowed = roots.allowed(provider);
                let path = super::super::allowed_in(&candidate.path, &allowed);
                let transcript = path.and_then(|path| {
                    read(provider, &path, &candidate.provider_session_id, 4 << 20)
                });
                match transcript {
                    Ok(transcript) => {
                        let count = |kind: &str| {
                            transcript
                                .entries
                                .iter()
                                .filter(|entry| entry.kind == kind)
                                .count()
                        };
                        let outputs = transcript
                            .entries
                            .iter()
                            .filter(|entry| entry.output.is_some())
                            .count();
                        print!(
                            " | user {} assistant {} tool {} outputs {} prompt {}ch cwd {}",
                            count("user"),
                            count("assistant"),
                            count("tool"),
                            outputs,
                            candidate.first_prompt.chars().count(),
                            candidate.cwd
                        );
                    }
                    Err(error) => print!(" | error: {error}"),
                }
            }
            println!();
        }
    }
}
