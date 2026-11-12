//! Bounded mention search; callers supply text, never raw JQL.
use super::*;
use std::collections::HashSet;

const PICKER_LIMIT: usize = 20;

fn validate_search(search: &str) -> Result<&str, String> {
    if search.len() > 200 || search.chars().any(char::is_control) {
        return Err("Invalid Jira search".into());
    }
    Ok(search.trim())
}

pub(super) fn validate_projects(project_ids: &[String]) -> Result<(), String> {
    if project_ids
        .iter()
        .any(|id| id.is_empty() || !id.chars().all(|ch| ch.is_ascii_digit()))
    {
        return Err("Invalid Jira project scope".into());
    }
    Ok(())
}

fn picker_path(search: &str, current_jql: &str) -> Result<String, String> {
    let search = validate_search(search)?;
    let mut params = url::form_urlencoded::Serializer::new(String::new());
    params.append_pair("query", search);
    if !current_jql.is_empty() {
        params.append_pair("currentJQL", current_jql);
    }
    params.append_pair("showSubTasks", "true");
    Ok(format!("/rest/api/3/issue/picker?{}", params.finish()))
}

fn picker_keys(data: &Value) -> Result<Vec<String>, String> {
    let sections = data["sections"]
        .as_array()
        .ok_or("Jira did not return picker sections")?;
    let mut seen = HashSet::new();
    Ok(sections
        .iter()
        .filter_map(|section| section["issues"].as_array())
        .flatten()
        .filter_map(|issue| issue["key"].as_str())
        .filter(|key| require_issue_key(key).is_ok())
        .map(str::to_ascii_uppercase)
        .filter(|key| seen.insert(key.clone()))
        .take(PICKER_LIMIT)
        .collect())
}

fn hydration_jql(keys: &[String], current_jql: &str) -> String {
    let keys = keys
        .iter()
        .map(|key| format!("\"{key}\""))
        .collect::<Vec<_>>();
    format!("key in ({}) AND ({current_jql})", keys.join(", "))
}

fn order_issues(keys: &[String], mut issues: Vec<JiraIssue>) -> Vec<JiraIssue> {
    issues.retain(|issue| keys.contains(&issue.identifier));
    issues.sort_by_key(|issue| keys.iter().position(|key| key == &issue.identifier));
    issues
}

pub(super) fn picker_issues(
    config: &JiraConfig,
    filters: &filters::JiraIssueFilters,
    assigned_to_me: bool,
    state: &str,
    project_ids: &[String],
    limit: u32,
) -> Result<Vec<JiraIssue>, String> {
    validate_projects(project_ids)?;
    let jql = filters.jql(assigned_to_me, state, project_ids)?;
    let current_jql = jql.strip_suffix(" ORDER BY updated DESC").unwrap_or(&jql);
    let data = jira_get(config, &picker_path(&filters.search, current_jql)?)?;
    let mut keys = picker_keys(&data)?;
    keys.truncate(limit.min(PICKER_LIMIT as u32) as usize);
    if keys.is_empty() {
        return Ok(Vec::new());
    }
    // History sections can ignore currentJQL; enforce scope again during hydration.
    let data = jira_post(
        config,
        "/rest/api/3/search/jql",
        &json!({
            "jql": hydration_jql(&keys, current_jql),
            "maxResults": keys.len(),
            "fields": ISSUE_FIELDS,
        }),
    )?;
    Ok(order_issues(&keys, parse_jira_issues(&data, &config.site)?))
}

pub(super) fn search_clause(search: &str) -> Result<String, String> {
    let search = validate_search(search)?;
    // Escape Lucene syntax before quoting the JQL string. Only our trailing wildcard is active.
    let mut literal = String::new();
    for ch in search.chars() {
        if "+-!(){}[]^\"~*?:\\/|&".contains(ch) {
            literal.push('\\');
        }
        literal.push(ch);
    }
    let literal = format!("{literal}*")
        .replace('\\', "\\\\")
        .replace('"', "\\\"");
    Ok(format!("text ~ \"{literal}\""))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn picker_encodes_parameters_and_rejects_invalid_search() {
        assert_eq!(picker_path("PROJ-9 & café?", "project in (100, 200)").unwrap(), "/rest/api/3/issue/picker?query=PROJ-9+%26+caf%C3%A9%3F&currentJQL=project+in+%28100%2C+200%29&showSubTasks=true");
        assert_eq!(
            picker_path("9", "").unwrap(),
            "/rest/api/3/issue/picker?query=9&showSubTasks=true"
        );
        assert!(picker_path("9\n", "").is_err());
        assert!(picker_path(&"a".repeat(201), "").is_err());
    }

    #[test]
    fn picker_parses_sections_deduplicates_and_bounds_keys() {
        let keys = picker_keys(&json!({"sections": [
            {"issues": [{"key": "PROJ-9", "summaryText": "Plain"}, {"key": "PROJ-90", "summary": "<b>HTML</b>"}]},
            {"issues": [{"key": "proj-9"}, {"key": "ENG-9"}, {"key": "x\" OR true"}, {}]}, {}
        ]})).unwrap();
        assert_eq!(keys, ["PROJ-9", "PROJ-90", "ENG-9"]);
        assert_eq!(
            hydration_jql(&keys, "project in (100)"),
            "key in (\"PROJ-9\", \"PROJ-90\", \"ENG-9\") AND (project in (100))"
        );
        assert!(picker_keys(&json!({"sections": []})).unwrap().is_empty());
        assert!(picker_keys(&json!({"sections": [{"issues": []}]}))
            .unwrap()
            .is_empty());
        assert!(picker_keys(&json!({})).is_err());
        let issues: Vec<_> = (1..=30)
            .map(|n| json!({"key": format!("PROJ-{n}")}))
            .collect();
        assert_eq!(
            picker_keys(&json!({"sections": [{"issues": issues}]}))
                .unwrap()
                .len(),
            20
        );
    }

    #[test]
    fn picker_scope_uses_validated_ids_without_text_clause() {
        let filters = filters::JiraIssueFilters {
            search: "PROJ-9".into(),
            issue_picker: true,
            ..Default::default()
        };
        assert_eq!(
            filters
                .jql(false, "open", &["100".into(), "200".into()])
                .unwrap(),
            "project in (100, 200) AND statusCategory != Done ORDER BY updated DESC"
        );
        assert!(validate_projects(&["100".into(), "200".into()]).is_ok());
        assert!(validate_projects(&[]).is_ok());
        for id in ["", "PROJ", "100) OR project = OTHER", "100\n"] {
            assert!(validate_projects(&[id.into()]).is_err());
        }
    }

    #[test]
    fn hydration_restores_picker_order_and_omits_unrequested_rows() {
        let rows = json!({"issues": [{"id": "90", "key": "PROJ-90"}, {"id": "8", "key": "PROJ-8"}, {"id": "9", "key": "PROJ-9"}]});
        let issues = order_issues(
            &["PROJ-9".into(), "PROJ-90".into()],
            parse_jira_issues(&rows, "https://example.atlassian.net").unwrap(),
        );
        assert_eq!(
            issues
                .iter()
                .map(|issue| issue.identifier.as_str())
                .collect::<Vec<_>>(),
            ["PROJ-9", "PROJ-90"]
        );
    }
    #[test]
    fn text_cannot_escape_jql_or_lucene() {
        assert_eq!(search_clause("login").unwrap(), "text ~ \"login*\"");
        assert!(search_clause("bad\nquery").is_err());
        assert!(search_clause(&"a".repeat(201)).is_err());
        assert!(search_clause("x\" OR project = X")
            .unwrap()
            .contains("\\\\\\\""));
    }
}
