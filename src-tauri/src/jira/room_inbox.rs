//! Native-only Jira account snapshot for Room operations. The snapshot never crosses IPC.
use super::*;

pub(crate) struct RoomJiraAccount(JiraConfig);

impl RoomJiraAccount {
    pub(crate) fn capture(app: &AppHandle) -> Result<Self, String> {
        Ok(Self(require_config(app)?))
    }

    pub(crate) fn display(&self) -> (&str, &str) {
        (&self.0.site, &self.0.email)
    }

    /// Rechecks the exact credential, not just the visible account name. Requests
    /// use the captured config so a concurrent credential change cannot retarget it.
    pub(crate) fn current(&self, app: &AppHandle) -> Result<(), String> {
        let current = require_config(app)?;
        if !same_account(&self.0, &current) {
            return Err("Jira account changed; review the operation again".into());
        }
        Ok(())
    }

    pub(crate) fn execute(
        &self,
        operation: RoomJiraOperation,
        guard: impl Fn() -> Result<(), String>,
    ) -> Result<Value, String> {
        execute_with(&self.0, operation, guard, |config, method, path, body| {
            if method == "GET" { jira_get(config, path) }
            else { jira_post(config, path, body.expect("POST body")) }
        })
    }
}

fn same_account(a: &JiraConfig, b: &JiraConfig) -> bool {
    a.site == b.site && a.email == b.email && a.token == b.token
}

pub(crate) enum RoomJiraOperation {
    List { assigned_to_me: bool, state: String, project_ids: Vec<String>, limit: u32 },
    Details { key: String },
    Thread { key: String },
    Comment { key: String, body: String },
}

fn execute_with(
    account: &JiraConfig,
    operation: RoomJiraOperation,
    guard: impl Fn() -> Result<(), String>,
    mut request: impl FnMut(&JiraConfig, &str, &str, Option<&Value>) -> Result<Value, String>,
) -> Result<Value, String> {
    let (method, path, body, key, kind) = match operation {
        RoomJiraOperation::List { assigned_to_me, state, project_ids, limit } => {
            if !matches!(state.as_str(), "open" | "all") || project_ids.len() > 100 || project_ids.iter().any(|id| id.is_empty() || !id.bytes().all(|byte| byte.is_ascii_digit())) || !(1..=100).contains(&limit) {
                return Err("Invalid Jira list scope".into());
            }
            ("POST", "/rest/api/3/search/jql".to_string(), Some(json!({"jql":issue_jql(assigned_to_me, &state, &project_ids),"maxResults":limit,"fields":ISSUE_FIELDS})), String::new(), 0)
        }
        RoomJiraOperation::Details { key } => {
            require_issue_key(&key)?;
            ("GET", format!("/rest/api/3/issue/{key}?fields=description,reporter,creator,assignee"), None, key, 1)
        }
        RoomJiraOperation::Thread { key } => {
            require_issue_key(&key)?;
            ("GET", format!("/rest/api/3/issue/{key}/comment?maxResults={COMMENT_LIMIT}&orderBy=-created"), None, key, 2)
        }
        RoomJiraOperation::Comment { key, body } => {
            require_issue_key(&key)?;
            if body.trim().is_empty() || body.encode_utf16().count() > 30_000 || body.contains('\0') { return Err("Invalid Jira comment".into()); }
            ("POST", format!("/rest/api/3/issue/{key}/comment"), Some(json!({"body":text_to_adf(body.trim())})), key, 3)
        }
    };
    guard()?;
    let data = request(account, method, &path, body.as_ref())
        .map_err(|error| error.replace(&account.token, "[redacted]"))?;
    guard()?;
    match kind {
        0 => serde_json::to_value(parse_jira_issues(&data, &account.site)?),
        1 => serde_json::to_value(parse_jira_issue_details(&data)?),
        2 => serde_json::to_value(parse_jira_issue_thread(&data, &account.site, &key)?),
        _ => {
            let id = string_field(&data, "id").filter(|id| !id.is_empty()).ok_or("Could not post Jira comment")?;
            return Ok(json!(comment_url(&account.site, &key, &id)));
        }
    }.map_err(|_| "Could not serialize Jira result".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    fn account(token: &str) -> JiraConfig { JiraConfig { site: "https://jira.invalid".into(), email: "owner@example.invalid".into(), token: token.into() } }
    #[test]
    fn checks_full_credential_and_guards_before_request() {
        assert!(!same_account(&account("one"), &account("two")));
        let calls = Cell::new(0);
        let error = execute_with(&account("one"), RoomJiraOperation::Comment { key: "ABC-1".into(), body: "hello".into() }, || Err("revoked".into()), |_, _, _, _| { calls.set(1); Ok(json!({})) }).unwrap_err();
        assert_eq!(error, "revoked");
        assert_eq!(calls.get(), 0);
    }
    #[test]
    fn uses_captured_account_and_exact_comment_once() {
        let calls = Cell::new(0);
        let result = execute_with(&account("one"), RoomJiraOperation::Comment { key: "ABC-1".into(), body: "hello".into() }, || Ok(()), |config, method, path, body| {
            calls.set(calls.get() + 1);
            assert_eq!(config.token, "one");
            assert_eq!(method, "POST");
            assert_eq!(path, "/rest/api/3/issue/ABC-1/comment");
            assert_eq!(body.unwrap()["body"], text_to_adf("hello"));
            Ok(json!({"id":"17"}))
        }).unwrap();
        assert_eq!(calls.get(), 1);
        assert!(result.as_str().unwrap().contains("17"));
    }
}
