use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ring::{
    aead,
    rand::{SecureRandom, SystemRandom},
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::Path;

const PREFIX: &str = "sealed:v1:";
const ERROR: &str = "The system credential store could not protect the saved connections.";

/// The record fields that hold a secret: the device token and the seed of its proof key.
const SECRET_FIELDS: [&str; 2] = ["token", "proofSeed"];

fn secret<'a>(record: &'a Value, field: &str) -> Option<&'a str> {
    if record["kind"] == "ssh" {
        return None;
    }
    record[field].as_str().filter(|value| !value.is_empty())
}

pub(super) fn has_legacy_tokens(records: &[Value]) -> bool {
    records.iter().any(|record| {
        SECRET_FIELDS
            .iter()
            .any(|field| secret(record, field).is_some_and(|value| !value.starts_with(PREFIX)))
    })
}

#[cfg(not(test))]
fn key(path: &Path, create: bool) -> Result<aead::LessSafeKey, String> {
    let scope = URL_SAFE_NO_PAD.encode(Sha256::digest(path.as_os_str().as_encoded_bytes()));
    let entry =
        keyring::Entry::new("codes.bycoda.remote-connections", &scope).map_err(|_| ERROR)?;
    let bytes = match entry.get_password() {
        Ok(value) => URL_SAFE_NO_PAD.decode(value).map_err(|_| ERROR)?,
        Err(keyring::Error::NoEntry) if create => {
            let mut bytes = vec![0; 32];
            SystemRandom::new().fill(&mut bytes).map_err(|_| ERROR)?;
            entry
                .set_password(&URL_SAFE_NO_PAD.encode(&bytes))
                .map_err(|_| ERROR)?;
            bytes
        }
        _ => return Err(ERROR.into()),
    };
    make_key(&bytes)
}

#[cfg(test)]
fn key(path: &Path, _create: bool) -> Result<aead::LessSafeKey, String> {
    make_key(&Sha256::digest(path.as_os_str().as_encoded_bytes()))
}

fn make_key(bytes: &[u8]) -> Result<aead::LessSafeKey, String> {
    aead::UnboundKey::new(&aead::AES_256_GCM, bytes)
        .map(aead::LessSafeKey::new)
        .map_err(|_| ERROR.into())
}

/// The token's context is unchanged from before other fields were sealed; every other field adds
/// its name, so a sealed value cannot be moved into another field.
fn binding(record: &Value, field: &str) -> Result<Vec<u8>, String> {
    let mut fields = vec![&record["id"], &record["endpoint"], &record["environmentId"]];
    let name = Value::String(field.to_owned());
    if field != "token" {
        fields.push(&name);
    }
    serde_json::to_vec(&fields).map_err(|_| ERROR.into())
}

pub(super) fn seal(path: &Path, records: &mut [Value], create: bool) -> Result<(), String> {
    if !has_legacy_tokens(records) {
        return Ok(());
    }
    let key = key(path, create)?;
    for record in records {
        for field in SECRET_FIELDS {
            let Some(value) = secret(record, field).filter(|value| !value.starts_with(PREFIX))
            else {
                continue;
            };
            let binding = binding(record, field)?;
            let mut nonce = [0; aead::NONCE_LEN];
            SystemRandom::new().fill(&mut nonce).map_err(|_| ERROR)?;
            let mut encrypted = value.as_bytes().to_vec();
            key.seal_in_place_append_tag(
                aead::Nonce::assume_unique_for_key(nonce),
                aead::Aad::from(&binding),
                &mut encrypted,
            )
            .map_err(|_| ERROR)?;
            let mut payload = nonce.to_vec();
            payload.extend(encrypted);
            record[field] = Value::String(format!("{PREFIX}{}", URL_SAFE_NO_PAD.encode(payload)));
        }
    }
    Ok(())
}

pub(super) fn open(path: &Path, records: &mut [Value]) -> Result<(), String> {
    let mut key = None;
    for record in records {
        for field in SECRET_FIELDS {
            let Some(encoded) = secret(record, field).and_then(|value| value.strip_prefix(PREFIX))
            else {
                continue;
            };
            let mut payload = URL_SAFE_NO_PAD.decode(encoded).map_err(|_| ERROR)?;
            let (nonce, encrypted) = payload.split_at_mut_checked(aead::NONCE_LEN).ok_or(ERROR)?;
            let nonce = aead::Nonce::try_assume_unique_for_key(nonce).map_err(|_| ERROR)?;
            let binding = binding(record, field)?;
            if key.is_none() {
                key = Some(self::key(path, false)?);
            }
            let plain = key
                .as_ref()
                .ok_or(ERROR)?
                .open_in_place(nonce, aead::Aad::from(&binding), encrypted)
                .map_err(|_| ERROR)?;
            record[field] =
                Value::String(std::str::from_utf8(plain).map_err(|_| ERROR)?.to_owned());
        }
    }
    Ok(())
}

pub(super) fn has_sealed_tokens(records: &[Value]) -> bool {
    records.iter().any(|record| {
        SECRET_FIELDS
            .iter()
            .any(|field| secret(record, field).is_some_and(|value| value.starts_with(PREFIX)))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn seals_legacy_tokens_and_preserves_ssh_only_records() {
        let path = Path::new("machines.json");
        let original = [
            json!({"id": "host", "endpoint": "https://host.test", "environmentId": "env", "token": "private-key", "proofSeed": "private-seed"}),
            json!({"id": "ssh", "kind": "ssh"}),
        ];
        let mut protected = original.clone();
        assert!(has_legacy_tokens(&protected));
        seal(path, &mut protected, true).unwrap();
        assert!(!has_legacy_tokens(&protected));
        assert!(has_sealed_tokens(&protected));
        assert!(!protected[0].to_string().contains("private-key"));
        assert!(!protected[0].to_string().contains("private-seed"));
        // A sealed seed cannot be moved into the token field.
        let mut swapped = protected.clone();
        swapped[0]["token"] = swapped[0]["proofSeed"].clone();
        assert!(open(path, &mut swapped).is_err());
        assert_eq!(protected[1], original[1]);
        let mut relocated = protected.clone();
        relocated[0]["id"] = json!("another-host");
        assert!(open(path, &mut relocated).is_err());
        let mut redirected = protected.clone();
        redirected[0]["endpoint"] = json!("https://another-host.test");
        assert!(open(path, &mut redirected).is_err());
        open(path, &mut protected).unwrap();
        assert_eq!(protected, original);
    }
}
