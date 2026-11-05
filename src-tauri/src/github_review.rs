//! One approved review, including all inline comments, is submitted in one POST.
use crate::fs::{
    expand_home, gh_checked, git_github_pr_diff_for, split_github_repo, with_temp_markdown,
    GitHubPrDiff,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Captured GitHub credential is native-only and passed only to a child environment.
pub(crate) struct RoomGithubAccount { token: String, login: String }
impl RoomGithubAccount {
    pub(crate) fn capture(cwd: &str) -> Result<Self, String> {
        let token = crate::inbox_media::github_auth_token_fresh()?.filter(|value| !value.is_empty())
            .ok_or("GitHub account unavailable")?;
        let result = crate::fs::gh_checked_with_token(&expand_home(cwd), &["api", "--hostname", "github.com", "user"], &token)?;
        let user: Value = serde_json::from_str(&result).map_err(|_| "Invalid GitHub account response")?;
        let login = user["login"].as_str().filter(|value| !value.is_empty() && value.len() <= 200)
            .ok_or("GitHub account identity unavailable")?.to_owned();
        Ok(Self { token, login })
    }
    pub(crate) fn login(&self) -> &str { &self.login }
    pub(crate) fn list(&self, cwd: &str, state: &str, assigned: bool, search: &str, kinds: &[String], guard: impl Fn() -> Result<(), String>) -> Result<Vec<Value>, String> {
        if !matches!(state, "open" | "all") || search.len() > 500 || search.contains('\0') { return Err("Invalid GitHub list filter".into()); }
        if kinds.len() > 2 || kinds.iter().any(|kind| !matches!(kind.as_str(), "issue" | "pr")) { return Err("Invalid GitHub item kinds".into()); }
        let root = expand_home(cwd);
        guard()?;
        let repo = crate::fs::gh_checked_with_token(&root, &["repo", "view", "--json", "nameWithOwner"], &self.token)?;
        let repo: Value = serde_json::from_str(&repo).map_err(|_| "Invalid repository response")?;
        let name = repo["nameWithOwner"].as_str().ok_or("GitHub repository unavailable")?;
        crate::fs::split_github_repo(name)?;
        let mut result = Vec::new();
        for kind in kinds {
            guard()?;
            let items = crate::fs::git_github_work_items_for_token(&root, name, kind, assigned, state, search, 40, Some(&self.token))?;
            guard()?;
            for item in items {
                let mut row = serde_json::to_value(item).map_err(|_| "Invalid GitHub list result")?;
                row["provider"] = json!("github"); row["projectPath"] = json!(cwd);
                result.push(row);
            }
        }
        Ok(result)
    }
    pub(crate) fn current(&self, cwd: &str) -> Result<(), String> {
        let _ = cwd;
        let current = crate::inbox_media::github_auth_token_fresh()?.ok_or("GitHub account unavailable")?;
        if self.token != current {
            return Err("GitHub account changed; review the operation again".into());
        }
        Ok(())
    }
    #[allow(clippy::too_many_arguments)] // Each argument is a separately validated field of the GitHub write; a struct would only rename them.
    pub(crate) fn item(&self, cwd: &str, repo: &str, kind: &str, number: i64, action: &str, body: &str, guard: impl Fn() -> Result<(), String>) -> Result<Value, String> {
        let root = expand_home(cwd);
        guard()?;
        let result = match action {
            "details" => serde_json::to_value(crate::fs::git_github_work_item_details_for_token(&root, repo, kind, number, Some(&self.token))?).map_err(|_| "Invalid GitHub details")?,
            "thread" => serde_json::to_value(crate::fs::git_github_work_item_thread_for_token(&root, repo, kind, number, Some(&self.token))?).map_err(|_| "Invalid GitHub thread")?,
            "comment" => Value::String(crate::fs::git_github_work_item_comment_for_token(&root, repo, kind, number, body, "", Some(&self.token))?),
            _ => return Err("Invalid GitHub item action".into()),
        };
        guard()?;
        Ok(result)
    }
    pub(crate) fn pr_action(&self, cwd: &str, repo: &str, number: i64, action: &str, expected_head: &str, guard: impl Fn() -> Result<(), String>) -> Result<Value, String> {
        guard()?;
        let result = crate::fs::git_github_pr_action_for_token(&expand_home(cwd), repo, number, action, expected_head, Some(&self.token))?;
        guard()?;
        serde_json::to_value(result).map_err(|_| "Invalid GitHub action result".into())
    }
    pub(crate) fn review_context(&self, cwd: &str, repo: &str, number: i64, guard: impl Fn() -> Result<(), String>) -> Result<Value, String> {
        let root = expand_home(cwd);
        let endpoint = pull_endpoint(repo, number)?;
        let read_head = || -> Result<String, String> { guard()?; head_sha(&crate::fs::gh_checked_with_token(&root, &["api", "--hostname", "github.com", &endpoint], &self.token)?) };
        let before = read_head()?;
        let diff = crate::fs::git_github_pr_diff_for_token(&root, repo, number, false, Some(&self.token), &guard)?;
        let after = read_head()?;
        if before != after { return Err("PR changed while reading the diff. Read review context again.".into()); }
        guard()?;
        serde_json::to_value(ReviewContext { commit_id: before, diff }).map_err(|_| "Invalid review context".into())
    }
    pub(crate) fn review(&self, cwd: &str, repo: &str, number: i64, review: &ReviewInput,
        guard: impl Fn() -> Result<(), String>) -> Result<String, String> {
        execute_review_guarded_with_token(cwd, repo, number, review, guard, Some(&self.token))
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewComment {
    path: String,
    line: u32,
    side: String,
    body: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    start_line: Option<u32>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewInput {
    commit_id: String,
    event: String,
    body: String,
    comments: Vec<ReviewComment>,
}

fn text_ok(value: &str, maximum: usize, empty: bool) -> bool {
    (empty || !value.trim().is_empty())
        && value.encode_utf16().count() <= maximum
        && !value.contains('\0')
}

fn valid_sha(value: &str) -> bool {
    value.len() == 40
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

impl ReviewInput {
    fn validate(&self) -> Result<(), String> {
        if !valid_sha(&self.commit_id)
            || !matches!(
                self.event.as_str(),
                "COMMENT" | "APPROVE" | "REQUEST_CHANGES"
            )
            || !text_ok(&self.body, 30000, self.event == "APPROVE")
            || self.comments.len() > 50
        {
            return Err("Invalid GitHub review commit, event or content".into());
        }
        let mut length = self.body.encode_utf16().count();
        for comment in &self.comments {
            if !text_ok(&comment.path, 1000, false)
                || comment.path.contains(['\\', ':'])
                || comment
                    .path
                    .split('/')
                    .any(|part| part.is_empty() || part == "." || part == "..")
                || comment.line == 0
                || comment.line > i32::MAX as u32
                || !matches!(comment.side.as_str(), "LEFT" | "RIGHT")
                || comment
                    .start_line
                    .is_some_and(|start| start == 0 || start >= comment.line)
                || !text_ok(&comment.body, 30000, false)
            {
                return Err("Invalid GitHub review comment path, range, side or content".into());
            }
            length += comment.body.encode_utf16().count();
        }
        if length > 60000 {
            return Err("GitHub review content is too large".into());
        }
        Ok(())
    }

    pub(crate) fn approval_content(operation: &Value) -> Result<String, String> {
        let review: Self = serde_json::from_value(json!({
            "commitId": operation["commitId"], "event": operation["event"],
            "body": operation["body"], "comments": operation["comments"]
        }))
        .map_err(|_| "Invalid GitHub review approval")?;
        review.validate()?;
        let mut content = format!(
            "Review: {}\nCommit: {}\n\n{}",
            review.event, review.commit_id, review.body
        );
        for comment in review.comments {
            let range = comment
                .start_line
                .map(|start| format!("{start}-"))
                .unwrap_or_default();
            content.push_str(&format!(
                "\n\nFile: {}\nLines: {range}{} ({})\n{}",
                comment.path, comment.line, comment.side, comment.body
            ));
        }
        Ok(content)
    }

    fn payload(&self) -> Value {
        let comments: Vec<Value> = self.comments.iter().map(|comment| {
            let mut value = json!({"path":comment.path,"line":comment.line,"side":comment.side,"body":comment.body});
            if let Some(start) = comment.start_line {
                value["start_line"] = json!(start);
                value["start_side"] = json!(comment.side);
            }
            value
        }).collect();
        json!({"commit_id":self.commit_id,"event":self.event,"body":self.body,"comments":comments})
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewContext {
    commit_id: String,
    #[serde(flatten)]
    diff: GitHubPrDiff,
}

pub(crate) fn pull_endpoint(repo: &str, number: i64) -> Result<String, String> {
    if number <= 0 {
        return Err("Invalid pull request number".into());
    }
    let (owner, name) = split_github_repo(repo)?;
    if [&owner, &name].iter().any(|part| {
        matches!(part.as_str(), "." | "..")
            || !part
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    }) {
        return Err("Invalid GitHub review repository".into());
    }
    Ok(format!("repos/{owner}/{name}/pulls/{number}"))
}

fn head_sha(response: &str) -> Result<String, String> {
    let value: Value =
        serde_json::from_str(response).map_err(|_| "Invalid GitHub pull request response")?;
    value["head"]["sha"]
        .as_str()
        .filter(|sha| valid_sha(sha))
        .map(str::to_owned)
        .ok_or_else(|| "GitHub did not return the PR head commit".into())
}

#[tauri::command]
pub async fn git_github_pr_review_context(
    cwd: String,
    repo: String,
    number: i64,
) -> Result<ReviewContext, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = expand_home(&cwd);
        let endpoint = pull_endpoint(&repo, number)?;
        let before = head_sha(&gh_checked(
            &root,
            &["api", "--hostname", "github.com", &endpoint],
        )?)?;
        let diff = git_github_pr_diff_for(&root, &repo, number, false)?;
        let after = head_sha(&gh_checked(
            &root,
            &["api", "--hostname", "github.com", &endpoint],
        )?)?;
        if before != after {
            return Err("PR changed while reading the diff. Read review context again.".into());
        }
        Ok(ReviewContext {
            commit_id: before,
            diff,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

fn submit_review_with(
    repo: &str,
    number: i64,
    review: &ReviewInput,
    mut api: impl FnMut(&str, Option<&Value>) -> Result<String, String>,
) -> Result<String, String> {
    review.validate()?;
    let endpoint = pull_endpoint(repo, number)?;
    let current = head_sha(&api(&endpoint, None)?)?;
    if current != review.commit_id {
        return Err("PR head changed since this review was prepared. Read review context and request approval again.".into());
    }
    // Explicit event avoids leaving a pending review; never retry a POST automatically.
    let response = api(&format!("{endpoint}/reviews"), Some(&review.payload()))?;
    let result: Value = serde_json::from_str(&response).map_err(|_| {
        "Review submission result is uncertain. Inspect GitHub before another send."
    })?;
    result["html_url"]
        .as_str()
        .filter(|url| url.starts_with("https://github.com/"))
        .map(str::to_owned)
        .ok_or_else(|| {
            "Review submission result is uncertain. Inspect GitHub before another send.".into()
        })
}

#[tauri::command]
pub async fn git_github_pr_review(
    cwd: String,
    repo: String,
    number: i64,
    review: ReviewInput,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        execute_review_guarded(&cwd, &repo, number, &review, || Ok(()))
    })
    .await
    .map_err(|error| error.to_string())?
}

pub(crate) fn execute_review_guarded(
    cwd: &str,
    repo: &str,
    number: i64,
    review: &ReviewInput,
    guard: impl Fn() -> Result<(), String>,
) -> Result<String, String> {
    execute_review_guarded_with_token(cwd, repo, number, review, guard, None)
}

pub(crate) fn execute_review_guarded_with_token(
    cwd: &str, repo: &str, number: i64, review: &ReviewInput,
    guard: impl Fn() -> Result<(), String>, token: Option<&str>,
) -> Result<String, String> {
    let root = expand_home(cwd);
    submit_review_guarded_with(repo, number, review, guard, |endpoint, payload| {
        let checked = |args: &[&str]| match token {
            Some(value) => crate::fs::gh_checked_with_token(&root, args, value),
            None => gh_checked(&root, args),
        };
        if let Some(payload) = payload {
            with_temp_markdown(&payload.to_string(), |path| {
                checked(
                    &[
                        "api",
                        "--hostname",
                        "github.com",
                        "--method",
                        "POST",
                        endpoint,
                        "--input",
                        path,
                    ],
                )
            })
        } else {
            checked(&["api", "--hostname", "github.com", endpoint])
        }
    })
}

fn submit_review_guarded_with(
    repo: &str,
    number: i64,
    review: &ReviewInput,
    guard: impl Fn() -> Result<(), String>,
    mut request: impl FnMut(&str, Option<&Value>) -> Result<String, String>,
) -> Result<String, String> {
    submit_review_with(repo, number, review, |endpoint, payload| {
        guard()?;
        request(endpoint, payload)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn review() -> ReviewInput {
        serde_json::from_value(json!({"commitId":"a".repeat(40),"event":"REQUEST_CHANGES",
            "body":"Şu üç noktaya bakalım.","comments":[{"path":"src/a.ts","line":8,"startLine":6,"side":"RIGHT","body":"Burada yetki kontrolü eksik."}]})).unwrap()
    }
    #[test]
    fn approval_expiring_after_head_check_never_posts() {
        let guards = std::cell::Cell::new(0);
        let mut reads = 0;
        let result = submit_review_guarded_with(
            "owner/repo",
            7,
            &review(),
            || {
                let at = guards.get();
                guards.set(at + 1);
                if at == 0 {
                    Ok(())
                } else {
                    Err("Approval deadline expired".into())
                }
            },
            |_, payload| {
                assert!(payload.is_none());
                reads += 1;
                Ok(json!({"head":{"sha":"a".repeat(40)}}).to_string())
            },
        );
        assert_eq!(result.unwrap_err(), "Approval deadline expired");
        assert_eq!(reads, 1);
        assert_eq!(guards.get(), 2);
    }
    #[test]
    fn submits_one_review_with_exact_unicode_content_and_ranges() {
        let review = review();
        let mut calls = vec![];
        let url = submit_review_with("owner/repo", 7, &review, |endpoint, body| {
            calls.push((endpoint.to_owned(), body.cloned()));
            Ok(if body.is_some() {
                json!({"html_url":"https://github.com/owner/repo/pull/7#pullrequestreview-1"})
            } else {
                json!({"head":{"sha":"a".repeat(40)}})
            }
            .to_string())
        })
        .unwrap();
        assert!(url.contains("pullrequestreview-1"));
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[1].0, "repos/owner/repo/pulls/7/reviews");
        assert_eq!(
            calls[1].1.as_ref().unwrap(),
            &json!({"commit_id":"a".repeat(40),"event":"REQUEST_CHANGES",
            "body":review.body,"comments":[{"path":"src/a.ts","line":8,"start_line":6,"start_side":"RIGHT","side":"RIGHT","body":review.comments[0].body}]})
        );
    }
    #[test]
    fn changed_head_never_posts() {
        let mut calls = 0;
        let error = submit_review_with("owner/repo", 7, &review(), |_, body| {
            calls += 1;
            assert!(body.is_none());
            Ok(json!({"head":{"sha":"b".repeat(40)}}).to_string())
        })
        .unwrap_err();
        assert!(error.contains("head changed"));
        assert_eq!(calls, 1);
    }
    #[test]
    fn rejects_invalid_comments_before_any_network_call() {
        for patch in [
            json!({"path":"../secret"}),
            json!({"line":0}),
            json!({"side":"BOTH"}),
            json!({"startLine":8}),
            json!({"body":" "}),
        ] {
            let mut value = serde_json::to_value(review()).unwrap();
            for (key, entry) in patch.as_object().unwrap() {
                value["comments"][0][key] = entry.clone();
            }
            let input: ReviewInput = serde_json::from_value(value).unwrap();
            assert!(submit_review_with("owner/repo", 7, &input, |_, _| panic!(
                "must not contact GitHub"
            ))
            .is_err());
        }
    }
    #[test]
    fn approval_contains_every_comment_and_review_metadata() {
        let input = serde_json::to_value(review()).unwrap();
        let message = ReviewInput::approval_content(&input).unwrap();
        for expected in [
            "REQUEST_CHANGES",
            &"a".repeat(40),
            "src/a.ts",
            "6-8 (RIGHT)",
            "Burada yetki kontrolü eksik.",
        ] {
            assert!(message.contains(expected));
        }
    }
}
