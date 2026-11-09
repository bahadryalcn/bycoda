use super::*;
use std::collections::HashSet;

#[test]
fn distinct_legacy_originals_with_equal_bytes_never_reuse_a_completed_upload_intent() {
    let registry = Arc::new(NativeUploads::default());
    let first_id = uuid::Uuid::new_v4().to_string();
    let first = registry
        .claim_original(
            registry.reserve("route".into()).unwrap(),
            b"same exact report bytes",
            Some(first_id.clone()),
            None,
        )
        .unwrap();
    first.set_phase(Phase::Completed).unwrap();
    drop(first);
    let second_id = uuid::Uuid::new_v4().to_string();
    let second = registry
        .claim_original(
            registry.reserve("route".into()).unwrap(),
            b"same exact report bytes",
            Some(second_id.clone()),
            None,
        )
        .unwrap();
    assert_eq!(second.id, second_id);
    assert_ne!(second.id, first_id);
    assert!(matches!(second.phase().unwrap(), Phase::New));
    assert_eq!(registry.registry.lock().unwrap().entries.len(), 2);
}

#[test]
fn later_original_status_ack_retires_only_exact_completed_inactive_staging_metadata() {
    let registry = Arc::new(NativeUploads::default());
    let bytes = b"original snapshot";
    let binding = DeliveryBinding {
        original_id: uuid::Uuid::new_v4().to_string(),
        sha256: format!("{:x}", Sha256::digest(bytes)),
        byte_length: bytes.len(),
    };
    let lease = registry
        .claim_original(
            registry.reserve("original-route".into()).unwrap(),
            bytes,
            Some(binding.original_id.clone()),
            Some(binding.clone()),
        )
        .unwrap();
    lease.set_phase(Phase::Completed).unwrap();
    registry.applied_original("original-route", &binding);
    assert_eq!(
        registry.registry.lock().unwrap().entries.len(),
        1,
        "Active IO remains owned"
    );
    drop(lease);
    registry.applied_original("different-route", &binding);
    let mut foreign = binding.clone();
    foreign.original_id = uuid::Uuid::new_v4().to_string();
    registry.applied_original("original-route", &foreign);
    assert_eq!(
        registry.registry.lock().unwrap().entries.len(),
        1,
        "Other originals cannot retire this intent"
    );
    registry.applied_original("original-route", &binding);
    assert!(registry.registry.lock().unwrap().entries.is_empty());
}

#[derive(Clone)]
struct FixturePort {
    host: Arc<Mutex<FakeHost>>,
    clock: Arc<Mutex<Instant>>,
}

#[derive(Default)]
struct FakeHost {
    entry: Option<Value>,
    bytes: Vec<u8>,
    calls: Vec<(String, Value, Option<Instant>)>,
    lose: HashSet<String>,
    fail_status: bool,
    reject_commit: bool,
    commit_timeout: bool,
    updates: usize,
}

impl FixturePort {
    fn new() -> Self {
        Self {
            host: Arc::new(Mutex::new(FakeHost::default())),
            clock: Arc::new(Mutex::new(Instant::now())),
        }
    }
    fn new_channel(&self) -> Self {
        Self {
            host: self.host.clone(),
            clock: self.clock.clone(),
        }
    }
    fn attempt(
        &self,
        registry: &Arc<NativeUploads>,
        route: &str,
        bytes: &[u8],
    ) -> Result<(Value, UploadLease), String> {
        let lease = registry.claim(registry.reserve(route.into())?, bytes)?;
        run(self, lease, bytes, Budget::new(self.now()))
    }
}

impl UploadPort for FixturePort {
    type Reply = Value;
    fn wire(
        &self,
        method: &str,
        params: Value,
        options: RequestOptions,
    ) -> Result<Value, WsFailure> {
        let mut host = self.host.lock().unwrap();
        host.calls
            .push((method.into(), params.clone(), options.absolute_deadline));
        assert!(options.absolute_deadline.is_some());
        assert!(options
            .response_timeout
            .is_some_and(|value| value <= DEFAULT_RPC_TIMEOUT));
        if method == "native.buffers.upload.status" && host.fail_status {
            return Err(WsFailure::local("RPC_WS_NETWORK", "status unavailable"));
        }
        if method == "native.buffers.upload.commit" && host.reject_commit {
            host.reject_commit = false;
            return Err(WsFailure::local("RPC_WS_OVERLOAD", "not sent"));
        }
        let value = match method {
            "native.buffers.upload.start" => {
                if let Some(entry) = &host.entry {
                    assert_eq!(entry["uploadId"], params["uploadId"]);
                    assert_eq!(entry["sha256"], params["sha256"]);
                    assert_eq!(entry["byteLength"], params["byteLength"]);
                } else {
                    host.bytes.clear();
                    host.entry = Some(json!({
                        "uploadId":params["uploadId"],"sha256":params["sha256"],"byteLength":params["byteLength"],
                        "receivedBytes":0,"state":"receiving","expiresAt":120000,
                    }));
                }
                host.entry.clone().unwrap()
            }
            "native.buffers.upload.write" => {
                let entry = host.entry.as_ref().unwrap();
                assert_eq!(entry["uploadId"], params["uploadId"]);
                assert_eq!(entry["state"], "receiving");
                assert_eq!(
                    params["offset"].as_u64().unwrap() as usize,
                    host.bytes.len()
                );
                let chunk = base64::engine::general_purpose::STANDARD
                    .decode(params["data"].as_str().unwrap())
                    .unwrap();
                assert!(chunk.len() <= CHUNK_BYTES);
                host.bytes.extend_from_slice(&chunk);
                let count = host.bytes.len();
                host.entry.as_mut().unwrap()["receivedBytes"] = json!(count);
                host.entry.clone().unwrap()
            }
            "native.buffers.upload.commit" => {
                let entry = host.entry.as_ref().unwrap();
                assert_eq!(entry["uploadId"], params["uploadId"]);
                assert_eq!(
                    entry["byteLength"].as_u64().unwrap() as usize,
                    host.bytes.len()
                );
                assert_eq!(
                    entry["sha256"],
                    format!("{:x}", Sha256::digest(&host.bytes))
                );
                if entry["state"] != "completed" {
                    host.updates += 1;
                    let entry = host.entry.as_mut().unwrap();
                    entry["state"] = json!("completed");
                    entry["result"] = json!({"acknowledged":true});
                }
                host.entry.clone().unwrap()
            }
            "native.buffers.upload.status" => host.entry.clone().unwrap_or(Value::Null),
            _ => panic!("Unexpected upload operation: {method}"),
        };
        if method == "native.buffers.upload.commit" && host.commit_timeout {
            host.commit_timeout = false;
            *self.clock.lock().unwrap() = options.absolute_deadline.unwrap();
            let mut failure = WsFailure::local("RPC_WS_DEADLINE", "lost response");
            failure.uncertain = true;
            return Err(failure);
        }
        if host.lose.remove(method) {
            let mut failure = WsFailure::local("RPC_WS_INTERRUPTED", "lost response");
            failure.uncertain = true;
            return Err(failure);
        }
        Ok(value)
    }
    fn inspect<T>(
        &self,
        reply: &Value,
        project: impl FnOnce(&Value) -> Result<T, String>,
    ) -> Result<T, String> {
        project(reply)
    }
    fn acknowledged(&self, reply: Value) -> Value {
        reply["result"].clone()
    }
    fn current(&self) -> Result<(), String> {
        Ok(())
    }
    fn now(&self) -> Instant {
        *self.clock.lock().unwrap()
    }
    fn pause(&self, duration: Duration) {
        *self.clock.lock().unwrap() += duration;
    }
}

#[test]
fn lost_staging_receipts_resume_exact_bytes_and_id_across_new_channels() {
    for method in ["native.buffers.upload.start", "native.buffers.upload.write"] {
        let registry = Arc::new(NativeUploads::default());
        let first = FixturePort::new();
        let bytes = capture(&json!({"original":"🙂é\\\n".repeat(CHUNK_BYTES / 3)})).unwrap();
        {
            let mut host = first.host.lock().unwrap();
            host.lose.insert(method.into());
            host.fail_status = true;
        }
        assert!(first
            .attempt(&registry, "actual-saved-owner", &bytes)
            .is_err());
        let original = registry
            .registry
            .lock()
            .unwrap()
            .entries
            .values()
            .next()
            .unwrap()
            .id
            .clone();
        let second = first.new_channel();
        second.host.lock().unwrap().fail_status = false;
        let (result, lease) = second
            .attempt(&registry, "actual-saved-owner", &bytes)
            .unwrap();
        assert_eq!(lease.id, original);
        assert_eq!(result, json!({"acknowledged":true}));
        {
            let host = second.host.lock().unwrap();
            assert_eq!(host.bytes, bytes);
            assert_eq!(host.updates, 1);
            assert_eq!(
                host.calls
                    .iter()
                    .filter(|(method, _, _)| method == "native.buffers.upload.start")
                    .count(),
                1
            );
            assert!(host
                .calls
                .iter()
                .all(|(_, params, _)| params["uploadId"] == original));
        }
        lease.applied();
        assert!(registry.registry.lock().unwrap().entries.is_empty());
    }
}

#[test]
fn lost_commit_and_failed_final_callback_keep_identity_without_duplicate_update() {
    let registry = Arc::new(NativeUploads::default());
    let first = FixturePort::new();
    {
        let mut host = first.host.lock().unwrap();
        host.lose.insert("native.buffers.upload.commit".into());
        host.fail_status = true;
    }
    assert!(first.attempt(&registry, "owner", b"original").is_err());
    let second = first.new_channel();
    second.host.lock().unwrap().fail_status = false;
    let (_, lease) = second.attempt(&registry, "owner", b"original").unwrap();
    let id = lease.id.clone();
    drop(lease); // The actual Native confirmation failed; it did not call applied.
    let third = second.new_channel();
    let (_, lease) = third.attempt(&registry, "owner", b"original").unwrap();
    assert_eq!(lease.id, id);
    assert_eq!(third.host.lock().unwrap().updates, 1);
    assert_eq!(
        third
            .host
            .lock()
            .unwrap()
            .calls
            .iter()
            .filter(|(method, _, _)| method == "native.buffers.upload.commit")
            .count(),
        1
    );
    lease.applied();
    assert!(registry.registry.lock().unwrap().entries.is_empty());
}

#[test]
fn authoritative_absence_restages_only_before_commit_with_the_same_id() {
    let registry = Arc::new(NativeUploads::default());
    let first = FixturePort::new();
    {
        let mut host = first.host.lock().unwrap();
        host.lose.insert("native.buffers.upload.write".into());
        host.fail_status = true;
    }
    assert!(first.attempt(&registry, "owner", b"original").is_err());
    let id = registry
        .registry
        .lock()
        .unwrap()
        .entries
        .values()
        .next()
        .unwrap()
        .id
        .clone();
    let next = first.new_channel();
    {
        let mut host = next.host.lock().unwrap();
        host.entry = None; // Authenticated owner has expired only the receiving job.
        host.fail_status = false;
    }
    let (_, lease) = next.attempt(&registry, "owner", b"original").unwrap();
    assert_eq!(lease.id, id);
    assert_eq!(next.host.lock().unwrap().updates, 1);
    assert!(next
        .host
        .lock()
        .unwrap()
        .calls
        .iter()
        .all(|(_, params, _)| params["uploadId"] == id));
    lease.applied();
}

#[test]
fn commit_absence_is_held_unknown_and_never_restarts_or_replays() {
    let registry = Arc::new(NativeUploads::default());
    let first = FixturePort::new();
    {
        let mut host = first.host.lock().unwrap();
        host.lose.insert("native.buffers.upload.commit".into());
        host.fail_status = true;
    }
    assert!(first.attempt(&registry, "owner", b"original").is_err());
    let id = registry
        .registry
        .lock()
        .unwrap()
        .entries
        .values()
        .next()
        .unwrap()
        .id
        .clone();
    let next = first.new_channel();
    {
        let mut host = next.host.lock().unwrap();
        host.entry = None;
        host.fail_status = false;
    }
    assert!(next.attempt(&registry, "owner", b"original").is_err());
    assert_eq!(
        registry
            .registry
            .lock()
            .unwrap()
            .entries
            .values()
            .next()
            .unwrap()
            .id,
        id
    );
    let host = next.host.lock().unwrap();
    assert_eq!(
        host.calls
            .iter()
            .filter(|(method, _, _)| method == "native.buffers.upload.start")
            .count(),
        1
    );
    assert_eq!(
        host.calls
            .iter()
            .filter(|(method, _, _)| method == "native.buffers.upload.commit")
            .count(),
        1
    );
}

#[test]
fn proven_unsent_commit_can_resume_but_timeout_reserves_status_budget() {
    let registry = Arc::new(NativeUploads::default());
    let first = FixturePort::new();
    first.host.lock().unwrap().reject_commit = true;
    assert!(first.attempt(&registry, "owner", b"original").is_err());
    let second = first.new_channel();
    second.host.lock().unwrap().commit_timeout = true;
    let started = second.now();
    let (_, lease) = second.attempt(&registry, "owner", b"original").unwrap();
    let host = second.host.lock().unwrap();
    assert_eq!(host.updates, 1);
    let commit = host
        .calls
        .iter()
        .rev()
        .find(|(method, _, _)| method == "native.buffers.upload.commit")
        .unwrap();
    let status = host.calls.last().unwrap();
    assert_eq!(
        commit.2,
        Some(started + DEFAULT_RPC_TIMEOUT - STATUS_RESERVE)
    );
    assert_eq!(status.0, "native.buffers.upload.status");
    assert_eq!(status.2, Some(started + DEFAULT_RPC_TIMEOUT));
    assert!(second.now() < started + DEFAULT_RPC_TIMEOUT);
    drop(host);
    lease.applied();
}

#[test]
fn exact_payload_and_route_bounds_single_flight_and_metadata_retention() {
    let registry = Arc::new(NativeUploads::default());
    let first = registry
        .claim(registry.reserve("owner".into()).unwrap(), b"one")
        .unwrap();
    assert!(registry
        .claim(registry.reserve("owner".into()).unwrap(), b"one")
        .is_err());
    let other = registry
        .claim(registry.reserve("other-credential".into()).unwrap(), b"one")
        .unwrap();
    assert_ne!(first.id, other.id);
    drop(other);
    drop(first);
    for number in 1..MAX_ROUTE_INTENTS {
        drop(
            registry
                .claim(
                    registry.reserve("owner".into()).unwrap(),
                    number.to_string().as_bytes(),
                )
                .unwrap(),
        );
    }
    assert!(registry
        .claim(registry.reserve("owner".into()).unwrap(), b"overflow")
        .is_err());
    for route in 0..4 {
        for number in 0..MAX_ROUTE_INTENTS {
            if registry.registry.lock().unwrap().entries.len() == MAX_INTENTS {
                break;
            }
            drop(
                registry
                    .claim(
                        registry.reserve(format!("route-{route}")).unwrap(),
                        number.to_string().as_bytes(),
                    )
                    .unwrap(),
            );
        }
    }
    assert_eq!(registry.registry.lock().unwrap().entries.len(), MAX_INTENTS);
    assert!(registry
        .claim(registry.reserve("new-route".into()).unwrap(), b"overflow")
        .is_err());
    let slots: Vec<_> = (0..MAX_ACTIVE)
        .map(|index| registry.reserve(format!("active-{index}")).unwrap())
        .collect();
    assert!(registry.reserve("active-overflow".into()).is_err());
    drop(slots);
    let a = registry.reserve("one-route".into()).unwrap();
    let b = registry.reserve("one-route".into()).unwrap();
    assert!(registry.reserve("one-route".into()).is_err());
    drop((a, b));
    assert_eq!(registry.registry.lock().unwrap().active, 0);
    assert!(registry.registry.lock().unwrap().active_routes.is_empty());
}

#[test]
fn capture_is_original_utf8_bounded_and_receipts_cannot_change_identity() {
    let value = json!({"original":"🙂é\\\n"});
    assert_eq!(
        capture(&value).unwrap(),
        serde_json::to_vec(&value).unwrap()
    );
    assert!(capture(&json!({"oversized":"x".repeat(MAX_BYTES)})).is_err());
    let registry = Arc::new(NativeUploads::default());
    let lease = registry
        .claim(registry.reserve("owner".into()).unwrap(), b"bytes")
        .unwrap();
    let valid = json!({"uploadId":lease.id,"byteLength":5,"sha256":lease.key.digest,"receivedBytes":5,"state":"completed","result":{"acknowledged":true}});
    assert!(lease.validate(&valid).is_ok());
    for field in ["uploadId", "sha256"] {
        let mut altered = valid.clone();
        altered[field] = json!("different");
        assert!(lease.validate(&altered).is_err());
    }
    let mut incomplete = valid;
    incomplete["receivedBytes"] = json!(4);
    assert!(lease.validate(&incomplete).is_err());
}
