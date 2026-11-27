use super::{
    comments::{image_mime_type, upload_image, validate_image_name, IMAGE_LIMIT},
    post_comment_document, require_config, require_issue_key, text_to_adf, JiraConfig,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs::File,
    io::Read,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::AppHandle;

const PERMIT_LIFETIME_MS: u64 = 120_000;

#[derive(Deserialize)]
struct ImageRef {
    path: String,
    sha256: String,
}

struct ApprovedComment {
    config: JiraConfig,
    key: String,
    root: PathBuf,
    body: String,
    images: Vec<ImageRef>,
    expires: u64,
}

fn permits() -> &'static Mutex<HashMap<String, ApprovedComment>> {
    static PERMITS: OnceLock<Mutex<HashMap<String, ApprovedComment>>> = OnceLock::new();
    PERMITS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_ms() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .map_err(|_| "Clock unavailable".into())
}

fn checked_images(operation: &Value) -> Result<Vec<ImageRef>, String> {
    let images: Vec<ImageRef> =
        serde_json::from_value(operation["images"].clone()).map_err(|_| "Invalid Jira images")?;
    let mut seen = HashSet::new();
    if images.is_empty()
        || images.len() > 4
        || images.iter().any(|image| {
            image.path.len() > 4000
                || image.path.chars().any(|ch| {
                    ch.is_control() || matches!(ch, '\\' | ':' | '"' | '<' | '>' | '|' | '?' | '*')
                })
                || image.path.split('/').any(|part| {
                    part.is_empty()
                        || matches!(part, "." | "..")
                        || part.eq_ignore_ascii_case(".git")
                })
                || image.sha256.len() != 64
                || !image.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
                || !seen.insert(&image.path)
        })
    {
        return Err("Invalid Jira comment image paths or digests".into());
    }
    Ok(images)
}

pub(crate) fn approval_content(operation: &Value, body: &str) -> Result<String, String> {
    let paths = checked_images(operation)?
        .into_iter()
        .map(|image| image.path)
        .collect::<Vec<_>>()
        .join("\n");
    let root = operation["imageRoot"]
        .as_str()
        .filter(|root| Path::new(root).is_absolute() && !root.chars().any(char::is_control))
        .ok_or("Jira image checkout required")?;
    Ok(format!("Jira attachments from {root}\n{paths}\n\n{body}"))
}

pub(crate) fn authorize(
    app: &AppHandle,
    operation: &Value,
) -> Result<impl FnOnce() -> Result<String, String>, String> {
    let config = require_config(app)?;
    let key = require_issue_key(operation["item"]["identifier"].as_str().unwrap_or_default())?;
    let mut approved = ApprovedComment {
        config,
        key: key.to_owned(),
        root: PathBuf::from(
            operation["imageRoot"]
                .as_str()
                .ok_or("Jira image checkout required")?,
        ),
        body: operation["body"]
            .as_str()
            .ok_or("Invalid inbox comment")?
            .to_owned(),
        images: checked_images(operation)?,
        expires: 0,
    };
    Ok(move || {
        let mut permits = permits()
            .lock()
            .map_err(|_| "Jira image approvals unavailable")?;
        let now = now_ms()?;
        permits.retain(|_, comment| comment.expires > now);
        if permits.len() >= 16 {
            return Err("Too many Jira image approvals are waiting for the desktop".into());
        }
        let permit = uuid::Uuid::new_v4().to_string();
        approved.expires = now + PERMIT_LIFETIME_MS;
        permits.insert(permit.clone(), approved);
        Ok(permit)
    })
}

struct PreparedImage {
    name: String,
    mime: &'static str,
    bytes: Vec<u8>,
}

fn prepare_images(root: &Path, images: &[ImageRef]) -> Result<Vec<PreparedImage>, String> {
    let root = root
        .canonicalize()
        .map_err(|_| "Jira image checkout is unavailable")?;
    let mut remaining = IMAGE_LIMIT;
    let mut prepared = Vec::new();
    for image in images {
        let changed = || {
            format!(
                "Jira image is missing or changed since approval: {}",
                image.path
            )
        };
        let path = root
            .join(&image.path)
            .canonicalize()
            .map_err(|_| changed())?;
        let relative = path.strip_prefix(&root).map_err(|_| changed())?;
        if relative
            .iter()
            .any(|part| part.eq_ignore_ascii_case(".git"))
            || !path.metadata().is_ok_and(|metadata| metadata.is_file())
        {
            return Err(changed());
        }
        let name = Path::new(&image.path)
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or("Invalid Jira image filename")?;
        validate_image_name(name)?;
        let file = File::open(&path).map_err(|_| changed())?;
        let mut bytes = Vec::new();
        file.take(remaining as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| changed())?;
        if bytes.len() > remaining {
            return Err("Jira comment images exceed 10 MiB total".into());
        }
        if format!("{:x}", Sha256::digest(&bytes)) != image.sha256 {
            return Err(changed());
        }
        let mime = image_mime_type(&bytes).map_err(|reason| format!("{}: {reason}", image.path))?;
        remaining -= bytes.len();
        prepared.push(PreparedImage {
            name: name.to_owned(),
            mime,
            bytes,
        });
    }
    Ok(prepared)
}

fn ensure_deadline(deadline: u64) -> Result<(), String> {
    let now = now_ms()?;
    if deadline <= now || deadline - now > PERMIT_LIFETIME_MS {
        return Err("Jira comment image approval expired".into());
    }
    Ok(())
}

fn submit(app: &AppHandle, permit: &str, deadline: u64) -> Result<Value, String> {
    let ready: Result<_, String> = (|| {
        ensure_deadline(deadline)?;
        let approved = permits()
            .lock()
            .map_err(|_| "Jira image approvals unavailable")?
            .remove(permit)
            .filter(|comment| now_ms().is_ok_and(|now| comment.expires > now))
            .ok_or("Jira image approval expired or is unavailable on this desktop")?;
        let config = require_config(app)?;
        if config.site != approved.config.site
            || config.email != approved.config.email
            || config.token != approved.config.token
        {
            return Err("The connected Jira account changed after approval".into());
        }
        let images = prepare_images(&approved.root, &approved.images)?;
        ensure_deadline(deadline)?;
        Ok((approved, images))
    })();
    let (approved, images) = match ready {
        Ok(value) => value,
        Err(reason) => return Ok(json!({ "outcome": "not-submitted", "reason": reason })),
    };
    let mut document = text_to_adf(&approved.body);
    let mut attachments = Vec::new();
    for image in images {
        let receipt = ensure_deadline(deadline)
            .and_then(|()| {
                upload_image(
                    &approved.config,
                    &approved.key,
                    &image.name,
                    image.mime,
                    &image.bytes,
                )
            })
            .map_err(|reason| partial_failure(&approved.config, attachments.len(), &reason))?;
        if let Some(paragraphs) = document["content"].as_array_mut() {
            paragraphs.push(json!({
                "type": "paragraph",
                "content": [{
                    "type": "text",
                    "text": image.name,
                    "marks": [{ "type": "link", "attrs": { "href": receipt["url"] } }]
                }]
            }));
        }
        attachments.push(receipt);
    }
    let url = ensure_deadline(deadline)
        .and_then(|()| post_comment_document(&approved.config, &approved.key, document))
        .map_err(|reason| partial_failure(&approved.config, attachments.len(), &reason))?;
    Ok(json!({ "outcome": "submitted", "url": url, "attachments": attachments }))
}

fn partial_failure(config: &JiraConfig, uploaded: usize, reason: &str) -> String {
    let reason = reason.replace(&config.token, "[redacted]");
    format!("Jira confirmed {uploaded} attachment uploads. Check the Jira issue and attachments before retrying. {reason}")
}

#[tauri::command]
pub async fn jira_agent_comment_with_images(
    app: AppHandle,
    permit: String,
    deadline: u64,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || submit(&app, &permit, deadline))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn approval_names_the_checkout_and_rejects_escaped_paths() {
        let root = std::env::current_dir().unwrap();
        let mut operation = json!({
            "imageRoot": root,
            "images": [{ "path": "proof/screen.png", "sha256": "a".repeat(64) }]
        });
        let text = approval_content(&operation, "Verified").unwrap();
        assert!(text.starts_with("Jira attachments"));
        assert!(text.ends_with("proof/screen.png\n\nVerified"));
        operation["images"][0]["path"] = json!("../screen.png");
        assert!(approval_content(&operation, "Verified").is_err());
    }

    #[test]
    fn validates_every_file_against_approved_bytes_before_uploading() {
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("screen.png");
        let png = b"\x89PNG\r\n\x1a\n";
        std::fs::write(&file, png).unwrap();
        let images = [ImageRef {
            path: "screen.png".into(),
            sha256: format!("{:x}", Sha256::digest(png)),
        }];
        let prepared = prepare_images(root.path(), &images).unwrap();
        assert_eq!(prepared[0].mime, "image/png");
        assert_eq!(prepared[0].bytes, png);
        std::fs::write(&file, b"different file").unwrap();
        assert!(prepare_images(root.path(), &images)
            .err()
            .unwrap()
            .contains("changed since approval"));
    }
}
