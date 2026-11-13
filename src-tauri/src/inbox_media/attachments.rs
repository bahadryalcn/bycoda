/// Attachment links carry untrusted filenames and URLs into Markdown.
pub(crate) fn markdown_link(name: &str, raw: &str) -> Option<String> {
    let mut url = url::Url::parse(raw).ok()?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    url.set_fragment(None);
    let label: String = name
        .chars()
        .flat_map(|c| match c {
            '\\' | '[' | ']' => vec!['\\', c],
            '\r' | '\n' => vec![' '],
            _ => vec![c],
        })
        .collect();
    let target = url.as_str().replace('<', "%3C").replace('>', "%3E");
    Some(format!("[{label}](<{target}>)"))
}

pub(crate) fn matches_site(url: &url::Url, site: &url::Url) -> bool {
    let prefix = format!("{}/", site.path().trim_end_matches('/'));
    url.scheme() == "https"
        && url.origin() == site.origin()
        && url.path().starts_with(&prefix)
        && url.username().is_empty()
        && url.password().is_none()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn filenames_cannot_create_extra_markdown_links() {
        let link = markdown_link("a]\n[click](evil)", "https://example.com/file").unwrap();
        assert_eq!(link, "[a\\] \\[click\\](evil)](<https://example.com/file>)");
        assert!(markdown_link("bad", "javascript:alert(1)").is_none());
        assert!(markdown_link("bad", "https://token@example.com/file").is_none());
    }
    #[test]
    fn credentials_stay_on_the_configured_origin_and_tenant_path() {
        let site = url::Url::parse("https://dev.azure.com/acme").unwrap();
        assert!(matches_site(
            &site.join("/acme/project/_apis/wit/attachments/1").unwrap(),
            &site
        ));
        for raw in [
            "https://dev.azure.com/other/file",
            "https://dev.azure.com/acme-other/file",
            "https://dev.azure.com.evil.test/acme/file",
            "http://dev.azure.com/acme/file",
            "https://dev.azure.com:444/acme/file",
            "https://user@dev.azure.com/acme/file",
        ] {
            assert!(!matches_site(&url::Url::parse(raw).unwrap(), &site));
        }
    }
}
