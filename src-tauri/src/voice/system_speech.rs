//! System voice replies rendered to audio instead of played by the OS.
//!
//! The webview's `speechSynthesis` always plays on the default output device. Rendering the
//! same installed voices to WAV lets the companion play them through an `AudioContext` routed
//! to the owner's chosen audio output. Windows only; other platforms report unsupported and
//! the webview keeps `speechSynthesis`.

const MAX_TEXT_CHARS: usize = 2_000;

fn validate(text: &str, language: &str) -> Result<(), String> {
    if text.trim().is_empty() || text.chars().count() > MAX_TEXT_CHARS {
        return Err("Speech text must be 1 to 2000 characters.".into());
    }
    if !(language.is_empty()
        || (language.len() == 2 && language.bytes().all(|byte| byte.is_ascii_lowercase())))
    {
        return Err("Speech language must be a two-letter code.".into());
    }
    Ok(())
}

/// WAV bytes of `text` spoken by an installed voice for `language` (or the system voice).
#[tauri::command]
pub async fn voice_system_speech(
    text: String,
    language: String,
) -> Result<tauri::ipc::Response, String> {
    validate(&text, &language)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || synthesize(&text, &language))
        .await
        .map_err(|error| error.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(windows)]
fn synthesize(text: &str, language: &str) -> Result<Vec<u8>, String> {
    use windows::core::HSTRING;
    use windows::Media::SpeechSynthesis::SpeechSynthesizer;
    use windows::Storage::Streams::DataReader;

    let run = || -> windows::core::Result<Vec<u8>> {
        let synthesizer = SpeechSynthesizer::new()?;
        if !language.is_empty() {
            let voices = SpeechSynthesizer::AllVoices()?;
            for index in 0..voices.Size()? {
                let voice = voices.GetAt(index)?;
                let tag = voice.Language()?.to_string_lossy().to_ascii_lowercase();
                if tag.split('-').next() == Some(language) {
                    synthesizer.SetVoice(&voice)?;
                    break;
                }
            }
        }
        let stream = synthesizer
            .SynthesizeTextToStreamAsync(&HSTRING::from(text))?
            .join()?;
        let size = u32::try_from(stream.Size()?).unwrap_or(u32::MAX);
        let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0)?)?;
        let loaded = reader.LoadAsync(size)?.join()?;
        let mut bytes = vec![0u8; loaded as usize];
        reader.ReadBytes(&mut bytes)?;
        Ok(bytes)
    };
    run().map_err(|error| error.message())
}

#[cfg(not(windows))]
fn synthesize(_text: &str, _language: &str) -> Result<Vec<u8>, String> {
    Err("Rendering the system voice is not supported on this platform.".into())
}

#[cfg(test)]
mod tests {
    use super::validate;

    #[test]
    fn rejects_empty_long_text_and_malformed_languages() {
        assert!(validate("Hello", "en").is_ok());
        assert!(validate("Hello", "").is_ok());
        assert!(validate("  ", "en").is_err());
        assert!(validate(&"a".repeat(2_001), "en").is_err());
        assert!(validate("Hello", "EN").is_err());
        assert!(validate("Hello", "en-US").is_err());
    }

    /// Needs an installed Windows voice: `cargo test --lib voice_system_speech -- --ignored`.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn renders_installed_voice_to_wav() {
        let wav = super::synthesize("Hello", "en").expect("synthesis");
        assert_eq!(&wav[..4], b"RIFF");
        assert!(wav.len() > 1_000);
    }
}
