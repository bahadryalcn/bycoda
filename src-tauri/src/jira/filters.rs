//! Additional list filters are values, never caller-supplied JQL.
use serde::Deserialize;

#[derive(Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct JiraIssueFilters {
    pub assignee_ids: Vec<String>,
    pub unassigned: bool,
    pub statuses: Vec<String>,
}

impl JiraIssueFilters {
    pub(super) fn jql(
        &self,
        assigned_to_me: bool,
        state: &str,
        project_ids: &[String],
    ) -> Result<String, String> {
        if self.assignee_ids.len() > 100 || self.statuses.len() > 100 {
            return Err("Too many Jira filters".into());
        }
        let quote = |value: &str| -> Result<String, String> {
            if value.trim().is_empty() || value.len() > 512 || value.chars().any(char::is_control) {
                return Err("Invalid Jira filter value".into());
            }
            Ok(format!(
                "\"{}\"",
                value.replace('\\', "\\\\").replace('"', "\\\"")
            ))
        };
        let mut assignees = Vec::new();
        if assigned_to_me {
            assignees.push("assignee = currentUser()".to_string());
        }
        if self.unassigned {
            assignees.push("assignee is EMPTY".to_string());
        }
        if !self.assignee_ids.is_empty() {
            let ids = self
                .assignee_ids
                .iter()
                .map(|id| quote(id))
                .collect::<Result<Vec<_>, _>>()?;
            assignees.push(format!("assignee in ({})", ids.join(", ")));
        }
        let mut clauses = Vec::new();
        if !assignees.is_empty() {
            clauses.push(format!("({})", assignees.join(" OR ")));
        }
        if !self.statuses.is_empty() {
            let statuses = self
                .statuses
                .iter()
                .map(|status| quote(status))
                .collect::<Result<Vec<_>, _>>()?;
            clauses.push(format!("status in ({})", statuses.join(", ")));
        }
        if clauses.is_empty() {
            return Ok(super::issue_jql(false, state, project_ids));
        }
        let base = super::issue_jql(false, state, project_ids);
        let base = base.strip_suffix(" ORDER BY updated DESC").unwrap_or(&base);
        if base != "updated >= -365d" {
            clauses.push(base.to_string());
        }
        Ok(format!("{} ORDER BY updated DESC", clauses.join(" AND ")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unions_assignees_and_intersects_project_and_workflow() {
        let filters = JiraIssueFilters {
            assignee_ids: vec!["account-1".into()],
            unassigned: true,
            statuses: vec!["Development in progress".into(), "Test approved".into()],
        };
        assert_eq!(filters.jql(true, "open", &["10000".into()]).unwrap(),
            "(assignee = currentUser() OR assignee is EMPTY OR assignee in (\"account-1\")) AND status in (\"Development in progress\", \"Test approved\") AND project in (10000) AND statusCategory != Done ORDER BY updated DESC");
    }

    #[test]
    fn quotes_values_and_rejects_control_characters() {
        let mut filters = JiraIssueFilters {
            statuses: vec!["Release \"ready\"".into()],
            ..Default::default()
        };
        assert_eq!(
            filters.jql(false, "all", &[]).unwrap(),
            "status in (\"Release \\\"ready\\\"\") ORDER BY updated DESC"
        );
        filters.statuses = vec!["Done\nOR project = OTHER".into()];
        assert!(filters.jql(false, "all", &[]).is_err());
    }
}
