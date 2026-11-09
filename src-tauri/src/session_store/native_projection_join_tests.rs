//! Composed Native unit integration: actual retained SSE enqueue, physical
//! resources, normal Rust writer receipt and the production FULL/nonce consumer.
//! This is not a GUI/provider or application-conservation acceptance test.
use super::*;
use crate::native_authority_channel::CapturedSourceBinding;
use crate::native_authority_checkpoint::{
    NativeCheckpointRound, NativeCheckpointScope, NativeRendererCheckpoints,
};
use crate::native_provider_output::{
    NativeInputClaim, NativeProviderOutputRegistry, OutputChannel, OutputOwner, OutputSource,
    PreparedNativeInputGroup,
};
use crate::native_window_lifecycle as windows;

#[path = "native_projection_join_tests/raw_v3_interop.rs"]
mod raw_v3_interop;

struct Fixture {
    store: Arc<SessionStore>,
    barrier: window_barrier::WindowBarrier,
    resources: Arc<tauri::ResourceTable>,
    registry: NativeProviderOutputRegistry,
    owner: Arc<windows::NativeCheckpointWindow>,
    service: NativeRendererCheckpoints,
    raw: String,
    input: NativeInputClaim,
    round: NativeCheckpointRound,
    nonce: String,
}
impl Fixture {
    fn new() -> Self {
        Self::with_raw_capture(None)
    }
    fn with_raw_capture(capture: Option<&native_raw_capture::RawCaptureArtifact>) -> Self {
        let store = Arc::new(SessionStore::open_in_memory().unwrap());
        let barrier = window_barrier::WindowBarrier::new();
        let producer_resources = Arc::new(windows::test_buffer_resources(&barrier, "producer"));
        let resources = Arc::new(windows::test_buffer_resources(&barrier, "recipient"));
        let producer =
            OutputOwner::capture_resources(producer_resources, store.native_instance_id());
        let recipient =
            OutputOwner::capture_resources(resources.clone(), store.native_instance_id());
        let owner = Arc::new(
            windows::capture_checkpoint_resources(&resources, store.native_instance_id()).unwrap(),
        );
        let session: SessionUpsert = serde_json::from_value(json!({"id":"logical","cwd":"/isolated","harness":"codex","model":"fixture","modelSettings":{},"runtimeMode":"approve","title":"Native join","blocks":[{"id":"block","role":"assistant","text":"native λ 東京"}]})).unwrap();
        {
            let connection = store.lock_conn().unwrap();
            write_receipts::upsert(
                &store,
                &connection,
                &session,
                Default::default(),
                None,
                None,
                None,
                Some(owner.clone()),
            )
            .unwrap()
            .unwrap();
        }
        let registry = NativeProviderOutputRegistry::new();
        let source = OutputSource::capture_owned_physical(
            store.clone(),
            "logical#sse",
            Some("logical"),
            producer,
        )
        .unwrap();
        let current = recipient.clone();
        let stream = registry.begin_sse(
            source,
            Arc::new(move || current.current()),
            Arc::new(|_| true),
        );
        let (sent, received) = std::sync::mpsc::channel();
        let mut input = None;
        let actual_items = ["native λ 東京".into(), "unrelated native item".into()];
        stream.emit(OutputChannel::Sse, &actual_items, |metadata| {
            let metadata = metadata.unwrap();
            let enqueued = sent.send(()).is_ok();
            stream.observe_recipient_delivery(
                Some(&metadata),
                Some(recipient.clone()),
                &actual_items,
                enqueued,
            );
            let mut batch = metadata;
            batch.owner_epoch = Some(recipient.epoch());
            input = Some(NativeInputClaim {
                version: 1,
                qualified: false,
                kind: "native-output-item-comparison".into(),
                batch,
                item_index: 0,
            });
            enqueued
        });
        received.recv().unwrap();
        stream.reader(0).finish(true, false);
        stream.terminal_complete(true, false);
        stream.terminal_delivery(true);
        let input = input.unwrap();
        let mut batch = serde_json::to_value(&input.batch).unwrap();
        batch.as_object_mut().unwrap().remove("available");
        batch.as_object_mut().unwrap().remove("unavailableReason");
        let ack = {
            let connection = store.lock_conn().unwrap();
            write_receipts::upsert(
                &store,
                &connection,
                &session,
                Default::default(),
                None,
                None,
                None,
                Some(owner.clone()),
            )
            .unwrap()
            .unwrap()
        };
        let raw = serde_json::to_string(&json!({"version":1,"kind":"session-output-full-candidate-comparison","qualified":false,"fullCheckpoint":false,"applicationThrough":null,"nativeCommitmentRequired":true,
            "sessionId":"logical","modelVersion":1,"command":"session_upsert","admittedPayload":{"session":session,"captureOutputReceipt":true},
            "acknowledgement":{"kind":"replace","revision":ack.ack.transcript_revision.unwrap(),"updatedAt":ack.ack.updated_at,"nativeWriteId":ack.native_write_id},
            "items":[{"version":1,"qualified":false,"kind":"native-output-item-comparison","batch":batch,"itemIndex":0}]})).unwrap();
        let source = CapturedSourceBinding::capture(store.clone(), "environment").unwrap();
        let service = NativeRendererCheckpoints::new(source, barrier.clone()).unwrap();
        let round = service
            .start_round(
                barrier.try_close_idle_target_admission("logical").unwrap(),
                NativeCheckpointScope::new("environment", "logical", "migration", 0).unwrap(),
            )
            .unwrap();
        let nonce = match capture {
            Some(capture) => service.test_issue_projection_raw(&round, &resources, &raw, capture),
            None => service.test_issue_projection(&round, &resources, &raw),
        }
        .unwrap()
        .nonce;
        Self {
            store,
            barrier,
            resources,
            registry,
            owner,
            service,
            raw,
            input,
            round,
            nonce,
        }
    }
    fn prepared(&self) -> PreparedNativeInputGroup {
        self.registry
            .prepare_input_group(
                &self.store,
                "logical",
                &self.owner,
                std::slice::from_ref(&self.input),
            )
            .unwrap()
    }
    fn count(&self) -> i64 {
        self.store
            .lock_conn()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM native_renderer_checkpoint_receipts",
                [],
                |row| row.get(0),
            )
            .unwrap()
    }
    fn reopen(&self) {
        let closed = self.service.retire_round(&self.round).unwrap();
        self.barrier.reopen_target_admission(closed).unwrap();
    }
}

fn captured_raw(text: &str) -> native_raw_capture::RawCaptureArtifact {
    native_raw_capture::RawCaptureArtifact::parse(
        serde_json::to_string(&json!({
            "version":1,"kind":"mounted-composer-raw-capture","qualified":false,"sessionId":"logical",
            "snapshots":[
                {"id":1,"revision":2,"sessionId":"logical","snapshot":{"text":text,"attachments":[{"kind":"file","path":"/isolated/a"}],"mcpTags":[]},"undefinedPaths":[["attachments",0,"missing"]]},
                {"id":2,"revision":0,"snapshot":{"text":"","attachments":[],"mcpTags":[]}}
            ]
        })).unwrap(), "logical",
    ).unwrap()
}

#[test]
#[ignore = "Explicit source-checkout integration with the actual Node TypeScript encoder"]
fn actual_renderer_encoder_bytes_reach_the_native_full_transaction() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap();
    let module = root.join("src/features/sessions/data/nativeRawCapture.ts");
    let mut command = std::process::Command::new("node");
    command.args([
        "--experimental-transform-types",
        "--input-type=module",
        "-e",
        r#"import {pathToFileURL} from 'node:url';
const {encodeNativeRawCapture} = await import(pathToFileURL(process.argv[1]).href);
process.stdout.write(encodeNativeRawCapture('logical', {
  qualified:false, missingCoverage:['parent','buffers'], snapshots:[
    {id:1,revision:2,sessionId:'logical',snapshot:{text:' \t\r\nç 😀 ',
      attachments:[{kind:'file',path:'/isolated/a',missing:undefined}],
      mcpTags:[{id:'mcp',opaque:{absent:undefined}}]}},
    {id:2,revision:0,snapshot:{text:'',attachments:[],mcpTags:[],mode:undefined}}
  ]
}));"#,
    ]);
    command.arg(module);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let output = command.output().expect("Node encoder must be runnable");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let bytes = String::from_utf8(output.stdout).unwrap();
    let raw = native_raw_capture::RawCaptureArtifact::parse(bytes, "logical").unwrap();
    let value: serde_json::Value = serde_json::from_str(raw.raw()).unwrap();
    assert_eq!(value["snapshots"][0]["snapshot"]["text"], " \t\r\nç 😀 ");
    assert_eq!(value["snapshots"][1]["undefinedPaths"], json!([["mode"]]));
    let f = Fixture::with_raw_capture(Some(&raw));
    let receipt = f
        .service
        .projection_checkpoint_prepared_with_raw(
            &f.owner,
            &f.nonce,
            &f.raw,
            f.prepared(),
            Some(&raw),
        )
        .unwrap();
    let expected = receipt.raw_capture.unwrap();
    assert_eq!(
        expected.sql.raw_capture.as_ref().unwrap().sha256,
        raw.sha256()
    );
    assert_eq!(
        f.service.read_projection_raw(&f.owner, &expected).unwrap(),
        expected
    );
    let stored: String = f
        .store
        .lock_conn()
        .unwrap()
        .query_row("SELECT raw_json FROM native_raw_captures", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(stored.as_bytes(), raw.raw().as_bytes());
    assert_eq!(f.count(), 1);
    f.reopen();
}

#[test]
fn exact_raw_capture_and_real_projection_share_one_full_commit() {
    let raw = captured_raw(" \t\r\n");
    let f = Fixture::with_raw_capture(Some(&raw));
    let synchronous_before: i64 = f
        .store
        .lock_conn()
        .unwrap()
        .query_row("PRAGMA synchronous", [], |row| row.get(0))
        .unwrap();
    let receipt = f
        .service
        .projection_checkpoint_prepared_with_raw(
            &f.owner,
            &f.nonce,
            &f.raw,
            f.prepared(),
            Some(&raw),
        )
        .unwrap();
    let expected = receipt.raw_capture.as_ref().unwrap();
    assert_eq!(
        expected.sql.raw_capture.as_ref().unwrap().sha256,
        raw.sha256()
    );
    let conn = f.store.lock_conn().unwrap();
    let body: String = conn
        .query_row(
            "SELECT raw_json FROM native_raw_captures WHERE nonce=?1",
            [&f.nonce],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(body, raw.raw());
    assert_eq!(
        conn.query_row("PRAGMA synchronous", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        synchronous_before
    );
    drop(conn);
    assert_eq!(
        f.service.read_projection_raw(&f.owner, expected).unwrap(),
        *expected
    );
    let wire = serde_json::to_value(&receipt).unwrap();
    assert_eq!(wire["qualified"], false);
    assert!(wire["applicationThrough"].is_null());
    assert_eq!(wire["sql"]["providerOutput"], "unsealed");
    // A cached receipt still requires the original raw payload and cannot downgrade.
    assert!(f
        .service
        .projection_checkpoint_prepared(&f.owner, &f.nonce, &f.raw, f.prepared())
        .is_err());
    assert!(f
        .service
        .projection_checkpoint_prepared_with_raw(
            &f.owner,
            &f.nonce,
            &f.raw,
            f.prepared(),
            Some(&captured_raw("changed"))
        )
        .is_err());
    assert_eq!(f.count(), 1);
    f.reopen();
}

#[test]
#[ignore = "Explicit source-checkout integration with the actual producer encoder and Node module hooks"]
fn actual_renderer_producer_encoder_bytes_reach_native_full_transaction() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap();
    let module = root.join("src/features/sessions/data/nativeProducerCapture.ts");
    let mut command = std::process::Command::new("node");
    command.args([
        "--experimental-transform-types", "--input-type=module", "-e",
        r#"import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
registerHooks({resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && /^\.\.?\//.test(specifier) && !specifier.endsWith('.ts'))
      return next(specifier + '.ts', context);
    throw error;
  }
}});
const {encodeNativeProducerCapture} = await import(pathToFileURL(process.argv[1]).href);
process.stdout.write(encodeNativeProducerCapture('logical', {
  qualified:false, missingCoverage:[], snapshots:[
    {id:1,revision:2,sessionId:'logical',snapshot:{text:' \t\r\nç 😀 ',attachments:[],mcpTags:[]}}
  ]
}, {
  parent:{registryEpoch:3,snapshots:[{id:1,revision:4,kind:'question-draft',sessionId:'logical',snapshot:{questionId:'original',answer:' unsent ',optional:undefined}}]},
  editor:{registryEpoch:5,snapshots:[{id:1,revision:6,kind:'file-editor',snapshot:{path:'/isolated/file',text:'unsaved\r\n',draftBinding:{exactBodyAcknowledged:false,receipt:null,optional:undefined}}}]}
}));"#,
    ]);
    command.arg(module);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let output = command
        .output()
        .expect("Node producer encoder must be runnable");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let raw = native_raw_capture::RawCaptureArtifact::parse(
        String::from_utf8(output.stdout).unwrap(),
        "logical",
    )
    .unwrap();
    let value: serde_json::Value = serde_json::from_str(raw.raw()).unwrap();
    assert_eq!(value["version"], 2);
    assert_eq!(value["producerCoverage"], "unknown");
    assert_eq!(value["producers"][0]["snapshot"]["answer"], " unsent ");
    assert_eq!(
        value["producers"][1]["undefinedPaths"],
        json!([["draftBinding", "optional"]])
    );
    let f = Fixture::with_raw_capture(Some(&raw));
    let receipt = f
        .service
        .projection_checkpoint_prepared_with_raw(
            &f.owner,
            &f.nonce,
            &f.raw,
            f.prepared(),
            Some(&raw),
        )
        .unwrap();
    let editor = serde_json::to_value(receipt.editor_drafts.as_ref().unwrap()).unwrap();
    assert_eq!(editor["validatedCount"], 0);
    assert_eq!(editor["unverifiedCount"], 1);
    assert_eq!(editor["rosterComplete"], false);
    assert_eq!(editor["rawSha256"], raw.sha256());
    let expected = receipt.raw_capture.unwrap();
    assert_eq!(expected.sql.raw_capture.as_ref().unwrap().snapshot_count, 3);
    assert_eq!(
        f.service.read_projection_raw(&f.owner, &expected).unwrap(),
        expected
    );
    let stored: String = f
        .store
        .lock_conn()
        .unwrap()
        .query_row("SELECT raw_json FROM native_raw_captures", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(stored.as_bytes(), raw.raw().as_bytes());
    assert_eq!(f.count(), 1);
    f.reopen();
}

#[test]
fn failed_raw_insert_rolls_back_the_real_parent_receipt() {
    let raw = captured_raw("original");
    let f = Fixture::with_raw_capture(Some(&raw));
    f.store.lock_conn().unwrap().execute_batch("CREATE TEMP TRIGGER raw_fault BEFORE INSERT ON native_raw_captures BEGIN SELECT RAISE(ABORT,'raw rollback'); END;").unwrap();
    assert!(f
        .service
        .projection_checkpoint_prepared_with_raw(
            &f.owner,
            &f.nonce,
            &f.raw,
            f.prepared(),
            Some(&raw)
        )
        .is_err());
    assert_eq!(f.count(), 0);
    assert!(f
        .service
        .projection_raw_recovery_binding(&f.nonce)
        .unwrap()
        .is_none());
    assert_eq!(
        f.store
            .lock_conn()
            .unwrap()
            .query_row("SELECT count(*) FROM native_raw_captures", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    f.reopen();
}

#[test]
fn lost_actual_projection_reply_recovers_only_raw_data_without_replaying_write() {
    let raw = captured_raw(" \n");
    let f = Fixture::with_raw_capture(Some(&raw));
    f.service.test_lose_next_projection_reply();
    let error = f
        .service
        .projection_checkpoint_prepared_with_raw(
            &f.owner,
            &f.nonce,
            &f.raw,
            f.prepared(),
            Some(&raw),
        )
        .unwrap_err();
    assert!(error.contains("TEST_LOST_PROJECTION_REPLY"), "{error}");
    assert_eq!(f.count(), 1);
    let expected = f
        .service
        .projection_raw_recovery_binding(&f.nonce)
        .unwrap()
        .unwrap();
    // This private original locator may outlive round retirement, not its owner.
    f.reopen();
    assert_eq!(
        f.service.read_projection_raw(&f.owner, &expected).unwrap(),
        expected
    );
    assert_eq!(f.count(), 1);
    windows::test_reload_buffer_resources(&f.resources);
    assert!(f.service.read_projection_raw(&f.owner, &expected).is_err());
}

#[test]
fn retained_native_input_and_actual_normal_write_commit_one_full_nonce() {
    let f = Fixture::new();
    let receipt = f
        .service
        .projection_checkpoint_prepared(&f.owner, &f.nonce, &f.raw, f.prepared())
        .unwrap();
    assert_eq!(f.count(), 1);
    let wire = serde_json::to_value(receipt).unwrap();
    assert_eq!(wire["qualified"], false);
    assert!(wire["applicationThrough"].is_null());
    assert_eq!(wire["nativeInputCount"], 1);
    let original: Value = serde_json::from_str(&f.raw).unwrap();
    assert_eq!(
        wire["nativeWriteId"],
        original["acknowledgement"]["nativeWriteId"]
    );
    for key in [
        "normalizedInputSha256",
        "sqlCommitmentSha256",
        "orderedTranscriptSha256",
    ] {
        let digest = wire[key].as_str().unwrap();
        assert_eq!(digest.len(), 64);
        assert!(digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)));
    }
    assert_eq!(wire["sql"]["providerOutput"], "unsealed");
    assert_eq!(wire["sql"]["nonce"], f.nonce);
    assert_eq!(
        wire["orderedTranscriptSha256"],
        wire["sql"]["transcriptSha256"]
    );
    // A replay is a retained observation; no second transaction/nonce is made.
    assert!(f
        .service
        .projection_checkpoint_prepared(&f.owner, &f.nonce, &f.raw, f.prepared())
        .is_ok());
    assert_eq!(f.count(), 1);
    f.reopen();
}

#[test]
fn full_join_rejects_unrelated_prepared_item_and_keeps_no_nonce() {
    let f = Fixture::new();
    let mut unrelated = f.input.clone();
    unrelated.item_index = 1;
    let prepared = f
        .registry
        .prepare_input_group(&f.store, "logical", &f.owner, &[unrelated])
        .unwrap();
    assert!(f
        .service
        .projection_checkpoint_prepared(&f.owner, &f.nonce, &f.raw, prepared)
        .is_err());
    assert_eq!(f.count(), 0);
    f.reopen();
}

#[test]
fn full_join_rejects_a_compatibility_view_that_disagrees_with_the_genuine_write() {
    let f = Fixture::new();
    let prepared = f.prepared();
    {
        let connection = f.store.lock_conn().unwrap();
        let columns = connection
            .prepare("PRAGMA table_info(sessions)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        let select = columns
            .iter()
            .map(|name| {
                if name == "blocks_json" {
                    "'[]' AS blocks_json".into()
                } else {
                    format!("s.\"{}\"", name.replace('"', "\"\""))
                }
            })
            .collect::<Vec<_>>()
            .join(",");
        connection.execute_batch(&format!("DROP VIEW session_transcripts; CREATE VIEW session_transcripts AS SELECT {select} FROM sessions s;")).unwrap();
    }
    let result = f
        .service
        .projection_checkpoint_prepared(&f.owner, &f.nonce, &f.raw, prepared);
    assert!(
        result.is_err(),
        "a compatibility view must not substitute another transcript for the genuine Native write"
    );
    assert_eq!(f.count(), 0);
    f.reopen();
}

#[test]
fn full_join_commit_failure_does_not_publish_receipt_or_repeat_work() {
    let f = Fixture::new();
    let prepared = f.prepared();
    f.store
        .lock_conn()
        .unwrap()
        .commit_hook(Some(|| true))
        .unwrap();
    assert!(f
        .service
        .projection_checkpoint_prepared(&f.owner, &f.nonce, &f.raw, prepared)
        .is_err());
    f.store
        .lock_conn()
        .unwrap()
        .commit_hook(None::<fn() -> bool>)
        .unwrap();
    assert_eq!(f.count(), 0);
    assert!(f
        .service
        .projection_checkpoint_prepared(&f.owner, &f.nonce, &f.raw, f.prepared())
        .is_err());
    assert_eq!(f.count(), 0);
    f.reopen();
}

#[test]
fn full_join_rechecks_actual_pending_native_reservation_and_reloaded_recipient() {
    for reload in [false, true] {
        let f = Fixture::new();
        let prepared = f.prepared();
        if reload {
            windows::test_reload_buffer_resources(&f.resources);
        } else {
            f.store.lock_conn().unwrap().execute("INSERT INTO native_authority_reservations(reservation_id,session_id,generation,kind,phase,owner_pid,created_at) VALUES('pending','logical',0,'fixture','RUNNING',0,0)", []).unwrap();
        }
        assert!(f
            .service
            .projection_checkpoint_prepared(&f.owner, &f.nonce, &f.raw, prepared)
            .is_err());
        assert_eq!(f.count(), 0);
        f.reopen();
    }
}

#[test]
fn projection_issue_keeps_absolute_deadline_after_actual_blocking_sql_validation() {
    use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
    use std::sync::mpsc;
    use std::time::{Duration, Instant};
    let f = Fixture::new();
    let (entered, waiting) = mpsc::channel();
    let (release, released) = mpsc::channel();
    let released = Mutex::new(released);
    let once = AtomicBool::new(false);
    f.store
        .lock_conn()
        .unwrap()
        .authorizer(Some(move |context: AuthContext<'_>| {
            if matches!(
                context.action,
                AuthAction::Read {
                    table_name: "sessions",
                    ..
                }
            ) && !once.swap(true, Ordering::SeqCst)
            {
                entered.send(()).unwrap();
                released.lock().unwrap().recv().unwrap();
            }
            Authorization::Allow
        }))
        .unwrap();
    std::thread::scope(|scope| {
        let issue = scope.spawn(|| {
            f.service.test_issue_projection_before(
                &f.round,
                &f.resources,
                &f.raw,
                Instant::now() + Duration::from_millis(40),
            )
        });
        waiting.recv_timeout(Duration::from_secs(2)).unwrap();
        std::thread::sleep(Duration::from_millis(70));
        release.send(()).unwrap();
        assert!(issue.join().unwrap().unwrap_err().contains("EXPIRED"));
    });
    f.store
        .lock_conn()
        .unwrap()
        .authorizer(None::<fn(AuthContext<'_>) -> Authorization>)
        .unwrap();
    assert_eq!(f.count(), 0);
    f.reopen();
}

#[test]
fn source_idle_wait_cannot_close_a_target_after_expiry_or_cancellation() {
    use crate::native_authority_pipe::PipeCancellation;
    use crate::native_projection_coordinator::close_idle_source_admission;
    use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
    use std::sync::mpsc;
    use std::time::{Duration, Instant};
    for cancel in [false, true] {
        let f = Fixture::new();
        f.reopen();
        let source = CapturedSourceBinding::capture(f.store.clone(), "environment").unwrap();
        let cancellation = PipeCancellation::default();
        let stopping = AtomicBool::new(false);
        let (entered, waiting) = mpsc::channel();
        let (release, released) = mpsc::channel();
        let released = Mutex::new(released);
        let once = AtomicBool::new(false);
        f.store
            .lock_conn()
            .unwrap()
            .authorizer(Some(move |context: AuthContext<'_>| {
                if matches!(
                    context.action,
                    AuthAction::Read {
                        table_name: "native_authority_reservations",
                        ..
                    }
                ) && !once.swap(true, Ordering::SeqCst)
                {
                    entered.send(()).unwrap();
                    released.lock().unwrap().recv().unwrap();
                }
                Authorization::Allow
            }))
            .unwrap();
        std::thread::scope(|scope| {
            let check = scope.spawn(|| {
                close_idle_source_admission(
                    &source,
                    &f.barrier,
                    "logical",
                    Instant::now()
                        + if cancel {
                            Duration::from_secs(2)
                        } else {
                            Duration::from_millis(40)
                        },
                    &cancellation,
                    &stopping,
                )
            });
            waiting.recv_timeout(Duration::from_secs(2)).unwrap();
            if cancel {
                cancellation.cancel();
            } else {
                std::thread::sleep(Duration::from_millis(70));
            }
            release.send(()).unwrap();
            assert!(check.join().unwrap().is_err());
        });
        f.store
            .lock_conn()
            .unwrap()
            .authorizer(None::<fn(AuthContext<'_>) -> Authorization>)
            .unwrap();
        f.barrier
            .begin_process_session_write("logical")
            .unwrap()
            .finish(Ok::<_, ()>(()))
            .unwrap();
        assert_eq!(f.count(), 0);
    }
}
