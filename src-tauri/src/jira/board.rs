//! Jira Software boards use their own column mappings and rank field.
use super::*;
use std::collections::HashSet;
#[path = "mobile_board.rs"]
pub mod mobile_board;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Board {
    id: u64,
    name: String,
    kind: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    name: String,
    status_ids: Vec<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Sprint {
    id: u64,
    name: String,
    state: String,
    goal: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Configuration {
    columns: Vec<Column>,
    rank_field_id: Option<u64>,
    sprints: Vec<Sprint>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BoardIssue {
    #[serde(flatten)]
    issue: JiraIssue,
    status_id: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct IssuePage {
    issues: Vec<BoardIssue>,
    next_page_token: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Transition {
    id: String,
    name: String,
    status_id: String,
    requires_fields: bool,
}

fn positive(id: u64) -> Result<(), String> {
    if id == 0 {
        Err("Invalid Jira identifier".into())
    } else {
        Ok(())
    }
}

// Boards/sprints use offset pagination; issue search uses cursor pagination.
fn fetch_values(mut fetch: impl FnMut(u64) -> Result<Value, String>) -> Result<Vec<Value>, String> {
    let mut start = 0;
    let mut values = Vec::new();
    for _ in 0..1000 {
        let data = fetch(start)?;
        let page = data["values"]
            .as_array()
            .ok_or("Jira did not return board values")?;
        let next = data["startAt"].as_u64().unwrap_or(start) + page.len() as u64;
        values.extend(page.iter().cloned());
        if data["isLast"].as_bool() == Some(true)
            || data["total"].as_u64().is_some_and(|total| next >= total)
        {
            return Ok(values);
        }
        if next <= start {
            return Err("Jira board pagination did not advance".into());
        }
        start = next;
    }
    Err("Jira board pagination exceeded the safety limit".into())
}

fn fetch_sprints(config: &JiraConfig, board_id: u64) -> Result<Vec<Sprint>, String> {
    let values = fetch_values(|start| {
        jira_get(config, &format!("/rest/agile/1.0/board/{board_id}/sprint?state=active,future&maxResults=50&startAt={start}"))
    })?;
    Ok(values
        .iter()
        .filter_map(|s| {
            Some(Sprint {
                id: s["id"].as_u64()?,
                name: string_field(s, "name")?,
                state: string_field(s, "state")?,
                goal: string_field(s, "goal").unwrap_or_default(),
            })
        })
        .collect())
}

fn parse_configuration(data: &Value, sprints: Vec<Sprint>) -> Result<Configuration, String> {
    let columns = data
        .pointer("/columnConfig/columns")
        .and_then(Value::as_array)
        .ok_or("Jira did not return board columns")?;
    Ok(Configuration {
        columns: columns
            .iter()
            .map(|c| Column {
                name: string_field(c, "name").unwrap_or_default(),
                status_ids: c["statuses"]
                    .as_array()
                    .map(|items| items.iter().filter_map(|s| string_field(s, "id")).collect())
                    .unwrap_or_default(),
            })
            .collect(),
        rank_field_id: data
            .pointer("/ranking/rankCustomFieldId")
            .and_then(Value::as_u64),
        sprints,
    })
}

#[tauri::command]
pub async fn jira_list_boards(
    app: AppHandle,
    project_ids: Option<Vec<String>>,
) -> Result<Vec<Board>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config = require_config(&app)?;
        let scopes = match project_ids {
            Some(ids) => ids
                .into_iter()
                .map(|id| {
                    id.parse::<u64>()
                        .ok()
                        .filter(|id| *id > 0)
                        .map(Some)
                        .ok_or_else(|| "Invalid Jira project identifier".to_string())
                })
                .collect::<Result<Vec<_>, _>>()?,
            None => vec![None],
        };
        let mut values = Vec::new();
        for project in scopes {
            values.extend(fetch_values(|start| {
                let project = project
                    .map(|id| format!("&projectKeyOrId={id}"))
                    .unwrap_or_default();
                jira_get(
                    &config,
                    &format!("/rest/agile/1.0/board?maxResults=50&startAt={start}{project}"),
                )
            })?);
        }
        let mut seen = HashSet::new();
        Ok(values
            .iter()
            .filter_map(|b| {
                let id = b["id"].as_u64()?;
                let kind = string_field(b, "type")?;
                if !matches!(kind.as_str(), "scrum" | "kanban") || !seen.insert(id) {
                    return None;
                }
                Some(Board {
                    id,
                    name: string_field(b, "name")?,
                    kind,
                })
            })
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn jira_board_configuration(
    app: AppHandle,
    board_id: u64,
) -> Result<Configuration, String> {
    tauri::async_runtime::spawn_blocking(move || {
        positive(board_id)?;
        let config = require_config(&app)?;
        let data = jira_get(
            &config,
            &format!("/rest/agile/1.0/board/{board_id}/configuration"),
        )?;
        let sprints = if data["type"].as_str() == Some("scrum") {
            fetch_sprints(&config, board_id)?
        } else {
            Vec::new()
        };
        parse_configuration(&data, sprints)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn issue_path(
    board_id: u64,
    scope: &str,
    sprint_id: Option<u64>,
    token: Option<&str>,
) -> Result<String, String> {
    positive(board_id)?;
    let path = match scope {
        "board" => format!("/rest/software/1.0/board/{board_id}/issue"),
        "backlog" => format!("/rest/software/1.0/board/{board_id}/backlog"),
        "sprint" => {
            let id = sprint_id.ok_or("Select a Jira sprint")?;
            positive(id)?;
            format!("/rest/software/1.0/board/{board_id}/sprint/{id}/issue")
        }
        _ => return Err("Invalid Jira board scope".into()),
    };
    let mut url =
        url::Url::parse(&format!("https://jira.invalid{path}")).map_err(|e| e.to_string())?;
    url.query_pairs_mut()
        .append_pair("maxResults", "100")
        .append_pair("fields", &ISSUE_FIELDS.join(","));
    if let Some(token) = token {
        url.query_pairs_mut().append_pair("nextPageToken", token);
    }
    Ok(format!(
        "{}?{}",
        url.path(),
        url.query().unwrap_or_default()
    ))
}

fn parse_page(data: &Value, site: &str) -> Result<IssuePage, String> {
    let issues = data["issues"]
        .as_array()
        .ok_or("Jira did not return board issues")?;
    let parsed = issues
        .iter()
        .map(|node| {
            Ok(BoardIssue {
                issue: parse_jira_issue(node, site)
                    .ok_or("Jira returned an invalid board issue")?,
                status_id: node
                    .pointer("/fields/status/id")
                    .and_then(Value::as_str)
                    .ok_or("Jira did not return the issue status ID")?
                    .to_string(),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let token = string_field(data, "nextPageToken").filter(|s| !s.is_empty());
    if data["isLast"].as_bool() == Some(false) && token.is_none() {
        return Err("Jira did not return the next issue page token".into());
    }
    Ok(IssuePage {
        issues: parsed,
        next_page_token: if data["isLast"].as_bool() == Some(true) {
            None
        } else {
            token
        },
    })
}

#[tauri::command]
pub async fn jira_board_issues(
    app: AppHandle,
    board_id: u64,
    scope: String,
    sprint_id: Option<u64>,
    next_page_token: Option<String>,
    project_ids: Option<Vec<String>>,
) -> Result<IssuePage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config = require_config(&app)?;
        if project_ids.as_ref().is_some_and(|ids| ids.is_empty()) {
            return Ok(IssuePage {
                issues: Vec::new(),
                next_page_token: None,
            });
        }
        let mut path = issue_path(board_id, &scope, sprint_id, next_page_token.as_deref())?;
        if let Some(ids) = project_ids {
            let ids = ids
                .iter()
                .map(|id| {
                    id.parse::<u64>()
                        .ok()
                        .filter(|id| *id > 0)
                        .ok_or_else(|| "Invalid Jira project identifier".to_string())
                })
                .collect::<Result<Vec<_>, _>>()?;
            let mut url = url::Url::parse(&format!("https://jira.invalid{path}"))
                .map_err(|e| e.to_string())?;
            let ids = ids.iter().map(u64::to_string).collect::<Vec<_>>().join(",");
            url.query_pairs_mut()
                .append_pair("jql", &format!("project in ({ids})"));
            path = format!("{}?{}", url.path(), url.query().unwrap_or_default());
        }
        parse_page(&jira_get(&config, &path)?, &config.site)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn parse_transitions(data: &Value) -> Result<Vec<Transition>, String> {
    let values = data["transitions"]
        .as_array()
        .ok_or("Jira did not return issue transitions")?;
    Ok(values
        .iter()
        .filter_map(|v| {
            Some(Transition {
                id: string_field(v, "id")?,
                name: string_field(v, "name")?,
                status_id: v.pointer("/to/id")?.as_str()?.to_string(),
                requires_fields: v["fields"].as_object().is_some_and(|fields| {
                    fields.values().any(|f| {
                        f["required"].as_bool() == Some(true)
                            && f["hasDefaultValue"].as_bool() != Some(true)
                    })
                }),
            })
        })
        .collect())
}

fn transitions(config: &JiraConfig, key: &str) -> Result<Vec<Transition>, String> {
    parse_transitions(&jira_get(
        config,
        &format!("/rest/api/3/issue/{key}/transitions?expand=transitions.fields"),
    )?)
}

#[tauri::command]
pub async fn jira_issue_transitions(
    app: AppHandle,
    key: String,
) -> Result<Vec<Transition>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config = require_config(&app)?;
        transitions(&config, require_issue_key(&key)?)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn require_transition<'a>(values: &'a [Transition], id: &str) -> Result<&'a Transition, String> {
    let selected = values
        .iter()
        .find(|t| t.id == id)
        .ok_or("This Jira transition is no longer available. Refresh the board.")?;
    if selected.requires_fields {
        return Err(
            "This transition requires fields. Open the issue in Jira to complete it.".into(),
        );
    }
    Ok(selected)
}

// Mutation endpoints normally return 204; 207 must not masquerade as success.
fn write_response(status: u16, body: &str) -> Result<(), String> {
    if status == 207 {
        return Err(
            "Jira partially applied the move. Refresh the board and check the issue in Jira."
                .into(),
        );
    }
    if !(200..300).contains(&status) {
        return Err(jira_http_error(status, body));
    }
    Ok(())
}

fn write(config: &JiraConfig, method: &str, path: &str, body: Value) -> Result<(), String> {
    let agent = crate::integrations::http::agent(HTTP_TIMEOUT, None);
    let result = agent
        .request(method, &format!("{}{path}", config.site))
        .set("Authorization", &jira_authorization(config))
        .set("Accept", "application/json")
        .set("Content-Type", "application/json")
        .send_string(&body.to_string());
    let response = match result {
        Ok(r) => r,
        Err(ureq::Error::Status(status, r)) => {
            return Err(jira_http_error(
                status,
                &r.into_string().unwrap_or_default(),
            ))
        }
        Err(_) => {
            return Err("Could not reach Jira. Refresh the board before retrying the move.".into())
        }
    };
    write_response(
        response.status(),
        &response
            .into_string()
            .map_err(|_| "Jira returned an unreadable response")?,
    )
}

#[tauri::command]
pub async fn jira_issue_transition(
    app: AppHandle,
    key: String,
    transition_id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config = require_config(&app)?;
        let key = require_issue_key(&key)?;
        require_transition(&transitions(&config, key)?, &transition_id)?;
        write(
            &config,
            "POST",
            &format!("/rest/api/3/issue/{key}/transitions"),
            json!({"transition": {"id": transition_id}}),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

fn rank_body(
    key: &str,
    before: Option<&str>,
    after: Option<&str>,
    rank_field: Option<u64>,
) -> Result<Value, String> {
    require_issue_key(key)?;
    if before.is_some() && after.is_some() {
        return Err("Choose one Jira rank anchor".into());
    }
    let mut body = json!({"issues": [key]});
    for (field, anchor) in [("rankBeforeIssue", before), ("rankAfterIssue", after)] {
        if let Some(anchor) = anchor {
            require_issue_key(anchor)?;
            if anchor == key {
                return Err("An issue cannot be ranked against itself".into());
            }
            let rank_field = rank_field.ok_or("This Jira board has no rank field")?;
            positive(rank_field)?;
            body[field] = json!(anchor);
            body["rankCustomFieldId"] = json!(rank_field);
        }
    }
    Ok(body)
}

#[tauri::command]
pub async fn jira_board_move(
    app: AppHandle,
    board_id: u64,
    key: String,
    target: String,
    sprint_id: Option<u64>,
    before_key: Option<String>,
    after_key: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        positive(board_id)?;
        let config = require_config(&app)?;
        let data = jira_get(
            &config,
            &format!("/rest/agile/1.0/board/{board_id}/configuration"),
        )?;
        let field = data
            .pointer("/ranking/rankCustomFieldId")
            .and_then(Value::as_u64);
        let body = rank_body(&key, before_key.as_deref(), after_key.as_deref(), field)?;
        let path = match target.as_str() {
            "backlog" => format!("/rest/agile/1.0/backlog/{board_id}/issue"),
            "board" if data["type"].as_str() == Some("kanban") => {
                format!("/rest/agile/1.0/board/{board_id}/issue")
            }
            "sprint" => {
                let id = sprint_id.ok_or("Select a Jira sprint")?;
                if !fetch_sprints(&config, board_id)?
                    .iter()
                    .any(|s| s.id == id && matches!(s.state.as_str(), "active" | "future"))
                {
                    return Err(
                        "The target sprint is not an active or future sprint of this board".into(),
                    );
                }
                format!("/rest/agile/1.0/sprint/{id}/issue")
            }
            "rank" if before_key.is_some() || after_key.is_some() => {
                "/rest/agile/1.0/issue/rank".into()
            }
            _ => return Err("Invalid Jira move target".into()),
        };
        write(
            &config,
            if target == "rank" { "PUT" } else { "POST" },
            &path,
            body,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn maps_real_status_ids_and_rank_field() {
        let c = parse_configuration(&json!({"columnConfig":{"columns":[{"name":"Working","statuses":[{"id":"3"},{"id":"9"}]}]},"ranking":{"rankCustomFieldId":10010}}), vec![]).unwrap();
        assert_eq!(c.columns[0].status_ids, vec!["3", "9"]);
        assert_eq!(c.rank_field_id, Some(10010));
    }
    #[test]
    fn refuses_incomplete_pagination() {
        assert!(fetch_values(|_| Ok(json!({"values":[],"isLast":false}))).is_err());
        assert!(parse_page(
            &json!({"issues":[],"isLast":false}),
            "https://team.atlassian.net"
        )
        .is_err());
        let mut starts = vec![];
        let v = fetch_values(|start| {
            starts.push(start);
            Ok(if start == 0 {
                json!({"values":[1],"isLast":false})
            } else {
                json!({"values":[2],"isLast":true})
            })
        })
        .unwrap();
        assert_eq!(starts, vec![0, 1]);
        assert_eq!(v, vec![json!(1), json!(2)]);
    }
    #[test]
    fn scopes_and_encodes_issue_pages() {
        let p = issue_path(7, "sprint", Some(12), Some("a&b")).unwrap();
        assert!(p.starts_with("/rest/software/1.0/board/7/sprint/12/issue?"));
        assert!(p.contains("nextPageToken=a%26b"));
        assert!(issue_path(0, "board", None, None).is_err());
        assert!(issue_path(7, "sprint", None, None).is_err());
        assert!(issue_path(7, "shell", None, None).is_err());
    }
    #[test]
    fn rejects_required_fields_and_stale_transitions() {
        let t = parse_transitions(&json!({"transitions":[{"id":"5","name":"Finish","to":{"id":"9"},"fields":{"resolution":{"required":true,"hasDefaultValue":false}}}]})).unwrap();
        assert!(require_transition(&t, "5").is_err());
        assert!(require_transition(&t, "missing").is_err());
    }
    #[test]
    fn validates_rank_anchors_and_empty_mutation_responses() {
        assert_eq!(
            rank_body("ENG-1", Some("ENG-2"), None, Some(7)).unwrap()["rankCustomFieldId"],
            7
        );
        assert!(rank_body("ENG-1", Some("ENG-1"), None, Some(7)).is_err());
        assert!(rank_body("ENG-1", Some("ENG-2"), Some("ENG-3"), Some(7)).is_err());
        assert!(rank_body("ENG-1", Some("ENG-2"), None, None).is_err());
        assert!(rank_body("ENG-1", Some("../../secret"), None, Some(7)).is_err());
        assert!(write_response(204, "").is_ok());
        assert!(write_response(207, "{}").is_err());
        assert!(write_response(403, "{}").is_err());
    }
}
