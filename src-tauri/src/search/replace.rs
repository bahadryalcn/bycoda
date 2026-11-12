//! Replacement is bounded to the current search page and compared with its reviewed bytes.
use super::*;
use sha2::{Digest, Sha256};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceOptions {
    #[serde(flatten)]
    pub search: SearchOptions,
    pub replacement: String,
    #[serde(default)]
    pub dry_run: bool,
    #[serde(default)]
    pub revisions: HashMap<String, String>,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceResult {
    pub files_changed: usize,
    pub replacements: usize,
    pub failures: Vec<String>,
    pub revisions: HashMap<String, String>,
}

pub(super) fn pattern(options: &SearchOptions) -> Result<regex::Regex, String> {
    let query = options.query.trim();
    let expression = if options.regex {
        query.to_string()
    } else {
        regex::escape(query)
    };
    regex::RegexBuilder::new(&expression)
        .case_insensitive(!options.case_sensitive)
        .size_limit(2 * 1024 * 1024)
        .build()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn replace_project(
    app: tauri::AppHandle,
    window: tauri::Window,
    options: ReplaceOptions,
) -> Result<ReplaceResult, String> {
    let admission = crate::native_window_lifecycle::admit_window_buffers(&window)?;
    crate::native_window_lifecycle::run_admitted_blocking(admission, move || {
        let root =
            std::fs::canonicalize(expand_home(&options.search.cwd)).map_err(|e| e.to_string())?;
        crate::file_access::require(&app, &root, !options.dry_run)?;
        replace_sync(&root, &options, |path| {
            crate::file_access::require(&app, path, true).map(|_| ())
        })
    })
    .await
}

fn replace_sync(
    root: &Path,
    options: &ReplaceOptions,
    authorize: impl Fn(&Path) -> Result<(), String>,
) -> Result<ReplaceResult, String> {
    let canonical_root = std::fs::canonicalize(root).map_err(|e| e.to_string())?;
    let root = canonical_root.as_path();
    if options.search.query.trim().is_empty() {
        return Err("Enter a search query".into());
    }
    if options.replacement.len() > 512 * 1024 {
        return Err("Replacement is too large".into());
    }
    let pattern = pattern(&options.search)?;
    let result = search_project_sync(root, &options.search, &AtomicBool::new(false))?;
    let mut lines: std::collections::BTreeMap<String, Vec<u32>> = std::collections::BTreeMap::new();
    for found in result.matches {
        lines.entry(found.relative).or_default().push(found.line);
    }
    if !options.dry_run {
        for relative in options.revisions.keys() {
            lines.entry(relative.clone()).or_default();
        }
    }
    let mut result = ReplaceResult::default();
    for (relative, lines) in lines {
        let operation = (|| -> Result<(), String> {
            let path = std::fs::canonicalize(root.join(&relative)).map_err(|e| e.to_string())?;
            if !path.starts_with(root) {
                return Err("File is outside project".into());
            }
            let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
            if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
                return Err("File is too large".into());
            }
            let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
            if bytes.contains(&0) {
                return Err("Binary file".into());
            }
            let original = std::str::from_utf8(&bytes).map_err(|_| "File is not UTF-8")?;
            let revision = format!("{:x}", Sha256::digest(&bytes));
            if !options.dry_run && options.revisions.get(&relative) != Some(&revision) {
                return Err("File changed since confirmation; search again".into());
            }
            let (content, count) = replace_lines(
                original,
                &lines,
                &pattern,
                &options.replacement,
                options.search.regex,
                options.search.whole_word,
            )?;
            if count == 0 || content == original {
                return Ok(());
            }
            if !options.dry_run {
                authorize(&path)?;
                if std::fs::read(&path).map_err(|e| e.to_string())? != bytes {
                    return Err("File changed before saving".into());
                }
                crate::fs::write_text_file_sync_checked(
                    &crate::fs::path_to_js(&path),
                    &content,
                    || {
                        authorize(&path)?;
                        if std::fs::canonicalize(root.join(&relative)).map_err(|e| e.to_string())?
                            != path
                            || std::fs::read(&path).map_err(|e| e.to_string())? != bytes
                        {
                            return Err("File changed before saving".into());
                        }
                        Ok(())
                    },
                )?;
            }
            result.files_changed += 1;
            result.replacements += count;
            result.revisions.insert(relative.clone(), revision);
            Ok(())
        })();
        if let Err(error) = operation {
            result.failures.push(format!("{relative}: {error}"));
        }
    }
    Ok(result)
}

fn replace_lines(
    original: &str,
    lines: &[u32],
    pattern: &regex::Regex,
    replacement: &str,
    captures: bool,
    whole_word: bool,
) -> Result<(String, usize), String> {
    let mut count = 0;
    let mut content = String::with_capacity(original.len());
    let body = original.strip_prefix('\u{feff}').unwrap_or(original);
    if body.len() != original.len() {
        content.push('\u{feff}');
    }
    for (index, chunk) in body.split_inclusive('\n').enumerate() {
        if !lines.contains(&((index + 1) as u32)) {
            content.push_str(chunk);
            continue;
        }
        let line = chunk.trim_end_matches(['\r', '\n']);
        let mut end = 0;
        for capture in pattern.captures_iter(line) {
            let found = capture.get(0).unwrap();
            if whole_word && !is_word_boundary(line, found.start(), found.len()) {
                continue;
            }
            content.push_str(&line[end..found.start()]);
            if captures {
                capture.expand(replacement, &mut content);
            } else {
                content.push_str(replacement);
            }
            if content.len() as u64 > MAX_FILE_BYTES {
                return Err("Replacement would exceed 512 KiB".into());
            }
            end = found.end();
            count += 1;
        }
        content.push_str(&line[end..]);
        content.push_str(&chunk[line.len()..]);
    }
    if content.len() as u64 > MAX_FILE_BYTES {
        return Err("Replacement would exceed 512 KiB".into());
    }
    Ok((content, count))
}

#[cfg(test)]
#[path = "replace_tests.rs"]
mod tests;
