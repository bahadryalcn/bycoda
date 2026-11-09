//! Explicit fixture bridge: actual browser bytes, isolated Native SQL, no live profile.
use super::*;

fn packet_json(packet: &std::path::Path, name: &str) -> Value {
    let path = packet.join(name).canonicalize().unwrap();
    assert_eq!(path.parent(), Some(packet));
    assert!(std::fs::metadata(&path).unwrap().len() <= 8 * 1024 * 1024);
    serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
}

#[test]
#[ignore = "Requires a completed isolated Notes browser packet and BYCODA_NOTES_UI_RAW_MANIFEST"]
fn actual_notes_ui_raw_bytes_reach_native_full_without_changing_session_or_note_identity() {
    let repository = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .to_owned();
    let allowed = repository
        .join("temp/verification/2026-10-29-notes-input-closure/browser")
        .canonicalize()
        .unwrap();
    let manifest = PathBuf::from(
        std::env::var_os("BYCODA_NOTES_UI_RAW_MANIFEST")
            .expect("Supply the completed browser packet's raw-artifacts.json"),
    )
    .canonicalize()
    .unwrap();
    assert!(manifest.starts_with(&allowed));
    assert_eq!(manifest.file_name().unwrap(), "raw-artifacts.json");
    assert!(std::fs::metadata(&manifest).unwrap().len() <= 1024 * 1024);
    let entries: Vec<Value> = serde_json::from_slice(&std::fs::read(&manifest).unwrap()).unwrap();
    assert!(!entries.is_empty() && entries.len() <= 64);
    let packet = manifest.parent().unwrap();
    let checks = packet_json(packet, "checks.json");
    assert_eq!(checks["passed"], true);
    assert_eq!(checks["caseCount"], 40);
    assert_eq!(checks["passedCount"], 40);
    assert_eq!(checks["screenshotCount"], 40);
    assert_eq!(checks["qualified"], false);
    assert_eq!(checks["nativeProfile"], false);
    assert_eq!(entries.len(), 40);
    assert!(!packet.join("runner-failure.json").exists());
    for stage in ["after-build", "after-capture", "at-end"] {
        let guard = packet_json(packet, &format!("source-identity-{stage}.json"));
        assert_eq!(guard["stage"], stage);
        assert_eq!(guard["matches"], true);
        assert!(guard["fileCount"].as_u64().unwrap() > 0);
    }
    let handles = packet_json(packet, "handles-closed.json");
    assert_eq!(handles["browserClosed"], true);
    assert_eq!(handles["serverClosed"], true);
    let expected_ids: std::collections::BTreeSet<_> = [
        "library-source",
        "library-preview",
        "dock-title",
        "library-tag",
        "retained",
        "divergent",
        "pending-save",
        "pending-image",
        "shared-controls",
        "private-recovery",
    ]
    .into_iter()
    .flat_map(|surface| {
        [1280, 800].into_iter().flat_map(move |width| {
            ["light", "dark"]
                .into_iter()
                .map(move |theme| format!("{surface}-{theme}-{width}"))
        })
    })
    .collect();
    let results = packet_json(packet, "results.json");
    let results = results.as_array().unwrap();
    assert_eq!(results.len(), 40);
    assert!(results.iter().all(|result| result["status"] == "passed"));
    for rows in [results, &entries] {
        let ids: std::collections::BTreeSet<_> = rows
            .iter()
            .map(|row| row["id"].as_str().unwrap().to_owned())
            .collect();
        assert_eq!(expected_ids, ids);
    }
    let mut notes_count = 0;
    for entry in &entries {
        let name = entry["path"].as_str().unwrap();
        assert_eq!(std::path::Path::new(name).components().count(), 1);
        assert!(name.ends_with(".raw-v3.json"));
        let path = packet.join(name).canonicalize().unwrap();
        assert_eq!(path.parent(), Some(packet));
        assert!(std::fs::metadata(&path).unwrap().len() <= 16 * 1024 * 1024);
        let bytes = std::fs::read(path).unwrap();
        assert_eq!(bytes.len() as u64, entry["byteLength"].as_u64().unwrap());
        assert_eq!(sha(&bytes), entry["sha256"].as_str().unwrap());
        let text = String::from_utf8(bytes).unwrap();
        let value: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(value["version"], 3);
        assert_eq!(value["qualified"], false);
        assert_eq!(value["producerCoverage"], "unknown");
        let session = value["sessionId"].as_str().unwrap();
        assert_eq!(session, entry["sessionId"].as_str().unwrap());
        let producers = value["producers"].as_array().unwrap();
        assert!(producers.iter().all(|row| row["kind"] != "file-editor"));
        notes_count += producers
            .iter()
            .filter(|row| row["kind"] == "note-editor")
            .count();
        let raw = RawCaptureArtifact::parse(text, session).unwrap();
        let fixture = Fixture::new();
        if session != "A" {
            fixture.store.lock_conn().unwrap().execute(
                "INSERT INTO sessions(id,cwd,harness,model,runtime_mode,title,created_at,updated_at,blocks_json) VALUES(?1,'.','codex','fixture','approve','actual Notes UI fixture',1,1,'[]')",
                [session],
            ).unwrap();
        }
        let row = fixture
            .store
            .capture_session_row_identity(session)
            .unwrap()
            .unwrap();
        let (owner, operation) =
            test_buffer_owner(&fixture.resources, fixture.store.native_instance_id()).unwrap();
        let window = owner.incarnation().to_string();
        operation.finish(Ok::<(), String>(())).unwrap();
        let (validation, retained) = fixture
            .full(&fixture.resources, &raw, |tx, validation| {
                let validation = validation.ok_or_else(invalid)?.receipt();
                let parent = parent(tx, &fixture.store, &raw, &window, &row)?;
                let retained = native_raw_capture::retain_at(tx, &fixture.store, &parent, &raw)?;
                Ok((validation, retained))
            })
            .unwrap();
        let validation = serde_json::to_value(validation).unwrap();
        assert_eq!(validation["validatedCount"], 0);
        assert_eq!(validation["unverifiedCount"], 0);
        assert_eq!(validation["qualified"], false);
        assert_eq!(validation["rosterComplete"], false);
        assert_eq!(validation["rawSha256"], raw.sha256());
        assert_eq!(retained.sql.session_id, session);
        let descriptor = retained.sql.raw_capture.as_ref().unwrap();
        assert_eq!(descriptor.sha256, raw.sha256());
        assert_eq!(
            descriptor.snapshot_count,
            entry["snapshotCount"].as_u64().unwrap()
        );
        {
            let conn = fixture.store.lock_conn().unwrap();
            assert_eq!(
                native_raw_capture::read_at(&conn, &fixture.store, &retained).unwrap(),
                retained
            );
            let stored: String = conn
                .query_row("SELECT raw_json FROM native_raw_captures", [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(stored.as_bytes(), raw.raw().as_bytes());
        }
        let reopened = SessionStore::open(fixture.root.join("sessions.db")).unwrap();
        assert_eq!(
            native_raw_capture::read_retained_at(
                &reopened.lock_conn().unwrap(),
                &reopened,
                &retained,
            )
            .unwrap(),
            retained
        );
        println!(
            "{}: {} bytes retained exactly for original session {}",
            name,
            raw.raw().len(),
            session
        );
    }
    assert!(
        notes_count > 0,
        "The actual browser packet must contain Notes actors"
    );
    println!(
        "{} actual browser artifacts verified through isolated Native FULL",
        entries.len()
    );
}
