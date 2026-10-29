use super::*;
use crate::native_authority_pipe::AuthorityPipeAddress;
use crate::session_store::SessionStore;
use std::sync::Arc;
use std::time::Instant;

fn store() -> Arc<SessionStore> {
    Arc::new(SessionStore::open_in_memory().unwrap())
}
fn binding(store: Arc<SessionStore>) -> CapturedSourceBinding {
    CapturedSourceBinding::capture(store, "source-environment").unwrap()
}
fn options() -> SourceEndpointOptions {
    SourceEndpointOptions {
        io_timeout: Duration::from_secs(3),
    }
}
fn budget() -> PipeBudget {
    PipeBudget::new(Duration::from_secs(2), PipeCancellation::default()).unwrap()
}
fn start(store: Arc<SessionStore>) -> SourceEndpoint {
    SourceEndpoint::start(binding(store), PipeCancellation::default(), options()).unwrap()
}
fn client(endpoint: &SourceEndpoint) -> AuthorityPipeConnection {
    let address = AuthorityPipeAddress::parse_local(endpoint.descriptor().address()).unwrap();
    AuthorityPipeConnection::connect_current_native_image(&address, &budget()).unwrap()
}
fn hello(endpoint: &SourceEndpoint, client: &mut AuthorityPipeConnection) -> Value {
    client
        .send_json(
            &json!({
                "version":1,"kind":"source-hello",
                "registrationNonce":endpoint.descriptor().registration_nonce(),
                "environmentId":"source-environment",
            }),
            &budget(),
        )
        .unwrap();
    client.read_json(&budget()).unwrap()
}
fn status(client: &mut AuthorityPipeConnection, epoch: &str, id: u64) -> Value {
    client
        .send_json(
            &json!({"version":1,"kind":"source-status","requestId":id,"sourceEpoch":epoch}),
            &budget(),
        )
        .unwrap();
    client.read_json(&budget()).unwrap()
}
fn finished(endpoint: &SourceEndpoint) {
    let until = Instant::now() + Duration::from_secs(5);
    while !endpoint.observation().unwrap().thread_finished {
        assert!(
            Instant::now() < until,
            "actual endpoint worker did not finish"
        );
        std::thread::sleep(Duration::from_millis(2));
    }
}

fn retained_store(text: &str) -> (Arc<SessionStore>, SourceSnapshot) {
    let store = store();
    let source = store
        .authority_test_retained_snapshot(
            "source-environment",
            "retained.session",
            "retained.migration",
            text,
        )
        .unwrap();
    (store, source)
}
fn exchange(
    client: &mut AuthorityPipeConnection,
    epoch: &str,
    id: u64,
    mut request: Value,
) -> Result<Value, PipeError> {
    request["version"] = json!(1);
    request["requestId"] = json!(id);
    request["sourceEpoch"] = json!(epoch);
    client.send_json(&request, &budget())?;
    client.read_json(&budget())
}
fn retained_open(
    client: &mut AuthorityPipeConnection,
    epoch: &str,
    id: u64,
) -> Result<Value, PipeError> {
    exchange(
        client,
        epoch,
        id,
        json!({"kind":"source-retained-open","sessionId":"retained.session","migrationId":"retained.migration"}),
    )
}
fn retained_close(
    client: &mut AuthorityPipeConnection,
    epoch: &str,
    id: u64,
    export: &str,
) -> Result<Value, PipeError> {
    exchange(
        client,
        epoch,
        id,
        json!({"kind":"source-retained-close","exportId":export}),
    )
}

fn projection_request() -> Value {
    json!({"kind":"source-projection-observe","sessionId":"logical.session","migrationId":"migration.round","generation":7})
}
fn observed_projection() -> Value {
    json!({"version":1,"qualified":false,"prepareId":uuid::Uuid::new_v4().to_string(),
        "status":"observed","receiptCount":1,"missingCoverage":["provider-application-unverified"]})
}

#[test]
fn projection_observer_runs_only_after_hello_for_exact_monotonic_request() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    let _serial = test_lock();
    let calls = Arc::new(AtomicUsize::new(0));
    let actual_calls = calls.clone();
    let expected = observed_projection();
    let result = expected.clone();
    let endpoint = SourceEndpoint::start_with_projection(
        binding(store()),
        PipeCancellation::default(),
        options(),
        Arc::new(move |session, migration, generation, cancellation| {
            assert_eq!(
                (session, migration, generation),
                ("logical.session", "migration.round", 7)
            );
            assert!(!cancellation.is_cancelled());
            actual_calls.fetch_add(1, Ordering::AcqRel);
            Ok(result.clone())
        }),
    )
    .unwrap();
    let mut pipe = client(&endpoint);
    let initial = hello(&endpoint, &mut pipe);
    let epoch = initial["sourceEpoch"].as_str().unwrap();
    assert_eq!(calls.load(Ordering::Acquire), 0);
    status(&mut pipe, epoch, 1);
    assert_eq!(calls.load(Ordering::Acquire), 0);
    let response = exchange(&mut pipe, epoch, 2, projection_request()).unwrap();
    assert_eq!(
        response,
        json!({"version":1,"kind":"source-projection-observation","requestId":2,"sourceEpoch":epoch,"observation":expected})
    );
    assert_eq!(calls.load(Ordering::Acquire), 1);
    assert!(exchange(&mut pipe, epoch, 2, projection_request()).is_err());
    assert_eq!(endpoint.join(), Ok(SourceExit::InvalidRequestId));
    assert_eq!(calls.load(Ordering::Acquire), 1);
}

#[test]
fn projection_missing_or_invalid_callback_is_explicit_unverified_without_error_details() {
    let _serial = test_lock();
    for mode in 0..4 {
        let mut endpoint = if mode == 0 {
            start(store())
        } else {
            SourceEndpoint::start_with_projection(
                binding(store()),
                PipeCancellation::default(),
                options(),
                Arc::new(move |_, _, _, _| {
                    let mut result = observed_projection();
                    match mode {
                        1 => return Err("private SQL/path/token details".into()),
                        2 => result["qualified"] = json!(true),
                        _ => result["receiptCount"] = json!(65),
                    }
                    Ok(result)
                }),
            )
            .unwrap()
        };
        let mut pipe = client(&endpoint);
        let initial = hello(&endpoint, &mut pipe);
        let result = exchange(
            &mut pipe,
            initial["sourceEpoch"].as_str().unwrap(),
            1,
            projection_request(),
        )
        .unwrap();
        assert_eq!(result["observation"]["status"], "unverified");
        assert_eq!(result["observation"]["qualified"], false);
        assert_eq!(result["observation"]["receiptCount"], 0);
        assert!(
            uuid::Uuid::parse_str(result["observation"]["prepareId"].as_str().unwrap()).is_ok()
        );
        assert!(!result.to_string().contains("private SQL"));
        drop(pipe);
        endpoint.shutdown().unwrap();
    }
}

#[test]
fn projection_rejects_closed_scope_extra_fields_and_unsafe_generation_before_callback() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    let _serial = test_lock();
    let calls = Arc::new(AtomicUsize::new(0));
    for variant in 0..5 {
        let actual = calls.clone();
        let endpoint = SourceEndpoint::start_with_projection(
            binding(store()),
            PipeCancellation::default(),
            options(),
            Arc::new(move |_, _, _, _| {
                actual.fetch_add(1, Ordering::AcqRel);
                Ok(observed_projection())
            }),
        )
        .unwrap();
        let mut pipe = client(&endpoint);
        let initial = hello(&endpoint, &mut pipe);
        let mut request = projection_request();
        match variant {
            0 => request["sessionId"] = json!("logical#routing-suffix"),
            1 => request["generation"] = json!(MAX_REQUEST_ID + 1),
            2 => request["qualified"] = json!(true),
            3 => request["migrationId"] = json!("x".repeat(201)),
            _ => request["sessionId"] = json!(".not-an-identifier"),
        }
        assert!(exchange(
            &mut pipe,
            initial["sourceEpoch"].as_str().unwrap(),
            1,
            request
        )
        .is_err());
        assert_eq!(endpoint.join(), Ok(SourceExit::Malformed));
    }
    assert_eq!(calls.load(Ordering::Acquire), 0);
}

#[test]
fn projection_cancel_keeps_callback_and_endpoint_owned_until_actual_settlement() {
    use std::sync::mpsc;
    let _serial = test_lock();
    let cancellation = PipeCancellation::default();
    let (entered, observed) = mpsc::channel();
    let (release, held) = mpsc::channel();
    let held = Mutex::new(held);
    let endpoint = SourceEndpoint::start_with_projection(
        binding(store()),
        cancellation.clone(),
        options(),
        Arc::new(move |_, _, _, cancellation| {
            entered.send(()).unwrap();
            held.lock()
                .unwrap()
                .recv_timeout(Duration::from_secs(5))
                .unwrap();
            assert!(cancellation.is_cancelled());
            Ok(observed_projection())
        }),
    )
    .unwrap();
    let mut pipe = client(&endpoint);
    let initial = hello(&endpoint, &mut pipe);
    let mut request = projection_request();
    request["version"] = json!(1);
    request["requestId"] = json!(1);
    request["sourceEpoch"] = initial["sourceEpoch"].clone();
    pipe.send_json(&request, &budget()).unwrap();
    observed.recv_timeout(Duration::from_secs(5)).unwrap();
    cancellation.cancel();
    assert!(!endpoint.observation().unwrap().thread_finished);
    assert_eq!(endpoints().lock().unwrap().len(), 1);
    release.send(()).unwrap();
    assert_eq!(endpoint.join(), Ok(SourceExit::Cancelled));
    assert!(endpoints().lock().unwrap().is_empty());
    assert!(pipe.read_json(&budget()).is_err());
}

#[test]
fn projection_binding_is_revalidated_after_callback_before_disclosure() {
    let _serial = test_lock();
    let store = store();
    let changed = store.clone();
    let endpoint = SourceEndpoint::start_with_projection(binding(store), PipeCancellation::default(), options(), Arc::new(move |_, _, _, _| {
        // Inject source corruption past the immutable SQL gate so the original
        // captured binding still has to reject before disclosing its callback.
        changed.lock_conn().unwrap().execute_batch(
            "DROP TRIGGER native_raw_identity_immutable;
             UPDATE native_authority_identity SET source_store_id='changed-during-observe' WHERE id=1",
        ).unwrap();
        Ok(observed_projection())
    })).unwrap();
    let mut pipe = client(&endpoint);
    let initial = hello(&endpoint, &mut pipe);
    assert!(exchange(
        &mut pipe,
        initial["sourceEpoch"].as_str().unwrap(),
        1,
        projection_request()
    )
    .is_err());
    assert_eq!(endpoint.join(), Ok(SourceExit::BindingChanged));
}

#[test]
fn retained_exact_multibyte_chunks_are_read_only_and_close_releases_actual_export() {
    let _serial = test_lock();
    let text = "🦀漢ç".repeat(10_000);
    let (store, source) = retained_store(&text);
    let before = serde_json::to_value(store.authority_status("retained.session").unwrap()).unwrap();
    let changes: i64 = store
        .lock_conn()
        .unwrap()
        .query_row("SELECT total_changes()", [], |row| row.get(0))
        .unwrap();
    let endpoint = start(store.clone());
    let mut client = client(&endpoint);
    let initial = hello(&endpoint, &mut client);
    let epoch = initial["sourceEpoch"].as_str().unwrap();
    let open = retained_open(&mut client, epoch, 1).unwrap();
    assert_eq!(open["state"], "retained");
    assert_eq!(open["qualified"], false);
    assert_eq!(open["fence"], serde_json::to_value(&source.fence).unwrap());
    assert_eq!(open["totalBytes"], source.snapshot_json.len());
    assert_eq!(open["chunkBytes"], RETAINED_CHUNK_BYTES);
    let export = open["exportId"].as_str().unwrap();
    assert_eq!(uuid::Uuid::parse_str(export).unwrap().get_version_num(), 4);
    assert_eq!(retained_exports().lock().unwrap().len(), 1);
    let mut actual = Vec::new();
    let mut split_utf8 = false;
    let mut id = 2;
    loop {
        let chunk = exchange(
            &mut client,
            epoch,
            id,
            json!({"kind":"source-retained-chunk","exportId":export,"offset":actual.len()}),
        )
        .unwrap();
        id += 1;
        assert_eq!(chunk["offset"], actual.len());
        assert_eq!(chunk["qualified"], false);
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(chunk["data"].as_str().unwrap())
            .unwrap();
        assert_eq!(
            bytes.len(),
            RETAINED_CHUNK_BYTES.min(source.snapshot_json.len() - actual.len())
        );
        split_utf8 |= std::str::from_utf8(&bytes).is_err();
        actual.extend(bytes);
        assert_eq!(chunk["eof"], actual.len() == source.snapshot_json.len());
        if chunk["eof"] == true {
            break;
        }
    }
    assert!(
        split_utf8,
        "fixture must exercise a codepoint split across byte chunks"
    );
    assert_eq!(actual, source.snapshot_json.as_bytes());
    assert_eq!(
        retained_exports().lock().unwrap().len(),
        1,
        "EOF is not an export close"
    );
    let close = retained_close(&mut client, epoch, id, export).unwrap();
    assert_eq!(
        close,
        json!({"version":1,"kind":"source-retained-close-result","requestId":id,"sourceEpoch":epoch,
        "exportId":export,"retired":true,"qualified":false})
    );
    // The reply can be read before the server's post-write binding check has
    // settled. A following serialized operation observes completed retirement.
    assert_eq!(status(&mut client, epoch, id + 1)["requestId"], id + 1);
    assert!(retained_exports().lock().unwrap().is_empty());
    assert_eq!(
        serde_json::to_value(store.authority_status("retained.session").unwrap()).unwrap(),
        before
    );
    assert_eq!(
        store
            .authority_snapshot("retained.migration")
            .unwrap()
            .snapshot_json,
        source.snapshot_json
    );
    assert_eq!(
        store
            .lock_conn()
            .unwrap()
            .query_row("SELECT total_changes()", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        changes
    );
    client.close();
    assert_eq!(endpoint.join(), Ok(SourceExit::PeerClosed));
}

#[test]
fn retained_missing_is_explicit_absent_and_never_creates_a_floor() {
    let _serial = test_lock();
    let store = store();
    let endpoint = start(store.clone());
    let mut client = client(&endpoint);
    let initial = hello(&endpoint, &mut client);
    let epoch = initial["sourceEpoch"].as_str().unwrap();
    let result = retained_open(&mut client, epoch, 1).unwrap();
    assert_eq!(
        result,
        json!({"version":1,"kind":"source-retained-open-result","requestId":1,"sourceEpoch":epoch,
        "sessionId":"retained.session","migrationId":"retained.migration","state":"absent","qualified":false})
    );
    assert!(store
        .authority_status("retained.session")
        .unwrap()
        .is_none());
    assert_eq!(status(&mut client, epoch, 2)["requestId"], 2);
    assert!(retained_exports().lock().unwrap().is_empty());
    client.close();
    endpoint.join().unwrap();
}

#[test]
fn retained_corrupt_oversized_and_foreign_scope_records_fail_without_absent() {
    let _serial = test_lock();
    for sql in [
        "UPDATE native_authority_journal SET snapshot_json='{}'",
        "UPDATE native_authority_journal SET snapshot_json=CAST(zeroblob(33554433) AS TEXT)",
        "UPDATE native_authority_journal SET fence_json=json_set(fence_json,'$.unexpected',true)",
        "UPDATE native_authority_journal SET session_id='foreign'",
    ] {
        let (store, _) = retained_store("preserved");
        store.lock_conn().unwrap().execute(sql, []).unwrap();
        let endpoint = start(store);
        let mut client = client(&endpoint);
        let initial = hello(&endpoint, &mut client);
        assert!(
            retained_open(&mut client, initial["sourceEpoch"].as_str().unwrap(), 1).is_err(),
            "{sql}"
        );
        assert_eq!(endpoint.join(), Ok(SourceExit::RetainedUnavailable));
        assert!(retained_exports().lock().unwrap().is_empty());
    }
}

#[test]
fn retained_offsets_ids_unknown_fields_and_one_export_admission_are_closed() {
    let _serial = test_lock();
    for case in ["offset", "id", "repeat-open", "request-id", "extra"] {
        let (store, _) = retained_store("🦀".repeat(5000).as_str());
        let endpoint = start(store);
        let mut client = client(&endpoint);
        let initial = hello(&endpoint, &mut client);
        let epoch = initial["sourceEpoch"].as_str().unwrap();
        let open = retained_open(&mut client, epoch, 1).unwrap();
        let export = open["exportId"].as_str().unwrap();
        let (id, request, expected) = match case {
            "offset" => (
                2,
                json!({"kind":"source-retained-chunk","exportId":export,"offset":1}),
                SourceExit::InvalidOffset,
            ),
            "id" => (
                2,
                json!({"kind":"source-retained-close","exportId":uuid::Uuid::new_v4().to_string()}),
                SourceExit::InvalidExport,
            ),
            "repeat-open" => (
                2,
                json!({"kind":"source-retained-open","sessionId":"retained.session","migrationId":"retained.migration"}),
                SourceExit::RetainedCapacity,
            ),
            "request-id" => (
                1,
                json!({"kind":"source-retained-chunk","exportId":export,"offset":0}),
                SourceExit::InvalidRequestId,
            ),
            _ => (
                2,
                json!({"kind":"source-retained-chunk","exportId":export,"offset":0,"unexpected":true}),
                SourceExit::Malformed,
            ),
        };
        assert!(exchange(&mut client, epoch, id, request).is_err());
        assert_eq!(endpoint.join(), Ok(expected));
        assert!(retained_exports().lock().unwrap().is_empty());
    }
}

#[test]
fn retained_status_does_not_renew_the_original_open_deadline() {
    let _serial = test_lock();
    let (store, _) = retained_store("preserved");
    let endpoint = SourceEndpoint::start(
        binding(store),
        PipeCancellation::default(),
        SourceEndpointOptions {
            io_timeout: Duration::from_millis(500),
        },
    )
    .unwrap();
    let mut client = client(&endpoint);
    let initial = hello(&endpoint, &mut client);
    let epoch = initial["sourceEpoch"].as_str().unwrap();
    retained_open(&mut client, epoch, 1).unwrap();
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(status(&mut client, epoch, 2)["requestId"], 2);
    let waiting = Instant::now();
    assert!(client.read_json(&budget()).is_err());
    assert!(
        waiting.elapsed() < Duration::from_millis(400),
        "status renewed the export deadline"
    );
    assert_eq!(endpoint.join(), Ok(SourceExit::Deadline));
    assert!(retained_exports().lock().unwrap().is_empty());
}

#[test]
fn retained_cancellation_releases_bytes_after_actual_worker_settlement_without_mutation() {
    let _serial = test_lock();
    let (store, source) = retained_store("preserved");
    let mut endpoint = start(store.clone());
    let mut client = client(&endpoint);
    let initial = hello(&endpoint, &mut client);
    retained_open(&mut client, initial["sourceEpoch"].as_str().unwrap(), 1).unwrap();
    assert_eq!(retained_exports().lock().unwrap().len(), 1);
    assert_eq!(endpoint.shutdown(), Ok(SourceExit::Cancelled));
    assert!(retained_exports().lock().unwrap().is_empty());
    assert_eq!(
        store
            .authority_status("retained.session")
            .unwrap()
            .unwrap()
            .phase,
        "FENCED"
    );
    assert_eq!(
        store
            .authority_snapshot("retained.migration")
            .unwrap()
            .snapshot_json,
        source.snapshot_json
    );
}

#[test]
fn retained_aggregate_two_fixed_reservations_block_third_until_real_close() {
    let _serial = test_lock();
    let mut held = Vec::new();
    for _ in 0..MAX_RETAINED_EXPORTS {
        let (store, _) = retained_store("preserved");
        let endpoint = start(store);
        let mut client = client(&endpoint);
        let initial = hello(&endpoint, &mut client);
        let epoch = initial["sourceEpoch"].as_str().unwrap().to_string();
        let open = retained_open(&mut client, &epoch, 1).unwrap();
        held.push((
            endpoint,
            client,
            epoch,
            open["exportId"].as_str().unwrap().to_string(),
        ));
    }
    assert_eq!(
        retained_exports().lock().unwrap().len(),
        MAX_RETAINED_EXPORTS
    );
    let (store, _) = retained_store("third");
    let endpoint = start(store);
    let mut third = client(&endpoint);
    let initial = hello(&endpoint, &mut third);
    assert!(retained_open(&mut third, initial["sourceEpoch"].as_str().unwrap(), 1).is_err());
    assert_eq!(endpoint.join(), Ok(SourceExit::RetainedCapacity));
    assert_eq!(
        retained_exports().lock().unwrap().len(),
        MAX_RETAINED_EXPORTS
    );
    for (endpoint, mut client, epoch, export) in held {
        retained_close(&mut client, &epoch, 2, &export).unwrap();
        client.close();
        endpoint.join().unwrap();
    }
    assert!(retained_exports().lock().unwrap().is_empty());
    let (store, _) = retained_store("capacity recovered");
    let endpoint = start(store);
    let mut client = client(&endpoint);
    let initial = hello(&endpoint, &mut client);
    retained_open(&mut client, initial["sourceEpoch"].as_str().unwrap(), 1).unwrap();
    client.close();
    endpoint.join().unwrap();
    assert!(retained_exports().lock().unwrap().is_empty());
}

#[test]
fn real_source_hello_and_status_are_exact_current_binding_observations() {
    let _serial = test_lock();
    let store = store();
    let identity = store.authority_identity().unwrap();
    let endpoint = start(store);
    let descriptor = endpoint.descriptor();
    let wire = serde_json::to_value(&descriptor).unwrap();
    assert_eq!(wire.as_object().unwrap().len(), 2);
    assert!(wire.get("address").is_some());
    assert!(wire.get("registrationNonce").is_some());
    assert_eq!(
        uuid::Uuid::parse_str(descriptor.registration_nonce())
            .unwrap()
            .get_version_num(),
        4
    );
    let mut client = client(&endpoint);
    let response = hello(&endpoint, &mut client);
    let epoch = response["sourceEpoch"].as_str().unwrap();
    assert_eq!(epoch, endpoint.source_epoch());
    assert_eq!(uuid::Uuid::parse_str(epoch).unwrap().get_version_num(), 4);
    assert_eq!(
        response,
        json!({
            "version":1,"kind":"source-hello-result","registrationNonce":descriptor.registration_nonce(),
            "environmentId":"source-environment","sourceStoreId":identity.source_store_id,
            "sourceProfileId":identity.source_profile_id,"sourceEpoch":epoch,"writerProtocol":WRITER_PROTOCOL,"qualified":false,
        })
    );
    let current = status(&mut client, epoch, 1);
    assert_eq!(
        current,
        json!({
            "version":1,"kind":"source-status-result","requestId":1,"environmentId":"source-environment",
            "sourceStoreId":identity.source_store_id,"sourceProfileId":identity.source_profile_id,
            "sourceEpoch":epoch,"writerProtocol":WRITER_PROTOCOL,"qualified":false,
        })
    );
    assert_eq!(status(&mut client, epoch, 5)["requestId"], 5);
    client.close();
    assert_eq!(endpoint.join(), Ok(SourceExit::PeerClosed));
}

#[test]
fn wrong_registration_and_environment_close_without_a_disclosure_or_reaccept() {
    let _serial = test_lock();
    for (nonce, environment, expected) in [
        (
            Some("wrong"),
            "source-environment",
            SourceExit::WrongRegistration,
        ),
        (None, "foreign-environment", SourceExit::WrongEnvironment),
    ] {
        let endpoint = start(store());
        let descriptor = endpoint.descriptor();
        let mut client = client(&endpoint);
        client.send_json(&json!({"version":1,"kind":"source-hello",
            "registrationNonce":nonce.unwrap_or(descriptor.registration_nonce()),"environmentId":environment}), &budget()).unwrap();
        assert!(client.read_json(&budget()).is_err());
        assert_eq!(endpoint.join(), Ok(expected));
        let address = AuthorityPipeAddress::parse_local(descriptor.address()).unwrap();
        let short =
            PipeBudget::new(Duration::from_millis(20), PipeCancellation::default()).unwrap();
        assert!(matches!(
            AuthorityPipeConnection::connect_current_native_image(&address, &short),
            Err(PipeError::Deadline)
        ));
    }
}

#[test]
fn replayed_hello_and_unknown_outer_fields_are_not_status_or_authority_operations() {
    let _serial = test_lock();
    for after_hello in [false, true] {
        let endpoint = start(store());
        let mut client = client(&endpoint);
        if after_hello {
            hello(&endpoint, &mut client);
        }
        let mut request = json!({"version":1,"kind":"source-hello",
            "registrationNonce":endpoint.descriptor().registration_nonce(),"environmentId":"source-environment"});
        if !after_hello {
            request["databasePath"] = json!("must-not-open.db");
        }
        client.send_json(&request, &budget()).unwrap();
        assert!(client.read_json(&budget()).is_err());
        assert_eq!(endpoint.join(), Ok(SourceExit::Malformed));
    }
}

#[test]
fn status_epoch_and_safe_monotonic_id_guards_close_the_exact_connection() {
    let _serial = test_lock();
    for (id, repeat, wrong_epoch, expected) in [
        (0, false, false, SourceExit::InvalidRequestId),
        (
            MAX_REQUEST_ID + 1,
            false,
            false,
            SourceExit::InvalidRequestId,
        ),
        (1, true, false, SourceExit::InvalidRequestId),
        (1, false, true, SourceExit::WrongEpoch),
    ] {
        let endpoint = start(store());
        let mut client = client(&endpoint);
        let initial = hello(&endpoint, &mut client);
        let epoch = initial["sourceEpoch"].as_str().unwrap();
        if repeat {
            status(&mut client, epoch, id);
        }
        client
            .send_json(
                &json!({"version":1,"kind":"source-status","requestId":id,
            "sourceEpoch":if wrong_epoch {"old-epoch"} else {epoch}}),
                &budget(),
            )
            .unwrap();
        assert!(client.read_json(&budget()).is_err());
        assert_eq!(endpoint.join(), Ok(expected));
    }
}

#[test]
fn changed_actual_store_identity_is_rechecked_before_status_disclosure() {
    let _serial = test_lock();
    let store = store();
    let endpoint = start(store.clone());
    let mut client = client(&endpoint);
    let initial = hello(&endpoint, &mut client);
    // Deliberate source-identity corruption, below the production SQL guard.
    store
        .lock_conn()
        .unwrap()
        .execute_batch(
            "DROP TRIGGER native_raw_identity_immutable;
             UPDATE native_authority_identity SET source_profile_id='replaced-profile' WHERE id=1",
        )
        .unwrap();
    let _ = client.send_json(&json!({"version":1,"kind":"source-status","requestId":1,"sourceEpoch":initial["sourceEpoch"]}), &budget());
    assert!(client.read_json(&budget()).is_err());
    assert_eq!(endpoint.join(), Ok(SourceExit::BindingChanged));
}

#[test]
fn shutdown_interrupts_pending_accept_and_joins_before_releasing_store_and_permit() {
    let _serial = test_lock();
    let store = store();
    let weak = Arc::downgrade(&store);
    let mut endpoint = start(store.clone());
    drop(store);
    let observation = endpoint.observation().unwrap();
    assert!(!observation.qualified);
    assert!(!observation.joined);
    assert_eq!(observation.active_endpoints, 1);
    assert!(weak.upgrade().is_some());
    assert_eq!(endpoint.shutdown(), Ok(SourceExit::Cancelled));
    assert!(endpoint.observation().unwrap().joined);
    assert_eq!(endpoint.observation().unwrap().active_endpoints, 0);
    assert!(weak.upgrade().is_none());
}

#[test]
fn cancellation_of_an_actual_status_read_closes_transport_without_any_domain_stop() {
    let _serial = test_lock();
    let mut endpoint = start(store());
    let mut client = client(&endpoint);
    hello(&endpoint, &mut client);
    assert_eq!(endpoint.shutdown(), Ok(SourceExit::Cancelled));
    assert!(client.read_json(&budget()).is_err());
    assert_eq!(endpoint.observation().unwrap().active_endpoints, 0);
}

#[test]
fn finished_but_unjoined_worker_retains_the_per_instance_quota_until_real_join() {
    let _serial = test_lock();
    let store = store();
    let endpoint = start(store.clone());
    let mut client = client(&endpoint);
    hello(&endpoint, &mut client);
    client.close();
    finished(&endpoint);
    assert_eq!(endpoint.observation().unwrap().active_endpoints, 1);
    assert!(matches!(
        SourceEndpoint::start(
            binding(store.clone()),
            PipeCancellation::default(),
            options()
        ),
        Err(SourceError::Capacity)
    ));
    assert_eq!(endpoint.join(), Ok(SourceExit::PeerClosed));
    let mut next = start(store);
    assert_eq!(next.shutdown(), Ok(SourceExit::Cancelled));
}

#[test]
fn actual_global_admission_is_four_sources_and_never_released_by_a_cancellation_request_alone() {
    let _serial = test_lock();
    let mut active = Vec::new();
    let mut cancellations = Vec::new();
    for _ in 0..MAX_ENDPOINTS {
        let cancellation = PipeCancellation::default();
        active.push(
            SourceEndpoint::start(binding(store()), cancellation.clone(), options()).unwrap(),
        );
        cancellations.push(cancellation);
    }
    assert_eq!(
        active[0].observation().unwrap().active_endpoints,
        MAX_ENDPOINTS
    );
    assert!(matches!(
        SourceEndpoint::start(binding(store()), PipeCancellation::default(), options()),
        Err(SourceError::Capacity)
    ));
    cancellations[0].cancel();
    finished(&active[0]);
    assert_eq!(
        active[0].observation().unwrap().active_endpoints,
        MAX_ENDPOINTS
    );
    assert!(matches!(
        SourceEndpoint::start(binding(store()), PipeCancellation::default(), options()),
        Err(SourceError::Capacity)
    ));
    for endpoint in &mut active {
        endpoint.shutdown().unwrap();
    }
    assert!(endpoints().lock().unwrap().is_empty());
}

#[test]
fn spawn_failure_drops_the_actual_bound_listener_and_rolls_back_only_its_unstarted_permit() {
    let _serial = test_lock();
    let store = store();
    let mut address = None;
    let result = SourceEndpoint::start_using(
        binding(store.clone()),
        PipeCancellation::default(),
        options(),
        |descriptor, _worker| {
            address = Some(descriptor.address().to_owned());
            assert_eq!(endpoints().lock().unwrap().len(), 1);
            Err(std::io::Error::other("fixture spawn denied"))
        },
    );
    assert!(matches!(result, Err(SourceError::Spawn)));
    assert!(endpoints().lock().unwrap().is_empty());
    assert_eq!(Arc::strong_count(&store), 1);
    let address = AuthorityPipeAddress::parse_local(&address.unwrap()).unwrap();
    let short = PipeBudget::new(Duration::from_millis(20), PipeCancellation::default()).unwrap();
    assert!(matches!(
        AuthorityPipeConnection::connect_current_native_image(&address, &short),
        Err(PipeError::Deadline)
    ));
    let mut restarted = start(store);
    restarted.shutdown().unwrap();
}

#[test]
fn fresh_one_shot_registration_never_reuses_a_prior_nonce_or_source_epoch() {
    let _serial = test_lock();
    let store = store();
    let first = start(store.clone());
    let first_descriptor = first.descriptor();
    let mut client = client(&first);
    let first_hello = hello(&first, &mut client);
    client.close();
    first.join().unwrap();
    let second = start(store);
    assert_ne!(
        second.descriptor().registration_nonce(),
        first_descriptor.registration_nonce()
    );
    let mut client = self::client(&second);
    let second_hello = hello(&second, &mut client);
    assert_ne!(second_hello["sourceEpoch"], first_hello["sourceEpoch"]);
    client.send_json(&json!({"version":1,"kind":"source-status","requestId":1,"sourceEpoch":first_hello["sourceEpoch"]}), &budget()).unwrap();
    assert!(client.read_json(&budget()).is_err());
    assert_eq!(second.join(), Ok(SourceExit::WrongEpoch));
}

#[test]
fn finite_idle_accept_and_oversized_header_both_settle_the_actual_worker() {
    let _serial = test_lock();
    let endpoint = SourceEndpoint::start(
        binding(store()),
        PipeCancellation::default(),
        SourceEndpointOptions {
            io_timeout: Duration::from_millis(20),
        },
    )
    .unwrap();
    assert_eq!(endpoint.join(), Ok(SourceExit::Deadline));
    let endpoint = start(store());
    use std::os::windows::{ffi::OsStrExt, io::FromRawHandle};
    use windows_sys::Win32::{
        Foundation::{GENERIC_READ, GENERIC_WRITE, INVALID_HANDLE_VALUE},
        Storage::FileSystem::{CreateFileW, WriteFile, OPEN_EXISTING},
    };
    let name: Vec<u16> = std::ffi::OsStr::new(endpoint.descriptor().address())
        .encode_wide()
        .chain(Some(0))
        .collect();
    let raw = unsafe {
        CreateFileW(
            name.as_ptr(),
            GENERIC_READ | GENERIC_WRITE,
            0,
            std::ptr::null(),
            OPEN_EXISTING,
            0,
            std::ptr::null_mut(),
        )
    };
    assert_ne!(raw, INVALID_HANDLE_VALUE);
    let _client = unsafe { std::os::windows::io::OwnedHandle::from_raw_handle(raw) };
    let header = (crate::native_authority_pipe::MAX_CONTROL_FRAME as u32 + 1).to_le_bytes();
    let mut written = 0;
    assert_ne!(
        unsafe {
            WriteFile(
                raw,
                header.as_ptr().cast(),
                4,
                &mut written,
                std::ptr::null_mut(),
            )
        },
        0
    );
    assert_eq!(written, 4);
    assert_eq!(endpoint.join(), Ok(SourceExit::PipeFailure));
}

#[test]
fn invalid_source_options_fail_before_endpoint_admission() {
    let _serial = test_lock();
    for io_timeout in [Duration::ZERO, Duration::from_secs(31)] {
        assert!(matches!(
            SourceEndpoint::start(
                binding(store()),
                PipeCancellation::default(),
                SourceEndpointOptions { io_timeout }
            ),
            Err(SourceError::InvalidOptions)
        ));
    }
    assert!(endpoints().lock().unwrap().is_empty());
}
