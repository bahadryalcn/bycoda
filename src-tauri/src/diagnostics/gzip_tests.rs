use super::gzip::{gzip_base64, MAX_INPUT_BYTES};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use flate2::read::GzDecoder;
use std::io::Read;

#[test]
fn output_gunzips_back_to_the_input() {
    let text = "2026-11-09T10:00:00.000Z INFO  [app] hello \u{1F600}\n".repeat(50);
    let encoded = gzip_base64(&text).unwrap();
    let bytes = STANDARD.decode(encoded).unwrap();
    let mut back = String::new();
    GzDecoder::new(bytes.as_slice())
        .read_to_string(&mut back)
        .unwrap();
    assert_eq!(back, text);
}

#[test]
fn input_over_the_cap_is_refused() {
    assert!(gzip_base64(&"x".repeat(MAX_INPUT_BYTES + 1)).is_err());
}
