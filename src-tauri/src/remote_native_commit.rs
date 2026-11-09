//! Local SQL consumption of actual Native replies. This is a transport fence,
//! never an execution/application grant, and it never encloses network work.
use super::*;

pub(crate) struct NativeProjection<'a> {
    reply: Option<&'a NativeRecoveryReply>,
}

impl<'a> NativeProjection<'a> {
    pub(super) fn new(reply: &'a NativeRecoveryReply) -> Self {
        Self { reply: Some(reply) }
    }

    #[cfg(test)]
    pub(crate) fn fixture() -> NativeProjection<'static> {
        NativeProjection { reply: None }
    }

    pub(crate) fn commit<T>(
        projections: &[&NativeProjection<'_>],
        consume: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        if projections.is_empty() {
            return Err("A Native reply is required for local commit".into());
        }
        #[cfg(test)]
        if projections
            .iter()
            .all(|projection| projection.reply.is_none())
        {
            return consume();
        }
        let replies = projections
            .iter()
            .map(|projection| {
                projection.reply.ok_or_else(|| {
                    "Native fixture and actual replies cannot share a commit".to_owned()
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        let first = &replies[0].selection;
        if replies.iter().any(|reply| {
            let selected = &reply.selection;
            !Arc::ptr_eq(&first.store, &selected.store)
                || !Arc::ptr_eq(&first.routes, &selected.routes)
                || first.path != selected.path
                || first.pin.revision != selected.pin.revision
                || first.pin.selected_endpoint != selected.pin.selected_endpoint
                || first.machine.local_host != selected.machine.local_host
                || !same_request_route(&first.machine, &selected.machine)
        }) {
            return Err("Native projections belong to different saved routes or principals".into());
        }
        let _store = first
            .store
            .lock()
            .map_err(|_| "Connection store is locked")?;
        let _route = first
            .routes
            .commit
            .lock()
            .map_err(|_| "Native route commit fence is unavailable")?;
        for reply in &replies {
            let selected = &reply.selection;
            validate_recovery_saved(
                &selected.machine,
                &selected.pin,
                &selected.routes,
                &selected.path,
            )?;
        }
        let guards = replies
            .iter()
            .filter_map(|reply| reply.guard.as_ref())
            .collect::<Vec<_>>();
        crate::host_ws::native_profile::NativeProfileGuard::commit_many(&guards, consume)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        root: PathBuf,
        reply: NativeRecoveryReply,
    }
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir()
                .canonicalize()
                .unwrap()
                .join(format!("bycoda-native-commit-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&root).unwrap();
            let path = root.join("connections.json");
            let machine = StoredMachine {
                id: "local".into(),
                name: "Fixture".into(),
                endpoint: "http://127.0.0.1:3774".into(),
                environment_id: "fixture-env".into(),
                token: "fixture-owner".into(),
                ssh: None,
                local_host: true,
            };
            write(&path, std::slice::from_ref(&machine)).unwrap();
            let routes = Arc::new(RecoveryRoutes::default());
            let selection = NativeRecoverySelection {
                store: Arc::new(Mutex::new(())),
                routes: routes.clone(),
                path,
                pin: RecoveryRoute {
                    revision: routes.capture().unwrap(),
                    selected_endpoint: machine.endpoint.clone(),
                },
                machine,
            };
            Self {
                root,
                reply: NativeRecoveryReply {
                    value: json!({}),
                    guard: None,
                    selection,
                },
            }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            assert_eq!(
                self.root.parent(),
                Some(std::env::temp_dir().canonicalize().unwrap().as_path())
            );
            assert!(self
                .root
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("bycoda-native-commit-"));
            std::fs::remove_dir_all(&self.root).unwrap();
        }
    }

    #[test]
    fn native_projection_commit_rejects_retired_route_before_sql() {
        let fixture = Fixture::new();
        fixture.reply.selection.routes.retire();
        let called = AtomicBool::new(false);
        assert!(
            NativeProjection::commit(&[&NativeProjection::new(&fixture.reply)], || {
                called.store(true, Ordering::Release);
                Ok(())
            })
            .is_err()
        );
        assert!(!called.load(Ordering::Acquire));
    }

    #[test]
    fn native_projection_commit_fences_route_retirement_through_sql() {
        let fixture = Fixture::new();
        let routes = fixture.reply.selection.routes.clone();
        let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
        let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
        let (retired_tx, retired_rx) = std::sync::mpsc::sync_channel(1);
        std::thread::scope(|scope| {
            let reply = &fixture.reply;
            let sql = scope.spawn(move || {
                NativeProjection::commit(&[&NativeProjection::new(reply)], || {
                    let conn = rusqlite::Connection::open_in_memory().unwrap();
                    conn.execute_batch("CREATE TABLE receipt(value INTEGER);")
                        .unwrap();
                    entered_tx.send(()).unwrap();
                    release_rx
                        .recv_timeout(std::time::Duration::from_secs(5))
                        .unwrap();
                    conn.execute("INSERT INTO receipt VALUES(1)", []).unwrap();
                    Ok(conn
                        .query_row("SELECT count(*) FROM receipt", [], |row| {
                            row.get::<_, i64>(0)
                        })
                        .unwrap())
                })
            });
            entered_rx
                .recv_timeout(std::time::Duration::from_secs(5))
                .unwrap();
            let retire = scope.spawn(move || {
                routes.retire();
                retired_tx.send(()).unwrap();
            });
            let blocked = retired_rx
                .recv_timeout(std::time::Duration::from_millis(40))
                .is_err();
            release_tx.send(()).unwrap();
            assert_eq!(sql.join().unwrap().unwrap(), 1);
            retire.join().unwrap();
            assert!(blocked);
        });
        assert!(
            NativeProjection::commit(&[&NativeProjection::new(&fixture.reply)], || Ok(())).is_err()
        );
    }

    #[test]
    fn native_projection_nested_callbacks_commit_both_contexts_once() {
        let fixture = Fixture::new();
        let inner = NativeRecoveryReply {
            value: json!({}),
            guard: None,
            selection: fixture.reply.selection.clone(),
        };
        fixture
            .reply
            .inspect(|_| {
                let outer_context = NativeProjection::new(&fixture.reply);
                inner.inspect(|_| {
                    let inner_context = NativeProjection::new(&inner);
                    NativeProjection::commit(
                        &[&outer_context, &inner_context, &outer_context],
                        || Ok(()),
                    )
                })
            })
            .unwrap();
    }

    #[test]
    fn native_projection_commit_rejects_mixed_principal_and_revision() {
        let fixture = Fixture::new();
        for change_principal in [true, false] {
            let mut selection = fixture.reply.selection.clone();
            if change_principal {
                selection.machine.token = "replacement-owner".into();
            } else {
                selection.pin.revision += 1;
            }
            let other = NativeRecoveryReply {
                value: json!({}),
                guard: None,
                selection,
            };
            assert!(NativeProjection::commit(
                &[
                    &NativeProjection::new(&fixture.reply),
                    &NativeProjection::new(&other)
                ],
                || Ok(())
            )
            .is_err());
        }
    }
}
