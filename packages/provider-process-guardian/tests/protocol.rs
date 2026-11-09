use bycoda_provider_process_guardian::protocol::{
    self, ParentCommand, MAX_DATA_BYTES, MAX_FRAME_BYTES,
};
use serde_json::json;
use std::collections::BTreeMap;
use std::io::Cursor;
use uuid::Uuid;

#[test]
fn frame_limit_includes_newline_and_partial_eof_is_not_a_command() {
    let mut exact = vec![b' '; MAX_FRAME_BYTES - 1];
    exact.push(b'\n');
    assert_eq!(
        protocol::read_frame(&mut Cursor::new(exact))
            .unwrap()
            .unwrap()
            .len(),
        MAX_FRAME_BYTES - 1
    );
    let mut too_large = vec![b' '; MAX_FRAME_BYTES];
    too_large.push(b'\n');
    assert!(protocol::read_frame(&mut Cursor::new(too_large)).is_err());
    assert!(protocol::read_frame(&mut Cursor::new(b"{}".to_vec())).is_err());
    assert!(protocol::read_frame(&mut Cursor::new(b"\n".to_vec())).is_err());
    assert!(protocol::read_frame(&mut Cursor::new(Vec::<u8>::new()))
        .unwrap()
        .is_none());
}

#[test]
fn closed_commands_reject_duplicate_unknown_and_malformed_identity_fields() {
    let guardian = Uuid::new_v4().to_string();
    let parent = Uuid::new_v4().to_string();
    let owner = Uuid::new_v4().to_string();
    let valid = json!({"kind":"stop","version":1,"guardianId":guardian,"parentId":parent,"ownerId":owner,"id":1});
    let parse =
        |value: serde_json::Value| protocol::read_command(&mut Cursor::new(format!("{value}\n")));
    assert!(matches!(
        parse(valid.clone()).unwrap(),
        Some(ParentCommand::Stop { id: 1, .. })
    ));
    let mut unknown = valid.clone();
    unknown["pid"] = json!(123);
    assert!(parse(unknown).is_err());
    let mut malformed = valid.clone();
    malformed["ownerId"] = json!("11111111-1111-1111-8111-111111111111");
    assert!(parse(malformed).is_err());
    let duplicate = format!("{{\"kind\":\"stop\",\"version\":1,\"version\":1,\"guardianId\":\"{guardian}\",\"parentId\":\"{parent}\",\"ownerId\":\"{owner}\",\"id\":1}}\n");
    assert!(protocol::read_command(&mut Cursor::new(duplicate)).is_err());
}

#[test]
fn provider_bytes_are_canonical_bounded_and_lossless() {
    let data: Vec<u8> = (0..MAX_DATA_BYTES)
        .map(|index| (index % 256) as u8)
        .collect();
    assert_eq!(
        protocol::decode_data(&protocol::encode_data(&data)).unwrap(),
        data
    );
    assert!(protocol::decode_data(&protocol::encode_data(&vec![0; MAX_DATA_BYTES + 1])).is_err());
    assert!(protocol::decode_data("A===").is_err());
    assert!(protocol::decode_data("Zg").is_err());
}

#[test]
fn launch_validation_keeps_exact_arguments_and_environment_with_no_control_locators() {
    let executable = std::env::current_exe()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let cwd = std::env::current_dir()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let mut env = BTreeMap::from([("FIXTURE_VALUE".into(), "spaces = and unicode λ".into())]);
    let args = vec!["an argument with spaces".into()];
    assert!(protocol::valid_start(&executable, &args, &cwd, &env));
    assert!(!protocol::valid_start(
        "relative-provider",
        &args,
        &cwd,
        &env
    ));
    assert!(!protocol::valid_start(
        &executable,
        &["bad\0argument".into()],
        &cwd,
        &env
    ));
    env.insert("bad=key".into(), "value".into());
    assert!(!protocol::valid_start(&executable, &args, &cwd, &env));
}
