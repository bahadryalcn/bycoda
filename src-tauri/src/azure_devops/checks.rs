use super::*;

fn check_state(raw: &str) -> &'static str {
    match raw {
        "succeeded" | "approved" | "success" => "pass",
        "failed" | "rejected" | "error" => "fail",
        "pending" | "running" | "queued" | "inProgress" | "notStarted" => "pending",
        "canceled" | "cancelled" => "cancel",
        "skipped" | "notApplicable" => "skipping",
        _ => "unknown",
    }
}
#[tauri::command]
pub async fn azure_devops_pr_checks(
    app: AppHandle,
    repo: String,
    number: i64,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || checks_for(&require_config(&app)?, &repo, number))
        .await
        .map_err(|e| e.to_string())?
}
fn checks_for(config: &AzureDevOpsConfig, repo: &str, number: i64) -> Result<Value, String> {
    if number <= 0 {
        return Err("Invalid pull request number".into());
    }
    let (project, repository) = split_repo(repo)?;

    let base = format!(
        "/{}/_apis/git/repositories/{}/pullRequests/{number}",
        encode_segment(&project),
        encode_segment(&repository)
    );

    let pr = azure_get(config, &format!("{base}?api-version={API_VERSION}"))?.value;

    let head = pr
        .pointer("/lastMergeSourceCommit/commitId")
        .and_then(Value::as_str)
        .unwrap_or_default();

    let iterations = azure_get(
        config,
        &format!("{base}/iterations?api-version={API_VERSION}"),
    )?;
    if iterations.truncated {
        return Err("Azure DevOps iterations exceeded the response limit".into());
    }
    let iteration = iterations.value["value"]
        .as_array()
        .ok_or("Azure DevOps returned invalid iterations")?
        .iter()
        .filter(|row| {
            row.pointer("/sourceRefCommit/commitId")
                .and_then(Value::as_str)
                == Some(head)
        })
        .filter_map(|row| row["id"].as_u64())
        .max()
        .ok_or("Azure DevOps current PR iteration is unavailable")?;
    let mut rows = Vec::new();

    let statuses = azure_get(
        config,
        &format!("{base}/statuses?api-version={API_VERSION}"),
    )?;

    if statuses.truncated {
        return Err("Azure DevOps check statuses exceeded the response limit".into());
    }
    for status in latest_statuses(
        statuses.value["value"]
            .as_array()
            .ok_or("Azure DevOps returned invalid statuses")?,
        iteration,
    ) {
        rows.push(json!({
        "provider":"azuredevops",
        "name":status.pointer("/context/name").and_then(Value::as_str).unwrap_or("Status"),
        "workflow":status.pointer("/context/genre").and_then(Value::as_str).unwrap_or_default(),
        "state":check_state(status["state"].as_str().unwrap_or_default()),
        "url":status["targetUrl"],
        "startedAt":status["creationDate"],
        "completedAt":status["updatedDate"]
        }));
    }
    let project_id = pr
        .pointer("/repository/project/id")
        .and_then(Value::as_str)
        .ok_or("Azure DevOps PR project id is missing")?;

    let artifact = format!("vstfs:///CodeReview/CodeReviewId/{project_id}/{number}");

    let policies = azure_get(
        config,
        &format!(
            "/{}/_apis/policy/evaluations?artifactId={}&api-version=7.1-preview.1",
            encode_segment(&project),
            encode_segment(&artifact)
        ),
    )?;

    if policies.truncated {
        return Err("Azure DevOps policies exceeded the response limit".into());
    }
    for policy in policies.value["value"]
        .as_array()
        .ok_or("Azure DevOps returned invalid policies")?
    {
        rows.push(normalize_policy(policy, &project));
    }
    Ok(json!({
    "headOid":head,
    "instance":config.url,
    "checks":rows
    }))
}
fn latest_statuses(statuses: &[Value], iteration: u64) -> Vec<&Value> {
    let mut latest: std::collections::BTreeMap<(&str, &str), &Value> =
        std::collections::BTreeMap::new();
    for status in statuses {
        if status["iterationId"]
            .as_u64()
            .is_some_and(|id| id != 0 && id != iteration)
        {
            continue;
        }
        let context = (
            status
                .pointer("/context/genre")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            status
                .pointer("/context/name")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        );
        let rank = |row: &Value| {
            (
                row["updatedDate"].as_str().unwrap_or_default().to_owned(),
                row["id"].as_u64().unwrap_or_default(),
            )
        };
        match latest.get(&context) {
            Some(previous) if rank(previous) >= rank(status) => {}
            _ => {
                latest.insert(context, status);
            }
        }
    }
    latest.into_values().collect()
}
fn normalize_policy(p: &Value, project: &str) -> Value {
    let name = p
        .pointer("/configuration/settings/displayName")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .or_else(|| {
            p.pointer("/configuration/type/displayName")
                .and_then(Value::as_str)
        })
        .unwrap_or("Policy");

    let build = p
        .pointer("/context/buildId")
        .and_then(Value::as_u64)
        .map(|id| id.to_string());

    json!({
    "provider":"azuredevops",
    "name":name,
    "workflow":"Branch policy",
    "state":check_state(p["status"].as_str().unwrap_or_default()),
    "allowFailure":p.pointer("/configuration/isBlocking").and_then(Value::as_bool)==Some(false),
    "url":p.pointer("/context/buildUrl"),
    "startedAt":p["startedDate"],
    "completedAt":p["completedDate"],
    "detailsRef":build.map(|id|json!({
    "project":project,
    "buildId":id
    }))
    })
}
#[tauri::command]
pub async fn azure_devops_check_details(
    app: AppHandle,
    repo: String,
    project: Option<String>,
    build_id: String,
    expected_instance: String,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
  let config=require_config(&app)?;
  ensure_instance(&config.url, &expected_instance)?;

let (repo_project,_)=split_repo(&repo)?;

let project=project.unwrap_or(repo_project);

  if project.trim().is_empty()||project.contains('/')||project.contains('\\') {
return Err("Invalid build project".into());
}
  let id=build_id.parse::<u64>().map_err(|_|"Invalid build id")?;

if id==0{return Err("Invalid build id".into());
}
  let base=format!("/{}/_apis/build/builds/{id}",encode_segment(&project));

  let timeline=azure_get(&config,&format!("{base}/timeline?api-version={API_VERSION}"))?;

  let records=timeline.value["records"].as_array().ok_or("Azure DevOps returned invalid timeline")?;

  let steps:Vec<Value>=records.iter().filter(|r|r["type"]=="Task"||r["type"]=="Job").map(|r|json!({
"name":r["name"],
"state":check_state(r["result"].as_str().or_else(||r["state"].as_str()).unwrap_or_default()),
"startedAt":r["startTime"],
"completedAt":r["finishTime"]
})).collect();

  let mut logs=String::new();

let mut notices=Vec::new();

  for record in records.iter().filter(|r|r["result"]=="failed").take(3) {

   if let Some(log)=record.pointer("/log/id").and_then(Value::as_u64) {

    match azure_get_bytes(&config,&format!("{base}/logs/{log}?api-version={API_VERSION}")) {

     Ok((bytes,truncated))=>{let text=String::from_utf8_lossy(&bytes);
logs.push_str(&text.chars().take(16384).collect::<String>());

if truncated||text.len()>16384{notices.push("Job log truncated.");
}},
     Err(_)=>notices.push("A failing task log is unavailable."),
    }
   }
  }
  Ok(json!({
"steps":steps,
"annotations":[],
"log":logs,
"notice":if notices.is_empty() {
None}
else {
Some(notices.join(" "))}
}))


}).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn azure_devops_list_projects(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config = require_config(&app)?;

        let mut projects = Vec::new();

        for page in 0..50 {
            let response = azure_get(
                &config,
                &format!(
                    "/_apis/projects?$top=100&$skip={}&api-version={API_VERSION}",
                    page * 100
                ),
            )?;

            let rows = response.value["value"]
                .as_array()
                .ok_or("Azure DevOps returned invalid projects")?;

            projects.extend(rows.iter().filter_map(|p| {
                Some(json!({
                "id":p["id"].as_str()?,
                "name":p["name"].as_str()?,
                "path":p["name"].as_str()?
                }))
            }));

            if rows.len() < 100 && !response.truncated {
                return Ok(json!({
                "instance":config.url,
                "projects":projects
                }));
            }
        }
        Err("Azure DevOps projects exceeded the pagination limit".into())
    })
    .await
    .map_err(|e| e.to_string())?
}
fn ensure_instance(actual: &str, expected: &str) -> Result<(), String> {
    if actual.trim_end_matches('/') != expected.trim_end_matches('/') {
        return Err("Azure DevOps instance changed; reload checks".into());
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn required_build_failure_and_structured_log_reference() {
        let row = normalize_policy(
            &json!({
            "status":"rejected",
            "context":{"buildId":123},
            "configuration":{"type":{"displayName":"Build"}}
            }),
            "Space project",
        );

        assert_eq!(row["state"], "fail");

        assert_eq!(row["detailsRef"]["buildId"], "123");

        assert_eq!(check_state("unknownFuture"), "unknown");
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
    fn includes_required_policy_failures_even_when_status_passes() {
        let (url, server) = fixture(vec![
            r#"{"lastMergeSourceCommit":{"commitId":"head"},"repository":{"project":{"id":"project-id"}}}"#,
            r#"{"value":[{"id":2,"sourceRefCommit":{"commitId":"head"}}]}"#,
            r#"{"value":[{"id":99,"iterationId":1,"state":"failed","context":{"name":"external"}},{"id":2,"iterationId":2,"state":"succeeded","context":{"name":"external"}}]}"#,
            r#"{"value":[{"status":"rejected","context":{"buildId":42},"configuration":{"type":{"displayName":"Required build"}}}]}"#,
        ]);
        let result = checks_for(
            &AzureDevOpsConfig {
                url,
                token: "test-only".into(),
            },
            "Space project/repo",
            8,
        )
        .unwrap();
        assert_eq!(result["headOid"], "head");
        assert_eq!(result["checks"][0]["state"], "pass");
        assert_eq!(result["checks"][1]["state"], "fail");
        let paths = server.join().unwrap();
        assert!(paths[0].contains("/Space%20project/_apis/git/repositories/repo/pullRequests/8"));
        assert!(paths[3]
            .contains("artifactId=vstfs%3A%2F%2F%2FCodeReview%2FCodeReviewId%2Fproject-id%2F8"));
    }
    #[test]
    fn account_instance_change_rejects_detail_reads() {
        assert!(ensure_instance("https://dev.azure.com/b", "https://dev.azure.com/a").is_err());
    }
    #[test]
    fn old_iteration_and_retry_failures_do_not_mix_with_current_pass() {
        let rows = vec![
            json!({"id":99,"iterationId":1,"state":"failed","context":{"name":"CI"}}),
            json!({"id":2,"iterationId":2,"state":"failed","context":{"name":"CI"}}),
            json!({"id":3,"iterationId":2,"state":"succeeded","context":{"name":"CI"}}),
        ];
        let result = latest_statuses(&rows, 2);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0]["state"], "succeeded");
        assert_eq!(
            normalize_policy(
                &json!({"status":"rejected","configuration":{"isBlocking":false}}),
                "p"
            )["allowFailure"],
            true
        );
    }
}
