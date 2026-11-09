use super::*;
use serde_json::json;

fn parse(value: Value) -> Result<EmailConfig, String> {
    EmailConfig::parse(&value)
}

#[test]
fn gmail_preset_fills_servers_and_username() {
    let config =
        parse(json!({ "preset": "gmail", "address": " ada@gmail.com ", "displayName": " Ada " }))
            .unwrap();
    assert_eq!(config.address, "ada@gmail.com");
    assert_eq!(config.username, "ada@gmail.com");
    assert_eq!(config.display_name, "Ada");
    assert_eq!(
        config.imap,
        Server {
            host: "imap.gmail.com".into(),
            port: 993,
            security: Security::Tls
        }
    );
    assert_eq!(
        config.smtp,
        Server {
            host: "smtp.gmail.com".into(),
            port: 465,
            security: Security::Tls
        }
    );
    assert_eq!(config.auth, AuthKind::Google);
}

#[test]
fn presets_are_inferred_from_the_domain() {
    let outlook = parse(json!({ "address": "ada@hotmail.com" })).unwrap();
    assert_eq!(outlook.preset, "outlook");
    assert_eq!(outlook.auth, AuthKind::Microsoft);
    assert_eq!(
        outlook.smtp,
        Server {
            host: "smtp.office365.com".into(),
            port: 587,
            security: Security::StartTls
        }
    );
    let icloud = parse(json!({ "address": "ada@me.com" })).unwrap();
    assert_eq!(icloud.preset, "icloud");
    assert_eq!(icloud.smtp.security, Security::StartTls);
    assert_eq!(icloud.imap.host, "imap.mail.me.com");
    let yahoo = parse(json!({ "address": "ada@yahoo.co.uk" })).unwrap();
    assert_eq!(yahoo.smtp.host, "smtp.mail.yahoo.com");
    assert_eq!(
        parse(json!({ "address": "ada@example.org" })).unwrap_err(),
        "Enter the IMAP server."
    );
}

#[test]
fn custom_requires_servers_and_ports() {
    let base =
        json!({ "preset": "custom", "address": "ada@example.org", "imapHost": "Mail.Example.org" });
    assert!(parse(base.clone()).unwrap_err().contains("IMAP port"));
    let config = parse(json!({
        "preset": "custom", "address": "ada@example.org", "username": "ada",
        "imapHost": "Mail.Example.org", "imapPort": "993",
        "smtpHost": "smtp.example.org", "smtpPort": 587,
    }))
    .unwrap();
    assert_eq!(
        config.imap,
        Server {
            host: "mail.example.org".into(),
            port: 993,
            security: Security::Tls
        }
    );
    assert_eq!(config.smtp.security, Security::StartTls);
    assert_eq!(config.username, "ada");
}

#[test]
fn rejects_invalid_values() {
    let with = |key: &str, value: Value| {
        let mut config = json!({ "preset": "gmail", "address": "ada@gmail.com" });
        config[key] = value;
        parse(config)
    };
    for port in [json!(0), json!(70000), json!("abc"), json!(-1), json!(true)] {
        assert!(with("imapPort", port).unwrap_err().contains("port"));
    }
    for host in [
        "https://imap.gmail.com",
        "imap gmail.com",
        "imap.gmail.com/path",
        "-bad.host",
    ] {
        assert!(
            with("imapHost", json!(host))
                .unwrap_err()
                .contains("host name"),
            "{host}"
        );
    }
    assert!(with("imapSecurity", json!("none")).is_err());
    assert!(with("auth", json!("oauth")).is_err());
    assert!(with("auth", json!("microsoft"))
        .unwrap_err()
        .contains("Microsoft"));
    assert!(with("displayName", json!("Ada\r\nBcc: x")).is_err());
    assert!(with("clientId", json!("not a guid!")).is_err());
    assert!(with("preset", json!("aol")).is_err());
    for address in [
        "",
        "   ",
        "ada",
        "ada@",
        "@gmail.com",
        "a da@gmail.com",
        "ada@gm\r\nail.com",
        "<ada@gmail.com>",
    ] {
        assert!(
            parse(json!({ "preset": "gmail", "address": address })).is_err(),
            "{address:?}"
        );
    }
    assert!(parse(json!("text")).is_err());
}

#[test]
fn normalized_value_is_camel_case_and_round_trips() {
    let config = parse(json!({
        "preset": "outlook", "address": "ada@contoso.com", "clientId": "1234-abcd",
    }))
    .unwrap();
    let value = config.to_value();
    assert_eq!(value["imapHost"], "outlook.office365.com");
    assert_eq!(value["smtpSecurity"], "starttls");
    assert_eq!(value["auth"], "microsoft");
    assert_eq!(value["clientId"], "1234-abcd");
    assert_eq!(value["displayName"], "");
    assert_eq!(EmailConfig::parse(&value).unwrap(), config);
    let gmail = parse(json!({ "preset": "gmail", "address": "ada@gmail.com" }))
        .unwrap()
        .to_value();
    assert!(gmail.get("clientId").is_none());
}

#[test]
fn sasl_strings_match_the_wire_format() {
    let decode = |value: String| {
        base64::engine::general_purpose::STANDARD
            .decode(value)
            .unwrap()
    };
    assert_eq!(
        decode(xoauth2("ada@contoso.com", "tok")),
        b"user=ada@contoso.com\x01auth=Bearer tok\x01\x01"
    );
    assert_eq!(
        decode(sasl_plain("ada", "pässword")),
        "\0ada\0pässword".as_bytes()
    );
}

#[test]
fn password_credential_requires_a_password() {
    let config =
        parse(json!({ "preset": "gmail", "address": "ada@gmail.com", "auth": "password" }))
            .unwrap();
    let mut secret = Secret::new();
    assert!(Credential::load(&config, &mut secret).is_err());
    secret.insert("password".into(), json!("app-password"));
    match Credential::load(&config, &mut secret).unwrap() {
        Credential::Password { user, password } => {
            assert_eq!(user, "ada@gmail.com");
            assert_eq!(password, "app-password");
        }
        Credential::OAuth { .. } => panic!("expected a password"),
    }
    let microsoft = parse(json!({ "preset": "outlook", "address": "ada@outlook.com" })).unwrap();
    assert!(Credential::load(&microsoft, &mut Secret::new())
        .err()
        .unwrap()
        .contains("Microsoft"));
    let google = parse(json!({ "preset": "gmail", "address": "ada@gmail.com" })).unwrap();
    assert!(Credential::load(&google, &mut Secret::new())
        .err()
        .unwrap()
        .contains("Google"));
    assert!(
        parse(json!({ "preset": "yahoo", "address": "ada@yahoo.com", "auth": "google" })).is_err()
    );
}

#[test]
fn hints_name_app_passwords() {
    let gmail = parse(json!({ "preset": "gmail", "address": "ada@gmail.com", "auth": "password" }))
        .unwrap();
    assert!(gmail.sign_in_hint().contains("app password"));
    let google = parse(json!({ "preset": "gmail", "address": "ada@gmail.com" })).unwrap();
    assert!(google.sign_in_hint().contains("Google"));
}
