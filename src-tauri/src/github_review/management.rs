//! Bounded GitHub PR metadata and reaction operations. No shell interpolation.
use crate::fs::{expand_home, gh_checked, split_github_repo, with_temp_markdown};
use serde_json::{json, Value};
use std::path::Path;

fn target(repo: &str, number: i64) -> Result<String, String> {
    if number <= 0 {
        return Err("Invalid pull request number".into());
    }
    let (owner, name) = split_github_repo(repo)?;
    if !owner
        .bytes()
        .chain(name.bytes())
        .all(|c| c.is_ascii_alphanumeric() || b"_.-".contains(&c))
    {
        return Err("Invalid GitHub repository".into());
    }
    Ok(format!("{owner}/{name}"))
}

fn values(mode: &str, entries: &[String], reviewers: bool) -> Result<(), String> {
    let allowed = if reviewers {
        ["list", "request", "remove"]
    } else {
        ["list", "add", "remove"]
    };
    if !allowed.contains(&mode) || entries.len() > 20 || (mode == "list") != entries.is_empty() {
        return Err("Invalid pull request metadata operation".into());
    }
    for value in entries {
        if value.is_empty()
            || value.len() > 100
            || value.trim() != value
            || value.chars().any(char::is_control)
            || reviewers
                && (!value.as_bytes()[0].is_ascii_alphanumeric()
                    || !value
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || c == b'-'))
        {
            return Err("Invalid pull request metadata value".into());
        }
    }
    Ok(())
}

fn read(root: &Path, args: &[&str]) -> Result<Value, String> {
    serde_json::from_str(&gh_checked(root, args)?).map_err(|_| "Invalid GitHub response".into())
}

fn graphql(root: &Path, query: &str, variables: Value) -> Result<Value, String> {
    let result = with_temp_markdown(
        &json!({"query":query,"variables":variables}).to_string(),
        |path| {
            gh_checked(
                root,
                &[
                    "api",
                    "--hostname",
                    "github.com",
                    "graphql",
                    "--input",
                    path,
                ],
            )
        },
    )?;
    let result: Value = serde_json::from_str(&result).map_err(|_| "Invalid GitHub response")?;
    if result.get("errors").is_some() {
        return Err("GitHub rejected the reaction request".into());
    }
    Ok(result)
}

#[tauri::command]
pub async fn git_github_pr_reviewers(
    cwd: String,
    repo: String,
    number: i64,
    mode: String,
    logins: Vec<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo = target(&repo, number)?;
        values(&mode, &logins, true)?;
        let root = expand_home(&cwd);
        let number = number.to_string();
        if mode == "list" {
            return read(
                &root,
                &[
                    "pr",
                    "view",
                    &number,
                    "--repo",
                    &repo,
                    "--json",
                    "reviewRequests,latestReviews",
                ],
            );
        }
        let flag = if mode == "request" {
            "--add-reviewer"
        } else {
            "--remove-reviewer"
        };
        let mut args = vec!["pr", "edit", &number, "--repo", &repo];
        for login in &logins {
            args.extend([flag, login.as_str()]);
        }
        gh_checked(&root, &args)?;
        Ok(json!({"updated":true}))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_github_pr_labels(
    cwd: String,
    repo: String,
    number: i64,
    mode: String,
    names: Vec<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo = target(&repo, number)?;
        values(&mode, &names, false)?;
        let root = expand_home(&cwd);
        let number = number.to_string();
        if mode == "list" {
            let current = read(&root, &["pr", "view", &number, "--repo", &repo, "--json", "labels"])?;
            let available = read(&root, &["label", "list", "--repo", &repo, "--limit", "1000", "--json", "name,color"])?;
            return Ok(json!({"labels":current["labels"],"truncated":available.as_array().is_some_and(|v| v.len() == 1000),"available":available}));
        }
        // REST accepts exact label strings (including commas), unlike gh edit's comma-separated flags.
        let endpoint = format!("repos/{repo}/issues/{number}/labels");
        if mode == "add" {
            with_temp_markdown(&json!({"labels":names}).to_string(), |path| {
                gh_checked(&root, &["api", "--hostname", "github.com", "--method", "POST", &endpoint, "--input", path])
            })?;
        } else {
            for name in names {
                let encoded: String = name.bytes().map(|b| format!("%{b:02X}")).collect();
                gh_checked(&root, &["api", "--hostname", "github.com", "--method", "DELETE", &format!("{endpoint}/{encoded}")])?;
            }
        }
        Ok(json!({"updated":true}))
    }).await.map_err(|e| e.to_string())?
}

fn reaction_input(mode: &str, subject: &str, content: &str) -> Result<(), String> {
    if !["add", "remove"].contains(&mode)
        || subject.is_empty()
        || subject.len() > 200
        || !subject
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_=-".contains(&b))
        || ![
            "THUMBS_UP",
            "THUMBS_DOWN",
            "LAUGH",
            "HOORAY",
            "CONFUSED",
            "HEART",
            "ROCKET",
            "EYES",
        ]
        .contains(&content)
    {
        return Err("Invalid GitHub reaction".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn git_github_pr_reaction(
    cwd: String,
    repo: String,
    number: i64,
    mode: String,
    subject_id: String,
    content: String,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo = target(&repo, number)?;
        reaction_input(&mode, &subject_id, &content)?;
        let root = expand_home(&cwd);
        // Resolve ownership before allowing a client-supplied node ID to mutate anything.
        let subject = graphql(&root, "query($id:ID!){node(id:$id){... on IssueComment{pullRequest{number repository{nameWithOwner}}} ... on PullRequestReviewComment{pullRequest{number repository{nameWithOwner}}} ... on PullRequestReview{pullRequest{number repository{nameWithOwner}}}}}", json!({"id":subject_id}))?;
        let node = &subject["data"]["node"];
        let owner = node.get("pullRequest").ok_or("Unsupported reaction subject")?;
        if owner["number"].as_i64() != Some(number) || !owner["repository"]["nameWithOwner"].as_str().is_some_and(|v| v.eq_ignore_ascii_case(&repo)) {
            return Err("Reaction subject belongs to another pull request".into());
        }
        let mutation = if mode == "add" { "addReaction" } else { "removeReaction" };
        graphql(&root, &format!("mutation($input:{mutation_type}!){{{mutation}(input:$input){{subject{{id}}}}}}", mutation_type=if mode == "add" {"AddReactionInput"} else {"RemoveReactionInput"}), json!({"input":{"subjectId":subject_id,"content":content}}))?;
        Ok(json!({"updated":true}))
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_metadata_before_execution() {
        assert!(target("owner/repo", 0).is_err());
        assert!(values("request", &["--repo".into()], true).is_err());
        assert!(values("remove", &[], false).is_err());
        assert!(values("list", &["bug".into()], false).is_err());
        assert!(values("add", &["needs,review".into()], false).is_ok());
        assert!(reaction_input("add", "IC_123", "HEART").is_ok());
        assert!(reaction_input("delete", "IC_123", "HEART").is_err());
        assert!(reaction_input("add", "IC_123", "unknown").is_err());
    }
}
