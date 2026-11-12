//! Batched numeric-prefix lookup complements GitHub's text-only list search.
use crate::fs::split_github_repo;
use serde_json::{json, Value};

fn prefix_numbers(prefix: &str) -> Result<Vec<u64>, String> {
    if prefix.is_empty() || !prefix.chars().all(|c| c.is_ascii_digit()) {
        return Err("Invalid GitHub number prefix".into());
    }
    let number: u64 = prefix.parse().map_err(|_| "Invalid GitHub number prefix")?;
    if number == 0 || number > i32::MAX as u64 {
        return Err("Invalid GitHub number prefix".into());
    }
    let mut numbers = vec![number];
    let mut width = 10_u64;
    // Bound GraphQL cost while covering the closest identifiers before larger numbers.
    while numbers.len() < 100 && number * width <= i32::MAX as u64 {
        for candidate in number * width..(number * width + width).min(i32::MAX as u64 + 1) {
            numbers.push(candidate);
            if numbers.len() == 100 {
                break;
            }
        }
        width *= 10;
    }
    Ok(numbers)
}

fn prefix_query(repo: &str, prefix: &str) -> Result<String, String> {
    let (owner, name) = split_github_repo(repo)?;
    let fields = "number title url state updatedAt assignees(first:10){nodes{login}} labels(first:10){nodes{name color}}";
    let entries = prefix_numbers(prefix)?.iter().map(|number| format!(
        "n{number}:issueOrPullRequest(number:{number}){{... on Issue{{{fields}}} ... on PullRequest{{{fields} isDraft}}}}"
    )).collect::<Vec<_>>().join(" ");
    Ok(format!(
        "query{{repository(owner:{},name:{}){{{entries}}}}}",
        json!(owner),
        json!(name)
    ))
}

fn parse_prefix(data: &Value, repo: &str) -> Vec<Value> {
    data["data"]["repository"]
        .as_object()
        .into_iter()
        .flat_map(|rows| rows.values())
        .filter(|row| row["number"].as_i64().is_some())
        .map(|row| {
            json!({
                "kind": if row.get("isDraft").is_some() { "pr" } else { "issue" },
                "number": row["number"], "title": row["title"], "url": row["url"],
                "state": row["state"], "updatedAt": row["updatedAt"],
                "labels": row["labels"]["nodes"].as_array().cloned().unwrap_or_default(),
                "assignees": row["assignees"]["nodes"].as_array().cloned().unwrap_or_default(),
                "draft": row["isDraft"].as_bool().unwrap_or(false), "repo": repo,
            })
        })
        .collect()
}

#[tauri::command]
pub async fn github_mention_prefix(repo: String, prefix: String) -> Result<Vec<Value>, String> {
    let query = prefix_query(&repo, &prefix)?;
    tauri::async_runtime::spawn_blocking(move || {
        let token = crate::inbox_media::github_auth_token_fresh()?
            .filter(|value| !value.is_empty())
            .ok_or("GitHub account unavailable")?;
        // HTTP retains GraphQL partial data when some prefix candidates do not exist.
        let response = crate::integrations::http::agent(std::time::Duration::from_secs(8), Some(0))
            .post("https://api.github.com/graphql")
            .set("Authorization", &format!("Bearer {token}"))
            .set("User-Agent", "bycoda")
            .set("Content-Type", "application/json")
            .send_string(&json!({ "query": query }).to_string())
            .map_err(|error| error.to_string())?
            .into_string()
            .map_err(|_| "Invalid GitHub prefix response")?;
        let data: Value =
            serde_json::from_str(&response).map_err(|_| "Invalid GitHub prefix response")?;
        if !data["data"]["repository"].is_object() {
            return Err("GitHub prefix search unavailable".into());
        }
        Ok(parse_prefix(&data, &repo))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn batch_is_bounded_and_orders_shorter_numbers_first() {
        let numbers = prefix_numbers("14").unwrap();
        assert_eq!(&numbers[..3], &[14, 140, 141]);
        assert_eq!(numbers.len(), 100);
        assert!(prefix_numbers("0").is_err());
        assert!(prefix_numbers("14){}").is_err());
        assert!(prefix_query("owner/repo", "14")
            .unwrap()
            .contains("n14:issueOrPullRequest(number:14)"));
    }
    #[test]
    fn ignores_missing_numbers_and_keeps_issue_and_pr_ownership() {
        let data = json!({"data":{"repository":{
            "n14": {"number":14,"title":"Bug","state":"OPEN","assignees":{"nodes":[{"login":"ayse"}]},"labels":{"nodes":[]}},
            "n140": null,
            "n141": {"number":141,"isDraft":false,"assignees":{"nodes":[]}}
        }}});
        let rows = parse_prefix(&data, "owner/repo");
        assert_eq!(rows.len(), 2);
        assert!(rows
            .iter()
            .any(|row| row["kind"] == "issue" && row["assignees"][0]["login"] == "ayse"));
        assert!(rows.iter().any(|row| row["kind"] == "pr"));
    }
}
