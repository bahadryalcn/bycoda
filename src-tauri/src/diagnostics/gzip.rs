use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use flate2::write::GzEncoder;
use flate2::Compression;
use std::io::Write;

/// The contract's `DIAGNOSTIC_TEXT_MAX_CHARS` (1,000,000) times four bytes per character.
pub(super) const MAX_INPUT_BYTES: usize = 4_000_000;

/// Gzips `text` and returns it as standard base64, for webviews without `CompressionStream`.
pub(super) fn gzip_base64(text: &str) -> Result<String, String> {
    if text.len() > MAX_INPUT_BYTES {
        return Err("The log text is too large to compress.".into());
    }
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(text.as_bytes())
        .map_err(|error| error.to_string())?;
    let bytes = encoder.finish().map_err(|error| error.to_string())?;
    Ok(STANDARD.encode(bytes))
}
