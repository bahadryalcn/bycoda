use super::*;

fn fixture() -> (RecoveryContext, RecoverySource, Value, Value) {
    let context = RecoveryContext {
        host_environment_id: "selected-host".into(),
        source_store_id: "actual-store".into(),
        source_profile_id: "actual-profile".into(),
        native_store_instance: uuid::Uuid::new_v4().to_string(),
        client_id: "c".repeat(64),
    };
    let path = std::env::temp_dir()
        .join("native-recovery-fixture.txt")
        .to_string_lossy()
        .into_owned();
    let provenance = json!({"version":2,"sourceStoreId":context.source_store_id,"sourceProfileId":context.source_profile_id,"storeInstance":uuid::Uuid::new_v4().to_string(),"windowIncarnation":uuid::Uuid::new_v4().to_string(),"kind":"physical","reportVersion":1,"reportNonce":uuid::Uuid::new_v4().to_string(),"snapshotDigest":"d".repeat(64)});
    let owner = json!({"ownerId":"physical-owner","updatedAt":1,"unknown":false,"buffers":[{"path":path,"dirty":true}],"source":provenance});
    let raw = json!({"clientId":context.client_id,"instanceId":"native-instance","device":"a".repeat(64),"processId":1,"receivedAt":1,"owners":[owner],"recovery":{"reportVersion":2,"ownerVersions":{"physical-owner":3}}}).to_string();
    let source = RecoverySource {
        report_id: hash(
            &serde_json::to_vec(&json!([
                "a".repeat(64),
                context.client_id,
                "native-instance"
            ]))
            .unwrap(),
        ),
        report_version: 2,
        owner_id: "physical-owner".into(),
        owner_version: 3,
        snapshot_digest: hash(raw.as_bytes()),
    };
    let row = json!({"source":source,"clientId":context.client_id,"instanceId":"native-instance","processId":1,"updatedAt":1,"byteLength":raw.len(),"bufferCount":1,"dirtyCount":1,"unknown":false,"provenance":provenance,"lineage":"physical","ownerMissing":false,"compatibilityHoldId":"b".repeat(64),"verification":"metadata-only","retention":"historical","inspectable":true,"qualified":false,"resolution":"unsupported"});
    let read = json!({"version":1,"qualified":false,"source":source,"rawReport":raw,"owner":owner,"resolution":"unsupported"});
    (context, source, row, read)
}
fn page(rows: Vec<Value>) -> Value {
    json!({"version":1,"qualified":false,"records":rows,"next":null,"incomplete":false,"duplicatesPossible":false})
}

#[test]
fn exact_original_body_and_selected_profile_are_verified_without_claiming_qualification() {
    let (context, source, row, read) = fixture();
    assert_eq!(validate_read(&read, &source, &context).unwrap().len(), 1);
    let output = decode_page(page(vec![row]), context, 25, None).unwrap();
    assert_eq!(output.records.len(), 1);
    assert!(!output.qualified);
    assert!(!output.unavailable);
}
#[test]
fn other_clients_are_omitted_and_missing_or_mixed_same_client_provenance_is_generic_unavailable() {
    let (context, _, row, _) = fixture();
    let mut foreign = row.clone();
    foreign["clientId"] = json!("other-client");
    foreign["windowLabel"] = json!("foreign private label");
    let mut unknown = row.clone();
    unknown["provenance"] = Value::Null;
    let mut other_profile = row.clone();
    other_profile["provenance"]["sourceProfileId"] = json!("other-profile");
    let output = decode_page(
        page(vec![foreign, unknown, other_profile]),
        context,
        25,
        None,
    )
    .unwrap();
    assert!(output.records.is_empty());
    assert!(output.unavailable);
    let wire = serde_json::to_string(&output).unwrap();
    assert!(!wire.contains("foreign private label"));
    assert!(!wire.contains("other-profile"));
}
#[test]
fn source_replay_payload_change_and_another_owner_in_the_same_raw_body_cannot_disclose_paths() {
    for mode in [
        "raw",
        "version",
        "owner-version",
        "client",
        "profile",
        "mixed",
    ] {
        let (context, mut source, _, mut read) = fixture();
        match mode {
            "raw" => read["rawReport"] = json!(format!("{} ", read["rawReport"].as_str().unwrap())),
            "version" => {
                source.report_version += 1;
                read["source"] = json!(source);
            }
            "owner-version" => {
                source.owner_version += 1;
                read["source"] = json!(source);
            }
            _ => {
                let mut raw: Value =
                    serde_json::from_str(read["rawReport"].as_str().unwrap()).unwrap();
                if mode == "client" {
                    raw["clientId"] = json!("foreign");
                }
                if mode == "profile" {
                    raw["owners"][0]["source"]["sourceProfileId"] = json!("foreign");
                }
                if mode == "mixed" {
                    raw["owners"]
                        .as_array_mut()
                        .unwrap()
                        .push(json!({"ownerId":"unknown","buffers":[],"source":null}));
                }
                let text = raw.to_string();
                source.snapshot_digest = hash(text.as_bytes());
                read["rawReport"] = json!(text);
                read["source"] = json!(source);
            }
        }
        assert!(validate_read(&read, &source, &context).is_err(), "{mode}");
    }
}
#[test]
fn original_utf8_bom_is_hashed_before_parsing_and_not_silently_regenerated() {
    let (context, mut source, _, mut read) = fixture();
    let raw = format!("\u{feff} \r\n{}\t", read["rawReport"].as_str().unwrap());
    source.snapshot_digest = hash(raw.as_bytes());
    read["rawReport"] = json!(raw);
    read["source"] = json!(source);
    assert!(validate_read(&read, &source, &context).is_ok());
}
#[test]
fn cursor_continuation_requires_native_construction_context_and_monotonic_host_cursor() {
    let (context, _, row, _) = fixture();
    let cursor = RecoveryCursor {
        version: 1,
        cursor_id: uuid::Uuid::new_v4().to_string(),
        page: 1,
    };
    assert!(ListRequest {
        after: Some(cursor.clone()),
        limit: 25
    }
    .validate(&None)
    .is_err());
    assert!(ListRequest {
        after: Some(cursor.clone()),
        limit: 25
    }
    .validate(&Some(context.clone()))
    .is_ok());
    let mut changed = context.clone();
    changed.native_store_instance = uuid::Uuid::new_v4().to_string();
    assert_ne!(context, changed);
    let mut value = page(vec![row]);
    value["next"] = json!({"version":1,"cursorId":cursor.cursor_id,"page":1});
    assert!(decode_page(value, context, 25, Some(&cursor)).is_err());
}
#[test]
fn malformed_metadata_and_raw_buffer_projection_are_not_exposed() {
    let (context, source, mut row, mut read) = fixture();
    row["path"] = json!("unrecognized secret");
    assert!(
        decode_page(page(vec![row]), context.clone(), 25, None)
            .unwrap()
            .unavailable
    );
    read["owner"]["buffers"][0]["dirty"] = json!(false);
    assert!(validate_read(&read, &source, &context).is_err());
}

#[test]
fn undeclared_read_owner_provenance_and_raw_fields_cannot_cross_native_ipc() {
    for mode in [
        "outer",
        "owner",
        "provenance",
        "buffer",
        "raw-owner",
        "raw-provenance",
        "raw-outer",
        "raw-process-id",
        "raw-received-at",
        "raw-retired-at",
        "raw-owner-version",
        "raw-lineage",
        "raw-held-owner",
        "raw-clock",
    ] {
        let (context, mut source, _, mut read) = fixture();
        match mode {
            "outer" => read["foreign"] = json!("other-profile secret"),
            "owner" => read["owner"]["foreign"] = json!("other-profile secret"),
            "provenance" => read["owner"]["source"]["foreign"] = json!("other-profile secret"),
            "buffer" => read["owner"]["buffers"][0]["foreign"] = json!("other-profile secret"),
            _ => {
                let mut raw: Value =
                    serde_json::from_str(read["rawReport"].as_str().unwrap()).unwrap();
                match mode {
                    "raw-process-id" => {
                        raw["processId"] = json!({"foreign":"other-profile secret"})
                    }
                    "raw-received-at" => {
                        raw["receivedAt"] = json!({"foreign":"other-profile secret"})
                    }
                    "raw-retired-at" => {
                        raw["retiredAt"] = json!({"foreign":"other-profile secret"})
                    }
                    "raw-owner-version" => {
                        raw["recovery"]["ownerVersions"]["unvalidated"] =
                            json!({"foreign":"other-profile secret"})
                    }
                    "raw-lineage" => {
                        raw["recovery"]["ownerLineages"] =
                            json!({"unvalidated":{"foreign":"other-profile secret"}})
                    }
                    "raw-held-owner" => {
                        raw["recovery"]["heldOwnerIds"] =
                            json!([{"foreign":"other-profile secret"}])
                    }
                    "raw-clock" => {
                        raw["recovery"]["clockId"] = json!({"foreign":"other-profile secret"})
                    }
                    "raw-owner" => raw["owners"][0]["foreign"] = json!("other-profile secret"),
                    "raw-provenance" => {
                        raw["owners"][0]["source"]["foreign"] = json!("other-profile secret");
                        read["owner"]["source"]["foreign"] = json!("other-profile secret");
                    }
                    _ => raw["foreign"] = json!("other-profile secret"),
                }
                let text = raw.to_string();
                source.snapshot_digest = hash(text.as_bytes());
                read["rawReport"] = json!(text);
                read["source"] = json!(source);
            }
        }
        assert!(validate_read(&read, &source, &context).is_err(), "{mode}");
    }
}

#[test]
fn actual_store_reopen_and_selected_native_profile_have_distinct_continuation_identity() {
    let temporary = std::env::temp_dir().canonicalize().unwrap();
    let root = temporary.join(format!("bycoda-recovery-context-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    {
        let first = SessionStore::open(root.join("store.db")).unwrap();
        let second = SessionStore::open(root.join("store.db")).unwrap();
        let a = context_from_profile(&first, "selected-host", &root).unwrap();
        let b = context_from_profile(&second, "selected-host", &root).unwrap();
        assert_eq!(a.source_store_id, b.source_store_id);
        assert_eq!(a.source_profile_id, b.source_profile_id);
        assert_eq!(a.client_id, b.client_id);
        assert_ne!(a.native_store_instance, b.native_store_instance);
        assert_ne!(
            a,
            context_from_profile(&first, "other-host", &root).unwrap()
        );
        assert_ne!(
            a.client_id,
            context_from_profile(&first, "selected-host", &root.join("other-profile"))
                .unwrap()
                .client_id
        );
    }
    assert_eq!(root.parent(), Some(temporary.as_path()));
    assert!(!std::fs::symlink_metadata(&root)
        .unwrap()
        .file_type()
        .is_symlink());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn native_permits_remain_owned_until_actual_call_scope_settles() {
    let held = (0..4)
        .map(|_| Permit::acquire().unwrap())
        .collect::<Vec<_>>();
    assert!(Permit::acquire().is_err());
    drop(held);
    assert!(Permit::acquire().is_ok());
}
