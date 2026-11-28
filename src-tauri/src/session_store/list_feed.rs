//! Paged "Last sessions" feed: keyset pages, per-project counts and a
//! revision counter that moves only when a list-visible value changes.
use super::{recent_summary_row, SessionStore, SessionSummary};
use rusqlite::{types::Value as SqlValue, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::Manager;

const DEFAULT_LIMIT: i64 = 100;
const MAX_LIMIT: i64 = 2000;
const MAX_MARKS: usize = 50_000;
const MAX_CWDS: usize = 500;
const MAX_ID_LEN: usize = 1024;
const MAX_CWD_LEN: usize = 4096;
const MAX_TITLE_LEN: usize = 500;
/// Same grace as `isSettledSession` in `sessionLifecycle.ts`.
const SETTLED_GRACE_MS: i64 = 5000;

const ACTIVITY: &str = "COALESCE(sessions.last_activity_at,sessions.updated_at)";
const COLUMNS: &str =
    "sessions.id, sessions.cwd, sessions.harness, sessions.model, sessions.runtime_mode,
        sessions.title, sessions.provider_session_id, sessions.created_at, sessions.updated_at,
        sessions.branch, sessions.archived, sessions.pinned, sessions.linked_work_item_json,
        sessions.worktree_cwd, sessions.worktree_removed, sessions.is_draft, sessions.automation_id,
        sessions.workspace_id, sessions.workspace_revision, sessions.workspace_mode,
        projection.interrupted, projection.provider_history, projection.activity_at,
        projection.management_json, COALESCE(sessions.last_activity_at,sessions.updated_at)";

pub(super) fn ensure_schema(conn: &Connection) -> rusqlite::Result<()> {
    const BUMP: &str = "UPDATE session_list_feed_revision SET revision=revision+1 WHERE id=1;";
    let columns = [
        "id",
        "title",
        "model",
        "harness",
        "runtime_mode",
        "provider_session_id",
        "branch",
        "archived",
        "pinned",
        "cwd",
        "linked_work_item_json",
        "worktree_cwd",
        "worktree_removed",
        "is_draft",
        "automation_id",
        "workspace_id",
        "workspace_revision",
        "workspace_mode",
        "assistant_management_json",
        "model_settings",
        "has_user_message",
        "inbox_ask",
    ];
    let mut changed: Vec<String> = columns
        .iter()
        .map(|column| format!("OLD.{column} IS NOT NEW.{column}"))
        .collect();
    changed.push(
        "COALESCE(OLD.last_activity_at,OLD.updated_at) IS NOT COALESCE(NEW.last_activity_at,NEW.updated_at)"
            .into(),
    );
    conn.execute_batch(&format!(
        "CREATE TABLE IF NOT EXISTS session_list_feed_revision (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
         INSERT OR IGNORE INTO session_list_feed_revision(id,revision) VALUES(1,0);
         CREATE TRIGGER IF NOT EXISTS list_feed_session_insert AFTER INSERT ON sessions BEGIN {BUMP} END;
         CREATE TRIGGER IF NOT EXISTS list_feed_session_delete AFTER DELETE ON sessions BEGIN {BUMP} END;
         CREATE TRIGGER IF NOT EXISTS list_feed_session_update AFTER UPDATE ON sessions
         WHEN {changed} BEGIN {BUMP} END;
         CREATE TRIGGER IF NOT EXISTS list_feed_summary_update AFTER UPDATE ON session_list_summaries
         WHEN OLD.interrupted IS NOT NEW.interrupted OR OLD.provider_history IS NOT NEW.provider_history
           OR OLD.activity_at IS NOT NEW.activity_at OR OLD.management_json IS NOT NEW.management_json
         BEGIN {BUMP} END;
         CREATE TRIGGER IF NOT EXISTS list_feed_worker_insert AFTER INSERT ON orchestration_workers BEGIN {BUMP} END;
         CREATE TRIGGER IF NOT EXISTS list_feed_worker_update AFTER UPDATE ON orchestration_workers
         WHEN OLD.session_id IS NOT NEW.session_id OR OLD.lead_id IS NOT NEW.lead_id BEGIN {BUMP} END;
         CREATE TRIGGER IF NOT EXISTS list_feed_worker_delete AFTER DELETE ON orchestration_workers BEGIN {BUMP} END;",
        changed = changed.join(" OR "),
    ))
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettledMark {
    id: String,
    settled_at: Option<i64>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SettledMode {
    Exclude,
    Only,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionListQuery {
    pinned: bool,
    since: Option<i64>,
    cwds: Option<Vec<String>>,
    settled: Option<Vec<SettledMark>>,
    settled_mode: Option<SettledMode>,
    title: Option<String>,
    /// true lists archived rows only; absent or false lists unarchived rows only.
    archived: Option<bool>,
    limit: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionListCursor {
    activity_at: i64,
    id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionListPage {
    rows: Vec<SessionSummary>,
    next_cursor: Option<SessionListCursor>,
    revision: i64,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionListCountGroup {
    cwd: String,
    count: i64,
    latest_activity_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionListCounts {
    groups: Vec<SessionListCountGroup>,
    total: i64,
    revision: i64,
}

#[tauri::command]
pub async fn session_list_page(
    app: tauri::AppHandle,
    query: SessionListQuery,
    cursor: Option<SessionListCursor>,
) -> Result<SessionListPage, String> {
    validate(&query, cursor.as_ref())?;
    crate::harness::run_blocking("session_list_page", move || {
        let store = app.state::<SessionStore>();
        store.with_read_conn(|conn| list_page(conn, &query, cursor.as_ref()))
    })
    .await
}

#[tauri::command]
pub async fn session_list_counts(
    app: tauri::AppHandle,
    query: SessionListQuery,
) -> Result<SessionListCounts, String> {
    validate(&query, None)?;
    crate::harness::run_blocking("session_list_counts", move || {
        let store = app.state::<SessionStore>();
        store.with_read_conn(|conn| list_counts(conn, &query))
    })
    .await
}

#[tauri::command]
pub async fn session_list_feed_revision(app: tauri::AppHandle) -> Result<i64, String> {
    crate::harness::run_blocking("session_list_feed_revision", move || {
        let store = app.state::<SessionStore>();
        store.with_read_conn(|conn| read_revision(conn))
    })
    .await
}

fn validate(query: &SessionListQuery, cursor: Option<&SessionListCursor>) -> Result<(), String> {
    if cursor.is_some_and(|c| c.id.is_empty() || c.id.len() > MAX_ID_LEN) {
        return Err("Invalid session-list cursor".into());
    }
    if let Some(marks) = &query.settled {
        if marks.len() > MAX_MARKS {
            return Err("Too many settled marks".into());
        }
        if marks
            .iter()
            .any(|mark| mark.id.is_empty() || mark.id.len() > MAX_ID_LEN)
        {
            return Err("Invalid settled mark id".into());
        }
    }
    if let Some(cwds) = &query.cwds {
        if cwds.len() > MAX_CWDS || cwds.iter().any(|cwd| cwd.len() > MAX_CWD_LEN) {
            return Err("Invalid session-list cwd filter".into());
        }
    }
    if query
        .title
        .as_ref()
        .is_some_and(|title| title.chars().count() > MAX_TITLE_LEN)
    {
        return Err("Session-list title filter is too long".into());
    }
    Ok(())
}

fn read_revision(conn: &Connection) -> Result<i64, String> {
    conn.query_row(
        "SELECT revision FROM session_list_feed_revision WHERE id=1",
        [],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

fn limit_of(query: &SessionListQuery) -> i64 {
    query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT)
}

fn escape_like(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    for ch in text.chars() {
        if matches!(ch, '%' | '_' | '\\') {
            out.push('\\');
        }
        out.push(ch);
    }
    format!("%{out}%")
}

/// One mark per id: a null `settledAt` (always settled) beats a timestamp.
fn marks_json(marks: &[SettledMark]) -> String {
    let mut merged: HashMap<&str, Option<i64>> = HashMap::new();
    for mark in marks {
        merged
            .entry(mark.id.as_str())
            .and_modify(|current| {
                *current = match (*current, mark.settled_at) {
                    (Some(a), Some(b)) => Some(a.max(b)),
                    _ => None,
                }
            })
            .or_insert(mark.settled_at);
    }
    let values: Vec<serde_json::Value> = merged
        .into_iter()
        .map(|(id, settled_at)| serde_json::json!({ "id": id, "settledAt": settled_at }))
        .collect();
    serde_json::Value::Array(values).to_string()
}

fn bind(args: &mut Vec<SqlValue>, value: SqlValue) -> String {
    args.push(value);
    format!("?{}", args.len())
}

struct Built {
    sql: String,
    args: Vec<SqlValue>,
}

/// Which statement to build around the shared filters.
enum Shape {
    Rows { limit: i64 },
    Counts,
}

/// `None` means the query can match nothing (settled "only" without marks).
fn build(
    query: &SessionListQuery,
    cursor: Option<&SessionListCursor>,
    cwd: Option<&str>,
    shape: &Shape,
) -> Option<Built> {
    let mut args: Vec<SqlValue> = Vec::new();
    let mark_args = match (query.settled_mode, query.settled.as_deref()) {
        (Some(_), Some(marks)) if !marks.is_empty() => Some(marks_json(marks)),
        (Some(SettledMode::Only), _) => return None,
        _ => None,
    };
    let mut cte = String::new();
    let mut wheres: Vec<String> = Vec::new();
    let only = query.settled_mode == Some(SettledMode::Only) && mark_args.is_some();
    let exclude = query.settled_mode == Some(SettledMode::Exclude) && mark_args.is_some();
    if let Some(json) = mark_args {
        let placeholder = bind(&mut args, SqlValue::Text(json));
        cte = format!(
            "WITH marks AS MATERIALIZED (SELECT json_extract(value,'$.id') AS mid, json_extract(value,'$.settledAt') AS msettled FROM json_each({placeholder})) "
        );
    }
    let grace =
        format!("(marks.msettled IS NULL OR {ACTIVITY} <= marks.msettled + {SETTLED_GRACE_MS})");
    let from = if only {
        wheres.push(format!("sessions.id=marks.mid AND {grace}"));
        "marks CROSS JOIN sessions".to_owned()
    } else {
        let archived = query.archived == Some(true);
        // The recent cover index is partial on archived=0, so archived rows cannot use it.
        let index = if cwd.is_some() || matches!(shape, Shape::Counts) {
            Some("sessions_activity_project_cover_v2_idx")
        } else if archived {
            None
        } else {
            Some("sessions_activity_recent_cover_v2_idx")
        };
        match index {
            Some(index) => format!("sessions INDEXED BY {index}"),
            None => "sessions".to_owned(),
        }
    };
    if exclude {
        wheres.push(format!(
            "NOT EXISTS (SELECT 1 FROM marks WHERE marks.mid=sessions.id AND {grace})"
        ));
    }
    wheres.push(format!(
        "sessions.has_user_message=1 AND sessions.archived={}",
        (query.archived == Some(true)) as i64
    ));
    let pinned = bind(&mut args, SqlValue::Integer(query.pinned as i64));
    wheres.push(format!("sessions.pinned={pinned}"));
    if let Some(since) = query.since {
        let p = bind(&mut args, SqlValue::Integer(since));
        wheres.push(format!("{ACTIVITY} >= {p}"));
    }
    if let Some(cwd) = cwd {
        let p = bind(&mut args, SqlValue::Text(cwd.to_owned()));
        wheres.push(format!("sessions.cwd={p}"));
    }
    // Like the list's own search: every word must appear in the title, model, provider, branch
    // or folder. ASCII-only case folding (SQLite LIKE); the client filter refines loaded rows.
    if let Some(title) = query.title.as_deref() {
        for word in title.split_whitespace().take(8) {
            let p = bind(&mut args, SqlValue::Text(escape_like(word)));
            wheres.push(format!(
                "(sessions.title LIKE {p} ESCAPE '\\' OR sessions.model LIKE {p} ESCAPE '\\' \
                 OR sessions.harness LIKE {p} ESCAPE '\\' OR COALESCE(sessions.branch,'') LIKE {p} ESCAPE '\\' \
                 OR sessions.cwd LIKE {p} ESCAPE '\\' OR COALESCE(sessions.worktree_cwd,'') LIKE {p} ESCAPE '\\')"
            ));
        }
    }
    if let Some(cursor) = cursor {
        let a = bind(&mut args, SqlValue::Integer(cursor.activity_at));
        let id = bind(&mut args, SqlValue::Text(cursor.id.clone()));
        wheres.push(format!(
            "{ACTIVITY} <= {a} AND ({ACTIVITY} < {a} OR sessions.id > {id})"
        ));
    }
    wheres.push("sessions.id NOT IN (SELECT id FROM sessions WHERE inbox_ask IS NOT NULL)".into());
    wheres.push("sessions.id NOT IN (SELECT session_id FROM orchestration_workers)".into());
    wheres.push("NOT EXISTS (SELECT 1 FROM delegated_session_ids d WHERE d.id=sessions.id)".into());
    let filter = wheres.join(" AND ");
    let sql = match shape {
        Shape::Rows { limit } => {
            let l = bind(&mut args, SqlValue::Integer(*limit));
            format!(
                "{cte}SELECT {COLUMNS} FROM {from}
                 LEFT JOIN session_list_summaries projection ON projection.session_id=sessions.id
                 WHERE {filter}
                 ORDER BY {ACTIVITY} DESC, sessions.id ASC LIMIT {l}"
            )
        }
        Shape::Counts => format!(
            "{cte}SELECT sessions.cwd, COUNT(*), MAX({ACTIVITY}) FROM {from}
             WHERE {filter}
             GROUP BY sessions.cwd ORDER BY MAX({ACTIVITY}) DESC, sessions.cwd ASC"
        ),
    };
    Some(Built { sql, args })
}

fn query_rows(conn: &Connection, built: Built) -> Result<Vec<SessionSummary>, String> {
    let mut statement = conn.prepare(&built.sql).map_err(|e| e.to_string())?;
    let rows = statement
        .query_map(rusqlite::params_from_iter(built.args), |row| {
            recent_summary_row(conn, row)
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())
}

fn list_page(
    conn: &Connection,
    query: &SessionListQuery,
    cursor: Option<&SessionListCursor>,
) -> Result<SessionListPage, String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let revision = read_revision(&tx)?;
    let limit = limit_of(query);
    let shape = Shape::Rows { limit: limit + 1 };
    let mut rows = Vec::new();
    match query.cwds.as_deref() {
        Some(cwds) => {
            let mut seen = std::collections::HashSet::new();
            for cwd in cwds.iter().filter(|cwd| seen.insert(cwd.as_str())) {
                if let Some(built) = build(query, cursor, Some(cwd), &shape) {
                    rows.extend(query_rows(&tx, built)?);
                }
            }
            rows.sort_by(|a, b| {
                b.last_activity_at
                    .cmp(&a.last_activity_at)
                    .then_with(|| a.id.cmp(&b.id))
            });
        }
        None => {
            if let Some(built) = build(query, cursor, None, &shape) {
                rows = query_rows(&tx, built)?;
            }
        }
    }
    let has_more = rows.len() as i64 > limit;
    rows.truncate(limit as usize);
    let next_cursor = if has_more {
        rows.last().map(|row| SessionListCursor {
            activity_at: row.last_activity_at,
            id: row.id.clone(),
        })
    } else {
        None
    };
    tx.commit().map_err(|e| e.to_string())?;
    Ok(SessionListPage {
        rows,
        next_cursor,
        revision,
    })
}

fn list_counts(conn: &Connection, query: &SessionListQuery) -> Result<SessionListCounts, String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let revision = read_revision(&tx)?;
    let mut groups = Vec::new();
    if let Some(built) = build(query, None, None, &Shape::Counts) {
        let mut statement = tx.prepare(&built.sql).map_err(|e| e.to_string())?;
        let rows = statement
            .query_map(rusqlite::params_from_iter(built.args), |row| {
                Ok(SessionListCountGroup {
                    cwd: row.get(0)?,
                    count: row.get(1)?,
                    latest_activity_at: row.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?;
        groups = rows
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?;
    }
    let total = groups.iter().map(|group| group.count).sum();
    tx.commit().map_err(|e| e.to_string())?;
    Ok(SessionListCounts {
        groups,
        total,
        revision,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session_store::{upsert_session, SessionUpsert};
    use serde_json::json;
    use std::collections::HashSet;

    fn sample(id: &str, cwd: &str, title: &str) -> SessionUpsert {
        SessionUpsert {
            preserve_activity_at: false,
            managed_by: None,
            id: id.into(),
            cwd: cwd.into(),
            harness: "cursor".into(),
            model: "gpt-5".into(),
            model_settings: json!({ "thinking": "high" }),
            runtime_mode: "supervised".into(),
            title: title.into(),
            provider_session_id: Some("acp-session-1".into()),
            provider_account_id: None,
            blocks: json!([{ "id": "b1", "role": "user", "text": "hello" }]),
            context_used: None,
            context_window: None,
            branch: None,
            worktree_cwd: None,
            workspace_mode: None,
            workspace_id: None,
            workspace_revision: None,
            worktree_removed: false,
            linked_work_item: None,
            automation_id: None,
            rewind_history: None,
            pending_context_replay: None,
            adopted_divergence: None,
            adopted_base: None,
            created_at: None,
            updated_at: None,
        }
    }

    fn query(pinned: bool) -> SessionListQuery {
        SessionListQuery {
            pinned,
            ..Default::default()
        }
    }

    fn add(conn: &Connection, id: &str, cwd: &str, title: &str, activity: i64) {
        upsert_session(conn, &sample(id, cwd, title)).unwrap();
        conn.execute(
            "UPDATE sessions SET last_activity_at=?2, updated_at=?2 WHERE id=?1",
            rusqlite::params![id, activity],
        )
        .unwrap();
    }

    fn ids(page: &SessionListPage) -> Vec<String> {
        page.rows.iter().map(|row| row.id.clone()).collect()
    }

    fn mark(id: &str, settled_at: Option<i64>) -> SettledMark {
        SettledMark {
            id: id.into(),
            settled_at,
        }
    }

    #[test]
    fn keyset_paging_is_stable_and_complete() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        for n in 0..25 {
            // Ties on activity exercise the id tiebreak.
            add(&conn, &format!("s{n:02}"), "/a", "t", 1000 + (n / 3) * 10);
        }
        let mut q = query(false);
        q.limit = Some(7);
        let mut cursor = None;
        let mut seen = Vec::new();
        loop {
            let page = list_page(&conn, &q, cursor.as_ref()).unwrap();
            seen.extend(ids(&page));
            match page.next_cursor {
                Some(next) => cursor = Some(next),
                None => break,
            }
        }
        assert_eq!(seen.len(), 25);
        assert_eq!(seen.iter().collect::<HashSet<_>>().len(), 25);
        let mut q_all = query(false);
        q_all.limit = Some(100);
        let all = ids(&list_page(&conn, &q_all, None).unwrap());
        assert_eq!(seen, all);
        assert_eq!(all[..2], ["s24", "s21"]);
    }

    #[test]
    fn pinned_segments_are_separate_and_since_filters() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        add(&conn, "old", "/a", "t", 100);
        add(&conn, "new", "/a", "t", 900);
        add(&conn, "pin", "/a", "t", 500);
        conn.execute("UPDATE sessions SET pinned=1 WHERE id='pin'", [])
            .unwrap();
        assert_eq!(ids(&list_page(&conn, &query(true), None).unwrap()), ["pin"]);
        assert_eq!(
            ids(&list_page(&conn, &query(false), None).unwrap()),
            ["new", "old"]
        );
        let mut q = query(false);
        q.since = Some(500);
        assert_eq!(ids(&list_page(&conn, &q, None).unwrap()), ["new"]);
    }

    #[test]
    fn cwds_merge_in_global_order_and_page() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        add(&conn, "a1", "/a", "t", 500);
        add(&conn, "b1", "/b", "t", 400);
        add(&conn, "a2", "/a", "t", 300);
        add(&conn, "b2", "/b", "t", 200);
        add(&conn, "c1", "/c", "t", 600);
        let mut q = query(false);
        q.cwds = Some(vec!["/a".into(), "/b".into(), "/a".into()]);
        q.limit = Some(3);
        let first = list_page(&conn, &q, None).unwrap();
        assert_eq!(ids(&first), ["a1", "b1", "a2"]);
        let second = list_page(&conn, &q, first.next_cursor.as_ref()).unwrap();
        assert_eq!(ids(&second), ["b2"]);
        assert!(second.next_cursor.is_none());
        q.cwds = Some(vec![]);
        assert!(list_page(&conn, &q, None).unwrap().rows.is_empty());
    }

    #[test]
    fn settled_exclude_and_only_follow_the_grace_rule() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        add(&conn, "settled", "/a", "t", 1000);
        add(&conn, "grace", "/a", "t", 1000 + 5000);
        add(&conn, "reopened", "/a", "t", 1000 + 5001);
        add(&conn, "forever", "/a", "t", 99_000);
        add(&conn, "plain", "/a", "t", 50);
        let marks = vec![
            mark("settled", Some(1000)),
            mark("grace", Some(1000)),
            mark("reopened", Some(1000)),
            mark("forever", None),
            mark("missing", Some(1)),
        ];
        let mut q = query(false);
        q.settled = Some(marks);
        q.settled_mode = Some(SettledMode::Only);
        let only = ids(&list_page(&conn, &q, None).unwrap());
        assert_eq!(only, ["forever", "grace", "settled"]);
        q.settled_mode = Some(SettledMode::Exclude);
        let rest = ids(&list_page(&conn, &q, None).unwrap());
        assert_eq!(rest, ["reopened", "plain"]);
        q.settled = Some(vec![]);
        q.settled_mode = Some(SettledMode::Only);
        assert!(list_page(&conn, &q, None).unwrap().rows.is_empty());
        q.settled_mode = Some(SettledMode::Exclude);
        assert_eq!(list_page(&conn, &q, None).unwrap().rows.len(), 5);
    }

    #[test]
    fn title_filter_escapes_like_wildcards() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        add(&conn, "p", "/a", "100% done", 3);
        add(&conn, "u", "/a", "a_b", 2);
        add(&conn, "x", "/a", "axb Mixed", 1);
        let mut q = query(false);
        q.title = Some("%".into());
        assert_eq!(ids(&list_page(&conn, &q, None).unwrap()), ["p"]);
        q.title = Some("a_b".into());
        assert_eq!(ids(&list_page(&conn, &q, None).unwrap()), ["u"]);
        q.title = Some("MIXED".into());
        assert_eq!(ids(&list_page(&conn, &q, None).unwrap()), ["x"]);
        q.title = Some("\\".into());
        assert!(list_page(&conn, &q, None).unwrap().rows.is_empty());
        // Every word must match, in any of the searched columns (here title and folder).
        q.title = Some("mixed  AXB".into());
        assert_eq!(ids(&list_page(&conn, &q, None).unwrap()), ["x"]);
        q.title = Some("/a done".into());
        assert_eq!(ids(&list_page(&conn, &q, None).unwrap()), ["p"]);
    }

    #[test]
    fn counts_group_by_cwd() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        add(&conn, "a1", "/a", "t", 100);
        add(&conn, "a2", "/a", "t", 300);
        add(&conn, "b1", "/b", "t", 200);
        add(&conn, "p1", "/b", "t", 900);
        conn.execute("UPDATE sessions SET pinned=1 WHERE id='p1'", [])
            .unwrap();
        let counts = list_counts(&conn, &query(false)).unwrap();
        assert_eq!(counts.total, 3);
        assert_eq!(
            counts.groups,
            vec![
                SessionListCountGroup {
                    cwd: "/a".into(),
                    count: 2,
                    latest_activity_at: 300
                },
                SessionListCountGroup {
                    cwd: "/b".into(),
                    count: 1,
                    latest_activity_at: 200
                },
            ]
        );
        let mut q = query(false);
        q.since = Some(250);
        assert_eq!(list_counts(&conn, &q).unwrap().total, 1);
    }

    #[test]
    fn archived_flag_selects_archived_rows_only() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        add(&conn, "live1", "/a", "t", 300);
        add(&conn, "live2", "/b", "t", 100);
        add(&conn, "arch1", "/a", "t", 400);
        add(&conn, "arch2", "/b", "t", 200);
        conn.execute("UPDATE sessions SET archived=1 WHERE id LIKE 'arch%'", [])
            .unwrap();
        let mut q = query(false);
        assert_eq!(
            ids(&list_page(&conn, &q, None).unwrap()),
            ["live1", "live2"]
        );
        q.archived = Some(false);
        assert_eq!(
            ids(&list_page(&conn, &q, None).unwrap()),
            ["live1", "live2"]
        );
        q.archived = Some(true);
        assert_eq!(
            ids(&list_page(&conn, &q, None).unwrap()),
            ["arch1", "arch2"]
        );
        q.cwds = Some(vec!["/b".into()]);
        assert_eq!(ids(&list_page(&conn, &q, None).unwrap()), ["arch2"]);
        q.cwds = None;
        let counts = list_counts(&conn, &q).unwrap();
        assert_eq!(counts.total, 2);
        assert_eq!(counts.groups[0].cwd, "/a");
        assert_eq!(counts.groups[0].latest_activity_at, 400);
        q.archived = None;
        assert_eq!(list_counts(&conn, &q).unwrap().total, 2);
        assert_eq!(
            list_counts(&conn, &q).unwrap().groups[0].latest_activity_at,
            300
        );
        // Settled "only" drives from the marks and still honours the flag.
        q.archived = Some(true);
        q.settled = Some(vec![mark("arch1", None), mark("live1", None)]);
        q.settled_mode = Some(SettledMode::Only);
        assert_eq!(ids(&list_page(&conn, &q, None).unwrap()), ["arch1"]);
    }

    fn revision(conn: &Connection) -> i64 {
        read_revision(conn).unwrap()
    }

    #[test]
    fn revision_bumps_on_metadata_changes_only() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let before = revision(&conn);
        add(&conn, "s1", "/a", "First", 100);
        let created = revision(&conn);
        assert!(created > before);

        upsert_session(&conn, &sample("s1", "/a", "Renamed")).unwrap();
        let renamed = revision(&conn);
        assert!(renamed > created);

        conn.execute("UPDATE sessions SET pinned=1 WHERE id='s1'", [])
            .unwrap();
        let pinned = revision(&conn);
        assert!(pinned > renamed);
        conn.execute("UPDATE sessions SET archived=1 WHERE id='s1'", [])
            .unwrap();
        let archived = revision(&conn);
        assert!(archived > pinned);
        // A no-op write of identical values never bumps.
        conn.execute("UPDATE sessions SET archived=1, pinned=1 WHERE id='s1'", [])
            .unwrap();
        assert_eq!(revision(&conn), archived);
        conn.execute("DELETE FROM sessions WHERE id='s1'", [])
            .unwrap();
        assert!(revision(&conn) > archived);
    }

    #[test]
    fn transcript_only_resave_keeps_the_revision() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let mut session = sample("s1", "/a", "Same");
        session.preserve_activity_at = true;
        upsert_session(&conn, &session).unwrap();
        conn.execute(
            "UPDATE sessions SET last_activity_at=100, updated_at=100 WHERE id='s1'",
            [],
        )
        .unwrap();
        // Same metadata, longer transcript.
        session.blocks = json!([
            { "id": "b1", "role": "user", "text": "hello" },
            { "id": "b2", "role": "assistant", "text": "more" }
        ]);
        let before = revision(&conn);
        upsert_session(&conn, &session).unwrap();
        assert_eq!(
            revision(&conn),
            before,
            "transcript-only save must not bump"
        );
    }

    #[test]
    fn rejects_invalid_input() {
        let mut q = query(false);
        q.title = Some("x".repeat(501));
        assert!(validate(&q, None).is_err());
        let mut q = query(false);
        q.settled = Some(vec![mark("", None)]);
        assert!(validate(&q, None).is_err());
        let bad = SessionListCursor {
            activity_at: 1,
            id: String::new(),
        };
        assert!(validate(&query(false), Some(&bad)).is_err());
        assert!(validate(&query(false), None).is_ok());
        let mut q = query(false);
        q.limit = Some(1_000_000);
        assert_eq!(limit_of(&q), MAX_LIMIT);
        q.limit = Some(-4);
        assert_eq!(limit_of(&q), 1);
    }

    /// 20k rows: a first page and a deep keyset page must not scan the table.
    /// The bound is generous (debug build, shared CI machines).
    #[test]
    fn pages_twenty_thousand_rows_quickly() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        add(&conn, "tmpl", "/a", "t", 1);
        let columns: Vec<String> = conn
            .prepare("SELECT name FROM pragma_table_info('sessions')")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        let select: Vec<String> = columns
            .iter()
            .map(|c| match c.as_str() {
                "id" => "'bulk-'||s.n".to_owned(),
                "last_activity_at" | "updated_at" => "s.n*1000".to_owned(),
                "cwd" => "'/proj-'||(s.n%40)".to_owned(),
                other => format!("t.{other}"),
            })
            .collect();
        conn.execute_batch(&format!(
            "INSERT INTO sessions({cols}) WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM s WHERE n<20000)
             SELECT {sel} FROM s, (SELECT * FROM sessions WHERE id='tmpl') t;",
            cols = columns.join(","),
            sel = select.join(","),
        ))
        .unwrap();
        let mut q = query(false);
        q.limit = Some(100);
        let started = std::time::Instant::now();
        let first = list_page(&conn, &q, None).unwrap();
        let deep = list_page(
            &conn,
            &q,
            Some(&SessionListCursor {
                activity_at: 10_000 * 1000,
                id: "bulk-10000".into(),
            }),
        )
        .unwrap();
        q.cwds = Some(vec!["/proj-7".into(), "/proj-8".into()]);
        let scoped = list_page(&conn, &q, None).unwrap();
        let elapsed = started.elapsed();
        assert_eq!(first.rows.len(), 100);
        assert_eq!(first.rows[0].id, "bulk-20000");
        assert_eq!(deep.rows[0].id, "bulk-9999");
        assert_eq!(scoped.rows.len(), 100);
        assert!(
            elapsed < std::time::Duration::from_millis(500),
            "three pages took {elapsed:?}"
        );
    }
}
