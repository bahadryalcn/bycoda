use super::*;

#[test]
#[ignore = "Explicit source-checkout integration with the actual v3 Notes producer encoder and Node module hooks"]
fn actual_renderer_notes_producer_encoder_bytes_reach_native_full_transaction() {
    check_renderer_producer_bytes("question-draft");
}

#[test]
#[ignore = "Explicit source-checkout integration with actual renderer approval producer bytes and Node module hooks"]
fn actual_renderer_approval_decision_bytes_reach_native_full_transaction_without_authority() {
    check_renderer_producer_bytes("approval-decision");
}

fn check_renderer_producer_bytes(parent_kind: &str) {
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
const parentKind = process.argv[2];
const parentData = parentKind === 'approval-decision'
  ? {requestId:17,tool:'original-tool',decision:{behavior:'allow',reason:'  ç 😀\r\n\t'},delivery:'unknown',providerAcknowledged:false,qualified:true,optional:undefined}
  : {questionId:'original',answer:' unsent ',optional:undefined};
process.stdout.write(encodeNativeProducerCapture('logical', {
  qualified:false, missingCoverage:[], snapshots:[
    {id:1,revision:2,sessionId:'logical',snapshot:{text:' \t\r\nç 😀 ',attachments:[],mcpTags:[]}}
  ]
}, {
  parent:{registryEpoch:3,snapshots:[{id:1,revision:4,kind:parentKind,sessionId:parentKind === 'approval-decision' ? undefined : 'logical',snapshot:parentData}]},
  editor:{registryEpoch:5,snapshots:[{id:1,revision:6,kind:'file-editor',snapshot:{path:'/isolated/file',text:'unsaved\r\n',draftBinding:{exactBodyAcknowledged:false,receipt:null,optional:undefined}}}]},
  notes:{registryEpoch:7,snapshots:[
    {id:1,revision:8,kind:'note-editor',snapshot:{noteId:'original-note',title:'',body:'  ç 😀\r\n\t',dirty:true,loaded:{body:'on disk\r\n',updatedAt:12},optional:undefined,draftBinding:{exactBodyAcknowledged:true,receipt:{userData:'not a Native ACK'}}}},
    {id:2,revision:0,kind:'note-editor',snapshot:{noteId:'empty-note',body:'',tags:[],pendingSave:false}}
  ]}
}));"#,
    ]);
    command.arg(module).arg(parent_kind);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let output = command
        .output()
        .expect("Node v3 producer encoder must be runnable");
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
    assert_eq!(value["version"], 3);
    assert_eq!(value["producerCoverage"], "unknown");
    assert_eq!(value["producers"][0]["kind"], parent_kind);
    if parent_kind == "approval-decision" {
        assert_eq!(value["producers"][0]["snapshot"]["delivery"], "unknown");
        assert_eq!(
            value["producers"][0]["snapshot"]["decision"]["reason"],
            "  ç 😀\r\n\t"
        );
        assert_eq!(
            value["producers"][0]["snapshot"]["providerAcknowledged"],
            false
        );
        // Payload assertions remain data; they cannot change the typed receipt.
        assert_eq!(value["producers"][0]["snapshot"]["qualified"], true);
    }
    assert_eq!(
        value["producerEpochs"],
        json!({"parent":3,"editor":5,"notes":7})
    );
    assert_eq!(
        value["producers"]
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| entry["id"].as_u64().unwrap())
            .collect::<Vec<_>>(),
        [3, 4, 5, 8]
    );
    assert_eq!(value["producers"][2]["snapshot"]["body"], "  ç 😀\r\n\t");
    assert_eq!(
        value["producers"][2]["snapshot"]["loaded"]["body"],
        "on disk\r\n"
    );
    assert_eq!(
        value["producers"][2]["undefinedPaths"],
        json!([["optional"]])
    );
    assert_eq!(value["producers"][3]["snapshot"]["body"], "");
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
    let wire = serde_json::to_value(&receipt).unwrap();
    assert_eq!(wire["qualified"], false);
    assert!(wire["applicationThrough"].is_null());
    let editor = serde_json::to_value(receipt.editor_drafts.as_ref().unwrap()).unwrap();
    assert_eq!(editor["validatedCount"], 0);
    assert_eq!(editor["unverifiedCount"], 1);
    assert_eq!(editor["rosterComplete"], false);
    assert_eq!(editor["rawSha256"], raw.sha256());
    let expected = receipt.raw_capture.unwrap();
    assert_eq!(expected.sql.raw_capture.as_ref().unwrap().snapshot_count, 5);
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
