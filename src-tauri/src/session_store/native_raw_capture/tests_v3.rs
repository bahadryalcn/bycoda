use super::*;

fn notes_capture() -> Value {
    let mut value = producer_capture();
    value["version"] = json!(3);
    value["producerEpochs"]["notes"] = json!(11);
    for (index, producer) in value["producers"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .enumerate()
    {
        producer["id"] = json!(if index == 5 { 4 } else { (index + 1) * 3 });
    }
    value["producers"].as_array_mut().unwrap().push(json!({
        "id":5,"revision":7,"kind":"note-editor",
        "snapshot":{
            "noteId":"original-note","title":"","body":"  ç 😀\r\n\t",
            "loaded":{"body":"on disk\r\n","updatedAt":12},
            "dirty":true,"input":{"tags":[],"items":[{}]},
            "__proto__":{"retained":"ordinary data"}
        },
        "undefinedPaths":[["sessionId"],["input","items",0,"optional"],["__proto__","missing"]]
    }));
    value
}

#[test]
fn v3_empty_notes_still_requires_its_independent_epoch_and_keeps_legacy_namespaces() {
    let mut value = notes_capture();
    value["producers"].as_array_mut().unwrap().pop();
    value["producerEpochs"]["notes"] = json!(0);
    let raw = RawCaptureArtifact::parse(value.to_string(), "A").unwrap();
    assert_eq!(raw.descriptor(&digest(b"c")).unwrap().snapshot_count, 8);
    value["snapshots"] = json!([]);
    value["producers"] = json!([]);
    let empty = RawCaptureArtifact::parse(value.to_string(), "A").unwrap();
    assert_eq!(empty.descriptor(&digest(b"c")).unwrap().snapshot_count, 0);
    value["producerEpochs"]
        .as_object_mut()
        .unwrap()
        .remove("notes");
    assert!(RawCaptureArtifact::parse(value.to_string(), "A").is_err());
}

#[test]
fn v3_exact_dirty_crlf_empty_body_and_own_undefined_notes_are_opaque_data() {
    let value = notes_capture();
    let raw = format!(" \n{}\n", value);
    let artifact = RawCaptureArtifact::parse(raw.clone(), "A").unwrap();
    assert_eq!(artifact.raw().as_bytes(), raw.as_bytes());
    assert_eq!(artifact.sha256(), digest(raw.as_bytes()));
    let parsed: Value = serde_json::from_str(artifact.raw()).unwrap();
    let note = &parsed["producers"][6];
    assert_eq!(note["snapshot"]["body"], "  ç 😀\r\n\t");
    assert_eq!(note["snapshot"]["loaded"]["body"], "on disk\r\n");
    assert!(note.get("sessionId").is_none());
    assert_eq!(
        note["undefinedPaths"],
        value["producers"][6]["undefinedPaths"]
    );
    assert_eq!(
        artifact.descriptor(&digest(b"c")).unwrap().snapshot_count,
        9
    );
    let mut empty = value.clone();
    empty["producers"][6]["sessionId"] = json!("A");
    empty["producers"][6]["snapshot"]["body"] = json!("");
    // Opaque user fields that resemble proof remain only exact raw data.
    empty["producers"][6]["snapshot"]["userData"] =
        json!({"qualified":true,"rosterComplete":true,"exactBodyAcknowledged":true});
    let empty = RawCaptureArtifact::parse(empty.to_string(), "A").unwrap();
    assert_ne!(empty.sha256(), artifact.sha256());
    let decoded: Value = serde_json::from_str(empty.raw()).unwrap();
    assert_eq!(decoded["producers"][6]["snapshot"]["body"], "");
    assert_eq!(decoded["qualified"], false);
    assert_eq!(decoded["producerCoverage"], "unknown");
}

#[test]
fn v3_epochs_and_coverage_are_closed_without_defaulting_or_v2_fallback() {
    let mut invalid = Vec::new();
    for field in ["parent", "editor", "notes"] {
        let mut value = notes_capture();
        value["producerEpochs"]
            .as_object_mut()
            .unwrap()
            .remove(field);
        invalid.push(value);
        for bad in [
            json!(-1),
            json!(MAX_SAFE + 1),
            json!(0.5),
            json!("0"),
            Value::Null,
        ] {
            let mut value = notes_capture();
            value["producerEpochs"][field] = bad;
            invalid.push(value);
        }
    }
    let mut value = notes_capture();
    value["producerEpochs"]["unknown"] = json!(0);
    invalid.push(value);
    let mut value = notes_capture();
    value["producerCoverage"] = json!("complete");
    invalid.push(value);
    let mut value = notes_capture();
    value["qualified"] = json!(true);
    invalid.push(value);
    let mut value = notes_capture();
    value["rosterComplete"] = json!(false);
    invalid.push(value);
    for value in invalid {
        assert!(RawCaptureArtifact::parse(value.to_string(), "A").is_err());
    }
    let mut legacy = producer_capture();
    legacy["producerEpochs"]["notes"] = json!(0);
    assert!(RawCaptureArtifact::parse(legacy.to_string(), "A").is_err());
    let mut legacy = producer_capture();
    legacy["producers"][0]["kind"] = json!("note-editor");
    assert!(RawCaptureArtifact::parse(legacy.to_string(), "A").is_err());
    // Existing v2 positive-ID semantics are intentionally not retrofitted with
    // v3's family namespace requirements.
    let mut legacy = producer_capture();
    legacy["producers"][0]["id"] = json!(3);
    assert!(RawCaptureArtifact::parse(legacy.to_string(), "A").is_ok());
}

#[test]
fn v3_ids_bind_the_original_family_and_reject_duplicates_scope_or_invalid_revisions() {
    let mut invalid = Vec::new();
    for index in 0..7 {
        let mut value = notes_capture();
        let id = value["producers"][index]["id"].as_u64().unwrap();
        value["producers"][index]["id"] = json!(id + 1);
        invalid.push(value);
    }
    for id in [0, 1, 2, MAX_SAFE + 1] {
        let mut value = notes_capture();
        value["producers"][6]["id"] = json!(id);
        invalid.push(value);
    }
    let mut value = notes_capture();
    let duplicate = value["producers"][6].clone();
    value["producers"].as_array_mut().unwrap().push(duplicate);
    invalid.push(value);
    for bad in [json!("B"), Value::Null] {
        let mut value = notes_capture();
        value["producers"][6]["sessionId"] = bad;
        invalid.push(value);
    }
    for revision in [json!(-1), json!(MAX_SAFE + 1), json!(1.5)] {
        let mut value = notes_capture();
        value["producers"][6]["revision"] = revision;
        invalid.push(value);
    }
    let mut value = notes_capture();
    value["sessionId"] = json!("B");
    invalid.push(value);
    let mut value = notes_capture();
    value["producers"][6]["kind"] = json!("notes-saved-row");
    invalid.push(value);
    for value in invalid {
        assert!(RawCaptureArtifact::parse(value.to_string(), "A").is_err());
    }
    let mut edge = notes_capture();
    edge["producers"][5]["id"] = json!(MAX_SAFE);
    assert_eq!(MAX_SAFE % 3, 1);
    assert!(RawCaptureArtifact::parse(edge.to_string(), "A").is_ok());
}

#[test]
fn v3_notes_undefined_paths_only_address_absent_object_members() {
    for paths in [
        json!([["body"]]),
        json!([["notPresent", "child"]]),
        json!([["sessionId"], ["sessionId"]]),
        json!([["sessionId"], ["sessionId", "child"]]),
        json!([["input", "items", 0]]),
        json!([["input", "items", 1, "missing"]]),
        json!([["input", "items", "0", "missing"]]),
        json!([[]]),
    ] {
        let mut value = notes_capture();
        value["producers"][6]["undefinedPaths"] = paths;
        assert!(RawCaptureArtifact::parse(value.to_string(), "A").is_err());
    }
    let mut value = notes_capture();
    value["snapshots"][0]["undefinedPaths"] = json!([["body"]]);
    assert!(RawCaptureArtifact::parse(value.to_string(), "A").is_err());
}

#[test]
fn v3_notes_share_entry_byte_node_depth_duplicate_key_and_unicode_limits() {
    let mut value = notes_capture();
    let template = value["producers"][6].clone();
    value["snapshots"] = json!([]);
    value["producers"] = json!((1..=MAX_SNAPSHOTS)
        .map(|id| {
            let mut entry = template.clone();
            entry["id"] = json!(id * 3 + 2);
            entry
        })
        .collect::<Vec<_>>());
    assert_eq!(
        RawCaptureArtifact::parse(value.to_string(), "A")
            .unwrap()
            .descriptor(&digest(b"c"))
            .unwrap()
            .snapshot_count,
        MAX_SNAPSHOTS as u64
    );
    value["snapshots"] = json!([capture()["snapshots"][0].clone()]);
    assert!(RawCaptureArtifact::parse(value.to_string(), "A").is_err());
    let mut value = notes_capture();
    value["producers"][6]["snapshot"]["huge"] = json!("x".repeat(MAX_BYTES));
    assert!(RawCaptureArtifact::parse(value.to_string(), "A").is_err());
    let mut value = notes_capture();
    value["producers"][6]["snapshot"]["many"] = json!(vec![false; MAX_NODES]);
    assert!(RawCaptureArtifact::parse(value.to_string(), "A").is_err());
    let mut nested = Value::Null;
    for _ in 0..MAX_DEPTH {
        nested = json!({"nested":nested});
    }
    let mut value = notes_capture();
    value["producers"][6]["snapshot"]["deep"] = nested;
    assert!(RawCaptureArtifact::parse(value.to_string(), "A").is_err());
    let raw = notes_capture()
        .to_string()
        .replacen("\"notes\":11", "\"notes\":11,\"notes\":11", 1);
    assert!(RawCaptureArtifact::parse(raw, "A").is_err());
    let raw = notes_capture()
        .to_string()
        .replacen("\"original-note\"", "\"\\ud800\"", 1);
    assert!(raw.contains("\\ud800"));
    assert!(RawCaptureArtifact::parse(raw, "A").is_err());
    let raw =
        notes_capture()
            .to_string()
            .replacen("\"dirty\":true", "\"dirty\":true,\"dirty\":false", 1);
    assert!(RawCaptureArtifact::parse(raw, "A").is_err());
}

#[test]
fn v3_and_original_v1_v2_commit_to_one_full_store_then_reopen_as_data_only() {
    let db = FileDb::new();
    let store = db.open();
    seed(&store);
    let artifacts = [
        artifact(),
        RawCaptureArtifact::parse(producer_capture().to_string(), "A").unwrap(),
        RawCaptureArtifact::parse(notes_capture().to_string(), "A").unwrap(),
    ];
    let receipts: Vec<_> = artifacts
        .iter()
        .map(|raw| commit(&store, raw).unwrap())
        .collect();
    for ((receipt, artifact), count) in receipts.iter().zip(&artifacts).zip([2, 8, 9]) {
        let descriptor = receipt.sql.raw_capture.as_ref().unwrap();
        assert_eq!(descriptor.version, 1);
        assert_eq!(descriptor.snapshot_count, count);
        assert_eq!(descriptor.sha256, artifact.sha256());
        assert_eq!(
            read_at(&store.lock_conn().unwrap(), &store, receipt).unwrap(),
            *receipt
        );
    }
    assert_eq!(count(&store, "native_raw_captures"), 3);
    drop(store);
    let reopened = db.open();
    let conn = reopened.lock_conn().unwrap();
    for (receipt, artifact) in receipts.iter().zip(&artifacts) {
        assert!(read_at(&conn, &reopened, receipt)
            .unwrap_err()
            .contains("RUNTIME_CHANGED"));
        assert_eq!(
            read_retained_at(&conn, &reopened, receipt).unwrap(),
            *receipt
        );
        let stored: String = conn
            .query_row(
                "SELECT raw_json FROM native_raw_captures WHERE nonce=?1",
                [&receipt.sql.nonce],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stored.as_bytes(), artifact.raw().as_bytes());
    }
}

#[test]
fn v3_full_rollback_and_weighted_capacity_preserve_the_original_rows_and_budget() {
    let db = FileDb::new();
    let store = db.open();
    seed(&store);
    let first = commit(&store, &artifact()).unwrap();
    let raw = RawCaptureArtifact::parse(notes_capture().to_string(), "A").unwrap();
    let baseline = health(&store.lock_conn().unwrap(), None).unwrap();
    let mut provisional = None;
    let aborted: Result<(), String> =
        authority::with_full_projection_transaction(&store, |checked| {
            let sql = parent(&checked, &store, Some(raw.descriptor(&digest(b"c"))?))?;
            provisional = Some(retain_at(&checked, &store, &sql, &raw)?);
            Err("original actual owner withdrew before COMMIT".into())
        });
    assert!(aborted.is_err());
    assert!(read_at(&store.lock_conn().unwrap(), &store, &provisional.unwrap()).is_err());
    for by_bytes in [false, true] {
        let result = authority::with_full_projection_transaction(&store, |checked| {
            let sql = parent(&checked, &store, Some(raw.descriptor(&digest(b"c"))?))?;
            retain_with_limits(
                &checked,
                &store,
                &sql,
                &raw,
                if by_bytes { MAX_ROWS } else { baseline.0 },
                if by_bytes { baseline.1 } else { STORE_BYTES },
            )
        });
        assert!(result.unwrap_err().contains("CAPACITY"));
        assert_eq!(health(&store.lock_conn().unwrap(), None).unwrap(), baseline);
        assert_eq!(count(&store, "native_raw_captures"), 1);
        assert_eq!(count(&store, "native_renderer_checkpoint_receipts"), 1);
        assert_eq!(
            read_at(&store.lock_conn().unwrap(), &store, &first).unwrap(),
            first
        );
    }
    let second = commit(&store, &raw).unwrap();
    assert_eq!(count(&store, "native_raw_captures"), 2);
    drop(store);
    let reopened = db.open();
    assert_eq!(
        read_retained_at(&reopened.lock_conn().unwrap(), &reopened, &second).unwrap(),
        second
    );
}
