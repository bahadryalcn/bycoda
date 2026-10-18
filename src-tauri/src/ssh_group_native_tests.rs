//! Explicit disposable SSH acceptance; never opens the owner's application DB.
use super::*;
use crate::ssh_group_defaults as groups;
use base64::{engine::general_purpose::STANDARD, Engine as _};

#[test]
#[ignore = "Starts one disposable owned sshd with synthetic keys; requires installed Git Bash and PowerShell 7"]
fn actual_inherited_route_and_literal_environment_are_review_bound() {
    let base = PathBuf::from(std::env::var("BYCODA_JUMP_FIXTURE_ROOT").unwrap());
    assert!(base.is_absolute() && config_path(&base).contains("/temp/verification/"));
    let root = base.join(format!("group-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let user = std::env::var("USERNAME").unwrap();
    let client = key(&root, "client");
    let host = key(&root, "host");
    let (_daemon, target_port, trust) = server(&root, 0, &client, &host, &user);
    let connection = rusqlite::Connection::open_in_memory().unwrap();
    groups::migrate(&connection).unwrap();
    let saved_endpoint = crate::ssh_security::SshEndpoint {
        host: "127.0.0.1".into(),
        user: Some("must-be-overridden".into()),
        port: 9,
        identity_file: Some(config_path(&root.join("missing-key"))),
        ..Default::default()
    };
    let inheritance = groups::Inheritance {
        group_id: "owned-fixture".into(),
        fields: vec![
            groups::InheritedField::User,
            groups::InheritedField::Port,
            groups::InheritedField::IdentityFile,
        ],
        environment: true,
    };
    let local_before = std::env::var_os("APP_BYCODA_FIXTURE_LITERAL");
    for (index, shell) in [
        groups::RemoteShellKind::Posix,
        groups::RemoteShellKind::Powershell,
    ]
    .into_iter()
    .enumerate()
    {
        let sentinel = root.join(format!("must-not-exist-{index}"));
        let literal = match shell {
            groups::RemoteShellKind::Posix => format!(
                "$(touch '{}') $HOME 'single' \"double\" Unicode İ🙂",
                config_path(&sentinel)
            ),
            groups::RemoteShellKind::Powershell => format!(
                "$(New-Item -ItemType File -Path '{}') $HOME 'single' \"double\" Unicode İ🙂",
                config_path(&sentinel)
            ),
        };
        let mut group = groups::GroupDefaults {
            id: "owned-fixture".into(),
            revision: 0,
            name: "Disposable fixture".into(),
            defaults: groups::ConnectionDefaults {
                user: Some(user.clone()),
                port: Some(target_port),
                identity_file: Some(config_path(&client)),
                certificate_file: None,
            },
            environment: vec![groups::LiteralEnvironment {
                name: "APP_BYCODA_FIXTURE_LITERAL".into(),
                value: literal.clone(),
            }],
            shell_kind: Some(shell),
        };
        if index > 0 {
            let old = groups::get(&connection, "owned-fixture").unwrap().unwrap();
            group.revision = old.revision;
        }
        let expected = (index > 0).then_some(group.revision);
        let group = groups::save_cas(&connection, &group, expected).unwrap();
        let effective = groups::resolve(&saved_endpoint, Some(&inheritance), Some(&group)).unwrap();
        assert_eq!(effective.endpoint.user.as_deref(), Some(user.as_str()));
        assert_eq!(effective.endpoint.port, target_port);
        assert_eq!(
            effective.endpoint.identity_file.as_deref(),
            Some(config_path(&client).as_str())
        );
        assert!(
            matches!(effective.provenance["identityFile"], groups::Provenance::Group { revision, .. } if revision == group.revision)
        );
        let reviewed_digest = effective.digest.clone();
        let endpoint = crate::ssh_configuration::runtime_endpoint(effective);
        crate::ssh_terminal::validate_configuration_review(&endpoint, Some(&reviewed_digest), None)
            .unwrap();
        assert!(crate::ssh_terminal::validate_configuration_review(&endpoint, None, None).is_err());

        let mut command = Command::new("ssh.exe");
        command
            .args(["-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o"])
            .arg(format!("UserKnownHostsFile={}", config_path(&trust)))
            .args(crate::ssh_security::connection_args(&endpoint).unwrap())
            .args(["--", "127.0.0.1"]);
        let output = match shell {
            groups::RemoteShellKind::Posix => {
                // Windows sshd's default shell is cmd.exe, not POSIX. Exercise
                // the production literal formatter in an explicit no-profile
                // remote Bash, without pretending its raw `sh -c` route applies.
                command.arg("\"C:/Program Files/Git/bin/bash.exe\" --noprofile --norc -s");
                let mut input =
                    crate::ssh_environment::prologue(&group.environment, shell).unwrap();
                input.push_str("printf 'BYCODA_ENV='; printf '%s' \"$APP_BYCODA_FIXTURE_LITERAL\" | base64 -w0; printf '\\n'; exit\n");
                bounded_input(&mut command, Some(input.as_bytes()))
            }
            groups::RemoteShellKind::Powershell => {
                // Preserve the production wrapper/encoding, replacing only
                // interactive lifetime with a deterministic one-shot probe.
                let production = crate::ssh_environment::remote_command(&endpoint, None)
                    .unwrap()
                    .unwrap();
                let one_shot = production.replacen("-NoExit", "-NonInteractive -NoProfile", 1);
                let prefix = one_shot.strip_suffix('"').unwrap();
                command.arg(format!("{prefix};[Console]::WriteLine(('BYCODA_ENV='+[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($env:APP_BYCODA_FIXTURE_LITERAL))))\""));
                bounded(&mut command)
            }
        };
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            String::from_utf8_lossy(&output.stdout).contains(&format!(
                "BYCODA_ENV={}",
                STANDARD.encode(literal.as_bytes())
            )),
            "Literal environment roundtrip failed: {}",
            String::from_utf8_lossy(&output.stdout)
        );
        assert!(!sentinel.exists(), "Literal data was evaluated as code");
        assert_eq!(std::env::var_os("APP_BYCODA_FIXTURE_LITERAL"), local_before);
        assert_eq!(saved_endpoint.port, 9);
        assert_eq!(saved_endpoint.user.as_deref(), Some("must-be-overridden"));

        let mut changed = group.clone();
        changed.environment[0].value.push_str(" changed");
        let changed = groups::save_cas(&connection, &changed, Some(group.revision)).unwrap();
        let fresh = groups::resolve(&saved_endpoint, Some(&inheritance), Some(&changed)).unwrap();
        assert_ne!(fresh.digest, reviewed_digest);
        let changed_endpoint = crate::ssh_configuration::runtime_endpoint(fresh);
        assert!(crate::ssh_terminal::validate_configuration_review(
            &changed_endpoint,
            Some(&reviewed_digest),
            None
        )
        .is_err());
    }
}
