use super::*;
use base64::Engine;

const IMAGE_LIMIT: usize = 10 * 1024 * 1024;

fn image_bytes(name: &str, mime_type: &str, data_base64: &str) -> Result<Vec<u8>, String> {
    if name.is_empty()
        || name.len() > 255
        || name
            .chars()
            .any(|ch| ch.is_control() || matches!(ch, '"' | '\\' | '/'))
    {
        return Err("Invalid image filename".into());
    }
    if data_base64.len() > IMAGE_LIMIT.div_ceil(3) * 4 {
        return Err("Image exceeds 10 MB".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64)
        .map_err(|_| "Invalid image data".to_string())?;
    if bytes.is_empty() || bytes.len() > IMAGE_LIMIT {
        return Err("Image must be between 1 byte and 10 MB".into());
    }
    let format = image::guess_format(&bytes).map_err(|_| "Unsupported image data".to_string())?;
    let expected = match format {
        image::ImageFormat::Png => "image/png",
        image::ImageFormat::Jpeg => "image/jpeg",
        image::ImageFormat::Gif => "image/gif",
        image::ImageFormat::WebP => "image/webp",
        _ => return Err("Use PNG, JPEG, GIF or WebP images".into()),
    };
    if mime_type != expected {
        return Err("Image content does not match its file type".into());
    }
    Ok(bytes)
}

fn multipart_image(name: &str, mime_type: &str, bytes: &[u8], boundary: &str) -> Vec<u8> {
    let mut body = format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\nContent-Type: {mime_type}\r\n\r\n").into_bytes();
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    body
}

fn attachment_request(config: &JiraConfig, key: &str, boundary: &str) -> ureq::Request {
    // No credential-bearing redirects or automatic retries for attachment writes.
    crate::integrations::http::agent(HTTP_TIMEOUT, Some(0))
        .post(&format!(
            "{}/rest/api/3/issue/{key}/attachments",
            config.site
        ))
        .set("Authorization", &jira_authorization(config))
        .set("Accept", "application/json")
        .set("X-Atlassian-Token", "no-check")
        .set(
            "Content-Type",
            &format!("multipart/form-data; boundary={boundary}"),
        )
}

#[tauri::command]
pub async fn jira_issue_attachment(
    app: AppHandle,
    key: String,
    name: String,
    mime_type: String,
    data_base64: String,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config = require_config(&app)?;
        let key = require_issue_key(&key)?;
        let bytes = image_bytes(&name, &mime_type, &data_base64)?;
        let boundary = format!("bycoda-{}", uuid::Uuid::new_v4());
        let body = multipart_image(&name, &mime_type, &bytes, &boundary);
        let result = attachment_request(&config, key, &boundary).send_bytes(&body);
        let data = read_jira_response(result)?;
        let id = data.get(0).and_then(|value| string_field(value, "id")).unwrap_or_default();
        if id.is_empty() || !id.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err("Jira did not return an attachment receipt".into());
        }
        Ok(json!({ "id": id, "url": format!("{}/rest/api/3/attachment/content/{id}", config.site) }))
    }).await.map_err(|error| error.to_string())?
}

/// The webview is untrusted: accept only the bounded ADF subset emitted by our editor.
pub(super) fn validate_document(document: &Value) -> Result<(), String> {
    fn node(value: &Value, depth: usize, count: &mut usize) -> bool {
        *count += 1;
        if depth > 16 || *count > 10_000 {
            return false;
        }
        let Some(kind) = value.get("type").and_then(Value::as_str) else {
            return false;
        };
        if !matches!(
            kind,
            "doc"
                | "paragraph"
                | "text"
                | "hardBreak"
                | "strong"
                | "em"
                | "code"
                | "link"
                | "bulletList"
                | "orderedList"
                | "listItem"
                | "codeBlock"
                | "blockquote"
        ) {
            return false;
        }
        if kind == "text"
            && !value
                .get("text")
                .and_then(Value::as_str)
                .is_some_and(|text| !text.is_empty())
        {
            return false;
        }
        if kind == "link"
            && !value
                .pointer("/attrs/href")
                .and_then(Value::as_str)
                .is_some_and(|href| {
                    url::Url::parse(href)
                        .is_ok_and(|url| matches!(url.scheme(), "https" | "http" | "mailto"))
                })
        {
            return false;
        }
        for field in ["content", "marks"] {
            if let Some(children) = value.get(field) {
                let Some(children) = children.as_array() else {
                    return false;
                };
                if !children.iter().all(|child| node(child, depth + 1, count)) {
                    return false;
                }
            }
        }
        true
    }
    if document.get("type").and_then(Value::as_str) != Some("doc")
        || document.get("version").and_then(Value::as_u64) != Some(1)
        || !document
            .get("content")
            .and_then(Value::as_array)
            .is_some_and(|content| !content.is_empty())
        || document.to_string().len() > 200_000
        || !node(document, 0, &mut 0)
    {
        return Err("Invalid Jira comment document".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_authenticated_jira_upload_request() {
        let config = JiraConfig {
            site: "https://example.atlassian.net".into(),
            email: "test@example.com".into(),
            token: "test-token".into(),
        };
        let request = attachment_request(&config, "ENG-42", "boundary");
        assert_eq!(request.method(), "POST");
        assert_eq!(
            request.url(),
            "https://example.atlassian.net/rest/api/3/issue/ENG-42/attachments"
        );
        assert_eq!(request.header("X-Atlassian-Token"), Some("no-check"));
        assert_eq!(
            request.header("Content-Type"),
            Some("multipart/form-data; boundary=boundary")
        );
        assert_eq!(
            request.header("Authorization"),
            Some(jira_authorization(&config).as_str())
        );
    }

    #[test]
    fn builds_multipart_file_field_with_exact_binary_bytes() {
        let body = multipart_image("screen.png", "image/png", &[0, 255, 13, 10], "boundary");
        assert!(body.starts_with(b"--boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"screen.png\"\r\nContent-Type: image/png\r\n\r\n"));
        assert!(body.ends_with(&[
            0, 255, 13, 10, 13, 10, b'-', b'-', b'b', b'o', b'u', b'n', b'd', b'a', b'r', b'y',
            b'-', b'-', 13, 10
        ]));
    }

    #[test]
    fn rejects_forged_images_and_header_injection() {
        assert!(image_bytes("a.png", "image/png", "SGVsbG8=").is_err());
        assert!(image_bytes("a\r\n.png", "image/png", "").is_err());
        assert!(image_bytes("a.png", "image/png", &"A".repeat(IMAGE_LIMIT * 2)).is_err());
        assert!(validate_document(&json!({"type":"doc","version":1,"content":[{"type":"paragraph","content":[{"type":"text","text":"x","marks":[{"type":"link","attrs":{"href":"javascript:alert(1)"}}]}]}]})).is_err());
    }
}
