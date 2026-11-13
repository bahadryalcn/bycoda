use super::*;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraListPage {
    issues: Vec<JiraIssue>,
    next_page_token: Option<String>,
    total: Option<u64>,
}

fn parse_page(data: &Value, site: &str) -> Result<JiraListPage, String> {
    let token = string_field(data, "nextPageToken").filter(|value| !value.is_empty());
    if data["isLast"].as_bool() == Some(false) && token.is_none() {
        return Err("Jira did not return the next issue page token".into());
    }
    Ok(JiraListPage {
        issues: parse_jira_issues(data, site)?,
        next_page_token: if data["isLast"].as_bool() == Some(true) {
            None
        } else {
            token
        },
        total: data["total"].as_u64(),
    })
}

/// Cursor reads use the same saved account, project validation and JQL filters as the legacy array read.
#[tauri::command]
pub async fn jira_list_issue_page(
    app: AppHandle,
    assigned_to_me: bool,
    state: String,
    project_ids: Vec<String>,
    limit: Option<u32>,
    filters: Option<filters::JiraIssueFilters>,
    next_page_token: Option<String>,
) -> Result<JiraListPage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config = require_config(&app)?;
        mention_search::validate_projects(&project_ids)?;
        let filters = filters.unwrap_or_default();
        let jql = filters.jql(assigned_to_me, &state, &project_ids)?;
        let mut body = json!({
            "jql": jql,
            "maxResults": limit.unwrap_or(DEFAULT_LIMIT).clamp(1, 100),
            "fields": ISSUE_FIELDS,
        });
        if let Some(token) = next_page_token {
            body["nextPageToken"] = Value::String(token);
        }
        let data = jira_post(&config, "/rest/api/3/search/jql", &body)?;
        parse_page(&data, &config.site)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_cursor_and_truthful_optional_total() {
        let page = parse_page(
            &json!({"issues": [], "nextPageToken": "second", "isLast": false}),
            "https://example.atlassian.net",
        )
        .unwrap();
        assert_eq!(page.next_page_token.as_deref(), Some("second"));
        assert_eq!(page.total, None);
        let last = parse_page(
            &json!({"issues": [], "nextPageToken": "stale", "isLast": true, "total": 42}),
            "https://example.atlassian.net",
        )
        .unwrap();
        assert_eq!(last.next_page_token, None);
        assert_eq!(last.total, Some(42));
        assert!(parse_page(
            &json!({"issues": [], "isLast": false}),
            "https://example.atlassian.net"
        )
        .is_err());
    }
}
