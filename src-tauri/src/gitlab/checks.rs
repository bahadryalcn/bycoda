use super::*;

use serde_json::json;

use std::io::Read;
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

const MAX_LOG_BYTES: usize = 64 * 1024;
const LOG_READ_CHUNK: usize = 8 * 1024;
const PROJECT_PAGE_LIMIT: u32 = 50;
const PROJECT_LIST_DEADLINE: Duration = Duration::from_secs(60);
const PROJECT_CACHE_TTL: Duration = Duration::from_secs(60);
const PROJECT_LIMIT_NOTICE: &str =
    "GitLab has more projects than the picker loads (5,000). Showing the first 5,000.";
const PROJECT_DEADLINE_NOTICE: &str =
    "Loading GitLab projects reached its time limit. Showing the projects loaded so far.";

struct ProjectPage {
    projects: Vec<Value>,
    has_next_page: bool,
}

/// One successful, complete list for one GitLab instance and token. Never persisted.
struct ProjectCacheEntry {
    url: String,
    token: String,
    stored_at: Instant,
    value: Value,
}

struct ProjectCache {
    /// Bumped when the connection changes, so a fetch started before that cannot store its result.
    generation: u64,
    entry: Option<ProjectCacheEntry>,
}

static PROJECT_CACHE: Mutex<ProjectCache> = Mutex::new(ProjectCache {
    generation: 0,
    entry: None,
});

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

        let (bytes, truncated) = fetch_log_tail(&config, &base)?;

        Ok(json!({
        "steps":[{"name":job["name"],
        "state":state(job["status"].as_str().unwrap_or_default()),
        "startedAt":job["started_at"],
        "completedAt":job["finished_at"]}],
        "annotations":[],
        "log":String::from_utf8_lossy(&bytes),
        "notice":if truncated{Some("Showing the last 64 KiB of the job log.")}
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
        let now = Instant::now();
        if let Some(cached) = cached_projects(&config, now) {
            return Ok(cached);
        }

        let generation = lock_project_cache().generation;
        let (projects, incomplete) = collect_projects(
            |page| fetch_project_page(&config, page),
            || now.elapsed() >= PROJECT_LIST_DEADLINE,
        )?;
        let complete = incomplete.is_none();
        let value = json!({
        "instance":config.url,
        "projects":projects,
        "incomplete":incomplete
        });
        if complete {
            store_projects(&config, generation, &value);
        }
        Ok(value)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Drops the cached project list. Called whenever the GitLab connection is saved or removed.
pub(crate) fn clear_project_cache() {
    let mut cache = lock_project_cache();
    cache.generation += 1;
    cache.entry = None;
}

fn lock_project_cache() -> MutexGuard<'static, ProjectCache> {
    PROJECT_CACHE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn cached_projects(config: &GitlabConfig, now: Instant) -> Option<Value> {
    let cache = lock_project_cache();
    let entry = cache.entry.as_ref()?;
    project_entry_matches(entry, config, now).then(|| entry.value.clone())
}

/// A cached list serves only the same instance and token, within the TTL.
fn project_entry_matches(entry: &ProjectCacheEntry, config: &GitlabConfig, now: Instant) -> bool {
    entry.url == config.url
        && entry.token == config.token
        && now.saturating_duration_since(entry.stored_at) < PROJECT_CACHE_TTL
}

fn store_projects(config: &GitlabConfig, generation: u64, value: &Value) {
    let mut cache = lock_project_cache();
    if cache.generation != generation {
        return;
    }
    cache.entry = Some(ProjectCacheEntry {
        url: config.url.clone(),
        token: config.token.clone(),
        stored_at: Instant::now(),
        value: value.clone(),
    });
}

fn fetch_project_page(config: &GitlabConfig, page: u32) -> Result<ProjectPage, String> {
    let response = gitlab_get(
        config,
        &format!("/projects?membership=true&simple=true&per_page=100&page={page}"),
    )?;
    let projects = response
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
        })
        .collect();
    Ok(ProjectPage {
        projects,
        has_next_page: response.has_next_page,
    })
}

/// Reads project pages in order. A failed first page is an error; a later failure, the page
/// limit or the deadline keeps the pages already read and returns a notice for the UI.
fn collect_projects(
    mut fetch_page: impl FnMut(u32) -> Result<ProjectPage, String>,
    mut expired: impl FnMut() -> bool,
) -> Result<(Vec<Value>, Option<String>), String> {
    let mut projects = Vec::new();
    for page in 1..=PROJECT_PAGE_LIMIT {
        if page > 1 && expired() {
            return Ok((projects, Some(PROJECT_DEADLINE_NOTICE.into())));
        }
        match fetch_page(page) {
            Ok(next) => {
                projects.extend(next.projects);
                if !next.has_next_page {
                    return Ok((projects, None));
                }
            }
            Err(error) if page == 1 => return Err(error),
            Err(error) => return Ok((projects, Some(error))),
        }
    }
    Ok((projects, Some(PROJECT_LIMIT_NOTICE.into())))
}
/// Returns the last `MAX_LOG_BYTES` of a job trace and whether earlier bytes were dropped.
///
/// The request asks for a suffix `Range`, so GitLab can send only the tail. A server
/// that ignores the header answers 200; its body is then streamed and only the tail
/// is kept. The HTTP agent's total timeout bounds the request either way.
fn fetch_log_tail(config: &GitlabConfig, base: &str) -> Result<(Vec<u8>, bool), String> {
    let url = format!("{}/api/v4{base}/trace", config.url.trim_end_matches('/'));

    let response = match gitlab_agent()
        .get(&url)
        .set("PRIVATE-TOKEN", &config.token)
        .set("User-Agent", USER_AGENT)
        .set("Range", &format!("bytes=-{MAX_LOG_BYTES}"))
        .call()
    {
        Ok(response) => response,
        // An empty trace cannot satisfy a suffix range.
        Err(ureq::Error::Status(416, _)) => return Ok((Vec::new(), false)),
        Err(ureq::Error::Status(401 | 403, _)) => {
            return Err("GitLab access token is invalid or lacks permission".into());
        }
        Err(_) => return Err("GitLab job log is unavailable".into()),
    };

    let ranged = response.status() == 206;
    let range_start = response
        .header("Content-Range")
        .and_then(content_range_start);
    let mut reader = response.into_reader();
    let mut tail = Vec::new();
    let mut total: u64 = 0;
    let mut chunk = [0u8; LOG_READ_CHUNK];
    loop {
        let read = reader
            .read(&mut chunk)
            .map_err(|_| "GitLab log is unreadable")?;
        if read == 0 {
            break;
        }
        total += read as u64;
        push_tail(&mut tail, &chunk[..read]);
    }

    let truncated = if ranged {
        range_start.is_none_or(|start| start > 0)
    } else {
        total > MAX_LOG_BYTES as u64
    };
    finish_tail(&mut tail, truncated);
    Ok((tail, truncated))
}

/// Parses the first offset from `bytes <start>-<end>/<total>`.
fn content_range_start(value: &str) -> Option<u64> {
    value
        .strip_prefix("bytes ")?
        .split('-')
        .next()?
        .trim()
        .parse()
        .ok()
}

/// Appends `chunk`, compacting only when the buffer reaches twice the limit, so memory
/// stays within 2 × `MAX_LOG_BYTES` plus one chunk and the copy cost is amortised.
fn push_tail(tail: &mut Vec<u8>, chunk: &[u8]) {
    tail.extend_from_slice(chunk);
    if tail.len() > 2 * MAX_LOG_BYTES {
        let cut = tail.len() - MAX_LOG_BYTES;
        tail.drain(..cut);
    }
}

/// Trims to the final `MAX_LOG_BYTES`. A cut that starts inside a UTF-8 sequence drops
/// its leftover continuation bytes so the log does not open with a broken character.
fn finish_tail(tail: &mut Vec<u8>, truncated: bool) {
    if tail.len() > MAX_LOG_BYTES {
        let cut = tail.len() - MAX_LOG_BYTES;
        tail.drain(..cut);
    }
    if truncated {
        let partial = tail
            .iter()
            .take(3)
            .take_while(|byte| **byte & 0xC0 == 0x80)
            .count();
        tail.drain(..partial);
    }
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
    fn job_log_keeps_the_tail_of_a_long_trace() {
        let body: &'static str = Box::leak(
            format!("{}ERROR: exit 1", "setup line\n".repeat(20_000)).into_boxed_str(),
        );
        let (url, server) = fixture(vec![body]);
        let config = GitlabConfig {
            url,
            token: "test-only".into(),
        };
        let (log, truncated) = fetch_log_tail(&config, "/projects/g%2Fr/jobs/3").unwrap();
        assert!(truncated);
        assert_eq!(log.len(), MAX_LOG_BYTES);
        assert!(log.ends_with(b"ERROR: exit 1"));
        assert!(server.join().unwrap()[0].contains("/projects/g%2Fr/jobs/3/trace"));
    }
    #[test]
    fn job_log_reports_a_complete_short_trace() {
        let (url, server) = fixture(vec!["short\n"]);
        let config = GitlabConfig {
            url,
            token: "test-only".into(),
        };
        let (log, truncated) = fetch_log_tail(&config, "/projects/g%2Fr/jobs/3").unwrap();
        assert!(!truncated);
        assert_eq!(log, b"short\n");
        server.join().unwrap();
    }
    #[test]
    fn tail_buffer_stays_bounded_while_streaming() {
        let mut tail = Vec::new();
        for _ in 0..1_000 {
            push_tail(&mut tail, &[b'x'; LOG_READ_CHUNK]);
            assert!(tail.len() <= 2 * MAX_LOG_BYTES + LOG_READ_CHUNK);
        }
        tail.extend_from_slice(b"end");
        finish_tail(&mut tail, true);
        assert_eq!(tail.len(), MAX_LOG_BYTES);
        assert!(tail.ends_with(b"xxend"));
    }
    #[test]
    fn tail_cut_inside_a_utf8_character_drops_its_remainder() {
        // "é" is two bytes; cutting one byte leaves a lone continuation byte at the start.
        let mut tail = format!("é{}", "a".repeat(MAX_LOG_BYTES - 1)).into_bytes();
        finish_tail(&mut tail, true);
        assert_eq!(tail.len(), MAX_LOG_BYTES - 1);
        assert_eq!(tail[0], b'a');
    }
    #[test]
    fn content_range_start_reads_the_first_offset() {
        assert_eq!(content_range_start("bytes 100-200/300"), Some(100));
        assert_eq!(content_range_start("bytes 0-9/10"), Some(0));
        assert_eq!(content_range_start("items 1-2/3"), None);
    }
    #[test]
    fn account_instance_change_rejects_detail_reads() {
        assert!(ensure_instance("https://b.example", "https://a.example").is_err());
        assert!(ensure_instance("https://a.example/", "https://a.example").is_ok());
    }

    fn project_page(has_next_page: bool) -> ProjectPage {
        ProjectPage {
            projects: vec![json!({"id": "1"})],
            has_next_page,
        }
    }

    fn test_config(url: &str, token: &str) -> GitlabConfig {
        GitlabConfig {
            url: url.into(),
            token: token.into(),
        }
    }

    #[test]
    fn project_first_page_failure_is_an_error() {
        assert!(collect_projects(|_| Err("Could not reach GitLab".into()), || false).is_err());
    }

    #[test]
    fn project_later_page_failure_keeps_loaded_pages_with_a_notice() {
        let (projects, notice) = collect_projects(
            |page| match page {
                1 => Ok(project_page(true)),
                _ => Err("Could not reach GitLab".into()),
            },
            || false,
        )
        .unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(notice.as_deref(), Some("Could not reach GitLab"));
    }

    #[test]
    fn project_pages_without_a_next_page_are_complete() {
        let (projects, notice) = collect_projects(|_| Ok(project_page(false)), || false).unwrap();
        assert_eq!(projects.len(), 1);
        assert!(notice.is_none());
    }

    #[test]
    fn project_pages_stop_at_the_deadline_after_the_first_page() {
        let mut calls = 0;
        let (projects, notice) = collect_projects(
            |_| {
                calls += 1;
                Ok(project_page(true))
            },
            || true,
        )
        .unwrap();
        assert_eq!(calls, 1);
        assert_eq!(projects.len(), 1);
        assert_eq!(notice.as_deref(), Some(PROJECT_DEADLINE_NOTICE));
    }

    #[test]
    fn project_pages_stop_at_the_page_limit_with_a_notice() {
        let mut calls = 0;
        let (projects, notice) = collect_projects(
            |_| {
                calls += 1;
                Ok(project_page(true))
            },
            || false,
        )
        .unwrap();
        assert_eq!(calls, PROJECT_PAGE_LIMIT);
        assert_eq!(projects.len(), PROJECT_PAGE_LIMIT as usize);
        assert_eq!(notice.as_deref(), Some(PROJECT_LIMIT_NOTICE));
    }

    #[test]
    fn cached_projects_serve_only_the_same_instance_and_token_within_the_ttl() {
        let now = Instant::now();
        let entry = ProjectCacheEntry {
            url: "https://gitlab.example".into(),
            token: "token-a".into(),
            stored_at: now,
            value: json!({}),
        };
        let same = test_config("https://gitlab.example", "token-a");
        assert!(project_entry_matches(&entry, &same, now));
        assert!(!project_entry_matches(
            &entry,
            &test_config("https://gitlab.example", "token-b"),
            now
        ));
        assert!(!project_entry_matches(
            &entry,
            &test_config("https://other.example", "token-a"),
            now
        ));
        assert!(!project_entry_matches(&entry, &same, now + PROJECT_CACHE_TTL));
    }
}
