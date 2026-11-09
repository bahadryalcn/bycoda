//! A per-machine sync cycle remains held across page retirement until Native
//! proves its admitted remote IO completed. Unknown outcomes never time out.
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use tauri::Manager;

struct Cycle {
    issuer: Arc<crate::control::receipts::WindowIssuer>,
    page: String,
    machine: String,
    active: usize,
    uncertain: bool,
}
fn cycles() -> &'static Mutex<HashMap<String, Cycle>> {
    static CYCLES: OnceLock<Mutex<HashMap<String, Cycle>>> = OnceLock::new();
    CYCLES.get_or_init(|| Mutex::new(HashMap::new()))
}
fn owners() -> &'static Mutex<HashMap<String, Arc<crate::control::receipts::WindowIssuer>>> {
    static OWNERS: OnceLock<Mutex<HashMap<String, Arc<crate::control::receipts::WindowIssuer>>>> =
        OnceLock::new();
    OWNERS.get_or_init(|| Mutex::new(HashMap::new()))
}
pub(crate) fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS native_sync_cycles (machine_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE, page TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS native_sync_owner (id INTEGER PRIMARY KEY CHECK(id=1), page TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('live','retired')));
      CREATE TABLE IF NOT EXISTS native_sync_owner_process (id INTEGER PRIMARY KEY CHECK(id=1), instance_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS native_sync_cycle_completions (operation_id TEXT PRIMARY KEY, machine_id TEXT NOT NULL, page TEXT NOT NULL)")
}
fn valid(value: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 4096 {
        Err("SYNC_OWNER_ID_INVALID".into())
    } else {
        Ok(())
    }
}
fn capture(
    window: &tauri::Window,
) -> Result<(String, Arc<crate::control::receipts::WindowIssuer>), String> {
    if !crate::window::is_workspace_window(window.label()) {
        return Err("SYNC_OWNER_WINDOW_INVALID".into());
    }
    let page = crate::harness::page_incarnation(window)?;
    let webview = window
        .app_handle()
        .get_webview_window(window.label())
        .ok_or("SYNC_OWNER_WINDOW_UNKNOWN")?;
    let issuer = crate::control::receipts::existing(&webview)?;
    if crate::harness::page_incarnation(window)? != page {
        return Err("SYNC_OWNER_PAGE_STALE".into());
    }
    Ok((page, issuer))
}
fn durable<T>(conn: &Connection, work: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let prior: i64 = conn
        .query_row("PRAGMA synchronous", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if !(0..=3).contains(&prior) {
        return Err("SYNC_OWNER_DURABILITY_INVALID".into());
    }
    conn.execute_batch("PRAGMA synchronous=FULL")
        .map_err(|e| e.to_string())?;
    let result = work();
    conn.execute_batch(&format!("PRAGMA synchronous={prior}"))
        .map_err(|e| e.to_string())?;
    let restored: i64 = conn
        .query_row("PRAGMA synchronous", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if restored != prior {
        return Err("SYNC_OWNER_DURABILITY_UNKNOWN".into());
    }
    result
}

fn prior_instance_retired(
    conn: &crate::session_store::cohort::RegisteredConnection,
    instance_id: &str,
) -> Result<bool, String> {
    let old_instance: Option<String> = conn
        .query_row(
            "SELECT instance_id FROM native_sync_owner_process WHERE id=1",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    // The exact store lease is held for the native instance lifetime. A missing
    // lease or failed read stays unknown; only an unlocked existing lease proves
    // that instance can no longer have admitted local IO running.
    Ok(old_instance.as_ref().is_some_and(|old| {
        old != instance_id
            && matches!(
                conn.recovery_lease_state(old),
                Ok(crate::session_store::cohort::LeaseState::Unleased)
            )
    }))
}

#[tauri::command]
pub async fn sync_cycle_begin(
    window: tauri::Window,
    machine_id: String,
    operation_id: String,
) -> Result<(), String> {
    valid(&machine_id)?;
    valid(&operation_id)?;
    let (page, issuer) = capture(&window)?;
    let app = window.app_handle().clone();
    crate::harness::run_blocking("sync_cycle_begin", move || {
      crate::native_window_lifecycle::persistence_write(&window, || {
        let store = app.state::<crate::session_store::SessionStore>();
        let conn = store.lock_conn()?;
        let instance_id = store.native_instance_id().to_string();
        durable(&conn, || {
            let tx = Transaction::new_unchecked(&conn, TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
            issuer.try_with_live(|| {
                let prior_instance_retired = prior_instance_retired(&conn, &instance_id)?;
                let mut known_owners = owners().lock().map_err(|_| "SYNC_OWNER_UNAVAILABLE")?;
                let mut entries = cycles().lock().map_err(|_| "SYNC_OWNER_UNAVAILABLE")?;
                let prior_owner: Option<(String,String)> = tx.query_row("SELECT page,state FROM native_sync_owner WHERE id=1", [], |r| Ok((r.get(0)?,r.get(1)?))).optional().map_err(|e| e.to_string())?;
                if let Some((old_page, state)) = prior_owner {
                    if old_page == page {
                        if !known_owners.get(&page).is_some_and(|old| Arc::ptr_eq(old, &issuer)) { return Err("SYNC_OWNER_UNKNOWN".into()); }
                    } else {
                        if state != "retired" && !prior_instance_retired {
                            let old = known_owners.get(&old_page).ok_or("SYNC_OWNER_UNKNOWN")?;
                            if !old.is_retired() || !matches!(crate::harness::page_retirement_status(&old_page), crate::harness::PageRetirement::Confirmed) { return Err("SYNC_OWNER_HELD".into()); }
                            let rows: Vec<String> = {
                                let mut statement = tx.prepare("SELECT operation_id FROM native_sync_cycles WHERE page=?1").map_err(|e| e.to_string())?;
                                let values = statement.query_map([&old_page], |r| r.get(0)).map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
                                values
                            };
                            if rows.iter().any(|id| entries.get(id).is_none_or(|entry| entry.page != old_page || entry.active != 0 || entry.uncertain)) { return Err("SYNC_OWNER_HELD".into()); }
                            tx.execute("DELETE FROM native_sync_cycles WHERE page=?1", [&old_page]).map_err(|e| e.to_string())?;
                            for id in rows { entries.remove(&id); }
                        }
                        if prior_instance_retired {
                            tx.execute("DELETE FROM native_sync_cycles WHERE page=?1", [&old_page]).map_err(|e| e.to_string())?;
                            entries.retain(|_, cycle| cycle.page != old_page);
                        }
                        let remaining: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM native_sync_cycles)", [], |r| r.get(0)).map_err(|e| e.to_string())?;
                        if remaining { return Err("SYNC_OWNER_HELD".into()); }
                        tx.execute("UPDATE native_sync_owner SET page=?1,state='live' WHERE id=1", [&page]).map_err(|e| e.to_string())?;
                        known_owners.remove(&old_page);
                    }
                } else {
                    tx.execute("INSERT INTO native_sync_owner(id,page,state) VALUES(1,?1,'live')", [&page]).map_err(|e| e.to_string())?;
                }
                known_owners.insert(page.clone(), issuer.clone());
                tx.execute("INSERT INTO native_sync_owner_process(id,instance_id) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET instance_id=excluded.instance_id", [&instance_id]).map_err(|e| e.to_string())?;
                let completed: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM native_sync_cycle_completions WHERE operation_id=?1)", [&operation_id], |r| r.get(0)).map_err(|e| e.to_string())?;
                if completed { return Err("SYNC_OWNER_ALREADY_COMPLETE".into()); }
                let previous: Option<(String,String)> = tx.query_row("SELECT operation_id,page FROM native_sync_cycles WHERE machine_id=?1", [&machine_id], |r| Ok((r.get(0)?,r.get(1)?))).optional().map_err(|e| e.to_string())?;
                if let Some((old_id, old_page)) = previous {
                    if old_id == operation_id && old_page == page {
                        if entries.get(&old_id).is_some_and(|old| Arc::ptr_eq(&old.issuer, &issuer) && old.machine == machine_id) { return Ok(()); }
                        return Err("SYNC_OWNER_UNKNOWN".into());
                    }
                    let Some(old) = entries.get(&old_id) else { return Err("SYNC_OWNER_UNKNOWN".into()); };
                    if old.page != old_page || !old.issuer.is_retired() || old.active != 0 || old.uncertain ||
                        !matches!(crate::harness::page_retirement_status(&old.page), crate::harness::PageRetirement::Confirmed) { return Err("SYNC_OWNER_HELD".into()); }
                    tx.execute("DELETE FROM native_sync_cycles WHERE machine_id=?1 AND operation_id=?2", params![machine_id,old_id]).map_err(|e| e.to_string())?;
                    entries.remove(&old_id);
                }
                tx.execute("INSERT INTO native_sync_cycles(machine_id,operation_id,page) VALUES(?1,?2,?3)", params![machine_id,operation_id,page]).map_err(|e| e.to_string())?;
                entries.insert(operation_id, Cycle { issuer: issuer.clone(), page, machine: machine_id, active: 0, uncertain: false });
                tx.commit().map_err(|e| e.to_string())?;
                Ok(())
            })
        })
      })
    }).await
}

/// Called after the native page issuer is retired. No timer or empty census
/// proves retirement, and an unresolved transport result keeps the row held.
pub(crate) fn page_retired(
    app: &tauri::AppHandle,
    issuer: &Arc<crate::control::receipts::WindowIssuer>,
) {
    let page = match owners().lock() {
        Ok(owners) => owners
            .iter()
            .find_map(|(page, owner)| Arc::ptr_eq(owner, issuer).then(|| page.clone())),
        Err(_) => None,
    };
    let Some(page) = page else {
        return;
    };
    let app = app.clone();
    let issuer = issuer.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            match crate::harness::page_retirement_status(&page) {
                crate::harness::PageRetirement::Confirmed => break,
                crate::harness::PageRetirement::Unknown => return,
                crate::harness::PageRetirement::Pending => {
                    tokio::time::sleep(std::time::Duration::from_millis(250)).await
                }
            }
        }
        let work = tauri::async_runtime::spawn_blocking(move || {
            let result: Result<(), String> = (|| {
                if !issuer.is_retired() {
                    return Ok(());
                }
                let store = app.state::<crate::session_store::SessionStore>();
                let conn = store.lock_conn()?;
                durable(&conn, || {
                    let tx = Transaction::new_unchecked(&conn, TransactionBehavior::Immediate)
                        .map_err(|e| e.to_string())?;
                    let mut known_owners = owners().lock().map_err(|_| "SYNC_OWNER_UNAVAILABLE")?;
                    let mut entries = cycles().lock().map_err(|_| "SYNC_OWNER_UNAVAILABLE")?;
                    let page = known_owners.iter().find_map(|(page, owner)| {
                        Arc::ptr_eq(owner, &issuer).then(|| page.clone())
                    });
                    let Some(page) = page else {
                        return Ok(());
                    };
                    if !matches!(
                        crate::harness::page_retirement_status(&page),
                        crate::harness::PageRetirement::Confirmed
                    ) {
                        return Ok(());
                    }
                    let ids: Vec<String> = {
                        let mut statement = tx
                            .prepare("SELECT operation_id FROM native_sync_cycles WHERE page=?1")
                            .map_err(|e| e.to_string())?;
                        let values = statement
                            .query_map([&page], |r| r.get(0))
                            .map_err(|e| e.to_string())?
                            .collect::<Result<Vec<_>, _>>()
                            .map_err(|e| e.to_string())?;
                        values
                    };
                    if ids.iter().any(|id| {
                        entries.get(id).is_none_or(|entry| {
                            entry.page != page || entry.active != 0 || entry.uncertain
                        })
                    }) {
                        return Ok(());
                    }
                    tx.execute("DELETE FROM native_sync_cycles WHERE page=?1", [&page])
                        .map_err(|e| e.to_string())?;
                    tx.execute("UPDATE native_sync_owner SET state='retired' WHERE id=1 AND page=?1 AND state='live'", [&page]).map_err(|e| e.to_string())?;
                    tx.commit().map_err(|e| e.to_string())?;
                    for id in ids {
                        entries.remove(&id);
                    }
                    known_owners.remove(&page);
                    Ok(())
                })
            })();
            if let Err(error) = result {
                log::warn!("retirement remains unknown: {error}");
            }
        });
        if let Err(error) = work.await {
            log::warn!("retirement worker failed: {error}");
        }
    });
}

pub(crate) struct Effect {
    id: String,
    app: tauri::AppHandle,
    finished: bool,
}
impl Effect {
    pub(crate) fn finish(mut self, _success: bool) {
        let mut retired = None;
        if let Ok(mut entries) = cycles().lock() {
            if let Some(cycle) = entries.get_mut(&self.id) {
                // The Host's sync mutations use baseRev CAS; once transport IO
                // has ended, the next pull reconciles an unknown HTTP outcome.
                cycle.active = cycle.active.saturating_sub(1);
                if cycle.issuer.is_retired() {
                    retired = Some(cycle.issuer.clone());
                }
            }
        }
        self.finished = true;
        if let Some(issuer) = retired {
            page_retired(&self.app, &issuer);
        }
    }
}
impl Drop for Effect {
    fn drop(&mut self) {
        if self.finished {
            return;
        }
        if let Ok(mut entries) = cycles().lock() {
            if let Some(cycle) = entries.get_mut(&self.id) {
                cycle.active = cycle.active.saturating_sub(1);
                cycle.uncertain = true;
            }
        }
    }
}
pub(crate) fn admit(
    window: &tauri::Window,
    machine: &str,
    operation_id: &str,
) -> Result<Effect, String> {
    let (_, issuer) = capture(window)?;
    issuer.with_live(|| {
        let mut entries = cycles().lock().map_err(|_| "SYNC_OWNER_UNAVAILABLE")?;
        let cycle = entries.get_mut(operation_id).ok_or("SYNC_OWNER_UNKNOWN")?;
        if cycle.machine != machine || !Arc::ptr_eq(&cycle.issuer, &issuer) || cycle.uncertain {
            return Err("SYNC_OWNER_HELD".into());
        }
        cycle.active = cycle.active.checked_add(1).ok_or("SYNC_OWNER_CAPACITY")?;
        Ok(Effect {
            id: operation_id.to_owned(),
            app: window.app_handle().clone(),
            finished: false,
        })
    })
}

#[tauri::command]
pub async fn sync_cycle_complete(
    window: tauri::Window,
    machine_id: String,
    operation_id: String,
) -> Result<(), String> {
    valid(&machine_id)?;
    valid(&operation_id)?;
    let (page, issuer) = capture(&window)?;
    let app = window.app_handle().clone();
    crate::harness::run_blocking("sync_cycle_complete", move || {
      crate::native_window_lifecycle::persistence_write(&window, || {
        let store = app.state::<crate::session_store::SessionStore>();
        let conn = store.lock_conn()?;
        durable(&conn, || {
            let tx = Transaction::new_unchecked(&conn, TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
            issuer.try_with_live(|| {
                let mut entries = cycles().lock().map_err(|_| "SYNC_OWNER_UNAVAILABLE")?;
                let prior: Option<(String,String)> = tx.query_row("SELECT machine_id,page FROM native_sync_cycle_completions WHERE operation_id=?1", [&operation_id], |r| Ok((r.get(0)?,r.get(1)?))).optional().map_err(|e| e.to_string())?;
                if let Some((machine, owner_page)) = prior {
                    if machine != machine_id || owner_page != page { return Err("SYNC_OWNER_ID_REUSED".into()); }
                    return Ok(());
                }
                let cycle = entries.get(&operation_id).ok_or("SYNC_OWNER_UNKNOWN")?;
                if cycle.machine != machine_id || !Arc::ptr_eq(&cycle.issuer, &issuer) || cycle.active != 0 || cycle.uncertain { return Err("SYNC_OWNER_HELD".into()); }
                let removed = tx.execute("DELETE FROM native_sync_cycles WHERE machine_id=?1 AND operation_id=?2 AND page=?3", params![machine_id,operation_id,page]).map_err(|e| e.to_string())?;
                if removed != 1 { return Err("SYNC_OWNER_UNKNOWN".into()); }
                tx.execute("INSERT INTO native_sync_cycle_completions(operation_id,machine_id,page) VALUES(?1,?2,?3)", params![operation_id,machine_id,page]).map_err(|e| e.to_string())?;
                tx.commit().map_err(|e| e.to_string())?;
                entries.remove(&operation_id);
                Ok(())
            })
        })
      })
    }).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    /// Closing the lease file does not release its lock at once for another opener:
    /// a child that another test is spawning shares the open file description between
    /// fork and exec (close-on-exec takes effect at exec), and Windows releases a
    /// closed handle's lock asynchronously. Release is eventual, so wait for it with a deadline.
    fn retired_within_deadline(
        store: &crate::session_store::SessionStore,
        instance_id: &str,
    ) -> bool {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            if prior_instance_retired(&store.lock_conn().unwrap(), instance_id).unwrap() {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    #[test]
    fn sync_restart_requires_the_exact_previous_instance_lease_to_be_unleased() {
        let directory =
            std::env::temp_dir().join(format!("bycoda-sync-owner-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("sync-owner.sqlite");
        let first = crate::session_store::SessionStore::open(path.clone()).unwrap();
        let first_id = first.native_instance_id().to_string();
        first
            .lock_conn()
            .unwrap()
            .execute(
                "INSERT INTO native_sync_owner_process(id,instance_id) VALUES(1,?1)",
                [&first_id],
            )
            .unwrap();
        let second = crate::session_store::SessionStore::open(path).unwrap();
        let second_id = second.native_instance_id().to_string();
        assert!(!prior_instance_retired(&second.lock_conn().unwrap(), &second_id).unwrap());
        assert!(!prior_instance_retired(&first.lock_conn().unwrap(), &first_id).unwrap());
        drop(first);
        assert!(retired_within_deadline(&second, &second_id));
        // An identity without an existing kernel lease is unknown, not retired.
        second
            .lock_conn()
            .unwrap()
            .execute(
                "UPDATE native_sync_owner_process SET instance_id=?1",
                [uuid::Uuid::new_v4().to_string()],
            )
            .unwrap();
        assert!(!prior_instance_retired(&second.lock_conn().unwrap(), &second_id).unwrap());
        drop(second);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
