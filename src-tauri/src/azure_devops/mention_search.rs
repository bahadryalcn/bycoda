use super::*;

fn search_clause(search: &str) -> Result<String, String> {
    if search.len() > 200 || search.chars().any(char::is_control) {
        return Err("Invalid Azure DevOps search".into());
    }
    let mut clauses = vec![format!(
        "[System.Title] CONTAINS '{}'",
        search.replace('\'', "''")
    )];
    if !search.is_empty() && search.chars().all(|c| c.is_ascii_digit()) {
        let mut start: u64 = search.parse().map_err(|_| "Invalid Azure DevOps number")?;
        let mut width = 1_u64;
        while start > 0 && start <= i32::MAX as u64 {
            clauses.push(format!(
                "([System.Id] >= {start} AND [System.Id] <= {})",
                (start + width - 1).min(i32::MAX as u64)
            ));
            start *= 10;
            width *= 10;
        }
    }
    Ok(format!("({})", clauses.join(" OR ")))
}

pub(super) fn search_items(
    config: &AzureDevOpsConfig,
    repo: &str,
    kind: &str,
    search: &str,
    limit: u32,
) -> Result<Vec<AzureDevOpsWorkItem>, String> {
    validate_kind(kind)?;
    let clause = search_clause(search)?;
    let (project, repo_name) = split_repo(repo)?;
    if kind == "pr" {
        // shortcut: Azure PR list has no title search; filter its first 100 active PRs until a search API exists.
        let mut items = azure_fetch_prs(config, &project, &repo_name, repo, "active", 100, None)?;
        if let Ok(number) = search.parse::<i64>() {
            if number > 0 {
                let path = format!(
                    "/{}/_apis/git/repositories/{}/pullrequests/{number}?api-version={API_VERSION}",
                    encode_segment(&project),
                    encode_segment(&repo_name)
                );
                if let Ok(response) = azure_get(config, &path) {
                    if let Some(item) = parse_pr(&response.value, repo, &config.url) {
                        items.push(item);
                    }
                }
            }
        }
        let needle = search.to_lowercase();
        items.retain(|item| {
            item.title.to_lowercase().contains(&needle)
                || item.number.to_string().starts_with(search)
        });
        return Ok(items);
    }
    let base = wit_wiql(Some(&project), false, "open");
    let base = base.split(" ORDER BY").next().unwrap_or(&base);
    let query = format!("{base} AND {clause} ORDER BY [System.Id] ASC");
    let ids = azure_query_wit_ids(config, &query, limit.clamp(1, 100))?;
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    azure_fetch_wit_batch(config, &ids)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn quotes_titles_and_searches_numeric_ranges() {
        assert!(search_clause("owner's bug")
            .unwrap()
            .contains("'owner''s bug'"));
        let query = search_clause("14").unwrap();
        assert!(query.contains("[System.Id] >= 14 AND [System.Id] <= 14"));
        assert!(query.contains("[System.Id] >= 140 AND [System.Id] <= 149"));
        assert!(search_clause("x\n").is_err());
    }
}
