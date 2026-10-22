//! Calls the exact production domain/store/transport; only platform event and
//! app-data-root dependencies are supplied by the isolated fixture.
use super::*;

fn operation(owner: &str, endpoint: &SshEndpoint) -> Operation {
    Operation::begin_for_window(uuid::Uuid::new_v4().to_string(), owner, endpoint).unwrap()
}
fn cancel_after_transfer(context: &TransferContext, owner: &str, phase: &str) -> TransferContext {
    let owner = owner.to_owned();
    let phase = phase.to_owned();
    TransferContext {
        app: None,
        root: context.root.clone(),
        observer: Some(Arc::new(move |event| {
            if event.phase == phase && event.state == "transferred" {
                cancel_for_window(&owner, &event.operation_id).unwrap();
            }
        })),
    }
}
fn one_record(context: &TransferContext, owner: &str) -> Recovery {
    let views = list_core(context, owner, "fixture-server").unwrap();
    assert_eq!(views.len(), 1);
    let path = record_path(context, &views[0].id).unwrap();
    serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
}

#[test]
#[ignore = "Requires the disposable running SFTP fixture and test environment"]
fn real_production_transfer_recovery_domain_flow() {
    let fixture = PathBuf::from(std::env::var("BYCODA_TEST_SFTP_ROOT").expect("fixture root"));
    let endpoint = SshEndpoint {
        host: "127.0.0.1".into(),
        user: Some(std::env::var("USERNAME").unwrap()),
        port: fs::read_to_string(fixture.join("port.txt"))
            .unwrap()
            .trim()
            .parse()
            .unwrap(),
        identity_file: Some(std::env::var("BYCODA_TEST_SFTP_IDENTITY").unwrap()),
        ..Default::default()
    };
    let root = fixture.join(format!("domain-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&root).unwrap();
    let owner = format!("domain-owner-{}", uuid::Uuid::new_v4());
    // Production operations capture a window registered by the app lifecycle.
    crate::ssh_window_lifecycle::register(&owner).unwrap();
    crate::ssh_window_lifecycle::register("different-domain-owner").unwrap();
    let context = TransferContext {
        app: None,
        root: root.join("recoveries"),
        observer: None,
    };
    let source = root.join("source.bin");
    let remote = root.join("remote.bin").to_string_lossy().replace('\\', "/");
    let bytes: Vec<u8> = (0..262_144).map(|i| (i % 251) as u8).collect();
    fs::write(&source, &bytes).unwrap();
    let source_text = source.to_string_lossy().into_owned();

    // Actual fresh upload verifies staged bytes before remote publication.
    let op = operation(&owner, &endpoint);
    assert!(upload_core(
        &context,
        &endpoint,
        &op,
        "fixture-server".into(),
        source_text.clone(),
        remote.clone(),
        false
    )
    .is_err());
    assert!(!Path::new(&remote).exists());
    assert_eq!(
        upload_core(
            &context,
            &endpoint,
            &op,
            "fixture-server".into(),
            source_text.clone(),
            remote.clone(),
            true
        )
        .unwrap(),
        bytes.len() as u64
    );
    assert_eq!(fs::read(&remote).unwrap(), bytes);
    // Replacement is an actual server rename capability, not inferred merely
    // from consent. Seed only this fixture-owned destination, then verify the
    // production staging/content-verification/publication path replaces it.
    fs::write(&remote, b"previous owned target content").unwrap();
    assert_eq!(upload_core(&context, &endpoint, &op, "fixture-server".into(), source_text.clone(), remote.clone(), true)
        .expect("server must support consented standard/extension rename replacement; no delete-then-rename fallback"), bytes.len() as u64);
    assert_eq!(
        hash_file(Path::new(&remote), None).unwrap(),
        hash_file(&source, None).unwrap()
    );
    assert!(list_core(&context, &owner, "fixture-server")
        .unwrap()
        .is_empty());
    drop(op);

    // Actual download + no-clobber destination enforcement.
    let destination = root.join("download.bin").to_string_lossy().into_owned();
    let op = operation(&owner, &endpoint);
    download_core(
        &context,
        &endpoint,
        &op,
        "fixture-server".into(),
        remote.clone(),
        destination.clone(),
    )
    .unwrap();
    assert_eq!(fs::read(&destination).unwrap(), bytes);
    assert!(download_core(
        &context,
        &endpoint,
        &op,
        "fixture-server".into(),
        remote.clone(),
        destination.clone()
    )
    .is_err());
    drop(op);

    // Cancel the real production domain after actual transport, before publish.
    let resumed = root.join("resumed.bin").to_string_lossy().into_owned();
    let cancelled = cancel_after_transfer(&context, &owner, "download");
    let op = operation(&owner, &endpoint);
    assert!(download_core(
        &cancelled,
        &endpoint,
        &op,
        "fixture-server".into(),
        remote.clone(),
        resumed.clone()
    )
    .is_err());
    assert!(!Path::new(&resumed).exists());
    drop(op);
    let mut record = one_record(&context, &owner);
    assert!(load(
        &context,
        &record.id,
        "wrong-window",
        "fixture-server",
        &endpoint
    )
    .is_err());
    let wrong_owner = operation("different-domain-owner", &endpoint);
    assert!(resume_core(
        &context,
        &endpoint,
        &wrong_owner,
        "fixture-server".into(),
        record.id.clone(),
        false
    )
    .is_err());
    assert!(discard_core(
        &context,
        &endpoint,
        &wrong_owner,
        "fixture-server".into(),
        record.id.clone()
    )
    .is_err());
    drop(wrong_owner);
    let mut changed_endpoint = endpoint.clone();
    changed_endpoint.port = endpoint.port.saturating_add(1);
    let op = operation(&owner, &changed_endpoint);
    assert!(resume_core(
        &context,
        &changed_endpoint,
        &op,
        "fixture-server".into(),
        record.id.clone(),
        false
    )
    .is_err());
    drop(op);
    // Model a genuine shorter owned partial using the same production checkpoint.
    OpenOptions::new()
        .write(true)
        .open(&record.staging_path)
        .unwrap()
        .set_len(12345)
        .unwrap();
    checkpoint(&context, &mut record).unwrap();
    let op = operation(&owner, &endpoint);
    let mut wrong_partial = bytes[..12345].to_vec();
    wrong_partial[0] ^= 1;
    fs::write(&record.staging_path, wrong_partial).unwrap();
    assert!(resume_core(
        &context,
        &endpoint,
        &op,
        "fixture-server".into(),
        record.id.clone(),
        false
    )
    .is_err());
    fs::write(&record.staging_path, &bytes[..12345]).unwrap();
    resume_core(
        &context,
        &endpoint,
        &op,
        "fixture-server".into(),
        record.id.clone(),
        false,
    )
    .unwrap();
    assert_eq!(fs::read(&resumed).unwrap(), bytes);
    assert!(!record_path(&context, &record.id).unwrap().exists());
    drop(op);

    // Upload cancellation retains one target-bound recovery; actual prefix
    // verification + reput use the same production resume implementation.
    let second_remote = root
        .join("resumed-upload.bin")
        .to_string_lossy()
        .replace('\\', "/");
    let cancelled = cancel_after_transfer(&context, &owner, "upload");
    let op = operation(&owner, &endpoint);
    assert!(upload_core(
        &cancelled,
        &endpoint,
        &op,
        "fixture-server".into(),
        source_text.clone(),
        second_remote.clone(),
        true
    )
    .is_err());
    assert!(!Path::new(&second_remote).exists());
    drop(op);
    let record = one_record(&context, &owner);
    let short = root.join("prefix.bin");
    fs::write(&short, &bytes[..23456]).unwrap();
    let op = operation(&owner, &endpoint);
    run_batch(
        &endpoint,
        format!(
            "put {} {}\nbye\n",
            wire_path(&short).unwrap(),
            quote_path(&record.staging_path).unwrap()
        ),
        &op,
    )
    .unwrap();
    assert!(resume_core(
        &context,
        &endpoint,
        &op,
        "fixture-server".into(),
        record.id.clone(),
        false
    )
    .is_err());
    let mut tampered = bytes.clone();
    tampered[0] ^= 1;
    fs::write(&source, &tampered).unwrap();
    assert!(resume_core(
        &context,
        &endpoint,
        &op,
        "fixture-server".into(),
        record.id.clone(),
        true
    )
    .is_err());
    fs::write(&source, &bytes).unwrap();
    resume_core(
        &context,
        &endpoint,
        &op,
        "fixture-server".into(),
        record.id,
        true,
    )
    .unwrap();
    assert_eq!(fs::read(&second_remote).unwrap(), bytes);
    drop(op);

    // Explicit discard removes only the verified owned partial and metadata.
    let discarded = root.join("discarded.bin").to_string_lossy().into_owned();
    let cancelled = cancel_after_transfer(&context, &owner, "download");
    let op = operation(&owner, &endpoint);
    assert!(download_core(
        &cancelled,
        &endpoint,
        &op,
        "fixture-server".into(),
        remote.clone(),
        discarded.clone()
    )
    .is_err());
    drop(op);
    let mut record = one_record(&context, &owner);
    let op = operation(&owner, &endpoint);
    discard_core(
        &context,
        &endpoint,
        &op,
        "fixture-server".into(),
        record.id.clone(),
    )
    .unwrap();
    assert!(!Path::new(&record.staging_path).exists());
    assert!(!Path::new(&discarded).exists());

    // A lost rename reply can never become an automatic second publication.
    // Only metadata dismissal is allowed; destination and stage remain intact.
    fs::write(&record.staging_path, b"uncertain stage").unwrap();
    record.publication = Some("unknown".into());
    save(&context, &record).unwrap();
    let cancelled_dismissal = operation(&owner, &endpoint);
    cancel_for_window(&owner, &cancelled_dismissal.id).unwrap();
    assert!(discard_core(
        &context,
        &endpoint,
        &cancelled_dismissal,
        "fixture-server".into(),
        record.id.clone()
    )
    .is_err());
    assert!(record_path(&context, &record.id).unwrap().exists());
    assert_eq!(fs::read(&record.staging_path).unwrap(), b"uncertain stage");
    drop(cancelled_dismissal);
    assert!(resume_core(
        &context,
        &endpoint,
        &op,
        "fixture-server".into(),
        record.id.clone(),
        false
    )
    .is_err());
    discard_core(
        &context,
        &endpoint,
        &op,
        "fixture-server".into(),
        record.id.clone(),
    )
    .unwrap();
    assert_eq!(fs::read(&record.staging_path).unwrap(), b"uncertain stage");
    assert_eq!(fs::read(&remote).unwrap(), bytes);
    drop(op);
    // Exact generated fixture path only; no live or unrelated workspace paths.
    assert_eq!(root.parent(), Some(fixture.as_path()));
    assert!(root
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("domain-"));
    fs::remove_dir_all(root).unwrap();
    crate::ssh_window_lifecycle::close(&owner);
    crate::ssh_window_lifecycle::close("different-domain-owner");
}
