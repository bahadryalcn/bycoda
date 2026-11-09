//! Narrow local commit fence. No network or Permits.state lock may enter here.
use super::*;

fn failure(error: &WsFailure) -> String {
    format!(
        "{}{}",
        if error.uncertain {
            error.to_string().trim_end_matches('.').to_owned()
        } else {
            error.to_string()
        },
        if error.uncertain {
            ". The operation outcome is unknown; reconcile its command receipt before retrying."
        } else {
            ""
        }
    )
}

impl ReplyGuard {
    pub(crate) fn commit_many<T>(
        guards: &[&Self],
        consume: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        // Bulk preflight may lock Permits.state. Never repeat it under the
        // resource/grant locks: revocation takes state before these gates.
        for guard in guards {
            guard.check().map_err(|error| failure(&error))?;
        }
        let mut resources = Vec::new();
        let mut grants = Vec::new();
        for guard in guards {
            if let Some(disclosure) = &guard.disclosure {
                resources.push(disclosure.resource.clone());
            }
            if let Some(bulk) = &guard.bulk {
                let grant = bulk.commit_grant();
                resources.push(grant.resource());
                grants.push(grant);
            }
        }
        resources.sort_unstable_by_key(Arc::as_ptr);
        resources.dedup_by(|left, right| Arc::ptr_eq(left, right));
        grants.sort_unstable_by_key(Arc::as_ptr);
        grants.dedup_by(|left, right| Arc::ptr_eq(left, right));
        let _resources = resources
            .iter()
            .map(|scope| {
                scope
                    .commit
                    .lock()
                    .map_err(|_| "Native resource commit fence is unavailable".to_owned())
            })
            .collect::<Result<Vec<_>, _>>()?;
        let _grants = grants
            .iter()
            .map(|grant| {
                grant
                    .commit
                    .lock()
                    .map_err(|_| "Native bulk commit fence is unavailable".to_owned())
            })
            .collect::<Result<Vec<_>, _>>()?;
        for guard in guards {
            if let Some(disclosure) = &guard.disclosure {
                if !disclosure.resource.live() {
                    return Err(failure(&disclosure.failure));
                }
            }
        }
        if grants.iter().any(|grant| !grant.live()) {
            return Err("Native bulk grant changed before local commit".into());
        }
        consume()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{sync::mpsc, thread, time::Duration};

    fn guarded(permits: &permits::Permits) -> Arc<ReplyGuard> {
        Arc::new(ReplyGuard {
            disclosure: Some(Arc::new(ReplyDisclosure {
                resource: permits
                    .scope("native", "commit-request", &serde_json::json!({}))
                    .unwrap(),
                failure: WsFailure::local("RPC_WS_RESOURCE_RETIRED", "Native resource retired"),
            })),
            bulk: None,
        })
    }

    #[test]
    fn native_commit_resource_retirement_before_sql_rejects_consumption() {
        let permits = permits::Permits::new("env");
        let guard = guarded(&permits);
        permits.revoke_unary("native", "commit-request");
        let called = AtomicBool::new(false);
        assert!(ReplyGuard::commit_many(&[&guard], || {
            called.store(true, Ordering::Release);
            Ok(())
        })
        .is_err());
        assert!(!called.load(Ordering::Acquire));
    }

    #[test]
    fn native_commit_resource_retirement_waits_for_actual_sql() {
        let permits = Arc::new(permits::Permits::new("env"));
        let guard = guarded(&permits);
        let (entered_tx, entered_rx) = mpsc::sync_channel(1);
        let (release_tx, release_rx) = mpsc::sync_channel(1);
        let committed = guard.clone();
        let sql = thread::spawn(move || {
            ReplyGuard::commit_many(&[&committed, &committed], || {
                let database = rusqlite::Connection::open_in_memory().unwrap();
                database
                    .execute_batch("CREATE TABLE receipt(value INTEGER);")
                    .unwrap();
                entered_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                database
                    .execute("INSERT INTO receipt VALUES(1)", [])
                    .unwrap();
                Ok(database
                    .query_row("SELECT count(*) FROM receipt", [], |row| {
                        row.get::<_, i64>(0)
                    })
                    .unwrap())
            })
        });
        entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let (retired_tx, retired_rx) = mpsc::sync_channel(1);
        let retire = thread::spawn(move || {
            permits.revoke_unary("native", "commit-request");
            retired_tx.send(()).unwrap();
        });
        let blocked = retired_rx.recv_timeout(Duration::from_millis(40)).is_err();
        release_tx.send(()).unwrap();
        assert_eq!(sql.join().unwrap().unwrap(), 1);
        retire.join().unwrap();
        assert!(blocked, "retirement must linearize after local SQL");
        assert!(ReplyGuard::commit_many(&[&guard], || Ok(())).is_err());
    }
}
