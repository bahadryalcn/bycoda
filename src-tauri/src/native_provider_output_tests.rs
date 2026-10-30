//! Synthetic source/owner guards below exercise native emission mechanics only,
//! never GUI identity, actor qualification or an installed provider receipt.
use super::*;
use std::sync::mpsc;

#[test]
fn actual_process_wait_retains_original_reader_work_until_that_reader_closes() {
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};
    let registry = NativeProviderOutputRegistry::new();
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .arg("--list")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    crate::harness::prepare_gui_child(&mut command);
    let child = crate::harness::process_lifecycle::OwnedChild::spawn(&mut command).unwrap();
    let (output, process) = registry.begin_process(
        OutputSource::fixture("held-reader"),
        child,
        Arc::new(|| true),
        Arc::new(|_| true),
    );
    let reader = output.reader(0);
    output.reader(1).finish(true, false);
    let waiting_output = output.clone();
    let waiting = process.clone();
    let (returned, completion) = mpsc::channel();
    let waiter = std::thread::spawn(move || {
        returned.send(waiting.wait(&waiting_output, false)).unwrap();
    });
    let deadline = Instant::now() + Duration::from_secs(8);
    while !process.exit_observed() || !process.signals_closed() {
        assert!(
            Instant::now() < deadline,
            "held-reader process did not reach its owned stop phase"
        );
        std::thread::sleep(Duration::from_millis(2));
    }
    assert!(matches!(
        completion.try_recv(),
        Err(mpsc::TryRecvError::Empty)
    ));
    reader.finish(true, false);
    assert!(completion
        .recv_timeout(Duration::from_secs(5))
        .unwrap()
        .is_ok());
    waiter.join().unwrap();
    // An already closed actual owner can be joined repeatedly; it emits no
    // further numeric process/group signal after the final reap.
    process.request_stop().unwrap();
    process.wait_actual().unwrap();
    assert!(process.pin().is_err());
}

struct InputFixture {
    store: Arc<SessionStore>,
    registry: NativeProviderOutputRegistry,
    stream: Arc<NativeOutputStream>,
    original_resources: Arc<tauri::ResourceTable>,
    recipient_resources: Arc<tauri::ResourceTable>,
    recipient: Arc<OutputOwner>,
    checkpoint: NativeCheckpointWindow,
}
impl InputFixture {
    fn new() -> Self {
        use crate::session_store::window_barrier::WindowBarrier;
        let store = Arc::new(SessionStore::open_in_memory().unwrap());
        insert_session(&store, "logical");
        let barrier = WindowBarrier::new();
        barrier.admit_window("producer").unwrap();
        barrier.admit_window("recipient").unwrap();
        let original_resources = Arc::new(native_window_lifecycle::test_buffer_resources(
            &barrier, "producer",
        ));
        let recipient_resources = Arc::new(native_window_lifecycle::test_buffer_resources(
            &barrier,
            "recipient",
        ));
        let original =
            OutputOwner::capture_resources(original_resources.clone(), store.native_instance_id());
        let recipient =
            OutputOwner::capture_resources(recipient_resources.clone(), store.native_instance_id());
        let current_recipient = recipient.clone();
        let checkpoint = native_window_lifecycle::capture_checkpoint_resources(
            &recipient_resources,
            store.native_instance_id(),
        )
        .unwrap();
        let source = OutputSource::capture_owned_physical(
            store.clone(),
            "logical#input",
            Some("logical"),
            original,
        )
        .unwrap();
        let registry = NativeProviderOutputRegistry::new();
        let stream = registry.begin_sse(
            source,
            Arc::new(move || current_recipient.current()),
            Arc::new(|_| true),
        );
        Self {
            store,
            registry,
            stream,
            original_resources,
            recipient_resources,
            recipient,
            checkpoint,
        }
    }
    fn emit(&self, items: &[String], fail_send: bool, known: bool) -> NativeInputClaim {
        let (sent, received) = mpsc::channel::<()>();
        let mut receiver = Some(received);
        if fail_send {
            receiver.take();
        }
        let mut claim = None;
        self.stream.emit(OutputChannel::Sse, items, |metadata| {
            let raw = metadata.unwrap();
            let enqueued = sent.send(()).is_ok();
            self.stream.observe_recipient_delivery(
                Some(&raw),
                known.then(|| self.recipient.clone()),
                items,
                enqueued,
            );
            let mut batch = raw;
            batch.owner_epoch = known.then(|| self.recipient.epoch());
            claim = Some(NativeInputClaim {
                version: 1,
                qualified: false,
                kind: "native-output-item-comparison".into(),
                batch,
                item_index: 0,
            });
            enqueued
        });
        claim.unwrap()
    }
    fn seal(&self) {
        self.stream.reader(0).finish(true, false);
        self.stream.terminal_complete(true, false);
        self.stream.terminal_delivery(true);
    }
    fn compare(
        &self,
        claim: &NativeInputClaim,
    ) -> Result<VerifiedNativeInputComparison, InputComparisonError> {
        self.registry.compare_recipient_input(
            &self.store,
            &self.checkpoint,
            &self.recipient_resources,
            claim,
        )
    }
    fn prepare(&self, claims: &[NativeInputClaim]) -> PreparedNativeInputGroup {
        self.registry
            .prepare_input_group(&self.store, "logical", &self.checkpoint, claims)
            .unwrap()
    }
}

fn input_claim_json(claim: &NativeInputClaim) -> serde_json::Value {
    let mut batch = serde_json::to_value(&claim.batch).unwrap();
    batch.as_object_mut().unwrap().remove("available");
    batch.as_object_mut().unwrap().remove("unavailableReason");
    serde_json::json!({"version":1,"qualified":false,"kind":"native-output-item-comparison","batch":batch,"itemIndex":claim.item_index})
}

#[test]
fn closed_js_item_descriptor_parser_accepts_only_locators_not_observation_flags() {
    let f = InputFixture::new();
    let claim = f.emit(&["actual".into()], false, true);
    f.seal();
    let raw = input_claim_json(&claim);
    let parsed = NativeInputClaim::parse_json(&raw).unwrap();
    assert!(f.compare(&parsed).is_ok());
    for variant in 0..9 {
        let mut value = raw.clone();
        match variant {
            0 => value["qualified"] = serde_json::json!(true),
            1 => value["batch"]["available"] = serde_json::json!(true),
            2 => value["batch"]["unavailableReason"] = serde_json::Value::Null,
            3 => value["itemIndex"] = serde_json::json!(1),
            4 => value["batch"]["sequence"] = serde_json::json!(9007199254740992u64),
            5 => value["batch"]["logicalSessionId"] = serde_json::Value::Null,
            6 => value["batch"]["ownerEpoch"] = serde_json::json!("not-native-uuid"),
            7 => value["batch"]["payloadSha256"] = serde_json::json!("A".repeat(64)),
            _ => value["complete"] = serde_json::json!(true),
        }
        assert!(
            NativeInputClaim::parse_json(&value).is_err(),
            "variant {variant}"
        );
    }
}

#[test]
fn prepared_group_covers_more_than_32_items_without_allocating_single_item_handles() {
    let f = InputFixture::new();
    let items = (0..64)
        .map(|index| format!("item {index}"))
        .collect::<Vec<_>>();
    let base = f.emit(&items, false, true);
    f.seal();
    let claims = (0..items.len())
        .map(|index| {
            let mut claim = base.clone();
            claim.item_index = index;
            claim
        })
        .collect::<Vec<_>>();
    let group = f
        .registry
        .prepare_input_group(&f.store, "logical", &f.checkpoint, &claims)
        .unwrap();
    assert_eq!(group.items.len(), 64);
    assert_eq!(group.owners().len(), 2);
    assert_eq!(f.stream.comparisons.load(Ordering::Acquire), 0);
    assert_eq!(f.stream.groups.load(Ordering::Acquire), 1);
    let mut duplicated = claims.clone();
    duplicated.push(claims[0].clone());
    assert!(f
        .registry
        .prepare_input_group(&f.store, "logical", &f.checkpoint, &duplicated)
        .is_err());
    assert_eq!(f.stream.groups.load(Ordering::Acquire), 1);
    drop(group);
    assert_eq!(f.stream.groups.load(Ordering::Acquire), 0);
}

#[test]
fn stable_inputs_enclose_actual_full_commit_and_rollback_without_relocking() {
    use crate::native_window_lifecycle::with_checkpoint_owner_group;
    use crate::session_store::authority::with_full_projection_transaction;
    let f = InputFixture::new();
    let claim = f.emit(&["real retained input".into()], false, true);
    f.seal();
    let group = f.prepare(&[claim]);
    f.store
        .lock_conn()
        .unwrap()
        .execute_batch("CREATE TABLE input_join_marker(value TEXT NOT NULL)")
        .unwrap();
    let at_commit = Arc::new(Mutex::new(Vec::new()));
    let observed = at_commit.clone();
    let stream = f.stream.clone();
    let gate = f.registry.composition_gate.clone();
    f.store
        .lock_conn()
        .unwrap()
        .commit_hook(Some(move || {
            // This is SQLite's actual COMMIT hook, after the SQL callback returned.
            // Inner-callback-only guards would already have been released here.
            observed
                .lock()
                .unwrap()
                .push((stream.state.try_lock().is_err(), gate.try_write().is_err()));
            false
        }))
        .unwrap();
    for reject in [false, true] {
        let result =
            with_checkpoint_owner_group(&group.owners(), f.store.native_instance_id(), |owners| {
                group.with_stable_inputs(&owners, |stable| {
                    with_full_projection_transaction(&f.store, |tx| {
                        stable.validate_at(&f.store, &tx, |inputs| {
                            assert_eq!(inputs.logical_target(), "logical");
                            assert_eq!(inputs.len(), 1);
                            assert_eq!(
                                inputs.scope(0).unwrap().recipient_epoch,
                                f.checkpoint.incarnation()
                            );
                            assert!(inputs.scope(1).is_none());
                            assert_eq!(
                                tx.connection()
                                    .pragma_query_value(None, "synchronous", |row| row
                                        .get::<_, i64>(0))
                                    .unwrap(),
                                2
                            );
                            tx.connection()
                                .execute("INSERT INTO input_join_marker VALUES('owned')", [])
                                .unwrap();
                            if reject {
                                Err("fixture rollback".into())
                            } else {
                                Ok(())
                            }
                        })
                    })
                })
            });
        assert_eq!(result.is_err(), reject);
    }
    assert_eq!(*at_commit.lock().unwrap(), vec![(true, true)]);
    assert_eq!(
        f.store
            .lock_conn()
            .unwrap()
            .query_row("SELECT count(*) FROM input_join_marker", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
    f.store
        .lock_conn()
        .unwrap()
        .commit_hook(None::<fn() -> bool>)
        .unwrap();
    assert!(f.stream.state.try_lock().is_ok());
    assert!(f.registry.composition_gate.try_write().is_ok());
}

#[test]
fn stable_inputs_revalidate_original_row_inside_the_supplied_transaction() {
    use crate::native_window_lifecycle::with_checkpoint_owner_group;
    use crate::session_store::authority::with_full_projection_transaction;
    let f = InputFixture::new();
    let claim = f.emit(&["original row".into()], false, true);
    f.seal();
    let group = f.prepare(&[claim]);
    for replacement in [
        "DELETE FROM sessions WHERE id='logical'; INSERT INTO sessions(id,cwd,harness,model,runtime_mode,title,created_at,updated_at) VALUES('logical','/fixture','fixture','fixture','supervised','same',1,1)",
        "INSERT OR REPLACE INTO sessions(id,cwd,harness,model,runtime_mode,title,created_at,updated_at) SELECT id,cwd,harness,model,runtime_mode,title,created_at,updated_at FROM sessions WHERE id='logical'",
        "UPDATE sessions SET id='temporary' WHERE id='logical'; UPDATE sessions SET id='logical' WHERE id='temporary'",
    ] {
        let called = AtomicBool::new(false);
        let result = with_checkpoint_owner_group(&group.owners(), f.store.native_instance_id(), |owners| {
            group.with_stable_inputs(&owners, |stable| {
                with_full_projection_transaction(&f.store, |tx| {
                    tx.connection().execute_batch(replacement).unwrap();
                    stable.validate_at(&f.store, &tx, |_| {
                        called.store(true, Ordering::Release);
                        Ok(())
                    })
                })
            })
        });
        assert_eq!(result.err().as_deref(), Some("NATIVE_INPUT_SCOPE_CHANGED"));
        assert!(!called.load(Ordering::Acquire));
        // Failed validation rolled back the real replacement. The original
        // row is still valid; no guessed timestamp/rowid identity is involved.
        assert!(f.stream.source.matches_store(&f.store));
    }
    for late_mutation in [
        "INSERT OR REPLACE INTO sessions(id,cwd,harness,model,runtime_mode,title,created_at,updated_at) SELECT id,cwd,harness,model,runtime_mode,title,created_at,updated_at FROM sessions WHERE id='logical'",
        "UPDATE native_authority_identity SET source_store_id='replaced-by-consumer' WHERE id=1",
    ] {
        let result = with_checkpoint_owner_group(&group.owners(), f.store.native_instance_id(), |owners| {
            group.with_stable_inputs(&owners, |stable| {
                with_full_projection_transaction(&f.store, |tx| {
                    stable.validate_at(&f.store, &tx, |_| {
                        if late_mutation.starts_with("UPDATE native_authority_identity ") {
                            // Deliberate corruption inside this same transaction;
                            // failed validation rolls the guard and identity back.
                            tx.connection()
                                .execute_batch("DROP TRIGGER native_raw_identity_immutable")
                                .unwrap();
                        }
                        tx.connection().execute_batch(late_mutation).unwrap();
                        Ok(())
                    })
                })
            })
        });
        assert_eq!(result.err().as_deref(), Some("NATIVE_INPUT_SCOPE_CHANGED"));
        assert!(f.stream.source.matches_store(&f.store));
    }
    let foreign = SessionStore::open_in_memory().unwrap();
    assert!(
        with_checkpoint_owner_group(&group.owners(), f.store.native_instance_id(), |owners| {
            group.with_stable_inputs(&owners, |stable| {
                with_full_projection_transaction(&foreign, |tx| {
                    stable.validate_at(&f.store, &tx, |_| Ok(()))
                })
            })
        })
        .is_err()
    );
}

#[test]
fn prepared_group_requires_both_real_physical_owners_and_fresh_stream_state() {
    use crate::native_window_lifecycle::with_checkpoint_owner_group;
    let f = InputFixture::new();
    let claim = f.emit(&["retained".into()], false, true);
    f.seal();
    let group = f.prepare(&[claim]);
    let owners = group.owners();
    let called = AtomicBool::new(false);
    assert!(
        with_checkpoint_owner_group(&owners[..1], f.store.native_instance_id(), |checked| {
            group.with_stable_inputs(&checked, |_| {
                called.store(true, Ordering::Release);
                Ok(())
            })
        })
        .is_err()
    );
    assert!(!called.load(Ordering::Acquire));
    native_window_lifecycle::test_reload_buffer_resources(&f.recipient_resources);
    assert!(
        with_checkpoint_owner_group(&owners, f.store.native_instance_id(), |_| Ok(())).is_err()
    );

    let f = InputFixture::new();
    let claim = f.emit(&["retained".into()], false, true);
    f.seal();
    let group = f.prepare(&[claim]);
    f.stream.invalidate(UnavailableReason::EmitFailed);
    assert!(with_checkpoint_owner_group(
        &group.owners(),
        f.store.native_instance_id(),
        |checked| { group.with_stable_inputs(&checked, |_| Ok(())) }
    )
    .is_err());
}

#[test]
fn actual_shutdown_and_stream_invalidation_wait_through_commit_until_guard_release() {
    use crate::native_window_lifecycle::with_checkpoint_owner_group;
    use crate::session_store::authority::with_full_projection_transaction;
    use std::time::Duration;
    let f = InputFixture::new();
    let claim = f.emit(&["retained".into()], false, true);
    f.seal();
    let group = f.prepare(&[claim]);
    f.store
        .lock_conn()
        .unwrap()
        .execute_batch("CREATE TABLE guarded_commit(value INTEGER)")
        .unwrap();
    let registry = Arc::new(f.registry);
    let actual = registry.clone();
    let (start_shutdown, shutdown_start) = mpsc::channel();
    let (started_shutdown, shutdown_started) = mpsc::channel();
    let (done_shutdown, shutdown_done) = mpsc::channel();
    let shutdown = std::thread::spawn(move || {
        shutdown_start.recv_timeout(Duration::from_secs(5)).unwrap();
        started_shutdown.send(()).unwrap();
        actual.shutdown();
        done_shutdown.send(()).unwrap();
    });
    let actual = f.stream.clone();
    let (start_invalidation, invalidation_start) = mpsc::channel();
    let (started_invalidation, invalidation_started) = mpsc::channel();
    let (done_invalidation, invalidation_done) = mpsc::channel();
    let invalidation = std::thread::spawn(move || {
        invalidation_start
            .recv_timeout(Duration::from_secs(5))
            .unwrap();
        started_invalidation.send(()).unwrap();
        actual.invalidate(UnavailableReason::EmitFailed);
        done_invalidation.send(()).unwrap();
    });
    let observed = Arc::new(AtomicBool::new(false));
    let at_commit = observed.clone();
    f.store
        .lock_conn()
        .unwrap()
        .commit_hook(Some(move || {
            start_shutdown.send(()).unwrap();
            start_invalidation.send(()).unwrap();
            shutdown_started
                .recv_timeout(Duration::from_secs(5))
                .unwrap();
            invalidation_started
                .recv_timeout(Duration::from_secs(5))
                .unwrap();
            assert!(shutdown_done
                .recv_timeout(Duration::from_millis(75))
                .is_err());
            assert!(invalidation_done
                .recv_timeout(Duration::from_millis(75))
                .is_err());
            at_commit.store(true, Ordering::Release);
            false
        }))
        .unwrap();
    let result =
        with_checkpoint_owner_group(&group.owners(), f.store.native_instance_id(), |owners| {
            group.with_stable_inputs(&owners, |stable| {
                with_full_projection_transaction(&f.store, |tx| {
                    stable.validate_at(&f.store, &tx, |_| {
                        tx.connection()
                            .execute("INSERT INTO guarded_commit VALUES(1)", [])
                            .map_err(|error| error.to_string())?;
                        Ok(())
                    })
                })
            })
        });
    // Never leave the spawned work held if a SQL assertion fails.
    shutdown.join().unwrap();
    invalidation.join().unwrap();
    result.unwrap();
    assert!(observed.load(Ordering::Acquire));
    f.store
        .lock_conn()
        .unwrap()
        .commit_hook(None::<fn() -> bool>)
        .unwrap();
    assert_eq!(
        f.store
            .lock_conn()
            .unwrap()
            .query_row("SELECT count(*) FROM guarded_commit", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert!(registry.closed.load(Ordering::Acquire));
    assert_eq!(
        f.stream.state.lock().unwrap().reason,
        Some(UnavailableReason::EmitFailed)
    );
}

#[test]
fn group_admission_is_bounded_and_released_without_losing_retained_batches() {
    let f = InputFixture::new();
    let claim = f.emit(&["retained".into()], false, true);
    f.seal();
    let mut groups = (0..MAX_STREAM_GROUPS)
        .map(|_| f.prepare(std::slice::from_ref(&claim)))
        .collect::<Vec<_>>();
    assert_eq!(
        f.registry
            .prepare_input_group(
                &f.store,
                "logical",
                &f.checkpoint,
                std::slice::from_ref(&claim)
            )
            .err(),
        Some(InputComparisonError::Capacity)
    );
    assert_eq!(f.stream.comparisons.load(Ordering::Acquire), 0);
    groups.pop();
    let replacement = f.prepare(std::slice::from_ref(&claim));
    assert_eq!(replacement.logical_target(), "logical");
    drop(groups);
    drop(replacement);
    assert_eq!(f.stream.groups.load(Ordering::Acquire), 0);
    assert!(f.compare(&claim).is_ok());
}

#[test]
fn group_matches_actual_capture_across_distinct_retained_delivery_arcs() {
    use crate::native_window_lifecycle::with_checkpoint_owner_group;
    use crate::session_store::authority::with_full_projection_transaction;
    let mut f = InputFixture::new();
    let first = f.emit(&["first native owner capture".into()], false, true);
    let previous = f.recipient.clone();
    f.recipient =
        OutputOwner::capture_resources(f.recipient_resources.clone(), f.store.native_instance_id());
    assert!(!Arc::ptr_eq(&previous, &f.recipient));
    assert!(previous.owner.same_capture(&f.recipient.owner));
    let second = f.emit(&["recaptured same physical owner".into()], false, true);
    f.seal();
    let group = f.prepare(&[first, second]);
    with_checkpoint_owner_group(&group.owners(), f.store.native_instance_id(), |owners| {
        group.with_stable_inputs(&owners, |stable| {
            with_full_projection_transaction(&f.store, |tx| {
                stable.validate_at(&f.store, &tx, |inputs| {
                    assert_eq!(inputs.len(), 2);
                    Ok(())
                })
            })
        })
    })
    .unwrap();
}

#[test]
fn actual_recipient_enqueue_and_item_commitment_resolve_only_after_real_seal() {
    let f = InputFixture::new();
    let items = vec!["漢🦀\0\n".into(), "\u{feff}retained".into()];
    let mut claim = f.emit(&items, false, true);
    assert!(f.compare(&claim).is_err());
    f.seal();
    let proof = f.compare(&claim).unwrap();
    assert!(proof.is_current(&f.store, &f.checkpoint, &f.recipient_resources));
    assert_eq!(proof.scope().logical_session_id, "logical");
    assert_eq!(proof.scope().routing_session_id, "logical#input");
    assert_eq!(proof.scope().item_utf8_bytes, items[0].len());
    assert_eq!(
        proof.scope().item_sha256,
        format!("{:x}", Sha256::digest(items[0].as_bytes()))
    );
    claim.item_index = 1;
    assert_eq!(
        f.compare(&claim).unwrap().scope().item_utf8_bytes,
        items[1].len()
    );
    claim.item_index = 2;
    assert_eq!(
        f.compare(&claim).err(),
        Some(InputComparisonError::InvalidClaim)
    );
}

#[test]
fn forged_batch_scope_hash_channel_and_index_cannot_borrow_a_real_enqueue() {
    let f = InputFixture::new();
    let original = f.emit(&["actual".into()], false, true);
    f.seal();
    for variant in 0..12 {
        let mut claim = original.clone();
        match variant {
            0 => claim.batch.payload_sha256 = "0".repeat(64),
            1 => claim.batch.channel = OutputChannel::Stdout,
            2 => claim.batch.sequence += 1,
            3 => claim.batch.item_count += 1,
            4 => claim.batch.utf8_bytes += 1,
            5 => claim.batch.logical_session_id = Some("other".into()),
            6 => claim.batch.session_id = "logical#lookalike".into(),
            7 => claim.batch.source_store_id = Some("other-store".into()),
            8 => claim.batch.owner_epoch = Some(uuid::Uuid::new_v4().to_string()),
            9 => claim.batch.process_id = Some(123),
            10 => claim.qualified = true,
            _ => claim.kind = "applied".into(),
        }
        assert!(f.compare(&claim).is_err(), "variant {variant}");
    }
    assert!(f.compare(&original).is_ok());
}

#[test]
fn source_row_original_recipient_and_store_changes_invalidate_held_comparison() {
    for variant in [
        "row",
        "producer",
        "recipient",
        "other-store",
        "other-resource",
    ] {
        let f = InputFixture::new();
        let claim = f.emit(&["actual".into()], false, true);
        f.seal();
        let proof = f.compare(&claim).unwrap();
        match variant {
            "row" => {
                f.store
                    .lock_conn()
                    .unwrap()
                    .execute("DELETE FROM sessions WHERE id='logical'", [])
                    .unwrap();
                insert_session(&f.store, "logical");
            }
            "producer" => {
                native_window_lifecycle::test_reload_buffer_resources(&f.original_resources)
            }
            "recipient" => {
                native_window_lifecycle::test_reload_buffer_resources(&f.recipient_resources)
            }
            "other-store" => {
                let other = SessionStore::open_in_memory().unwrap();
                insert_session(&other, "logical");
                assert!(!proof.is_current(&other, &f.checkpoint, &f.recipient_resources));
                assert!(f
                    .registry
                    .compare_recipient_input(&other, &f.checkpoint, &f.recipient_resources, &claim)
                    .is_err());
                continue;
            }
            _ => {
                let resources = tauri::ResourceTable::default();
                assert!(!proof.is_current(&f.store, &f.checkpoint, &resources));
                assert!(f
                    .registry
                    .compare_recipient_input(&f.store, &f.checkpoint, &resources, &claim)
                    .is_err());
                continue;
            }
        }
        assert!(!proof.is_current(&f.store, &f.checkpoint, &f.recipient_resources));
        assert!(f.compare(&claim).is_err());
    }
}

#[test]
fn failed_unknown_and_missing_native_outcomes_never_become_input_eligibility() {
    for (failed, known) in [(true, true), (false, false)] {
        let f = InputFixture::new();
        let claim = f.emit(&["ordinary callback still ran".into()], failed, known);
        f.seal();
        assert!(f.compare(&claim).is_err());
        assert_eq!(f.stream.lock_state().deliveries, 1);
    }
    let f = InputFixture::new();
    let mut claim = None;
    f.stream
        .emit(OutputChannel::Sse, &["untracked".into()], |metadata| {
            let mut batch = metadata.unwrap();
            batch.owner_epoch = Some(f.recipient.epoch());
            claim = Some(NativeInputClaim {
                version: 1,
                qualified: false,
                kind: "native-output-item-comparison".into(),
                batch,
                item_index: 0,
            });
            true
        });
    f.seal();
    assert!(f.stream.verified_emit_seal().is_ok());
    assert!(f.compare(&claim.unwrap()).is_err()); // an aggregate seal is not a recipient receipt
}

#[test]
fn a_pid_and_mechanical_process_counters_cannot_replace_the_actual_child_owner() {
    let f = InputFixture::new();
    let original =
        OutputOwner::capture_resources(f.original_resources.clone(), f.store.native_instance_id());
    let source = OutputSource::capture_owned(
        f.store.clone(),
        "logical#pid-only",
        Some("logical"),
        Arc::new(move || original.current()),
    )
    .unwrap();
    let stream = f.registry.begin(
        source,
        StreamKind::Process,
        Some(std::process::id()),
        2,
        Arc::new(|| true),
        Arc::new(|_| true),
    );
    let items = vec!["actual callback, but no actual Child construction".into()];
    let mut claim = None;
    stream.emit(OutputChannel::Stdout, &items, |metadata| {
        let mut batch = metadata.unwrap();
        stream.observe_recipient_delivery(Some(&batch), Some(f.recipient.clone()), &items, true);
        batch.owner_epoch = Some(f.recipient.epoch());
        claim = Some(NativeInputClaim {
            version: 1,
            qualified: false,
            kind: "native-output-item-comparison".into(),
            batch,
            item_index: 0,
        });
        true
    });
    stream.reader(0).finish(true, false);
    stream.reader(1).finish(true, false);
    stream.terminal_complete(true, false);
    stream.terminal_delivery(true);
    assert!(stream.verified_emit_seal().is_ok()); // only the synthetic mechanical fixture
    assert_eq!(
        f.compare(&claim.unwrap()).err(),
        Some(InputComparisonError::Unknown)
    );
}

#[test]
fn real_retention_and_comparison_limits_preserve_ordinary_delivery_and_charge_until_drop() {
    let f = InputFixture::new();
    let claim = f.emit(&["actual".into()], false, true);
    f.seal();
    let mut handles = (0..MAX_COMPARISONS)
        .map(|_| f.compare(&claim).unwrap())
        .collect::<Vec<_>>();
    assert_eq!(
        f.compare(&claim).err(),
        Some(InputComparisonError::Capacity)
    );
    handles.pop();
    assert!(f.compare(&claim).is_ok());
    drop(handles);
    assert_eq!(f.stream.comparisons.load(Ordering::Acquire), 0);
    let overflow = InputFixture::new();
    let items = vec!["x".into(); MAX_BATCH_ITEMS];
    for _ in 0..3 {
        let _ = overflow.emit(&items, false, true);
    }
    assert_eq!(overflow.stream.records().len(), 3); // no ordinary output was suppressed
    assert_eq!(overflow.stream.lock_state().input_items, MAX_INPUT_ITEMS);
    overflow.seal();
    assert_eq!(
        overflow.stream.observation().reason,
        Some(UnavailableReason::RetentionCapacity)
    );
}

fn insert_session(store: &SessionStore, id: &str) {
    store
        .lock_conn()
        .unwrap()
        .execute(
            "INSERT INTO sessions(id,cwd,harness,model,runtime_mode,title,created_at,updated_at)
         VALUES(?1,'/isolated','antigravity','test','approval-required','test',1,1)",
            [id],
        )
        .unwrap();
}

fn native_owner_check() -> (
    crate::session_store::window_barrier::WindowBarrier,
    crate::session_store::window_barrier::WindowToken,
    Arc<dyn Fn() -> bool + Send + Sync>,
) {
    use crate::session_store::window_barrier::{NativeLane, WindowBarrier};
    let barrier = WindowBarrier::new();
    let window = barrier.admit_window("same-physical-label").unwrap();
    barrier.confirm_created(&window).unwrap();
    let owner = window.clone();
    let actual = barrier.clone();
    let check = Arc::new(move || {
        actual
            .begin_native_write(&owner, NativeLane::Buffers)
            .is_ok_and(|work| work.finish::<_, ()>(Ok(())).is_ok())
    });
    (barrier, window, check)
}

#[test]
fn persisted_logical_target_is_captured_without_changing_route_or_inventing_rows() {
    let store = Arc::new(SessionStore::open_in_memory().unwrap());
    insert_session(&store, "logical");
    let (_barrier, _window, owner) = native_owner_check();
    let source =
        OutputSource::capture_owned(store.clone(), "logical#child-2", Some("logical"), owner)
            .unwrap();
    let registry = NativeProviderOutputRegistry::new();
    let stream = registry.begin_sse(source, Arc::new(|| true), Arc::new(|_| true));
    stream.emit(OutputChannel::Sse, &["exact".into()], |metadata| {
        let metadata = metadata.unwrap();
        assert_eq!(metadata.session_id, "logical#child-2");
        assert_eq!(metadata.logical_session_id.as_deref(), Some("logical"));
        assert!(metadata.available);
        assert!(!metadata.qualified);
        true
    });
    let count: i64 = store
        .lock_conn()
        .unwrap()
        .query_row("SELECT count(*) FROM sessions", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 1);
    assert_eq!(stream.target(), "logical");
    assert!(registry.retained("logical").is_empty()); // public routing meaning preserved
    assert_eq!(registry.retained("logical#child-2").len(), 1);
    assert_eq!(
        stream.observation().logical_session_id.as_deref(),
        Some("logical")
    );
}

#[test]
fn logical_discovery_is_exact_bound_and_keeps_retired_negative_evidence() {
    let store = Arc::new(SessionStore::open_in_memory().unwrap());
    insert_session(&store, "logical");
    insert_session(&store, "other");
    let (_barrier, _window, owner) = native_owner_check();
    let registry = NativeProviderOutputRegistry::new();
    let bound = registry.begin_sse(
        OutputSource::capture_owned(
            store.clone(),
            "logical#real",
            Some("logical"),
            owner.clone(),
        )
        .unwrap(),
        Arc::new(|| true),
        Arc::new(|_| true),
    );
    let _lookalike = registry.begin_sse(
        OutputSource::capture_owned(
            store.clone(),
            "logical#lookalike",
            Some("other"),
            owner.clone(),
        )
        .unwrap(),
        Arc::new(|| true),
        Arc::new(|_| true),
    );
    let late = OutputSource::capture_owned(store.clone(), "logical_probe", None, owner).unwrap();
    insert_session(&store, "logical_probe");
    let _unbound = registry.begin_sse(late, Arc::new(|| true), Arc::new(|_| true));
    assert!(registry.retained("logical").is_empty());
    assert_eq!(registry.retained("logical#real").len(), 1);
    let matched = registry.retained_for_target("logical");
    assert_eq!(matched.len(), 1);
    assert!(Arc::ptr_eq(&matched[0], &bound));
    assert!(registry.retained_for_target("logical#real").is_empty());
    assert!(registry.retained_for_target("logical_probe").is_empty());
    bound.cancelled();
    let retired = registry.retained_for_target("logical");
    assert_eq!(retired.len(), 1);
    assert!(Arc::ptr_eq(&retired[0], &bound));
    assert!(retired[0].verified_emit_seal().is_err());
    registry.shutdown();
    assert!(registry.retained_for_target("logical").is_empty());
    assert!(retired[0].verified_emit_seal().is_err());
}

#[test]
fn explicit_missing_or_malformed_target_rejects_but_legacy_probe_never_retrobinds() {
    let store = Arc::new(SessionStore::open_in_memory().unwrap());
    let (_barrier, _window, owner) = native_owner_check();
    assert!(
        OutputSource::capture_owned(store.clone(), "route", Some("missing"), owner.clone())
            .is_err()
    );
    for value in ["", "bad\nidentity"] {
        assert!(
            OutputSource::capture_owned(store.clone(), "route", Some(value), owner.clone())
                .is_err()
        );
    }
    let source = OutputSource::capture_owned(store.clone(), "probe#exact", None, owner).unwrap();
    insert_session(&store, "probe#exact");
    let registry = NativeProviderOutputRegistry::new();
    let stream = registry.begin_sse(source, Arc::new(|| true), Arc::new(|_| true));
    stream.reader(0).finish(true, false);
    stream.terminal_complete(true, false);
    stream.terminal_delivery(true);
    let state = stream.observation();
    assert!(state.logical_session_id.is_none());
    assert_eq!(state.reason, Some(UnavailableReason::SessionUnbound));
    assert!(stream.verified_emit_seal().is_err());
}

#[test]
fn physical_window_replacement_and_deleted_logical_row_revoke_retained_source() {
    for replace_owner in [false, true] {
        let store = Arc::new(SessionStore::open_in_memory().unwrap());
        insert_session(&store, "logical");
        let (barrier, window, owner) = native_owner_check();
        let source =
            OutputSource::capture_owned(store.clone(), "route#immutable", Some("logical"), owner)
                .unwrap();
        let registry = NativeProviderOutputRegistry::new();
        let stream = registry.begin_sse(source, Arc::new(|| true), Arc::new(|_| true));
        stream.reader(0).finish(true, false);
        stream.terminal_complete(true, false);
        stream.terminal_delivery(true);
        let seal = stream.verified_emit_seal().unwrap();
        if replace_owner {
            barrier.observe_destroyed(&window).unwrap();
            let replacement = barrier.admit_window(window.label()).unwrap();
            barrier.confirm_created(&replacement).unwrap();
        } else {
            store
                .lock_conn()
                .unwrap()
                .execute("DELETE FROM sessions WHERE id='logical'", [])
                .unwrap();
        }
        assert!(!seal.is_current());
        assert_eq!(stream.observation().state, EmissionState::Unavailable);
    }
}

#[test]
fn explicit_source_loses_before_effect_admission_when_original_physical_owner_is_replaced() {
    let store = Arc::new(SessionStore::open_in_memory().unwrap());
    insert_session(&store, "logical");
    let (barrier, window, owner) = native_owner_check();
    let source = OutputSource::capture_owned(
        store.clone(),
        "logical#explicit",
        Some("logical"),
        owner.clone(),
    )
    .unwrap();
    assert!(source.assert_explicit_target_current(true).is_ok());
    barrier.observe_destroyed(&window).unwrap();
    let replacement = barrier.admit_window(window.label()).unwrap();
    barrier.confirm_created(&replacement).unwrap();
    assert!(source.store_current()); // the real row/Store did not change
    assert!(!source.owner_current()); // exact physical token did change
    assert!(source.assert_explicit_target_current(true).is_err());
    // Legacy omitted, unbound probes never gain proof and keep ordinary work.
    let probe = OutputSource::capture_owned(store, "probe", None, owner).unwrap();
    assert!(probe.assert_explicit_target_current(false).is_ok());
    assert!(!probe.current());
}

#[test]
fn actual_sql_row_reincarnation_never_revives_a_retained_emit_seal_or_pending_binding() {
    for mutation in ["delete-insert", "replace", "rename-aba"] {
        let store = Arc::new(SessionStore::open_in_memory().unwrap());
        insert_session(&store, "logical");
        let (_barrier, _window, owner) = native_owner_check();
        let source = OutputSource::capture_owned(
            store.clone(),
            "logical#pending",
            Some("logical"),
            owner.clone(),
        )
        .unwrap();
        let registry = NativeProviderOutputRegistry::new();
        let stream = registry.begin_sse(
            OutputSource::capture_owned(store.clone(), "logical#live", Some("logical"), owner)
                .unwrap(),
            Arc::new(|| true),
            Arc::new(|_| true),
        );
        stream.reader(0).finish(true, false);
        stream.terminal_complete(true, false);
        stream.terminal_delivery(true);
        let seal = stream.verified_emit_seal().unwrap();
        match mutation {
            "delete-insert" => {
                store
                    .lock_conn()
                    .unwrap()
                    .execute("DELETE FROM sessions WHERE id='logical'", [])
                    .unwrap();
                insert_session(&store, "logical");
            }
            "replace" => {
                let conn = store.lock_conn().unwrap();
                conn.execute_batch("PRAGMA recursive_triggers=OFF").unwrap();
                conn.execute("INSERT OR REPLACE INTO sessions(id,cwd,harness,model,runtime_mode,title,created_at,updated_at)
                  SELECT id,cwd,harness,model,runtime_mode,title,created_at,updated_at FROM sessions WHERE id='logical'", []).unwrap();
            }
            _ => {
                store.lock_conn().unwrap().execute_batch("UPDATE sessions SET id='other' WHERE id='logical'; UPDATE sessions SET id='logical' WHERE id='other'").unwrap();
            }
        }
        assert!(source.assert_explicit_target_current(true).is_err());
        assert!(!seal.is_current());
        assert_eq!(stream.observation().state, EmissionState::Unavailable);
        // Fresh construction can bind the real new row; old stream stays old.
        let new = OutputSource::capture_owned(
            store.clone(),
            "new-route",
            Some("logical"),
            native_owner_check().2,
        )
        .unwrap();
        assert!(new.current());
        assert!(!seal.is_current());
    }
}

#[test]
fn same_database_reopen_cannot_replace_the_captured_native_store_construction() {
    let root = std::env::temp_dir().join(format!("bycoda-output-binding-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    {
        let path = root.join("isolated.db");
        let store = Arc::new(SessionStore::open(path.clone()).unwrap());
        insert_session(&store, "logical");
        let (_barrier, _window, owner) = native_owner_check();
        let source =
            OutputSource::capture_owned(store.clone(), "route", Some("logical"), owner).unwrap();
        let reopened = SessionStore::open(path).unwrap();
        assert_eq!(
            store.authority_identity().unwrap(),
            reopened.authority_identity().unwrap()
        );
        assert_ne!(store.native_instance_id(), reopened.native_instance_id());
        assert!(source.matches_store(&store));
        assert!(!source.matches_store(&reopened));
    }
    // This unique test-owned directory is never a profile or provider directory.
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn native_authority_reservation_and_floor_are_bound_to_logical_not_routing_key() {
    let store = Arc::new(SessionStore::open_in_memory().unwrap());
    insert_session(&store, "logical");
    let (_barrier, _window, owner) = native_owner_check();
    let source =
        OutputSource::capture_owned(store.clone(), "logical#child", Some("logical"), owner)
            .unwrap();
    let gate = source.gate.as_ref().unwrap();
    let lease = gate
        .reserve(source.target(), "provider-test", None)
        .unwrap();
    let target: String = store
        .lock_conn()
        .unwrap()
        .query_row(
            "SELECT session_id FROM native_authority_reservations",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(target, "logical");
    drop(lease); // provably not forked, so normal cleanup is safe
    store.lock_conn().unwrap().execute(
        "INSERT INTO native_authority_floor(environment_id,session_id,generation,phase,migration_id,min_writer_protocol)
         VALUES('env','logical',1,'FENCED','migration',2)", []).unwrap();
    assert!(gate
        .reserve(source.target(), "provider-test", None)
        .is_err());
    // Routing grammar is deliberately broader than persisted session grammar.
    // It is never relaxed or parsed to manufacture authority over a target.
    let error = gate
        .reserve("logical#child", "route-only-test", None)
        .err()
        .unwrap();
    assert_eq!(error, "Invalid session id");
}

fn fixture(
    readers: usize,
) -> (
    NativeProviderOutputRegistry,
    Arc<NativeOutputStream>,
    Arc<Mutex<Vec<OutputState>>>,
) {
    let registry = NativeProviderOutputRegistry::new();
    let updates = Arc::new(Mutex::new(Vec::new()));
    let notices = updates.clone();
    let kind = if readers == 1 {
        StreamKind::Sse
    } else {
        StreamKind::Process
    };
    let stream = registry.begin(
        OutputSource::fixture("session"),
        kind,
        (readers == 2).then_some(123),
        readers,
        Arc::new(|| true),
        Arc::new(move |state| {
            notices.lock().unwrap().push(state);
            true
        }),
    );
    (registry, stream, updates)
}

#[test]
fn framed_digest_preserves_utf8_items_boundaries_channel_and_empty_strings() {
    let text = vec!["漢🦀\n\0".into(), "".into(), "ab".into()];
    let (bytes, digest) = payload_digest(OutputChannel::Stdout, &text).unwrap();
    assert_eq!(bytes, text.iter().map(String::len).sum::<usize>());
    let mut exact = b"bycoda-native-output-items-v1\0".to_vec();
    exact.push(1);
    exact.extend_from_slice(&3u32.to_le_bytes());
    for item in &text {
        exact.extend_from_slice(&(item.len() as u64).to_le_bytes());
        exact.extend_from_slice(item.as_bytes());
    }
    assert_eq!(digest, format!("{:x}", Sha256::digest(exact)));
    assert_ne!(
        digest,
        payload_digest(OutputChannel::Stderr, &text).unwrap().1
    );
    assert_ne!(
        payload_digest(OutputChannel::Stdout, &["ab".into(), "c".into()])
            .unwrap()
            .1,
        payload_digest(OutputChannel::Stdout, &["a".into(), "bc".into()])
            .unwrap()
            .1
    );
}

#[test]
fn sequence_is_recorded_before_actual_enqueue_and_shared_across_channels() {
    let (_registry, stream, _) = fixture(2);
    for (offset, channel) in [
        OutputChannel::Stdout,
        OutputChannel::Stderr,
        OutputChannel::Stdout,
    ]
    .into_iter()
    .enumerate()
    {
        stream.emit(channel, &["exact".into()], |metadata| {
            let metadata = metadata.unwrap();
            assert_eq!(metadata.sequence, offset as u64 + 1);
            assert_eq!(
                stream.records().last().unwrap().payload_sha256,
                metadata.payload_sha256
            );
            assert_eq!(stream.observation().state, EmissionState::Unsealed);
            true
        });
    }
    let records = stream.records();
    assert_eq!(records.len(), 3);
    assert_eq!(records[1].channel, OutputChannel::Stderr);
    assert!(!stream.observation().qualified);
}

#[test]
fn actual_terminal_wait_and_each_reader_eof_are_both_required() {
    let (_registry, stream, _) = fixture(2);
    let stdout = stream.reader(0);
    stdout.finish(true, false);
    // First reader may really finish before the second worker is scheduled.
    let stderr = stream.reader(1);
    stream.terminal_complete(true, false);
    assert_eq!(stream.observation().state, EmissionState::Unsealed);
    assert!(stream.verified_emit_seal().is_err());
    stderr.finish(true, false);
    assert_eq!(stream.observation().state, EmissionState::Unsealed);
    stream.terminal_delivery(true);
    assert_eq!(stream.observation().state, EmissionState::Sealed);
    assert!(stream.verified_emit_seal().unwrap().is_current());
}

#[test]
fn reader_error_abandonment_cancel_emit_failure_and_owner_loss_are_unavailable() {
    for mode in ["read", "drop", "cancel", "emit", "owner"] {
        let (_registry, stream, _) = fixture(1);
        let reader = stream.reader(0);
        match mode {
            "read" => reader.finish(false, false),
            "drop" => drop(reader),
            "cancel" => reader.finish(true, true),
            "emit" => {
                stream.emit(OutputChannel::Stdout, &["visible".into()], |_| false);
                reader.finish(true, false);
            }
            _ => {
                stream.invalidate(UnavailableReason::OwnerUnavailable);
                reader.finish(true, false);
            }
        }
        stream.terminal_complete(true, false);
        assert_eq!(stream.observation().state, EmissionState::Unavailable);
        assert!(stream.verified_emit_seal().is_err());
    }
}

#[test]
fn late_reader_settlement_publishes_seal_after_process_without_legacy_exit_replay() {
    let (_registry, stream, notices) = fixture(1);
    let reader = stream.reader(0);
    stream.terminal_complete(true, false);
    stream.terminal_delivery(true);
    assert_eq!(
        notices.lock().unwrap().last().unwrap().state,
        EmissionState::Unsealed
    );
    stream.emit(OutputChannel::Stdout, &["late actual bytes".into()], |_| {
        true
    });
    reader.finish(true, false);
    let snapshot = notices.lock().unwrap().clone();
    assert_eq!(snapshot.last().unwrap().state, EmissionState::Sealed);
    assert_eq!(snapshot.last().unwrap().last_sequence, 1);
}

#[test]
fn actual_enqueue_panic_stays_unavailable_and_does_not_leave_a_fake_pending_slot() {
    let (_registry, stream, _) = fixture(1);
    let reader = stream.reader(0);
    let owned = stream.clone();
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || owned.emit(
            OutputChannel::Stdout,
            &["x".into()],
            |_| panic!("fixture enqueue panic")
        )))
        .is_err()
    );
    reader.finish(true, false);
    stream.terminal_complete(true, false);
    assert_eq!(stream.observation().state, EmissionState::Unavailable);
    assert_eq!(stream.state.lock().unwrap().in_flight, 0);
}

#[test]
fn delayed_actual_notice_cannot_arrive_after_a_newer_sealed_notice() {
    use std::time::{Duration, Instant};
    let registry = NativeProviderOutputRegistry::new();
    let first = Arc::new(AtomicBool::new(true));
    let notices = Arc::new(Mutex::new(Vec::new()));
    let observed = notices.clone();
    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let release_rx = Mutex::new(release_rx);
    let (sealed_tx, sealed_rx) = mpsc::channel();
    let stream = registry.begin(
        OutputSource::fixture("notice-order"),
        StreamKind::Sse,
        None,
        1,
        Arc::new(|| true),
        Arc::new(move |state| {
            if first.swap(false, Ordering::AcqRel) {
                entered_tx.send(()).unwrap();
                release_rx
                    .lock()
                    .unwrap()
                    .recv_timeout(Duration::from_secs(5))
                    .unwrap();
            }
            if state.state == EmissionState::Sealed {
                let _ = sealed_tx.send(());
            }
            observed.lock().unwrap().push(state);
            true
        }),
    );
    let reader = stream.reader(0);
    let first_stream = stream.clone();
    let terminal = std::thread::spawn(move || first_stream.terminal_complete(true, false));
    entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    let reader_worker = std::thread::spawn(move || reader.finish(true, false));
    let delivery_stream = stream.clone();
    let delivery = std::thread::spawn(move || delivery_stream.terminal_delivery(true));
    let deadline = Instant::now() + Duration::from_secs(5);
    while stream.observation().state != EmissionState::Sealed && Instant::now() < deadline {
        std::thread::yield_now();
    }
    let actually_settled = stream.observation().state == EmissionState::Sealed;
    // These are actual callback enqueues, not calls to the public observation.
    let overtook = sealed_rx.recv_timeout(Duration::from_millis(200)).is_ok();
    release_tx.send(()).unwrap();
    terminal.join().unwrap();
    reader_worker.join().unwrap();
    delivery.join().unwrap();
    assert!(actually_settled);
    assert!(
        !overtook,
        "a newer notice overtook the delayed actual enqueue"
    );
    let notices = notices.lock().unwrap();
    assert_eq!(notices.first().unwrap().state, EmissionState::Unsealed);
    assert_eq!(notices.last().unwrap().state, EmissionState::Sealed);
    assert!(stream.verified_emit_seal().unwrap().is_current());
}

#[test]
fn retained_private_handle_revalidates_and_shutdown_does_not_erase_actual_work() {
    let (registry, stream, _) = fixture(1);
    let reader = stream.reader(0);
    assert_eq!(registry.retained("session").len(), 1);
    registry.shutdown();
    assert!(registry.retained("session").is_empty());
    assert_eq!(stream.state.lock().unwrap().readers, 1);
    reader.finish(true, false);
    stream.terminal_complete(true, false);
    assert_eq!(stream.observation().state, EmissionState::Unavailable);
    assert!(stream.verified_emit_seal().is_err());
}

#[test]
fn source_owner_invalidation_after_seal_revokes_native_private_handle() {
    let registry = NativeProviderOutputRegistry::new();
    let current = Arc::new(AtomicBool::new(true));
    let check = current.clone();
    let stream = registry.begin(
        OutputSource::fixture("session"),
        StreamKind::Sse,
        None,
        1,
        Arc::new(move || check.load(Ordering::Acquire)),
        Arc::new(|_| true),
    );
    stream.reader(0).finish(true, false);
    stream.terminal_complete(true, false);
    stream.terminal_delivery(true);
    let seal = stream.verified_emit_seal().unwrap();
    current.store(false, Ordering::Release);
    assert!(!seal.is_current());
}

#[test]
fn independent_python_framing_vectors_match_actual_native_encoder() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../src/integrations/harness/core/nativeOutputDelivery.fixture.json"
    ))
    .unwrap();
    for vector in fixture["cases"].as_array().unwrap() {
        let channel = match vector["channel"].as_str().unwrap() {
            "stdout" => OutputChannel::Stdout,
            "stderr" => OutputChannel::Stderr,
            "sse" => OutputChannel::Sse,
            _ => unreachable!(),
        };
        let items: Vec<String> = vector["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item.as_str().unwrap().to_owned())
            .collect();
        let (bytes, digest) = payload_digest(channel, &items).unwrap();
        assert_eq!(bytes as u64, vector["utf8Bytes"].as_u64().unwrap());
        assert_eq!(digest, vector["sha256"].as_str().unwrap());
    }
}

#[test]
fn failed_terminal_enqueue_cannot_produce_private_seal_even_after_eof() {
    let (_registry, stream, _) = fixture(1);
    stream.reader(0).finish(true, false);
    stream.terminal_complete(true, false);
    assert!(stream.verified_emit_seal().is_err());
    stream.terminal_delivery(false);
    assert_eq!(
        stream.observation().reason,
        Some(UnavailableReason::EmitFailed)
    );
    assert!(stream.verified_emit_seal().is_err());
}

#[test]
fn duplicate_reader_receipt_and_wrong_expected_reader_count_are_not_seals() {
    let (_registry, stream, _) = fixture(2);
    stream.reader(0).finish(true, false);
    stream.reader(0).finish(true, false);
    stream.reader(1).finish(true, false);
    stream.terminal_complete(true, false);
    stream.terminal_delivery(true);
    assert!(stream.verified_emit_seal().is_err());
    let (_registry, wrong, _) = fixture(0);
    wrong.terminal_complete(true, false);
    wrong.terminal_delivery(true);
    assert_eq!(
        wrong.observation().reason,
        Some(UnavailableReason::ReaderError)
    );
}

#[test]
fn retention_overflow_revokes_old_seal_without_suppressing_new_legacy_delivery() {
    let (registry, first, _) = fixture(1);
    first.reader(0).finish(true, false);
    first.terminal_complete(true, false);
    first.terminal_delivery(true);
    let seal = first.verified_emit_seal().unwrap();
    for _ in 1..=MAX_STREAMS {
        registry.begin(
            OutputSource::fixture("session"),
            StreamKind::Sse,
            None,
            1,
            Arc::new(|| true),
            Arc::new(|_| true),
        );
    }
    assert_eq!(registry.retained("session").len(), MAX_STREAMS);
    assert!(!seal.is_current());
    let last = registry.begin(
        OutputSource::fixture("session"),
        StreamKind::Sse,
        None,
        1,
        Arc::new(|| true),
        Arc::new(|_| true),
    );
    let mut delivered = false;
    last.emit(OutputChannel::Sse, &["still delivered".into()], |meta| {
        assert!(!meta.unwrap().available);
        delivered = true;
        true
    });
    assert!(delivered);
}

#[test]
fn record_capacity_does_not_silently_forget_earlier_receipts_or_drop_legacy_data() {
    let (_registry, stream, _) = fixture(1);
    for _ in 0..MAX_RECORDS {
        stream.emit(OutputChannel::Sse, &["x".into()], |_| true);
    }
    assert_eq!(stream.records().len(), MAX_RECORDS);
    let mut delivered = false;
    stream.emit(OutputChannel::Sse, &["last".into()], |meta| {
        assert!(!meta.unwrap().available);
        delivered = true;
        true
    });
    assert!(delivered);
    assert_eq!(stream.records().len(), MAX_RECORDS);
    assert_eq!(stream.observation().last_sequence, MAX_RECORDS as u64 + 1);
    assert_eq!(
        stream.observation().reason,
        Some(UnavailableReason::RetentionCapacity)
    );
}

#[test]
fn concurrent_channels_serialize_before_enqueue_without_reusing_batch_sequence() {
    let (_registry, stream, _) = fixture(2);
    let (tx, rx) = mpsc::channel();
    let jobs = [OutputChannel::Stdout, OutputChannel::Stderr]
        .into_iter()
        .map(|channel| {
            let stream = stream.clone();
            let tx = tx.clone();
            std::thread::spawn(move || {
                for _ in 0..40 {
                    stream.emit(channel, &["x".into()], |meta| {
                        tx.send(meta.unwrap().sequence).unwrap();
                        true
                    });
                }
            })
        })
        .collect::<Vec<_>>();
    drop(tx);
    for job in jobs {
        job.join().unwrap();
    }
    assert_eq!(
        rx.into_iter().collect::<Vec<_>>(),
        (1..=80).collect::<Vec<_>>()
    );
}

#[test]
fn capacity_and_counter_exhaustion_preserve_legacy_enqueue_but_never_seal() {
    let (_registry, stream, _) = fixture(1);
    let reader = stream.reader(0);
    let mut legacy = 0;
    stream.emit(
        OutputChannel::Stdout,
        &["x".repeat(MAX_BATCH_BYTES + 1)],
        |meta| {
            assert!(meta.is_none());
            legacy += 1;
            true
        },
    );
    assert_eq!(legacy, 1);
    assert_eq!(
        stream.observation().reason,
        Some(UnavailableReason::BatchCapacity)
    );
    stream.state.lock().unwrap().sequence = MAX_SAFE;
    stream.emit(OutputChannel::Stdout, &["x".into()], |meta| {
        assert!(meta.is_none());
        true
    });
    reader.finish(true, false);
    stream.terminal_complete(true, false);
    assert!(stream.verified_emit_seal().is_err());
}
