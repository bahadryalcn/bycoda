pub(super) fn social_peer_endpoint(value: &str) -> Result<String, String> {
    let url = url::Url::parse(value).map_err(|_| "Use a stable HTTPS social authority endpoint")?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !matches!(url.path(), "" | "/")
        || !(url.scheme() == "https"
            || (url.scheme() == "http"
                && matches!(url.host_str(), Some("localhost" | "127.0.0.1"))))
    {
        return Err("Use a stable HTTPS social authority endpoint or loopback endpoint. An SSH tunnel address cannot be stored as peer authority.".into());
    }
    Ok(url.origin().ascii_serialization())
}
