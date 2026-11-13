use serde_json::Value;

pub(super) fn is_attachment_path(path: &str) -> bool {
    for prefix in [
        "/rest/api/2/attachment/content/",
        "/rest/api/3/attachment/content/",
        "/rest/api/2/attachment/thumbnail/",
        "/rest/api/3/attachment/thumbnail/",
    ] {
        if let Some(id) = path.strip_prefix(prefix) {
            return !id.is_empty() && id.bytes().all(|byte| byte.is_ascii_digit());
        }
    }
    path.strip_prefix("/secure/attachment/")
        .and_then(|tail| tail.split_once('/'))
        .is_some_and(|(id, name)| {
            !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit()) && !name.is_empty()
        })
}

/// Jira media UUIDs in ADF are not REST attachment IDs. Keep the complete issue
/// attachment collection visible, including files referenced only by name in text.
pub(super) fn append_attachments(body: &mut String, fields: &Value) {
    let Some(files) = fields.get("attachment").and_then(Value::as_array) else {
        return;
    };
    for file in files {
        let Some(raw) = file.get("content").and_then(Value::as_str) else {
            continue;
        };
        let Ok(mut url) = url::Url::parse(raw) else {
            continue;
        };
        if url.scheme() != "https"
            || !url.username().is_empty()
            || url.password().is_some()
            || !is_attachment_path(url.path())
        {
            continue;
        }
        let name = file
            .get("filename")
            .and_then(Value::as_str)
            .unwrap_or("Attachment");
        // Ask Jira to return bytes on its authenticated origin rather than a CDN redirect.
        if url.path().starts_with("/rest/api/") {
            url.query_pairs_mut().append_pair("redirect", "false");
        }
        if let Some(link) = crate::inbox_media::attachments::markdown_link(name, url.as_str()) {
            body.push_str("\n\n");
            body.push_str(&link);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn keeps_images_and_documents_as_openable_links() {
        let mut body = "Steps".to_string();
        append_attachments(
            &mut body,
            &json!({"attachment": [
                {"filename":"shot [1].png", "content":"https://acme.atlassian.net/rest/api/3/attachment/content/12"},
                {"filename":"report.pdf", "content":"https://acme.atlassian.net/rest/api/3/attachment/content/13"},
                {"filename":"unsafe", "content":"https://evil.example/login"}
            ]}),
        );
        assert!(body.contains("[shot \\[1\\].png](<https://acme.atlassian.net/rest/api/3/attachment/content/12?redirect=false>)"));
        assert!(body.contains("[report.pdf]"));
        assert!(!body.contains("unsafe"));
    }

    #[test]
    fn only_attachment_endpoints_accept_credentials() {
        assert!(is_attachment_path("/rest/api/3/attachment/content/12"));
        assert!(is_attachment_path("/secure/attachment/12/shot.png"));
        for path in [
            "/rest/api/3/attachment/content/",
            "/rest/api/3/attachment/content/12/other",
            "/rest/api/3/issue/APP-1",
        ] {
            assert!(!is_attachment_path(path));
        }
    }
}
