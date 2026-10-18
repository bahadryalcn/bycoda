use super::*;

fn native_reference(value: &str) -> String {
    #[cfg(windows)]
    {
        format!("C:{value}")
    }
    #[cfg(not(windows))]
    {
        value.to_string()
    }
}

fn group() -> GroupDefaults {
    GroupDefaults {
        id: "production".into(),
        revision: 0,
        name: "Production".into(),
        defaults: ConnectionDefaults {
            user: Some("deploy".into()),
            port: Some(2222),
            identity_file: Some(native_reference("/owned/reference/id_ed25519")),
            certificate_file: Some(native_reference("/owned/reference/id-cert.pub")),
        },
        environment: vec![LiteralEnvironment {
            name: "APP_ENV".into(),
            value: "production".into(),
        }],
        shell_kind: Some(RemoteShellKind::Posix),
    }
}
fn base() -> SshEndpoint {
    SshEndpoint {
        host: "target.example".into(),
        user: Some("local-user".into()),
        port: 22,
        identity_file: Some("/connection/key".into()),
        ..Default::default()
    }
}
fn selection(fields: Vec<InheritedField>, environment: bool) -> Inheritance {
    Inheritance {
        group_id: "production".into(),
        fields,
        environment,
    }
}

#[test]
fn sqlite_cas_preserves_identity_rejects_stale_writes_and_delete() {
    let connection = Connection::open_in_memory().unwrap();
    migrate(&connection).unwrap();
    migrate(&connection).unwrap();
    let first = save_cas(&connection, &group(), None).unwrap();
    assert_eq!(first.revision, 1);
    assert_eq!(list(&connection).unwrap(), vec![first.clone()]);
    assert!(save_cas(&connection, &group(), None).is_err());
    let mut edit = first.clone();
    edit.name = "Production renamed".into();
    let second = save_cas(&connection, &edit, Some(1)).unwrap();
    assert_eq!(second.id, first.id);
    assert_eq!(second.revision, 2);
    assert!(save_cas(&connection, &edit, Some(1)).is_err());
    assert!(delete_cas(&connection, &first.id, 1).is_err());
    assert_eq!(get(&connection, &first.id).unwrap(), Some(second));
    delete_cas(&connection, &first.id, 2).unwrap();
    assert!(get(&connection, &first.id).unwrap().is_none());
}

#[test]
fn two_native_writers_cannot_overwrite_the_same_revision() {
    let uri = format!(
        "file:ssh-group-{}?mode=memory&cache=shared",
        uuid::Uuid::new_v4()
    );
    let flags = rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE
        | rusqlite::OpenFlags::SQLITE_OPEN_CREATE
        | rusqlite::OpenFlags::SQLITE_OPEN_URI;
    let first = Connection::open_with_flags(&uri, flags).unwrap();
    migrate(&first).unwrap();
    let saved = save_cas(&first, &group(), None).unwrap();
    let second = Connection::open_with_flags(&uri, flags).unwrap();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let other = barrier.clone();
    let copy = saved.clone();
    let writer = std::thread::spawn(move || {
        let mut edit = copy;
        edit.name = "Writer two".into();
        other.wait();
        save_cas(&second, &edit, Some(1))
    });
    let mut edit = saved;
    edit.name = "Writer one".into();
    barrier.wait();
    let own = save_cas(&first, &edit, Some(1));
    let other = writer.join().unwrap();
    assert_eq!(usize::from(own.is_ok()) + usize::from(other.is_ok()), 1);
    assert_eq!(get(&first, "production").unwrap().unwrap().revision, 2);
}

#[test]
fn inheritance_is_explicit_and_never_rewrites_saved_overrides() {
    let original = base();
    let mut defaults = group();
    defaults.revision = 1;
    let untouched = resolve(&original, None, Some(&defaults)).unwrap();
    assert_eq!(untouched.endpoint, original);
    assert!(untouched.environment.is_empty());
    let inherit = selection(vec![InheritedField::User, InheritedField::Port], false);
    let effective = resolve(&original, Some(&inherit), Some(&defaults)).unwrap();
    assert_eq!(effective.endpoint.user.as_deref(), Some("deploy"));
    assert_eq!(effective.endpoint.port, 2222);
    assert_eq!(effective.endpoint.identity_file, original.identity_file);
    assert_eq!(original.user.as_deref(), Some("local-user"));
    assert_eq!(original.port, 22);
    assert!(matches!(
        effective.provenance["user"],
        Provenance::Group { revision: 1, .. }
    ));
    assert_eq!(effective.provenance["identityFile"], Provenance::Connection);
    assert_eq!(effective.provenance["certificateFile"], Provenance::Default);
}

#[test]
fn missing_or_mismatched_groups_defaults_and_duplicate_fields_fail_closed() {
    let inherit = selection(vec![InheritedField::User], false);
    let mut defaults = group();
    defaults.revision = 1;
    assert!(resolve(&base(), Some(&inherit), None).is_err());
    defaults.id = "other".into();
    assert!(resolve(&base(), Some(&inherit), Some(&defaults)).is_err());
    defaults.id = "production".into();
    defaults.defaults.user = None;
    assert!(resolve(&base(), Some(&inherit), Some(&defaults)).is_err());
    assert!(resolve(
        &base(),
        Some(&selection(
            vec![InheritedField::Port, InheritedField::Port],
            false
        )),
        Some(&defaults)
    )
    .is_err());
}

#[test]
fn public_key_and_certificate_references_have_independent_provenance() {
    let mut defaults = group();
    defaults.revision = 7;
    let effective = resolve(
        &base(),
        Some(&selection(
            vec![
                InheritedField::IdentityFile,
                InheritedField::CertificateFile,
            ],
            false,
        )),
        Some(&defaults),
    )
    .unwrap();
    assert_eq!(
        effective.endpoint.identity_file,
        defaults.defaults.identity_file
    );
    assert_eq!(
        effective.endpoint.certificate_file,
        defaults.defaults.certificate_file
    );
    for name in ["identityFile", "certificateFile"] {
        assert!(matches!(
            effective.provenance[name],
            Provenance::Group { revision: 7, .. }
        ));
    }
    assert_eq!(effective.endpoint.user, base().user);
}

#[test]
fn environment_is_literal_prepared_data_with_shell_scope_and_stable_digest() {
    let mut defaults = group();
    defaults.revision = 1;
    defaults.environment = vec![LiteralEnvironment {
        name: "APP_ENV".into(),
        value: "$(touch owned-marker); $HOME 'quoted' 日本語".into(),
    }];
    let inherit = selection(vec![], true);
    let effective = resolve(&base(), Some(&inherit), Some(&defaults)).unwrap();
    assert_eq!(effective.environment, defaults.environment);
    assert_eq!(effective.shell_kind, Some(RemoteShellKind::Posix));
    assert_eq!(effective.endpoint, base());
    assert_eq!(
        effective.digest,
        resolve(&base(), Some(&inherit), Some(&defaults))
            .unwrap()
            .digest
    );
    defaults.revision = 2;
    assert_ne!(
        effective.digest,
        resolve(&base(), Some(&inherit), Some(&defaults))
            .unwrap()
            .digest
    );
    defaults.revision = 1;
    defaults.shell_kind = Some(RemoteShellKind::Powershell);
    assert_ne!(
        effective.digest,
        resolve(&base(), Some(&inherit), Some(&defaults))
            .unwrap()
            .digest
    );
    let off = resolve(&base(), Some(&selection(vec![], false)), Some(&defaults)).unwrap();
    assert!(off.environment.is_empty());
    assert_eq!(off.shell_kind, None);
}

#[test]
fn loader_secrets_private_material_and_case_collisions_cannot_be_saved() {
    let mut defaults = group();
    for name in [
        "PASSWORD",
        "APP_TOKEN",
        "PRIVATE_KEY",
        "API_KEY",
        "PATH",
        "BASH_ENV",
        "ZDOTDIR",
        "NODE_OPTIONS",
        "PYTHONPATH",
        "SSH_ASKPASS",
        "LD_PRELOAD",
        "DYLD_INSERT_LIBRARIES",
        "BYCODA_SSH_HTTP_PROXY_CAPABILITY",
        "GIT_CONFIG_COUNT",
    ] {
        defaults.environment = vec![LiteralEnvironment {
            name: name.into(),
            value: "literal".into(),
        }];
        assert!(validate(&defaults).is_err(), "{name}");
    }
    for value in [
        "http://user:password@proxy/",
        "-----BEGIN OPENSSH PRIVATE KEY-----",
        "bad\nvalue",
    ] {
        defaults.environment = vec![LiteralEnvironment {
            name: "APP_ENV".into(),
            value: value.into(),
        }];
        assert!(validate(&defaults).is_err());
    }
    defaults.environment = vec![
        LiteralEnvironment {
            name: "APP_ENV".into(),
            value: "one".into(),
        },
        LiteralEnvironment {
            name: "app_env".into(),
            value: "two".into(),
        },
    ];
    assert!(
        validate(&defaults).is_ok(),
        "POSIX variable names are case-sensitive"
    );
    defaults.shell_kind = Some(RemoteShellKind::Powershell);
    assert!(validate(&defaults).is_err());
    defaults.environment.clear();
    defaults.defaults.identity_file = Some("-----BEGIN PRIVATE KEY-----".into());
    assert!(validate(&defaults).is_err());
}

#[test]
fn environment_limits_and_explicit_shell_type_are_enforced() {
    let mut defaults = group();
    defaults.shell_kind = None;
    assert!(validate(&defaults).is_err());
    defaults.shell_kind = Some(RemoteShellKind::Posix);
    defaults.environment = (0..33)
        .map(|index| LiteralEnvironment {
            name: format!("APP_VALUE_{index}"),
            value: "x".into(),
        })
        .collect();
    assert!(validate(&defaults).is_err());
    defaults.environment = (0..5)
        .map(|index| LiteralEnvironment {
            name: format!("APP_VALUE_{index}"),
            value: "x".repeat(4096),
        })
        .collect();
    assert!(validate(&defaults).is_err());
    defaults.environment = vec![LiteralEnvironment {
        name: "APP_ENV".into(),
        value: "x".repeat(4097),
    }];
    assert!(validate(&defaults).is_err());
}

#[test]
fn strict_schema_and_corrupt_saved_rows_never_become_defaults() {
    let mut value = serde_json::to_value(group()).unwrap();
    value["password"] = serde_json::json!("not-accepted");
    assert!(serde_json::from_value::<GroupDefaults>(value).is_err());
    assert!(serde_json::from_value::<Inheritance>(
        serde_json::json!({"groupId":"production","fields":["host"],"environment":false})
    )
    .is_err());
    let connection = Connection::open_in_memory().unwrap();
    migrate(&connection).unwrap();
    let saved = save_cas(&connection, &group(), None).unwrap();
    connection
        .execute(
            "UPDATE ssh_group_defaults SET revision=2 WHERE id=?1",
            params![saved.id],
        )
        .unwrap();
    assert!(get(&connection, "production").is_err());
    connection
        .execute(
            "UPDATE ssh_group_defaults SET value=?1",
            params!["x".repeat(MAX_RECORD_BYTES + 1)],
        )
        .unwrap();
    assert!(list(&connection).is_err());
}

#[test]
fn new_group_references_are_native_absolute_or_explicit_home_without_changing_legacy_endpoints() {
    let mut defaults = group();
    for reference in [
        "id_ed25519",
        "keys/id_ed25519",
        "../key",
        "C:relative",
        "~/",
        "~\\",
        "~other/key",
    ] {
        defaults.defaults.identity_file = Some(reference.into());
        assert!(validate(&defaults).is_err(), "{reference}");
    }
    for reference in ["~/.ssh/id_ed25519", "~\\.ssh\\id_ed25519"] {
        defaults.defaults.identity_file = Some(reference.into());
        assert!(validate(&defaults).is_ok());
    }
    defaults.defaults.identity_file = Some(native_reference("/absolute/key"));
    assert!(validate(&defaults).is_ok());
    let mut legacy = base();
    legacy.identity_file = Some("legacy-relative-key".into());
    assert_eq!(
        resolve(&legacy, None, None).unwrap().endpoint.identity_file,
        legacy.identity_file
    );
}
