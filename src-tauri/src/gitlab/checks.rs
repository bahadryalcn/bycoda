use super::*;

use serde_json::json;

use std::io::Read;

const MAX_LOG_BYTES: usize = 64 * 1024;

#[tauri::command]
pub async fn gitlab_pr_checks(app: AppHandle, repo: String, number: i64) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        checks_for(&require_config(&app)?, &validate_repo(&repo)?, number)
    })
    .await
    .map_err(|e| e.to_string())?
}
fn checks_for(config: &GitlabConfig, repo: &str, number: i64) -> Result<Value, String> {
    if number <= 0 {
        return Err("Invalid merge request number".into());
    }
    let mr = gitlab_get(config, &item_path(repo, "pr", number))?.value;

    let head = mr
        .pointer("/diff_refs/head_sha")
        .and_then(Value::as_str)
        .or_else(|| mr["sha"].as_str())
        .unwrap_or_default();

    let Some(pipeline) = mr.get("head_pipeline").filter(|v| v.is_object()) else {
        return Ok(json!({
        "headOid":head,
        "instance":config.url,
        "checks":[]
        }));
    };

    let id = pipeline["id"].as_u64().ok_or("Invalid pipeline id")?;
    let project = pipeline["project_id"]
        .as_u64()
        .or_else(|| mr["project_id"].as_u64())
        .map(|id| id.to_string())
        .unwrap_or_else(|| repo.to_string());
    let pipeline_sha = pipeline["sha"].as_str().unwrap_or(head);
    if !head.is_empty() && pipeline_sha != head {
        // Merged-result/train pipelines run a synthetic commit. Require this MR's
        // pipeline association and verify its merge commit includes current source HEAD.
        let reference = pipeline["ref"].as_str().unwrap_or_default();
        let merged_ref = reference == format!("refs/merge-requests/{number}/merge")
            || reference == format!("refs/merge-requests/{number}/train");
        if !merged_ref || pipeline["source"] != "merge_request_event" {
            return Err("GitLab pipeline belongs to an earlier merge request commit".into());
        }
        let commit = gitlab_get(
            config,
            &format!(
                "/projects/{}/repository/commits/{}",
                encode_path_component(&project),
                encode_path_component(pipeline_sha)
            ),
        )?
        .value;
        if !commit["parent_ids"]
            .as_array()
            .is_some_and(|parents| parents.iter().any(|parent| parent.as_str() == Some(head)))
        {
            return Err("GitLab merge pipeline does not include the current source head".into());
        }
    }
    let mut rows = Vec::new();

    for page in 1..=50 {
        let response = gitlab_get(
            config,
            &format!(
                "/projects/{}/pipelines/{id}/jobs?include_retried=false&per_page=100&page={page}",
                encode_path_component(&project)
            ),
        )?;

        rows.extend(
            response
                .value
                .as_array()
                .ok_or("GitLab returned invalid jobs")?
                .iter()
                .map(|job| normalize_job(job, &project)),
        );

        if !response.has_next_page {
            return Ok(json!({
            "headOid":head,
            "pipelineOid":pipeline_sha,
            "instance":config.url,
            "checks":rows
            }));
        }
    }
    Err("GitLab jobs exceeded the pagination limit".into())
}
fn state(raw: &str) -> &'static str {
    match raw {
        "success" => "pass",
        "failed" => "fail",
        "canceled" => "cancel",
        "skipped" => "skipping",
        "running"
        | "pending"
        | "created"
        | "preparing"
        | "waiting_for_resource"
        | "waiting_for_callback"
        | "scheduled"
        | "manual" => "pending",
        _ => "unknown",
    }
}
fn normalize_job(job: &Value, project: &str) -> Value {
    json!({
    "provider":"gitlab",
    "name":job["name"].as_str().unwrap_or("Job"),
    "workflow":job["stage"].as_str().unwrap_or_default(),
    "state":state(job["status"].as_str().unwrap_or_default()),
    "url":job["web_url"],
    "startedAt":job["started_at"],
    "completedAt":job["finished_at"],
    "allowFailure":job["allow_failure"].as_bool().unwrap_or(false),
    "detailsRef":{"project":project,
    "jobId":job["id"].as_u64().map(|id|id.to_string())}
    })
}
#[tauri::command]
pub async fn gitlab_check_details(
    app: AppHandle,
    repo: String,
    project: Option<String>,
    job_id: String,
    expected_instance: String,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config = require_config(&app)?;
        ensure_instance(&config.url, &expected_instance)?;

        let repo = validate_repo(&repo)?;

        let project = project.unwrap_or(repo);

        let project = if project.parse::<u64>().is_ok() {
            project
        } else {
            validate_repo(&project)?
        };

        let id = job_id.parse::<u64>().map_err(|_| "Invalid job id")?;

        if id == 0 {
            return Err("Invalid job id".into());
        }
        let base = format!("/projects/{}/jobs/{id}", encode_path_component(&project));

        let job = gitlab_get(&config, &base)?.value;

        let url = format!("{}/api/v4{base}/trace", config.url.trim_end_matches('/'));

        let response = gitlab_agent()
            .get(&url)
            .set("PRIVATE-TOKEN", &config.token)
            .set("User-Agent", USER_AGENT)
            .call()
            .map_err(|e| match e {
                ureq::Error::Status(401 | 403, _) => {
                    "GitLab access token is invalid or lacks permission".to_string()
                }
                _ => "GitLab job log is unavailable".into(),
            })?;

        let mut bytes = Vec::new();
        response
            .into_reader()
            .take(MAX_LOG_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "GitLab log is unreadable")?;

        let truncated = bytes.len() > MAX_LOG_BYTES;
        bytes.truncate(MAX_LOG_BYTES);

        Ok(json!({
        "steps":[{"name":job["name"],
        "state":state(job["status"].as_str().unwrap_or_default()),
        "startedAt":job["started_at"],
        "completedAt":job["finished_at"]}],
        "annotations":[],
        "log":String::from_utf8_lossy(&bytes),
        "notice":if truncated{Some("Job log truncated to 64 KiB.")}
        else {
        job["failure_reason"].as_str()}
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn gitlab_list_projects(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config = require_config(&app)?;

        let mut projects = Vec::new();

        for page in 1..=50 {
            let response = gitlab_get(
                &config,
                &format!("/projects?membership=true&simple=true&per_page=100&page={page}"),
            )?;

            projects.extend(
                response
                    .value
                    .as_array()
                    .ok_or("GitLab returned invalid projects")?
                    .iter()
                    .filter_map(|p| {
                        Some(json!({
                        "id":p["id"].as_u64()?.to_string(),
                        "path":p["path_with_namespace"].as_str()?,
                        "name":p["name_with_namespace"].as_str().or_else(||p["name"].as_str())?
                        }))
                    }),
            );

            if !response.has_next_page {
                return Ok(json!({
                "instance":config.url,
                "projects":projects
                }));
            }
        }
        Err("GitLab projects exceeded the pagination limit".into())
    })
    .await
    .map_err(|e| e.to_string())?
}
fn ensure_instance(actual: &str, expected: &str) -> Result<(), String> {
    if actual.trim_end_matches('/') != expected.trim_end_matches('/') {
        return Err("GitLab instance changed; reload checks".into());
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn job_refs_are_structured_and_failure_is_not_pass() {
        let result = normalize_job(
            &json!({
            "id":23,
            "name":"test",
            "status":"failed",
            "allow_failure":true
            }),
            "91",
        );

        assert_eq!(result["state"], "fail");

        assert_eq!(result["detailsRef"]["project"], "91");

        assert_eq!(result["detailsRef"]["jobId"], "23");

        assert_eq!(state("brand_new_state"), "unknown");
    }
    fn fixture(bodies: Vec<&'static str>) -> (String, std::thread::JoinHandle<Vec<String>>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let thread = std::thread::spawn(move || {
            let mut paths = Vec::new();
            for body in bodies {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                    .unwrap();
                let mut data = Vec::new();
                loop {
                    let mut byte = [0];
                    stream.read_exact(&mut byte).unwrap();
                    data.push(byte[0]);
                    if data.ends_with(b"\r\n\r\n") {
                        break;
                    }
                }
                paths.push(
                    String::from_utf8(data)
                        .unwrap()
                        .lines()
                        .next()
                        .unwrap()
                        .to_string(),
                );
                write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
            }
            paths
        });
        (url, thread)
    }

    #[test]
    fn reads_current_mr_pipeline_from_configured_instance() {
        let (url, server) = fixture(vec![
            r#"{"diff_refs":{"head_sha":"head"},"project_id":99,"head_pipeline":{"id":7,"project_id":88}}"#,
            r#"[{"id":3,"name":"test","stage":"CI","status":"failed"}]"#,
        ]);
        let result = checks_for(
            &GitlabConfig {
                url,
                token: "test-only".into(),
            },
            "group/repo",
            4,
        )
        .unwrap();
        assert_eq!(result["headOid"], "head");
        assert_eq!(result["checks"][0]["detailsRef"]["project"], "88");
        let paths = server.join().unwrap();
        assert!(paths[0].contains("/projects/group%2Frepo/merge_requests/4"));
        assert!(paths[1].contains("/projects/88/pipelines/7/jobs?include_retried=false"));
    }
    #[test]
    fn refuses_pipeline_results_for_an_earlier_head() {
        let (url, server) = fixture(vec![
            r#"{"diff_refs":{"head_sha":"new"},"head_pipeline":{"id":7,"sha":"old"}}"#,
        ]);
        assert!(checks_for(
            &GitlabConfig {
                url,
                token: "test-only".into()
            },
            "g/r",
            4
        )
        .unwrap_err()
        .contains("earlier"));
        assert_eq!(server.join().unwrap().len(), 1);
    }
    #[test]
    fn merged_result_uses_synthetic_commit_without_mixing_source_head() {
        let (url, server) = fixture(vec![
            r#"{"diff_refs":{"head_sha":"source"},"head_pipeline":{"id":7,"project_id":88,"sha":"synthetic","ref":"refs/merge-requests/4/merge","source":"merge_request_event"}}"#,
            r#"{"parent_ids":["target","source"]}"#,
            r#"[{"id":3,"name":"test","status":"success"}]"#,
        ]);
        let result = checks_for(
            &GitlabConfig {
                url,
                token: "test-only".into(),
            },
            "g/r",
            4,
        )
        .unwrap();
        assert_eq!(result["headOid"], "source");
        assert_eq!(result["pipelineOid"], "synthetic");
        assert!(server.join().unwrap()[1].contains("/repository/commits/synthetic"));
    }
    #[test]
    fn account_instance_change_rejects_detail_reads() {
        assert!(ensure_instance("https://b.example", "https://a.example").is_err());
        assert!(ensure_instance("https://a.example/", "https://a.example").is_ok());
    }
}
