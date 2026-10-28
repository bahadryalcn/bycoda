//! Synthetic source/owner guards below exercise native emission mechanics only,
//! never GUI identity, actor qualification or an installed provider receipt.
use super::*;
use std::sync::mpsc;

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
