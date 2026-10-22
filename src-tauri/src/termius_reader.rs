//! Read-only Termius desktop migration. No Termius code is executed, no network is used,
//! and secrets never leave this module in a serializable value.
use base64::{engine::general_purpose::STANDARD, Engine};
use chromium_storage_indexeddb_core::{IndexedDbRecord, RecordValue, V8Value};
use crypto_secretbox::{
    aead::{Aead, KeyInit},
    Nonce, XSalsa20Poly1305,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
    collections::{BTreeMap, HashMap},
    path::{Path, PathBuf},
};
use zeroize::Zeroizing;

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Endpoint {
    pub host: String,
    pub user: Option<String>,
    pub port: u16,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostPreview {
    pub source_id: String,
    pub name: String,
    pub endpoint: Endpoint,
    pub group: Option<String>,
    pub tags: Vec<String>,
    pub has_key: bool,
    pub needs_password: bool,
    pub requires_review: bool,
    pub warnings: Vec<String>,
}

pub struct Candidate {
    pub preview: HostPreview,
    pub key: Option<Zeroizing<String>>,
}

pub struct Scan {
    pub hosts: Vec<Candidate>,
    pub warnings: Vec<String>,
}

pub fn default_profile() -> Result<PathBuf, String> {
    #[cfg(windows)]
    let base = std::env::var_os("APPDATA").map(PathBuf::from);
    #[cfg(target_os = "macos")]
    let base =
        std::env::var_os("HOME").map(|p| PathBuf::from(p).join("Library/Application Support"));
    #[cfg(not(any(windows, target_os = "macos")))]
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|p| PathBuf::from(p).join(".config")));
    base.map(|p| p.join("Termius"))
        .ok_or_else(|| "Could not find the Termius profile folder".into())
}

// Only file metadata is returned. Comparing it before and after reading rejects a changing
// profile instead of quietly mixing generations. Never open LevelDB as a writable database.
fn inventory(path: &Path) -> Result<BTreeMap<PathBuf, (u64, std::time::SystemTime)>, String> {
    let mut out = BTreeMap::new();
    let mut total = 0u64;
    for entry in
        std::fs::read_dir(path).map_err(|_| "Termius data not found. Choose its profile folder.")?
    {
        let entry = entry.map_err(|_| "Could not read Termius data")?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !(name.ends_with(".ldb")
            || name.ends_with(".sst")
            || name.ends_with(".log")
            || name == "CURRENT"
            || name.starts_with("MANIFEST-"))
        {
            continue;
        }
        let meta = entry
            .metadata()
            .map_err(|_| "Could not read Termius data")?;
        if entry
            .file_type()
            .map_err(|_| "Could not read Termius data")?
            .is_symlink()
        {
            return Err("Termius data must not contain symbolic links".into());
        }
        if !meta.is_file() {
            continue;
        }
        total = total.saturating_add(meta.len());
        if total > 128 * 1024 * 1024 || out.len() >= 1024 {
            return Err("Termius data exceeds the migration size limit".into());
        }
        out.insert(
            entry.path(),
            (
                meta.len(),
                meta.modified().map_err(|_| "Could not read Termius data")?,
            ),
        );
    }
    Ok(out)
}

fn json(value: V8Value, depth: usize) -> Result<Value, String> {
    if depth > 32 {
        return Err("Termius record is nested too deeply".into());
    }
    Ok(match value {
        V8Value::Null | V8Value::Undefined => Value::Null,
        V8Value::Bool(v) => Value::Bool(v),
        V8Value::Int(v) => v.into(),
        V8Value::Double(v) => serde_json::Number::from_f64(v)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        V8Value::String(v) => Value::String(v),
        V8Value::Array(v) => Value::Array(
            v.into_iter()
                .map(|v| json(v, depth + 1))
                .collect::<Result<_, _>>()?,
        ),
        V8Value::Object(v) => Value::Object(
            v.into_iter()
                .map(|(k, v)| Ok((k, json(v, depth + 1)?)))
                .collect::<Result<Map<_, _>, String>>()?,
        ),
        _ => return Err("Unsupported Termius record value. Update the migration reader.".into()),
    })
}

type Tables = HashMap<String, Vec<Value>>;
const TABLES: &[&str] = &[
    "hosts",
    "groups",
    "tags",
    "tag_hosts",
    "ssh_configs",
    "ssh_identities",
    "keys",
];

// Chromium's IndexedDB value wrapper is separate from LevelDB block compression.
// See blink/renderer/modules/indexeddb/idb_value_wrapping.cc: FF 11 02 precedes
// a raw (not framed) Snappy stream; FF 11 01 references an external blob.
fn record_value(value: RecordValue, remaining: &mut usize) -> Result<V8Value, String> {
    match value {
        RecordValue::V8(value) => Ok(value),
        RecordValue::Undecoded { raw, .. } => {
            if raw.starts_with(&[0xff, 0x11, 0x01]) {
                return Err("Termius stores this record in an external file that this importer cannot read. No records were imported.".into());
            }
            let Some(compressed) = raw.strip_prefix(&[0xff, 0x11, 0x02]) else {
                return Err(
                    "A Termius record could not be decoded. No records were imported.".into(),
                );
            };
            let length = snap::raw::decompress_len(compressed)
                .map_err(|_| "A compressed Termius record is invalid. No records were imported.")?;
            if length > 8 * 1024 * 1024 || length > *remaining {
                return Err("Termius data exceeds the migration size limit".into());
            }
            *remaining -= length;
            let bytes = Zeroizing::new(
                snap::raw::Decoder::new()
                    .decompress_vec(compressed)
                    .map_err(|_| {
                        "A compressed Termius record is invalid. No records were imported."
                    })?,
            );
            blob_decoder::v8_value::deserialize_blink(&bytes).map_err(|_| {
                "A Termius record could not be decoded. No records were imported.".into()
            })
        }
    }
}

fn current_records(records: Vec<IndexedDbRecord>) -> Result<Tables, String> {
    let mut latest = HashMap::new();
    for record in records {
        if !record
            .database
            .as_deref()
            .is_some_and(|n| TABLES.contains(&n))
        {
            continue;
        }
        let key = (
            record.database_id,
            record.object_store_id,
            format!("{:?}", record.key),
        );
        if latest
            .get(&key)
            .is_none_or(|old: &IndexedDbRecord| old.seq < record.seq)
        {
            latest.insert(key, record);
        }
    }
    let mut by_entity: HashMap<(String, String), (Value, u64)> = HashMap::new();
    let mut remaining = 128 * 1024 * 1024;
    for record in latest.into_values().filter(|r| !r.deleted) {
        let value = record_value(record.value, &mut remaining)?;
        let value = json(value, 0)?;
        if !value.is_object() {
            continue;
        }
        let id = entity(&value);
        if id.is_empty() {
            return Err("Termius record has no stable identifier".into());
        }
        let key = (record.database.unwrap_or_default(), id);
        let newer = by_entity.get(&key).is_none_or(|(old, seq)| {
            (scalar(&value["updated_at"]), record.seq) > (scalar(&old["updated_at"]), *seq)
        });
        if newer {
            by_entity.insert(key, (value, record.seq));
        }
    }
    let mut tables = Tables::new();
    for ((table, _), (value, _)) in by_entity {
        tables.entry(table).or_default().push(value);
    }
    Ok(tables)
}

fn scalar(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}
fn entity(v: &Value) -> String {
    if !v["id"].is_null() {
        format!("id:{}", scalar(&v["id"]))
    } else if !v["local_id"].is_null() {
        format!("local:{}", scalar(&v["local_id"]))
    } else {
        String::new()
    }
}
fn resolve<'a>(reference: &Value, table: &'a [Value]) -> Option<&'a Value> {
    if reference.is_null() {
        return None;
    }
    table.iter().find(|row| {
        if reference.is_object() {
            (!reference["id"].is_null() && row["id"] == reference["id"])
                || (!reference["local_id"].is_null() && row["local_id"] == reference["local_id"])
        } else {
            row["id"] == *reference || row["local_id"] == *reference
        }
    })
}

fn decrypt(value: &Value, cipher: &XSalsa20Poly1305) -> Result<String, String> {
    let text = scalar(value);
    let Ok(raw) = STANDARD.decode(&text) else {
        return Ok(text);
    };
    if raw.starts_with(&[4, 1]) {
        if raw.len() < 42 {
            return Err("Invalid encrypted Termius field".into());
        }
        let plain = Zeroizing::new(
            cipher
                .decrypt(Nonce::from_slice(&raw[2..26]), &raw[26..])
                .map_err(|_| "Termius data could not be decrypted with this account's local key")?,
        );
        String::from_utf8(plain.to_vec()).map_err(|_| "Invalid text in Termius data".into())
    } else if raw.len() >= 42 && raw[0] == 4 {
        Err("Unsupported Termius encryption version. No records were imported.".into())
    } else {
        Ok(text)
    }
}

fn normalize(tables: Tables, key: &[u8]) -> Result<Scan, String> {
    let cipher = XSalsa20Poly1305::new_from_slice(key).map_err(|_| "Invalid Termius local key")?;
    let rows = |name: &str| tables.get(name).map(Vec::as_slice).unwrap_or(&[]);
    let nil = Value::Null;
    let mut hosts = Vec::new();
    for row in rows("hosts") {
        if row["deleted"].as_bool() == Some(true) || !row["deleted_at"].is_null() {
            continue;
        }
        let cfg = resolve(&row["ssh_config"], rows("ssh_configs")).unwrap_or(&nil);
        let ident = resolve(
            if cfg["identity"].is_null() {
                &row["identity"]
            } else {
                &cfg["identity"]
            },
            rows("ssh_identities"),
        )
        .unwrap_or(&nil);
        let key_row = resolve(&ident["ssh_key"], rows("keys")).unwrap_or(&nil);
        let mut host = decrypt(&row["address"], &cipher)?;
        if let Ok(ip) = host.parse::<u32>() {
            host = std::net::Ipv4Addr::from(ip).to_string();
        }
        let name = decrypt(&row["label"], &cipher)?;
        let name = if name.trim().is_empty() {
            host.clone()
        } else {
            name
        };
        let user = decrypt(&ident["username"], &cipher)?;
        let port_text = decrypt(&cfg["port"], &cipher)?;
        let port = if port_text.is_empty() {
            22
        } else {
            port_text
                .parse::<u16>()
                .map_err(|_| "Invalid SSH port in Termius")?
        };
        let group_row = resolve(&row["group"], rows("groups")).unwrap_or(&nil);
        let group = decrypt(&group_row["label"], &cipher)?;
        let mut tags = Vec::new();
        for link in rows("tag_hosts") {
            if resolve(&link["host"], rows("hosts")).is_some_and(|h| entity(h) == entity(row)) {
                if let Some(tag) = resolve(&link["tag"], rows("tags")) {
                    let tag = decrypt(&tag["label"], &cipher)?;
                    if !tag.is_empty() {
                        tags.push(tag);
                    }
                }
            }
        }
        tags.sort();
        tags.dedup();
        let private_key = Zeroizing::new(decrypt(&key_row["private_key"], &cipher)?);
        let key = (!private_key.is_empty()).then_some(private_key);
        let mut warnings = Vec::new();
        let mut requires_review = false;
        // These settings must never be silently dropped while claiming a usable migration.
        for (field, warning) in [
            ("proxycommand", "Proxy settings require review"),
            ("host_chain", "Host chain requires review"),
            ("agent_forwarding", "Agent forwarding is not imported"),
        ] {
            if has_value(&cfg[field]) {
                warnings.push(warning.into());
                if field != "agent_forwarding" {
                    requires_review = true;
                }
            }
        }
        if has_value(&row["host_chain"]) {
            warnings.push("Host chain requires review".into());
            requires_review = true;
        }
        let password = Zeroizing::new(decrypt(&ident["password"], &cipher)?);
        let needs_password = !password.is_empty();
        if needs_password {
            warnings.push("Enter the server password when connecting".into());
        }
        if key.is_some() && ident["ssh_key"].is_null() {
            warnings.push("SSH key could not be linked".into());
        }
        hosts.push(Candidate {
            preview: HostPreview {
                source_id: entity(row),
                name,
                endpoint: Endpoint {
                    host,
                    user: (!user.is_empty()).then_some(user),
                    port,
                },
                group: (!group.is_empty()).then_some(group),
                tags,
                has_key: key.is_some(),
                needs_password,
                requires_review,
                warnings,
            },
            key,
        });
    }
    hosts.sort_by(|a, b| {
        a.preview
            .name
            .to_lowercase()
            .cmp(&b.preview.name.to_lowercase())
            .then(a.preview.source_id.cmp(&b.preview.source_id))
    });
    if hosts.len() > 10000 {
        return Err("Termius contains too many hosts for one migration".into());
    }
    Ok(Scan {
        hosts,
        warnings: vec!["Saved passwords, port forwards and snippets are not imported.".into()],
    })
}

fn has_value(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::String(s) => !s.is_empty(),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
        Value::Number(n) => n.as_u64() != Some(0),
    }
}

pub fn scan(profile: &Path) -> Result<Scan, String> {
    let path = profile.join("IndexedDB/file__0.indexeddb.leveldb");
    let before = inventory(&path)?;
    let raw = leveldb_core::read_dir(&path)
        .map_err(|_| "Could not read Termius data. Close Termius and try again.")?;
    if inventory(&path)? != before {
        return Err("Termius data changed while reading. Close Termius and try again.".into());
    }
    // Resolve only the migration databases before decoding V8. Terminal history and
    // other unrelated data can be large and must not enter the migration model.
    let mut latest = HashMap::<Vec<u8>, leveldb_core::Record>::new();
    for row in raw {
        if latest.get(&row.key).is_none_or(|old| old.seq < row.seq) {
            latest.insert(row.key.clone(), row);
        }
    }
    let mut ids = Vec::new();
    for row in latest
        .values()
        .filter(|r| !r.deleted && r.key.starts_with(&[0, 0, 0, 0, 201]))
    {
        if TABLES.iter().any(|name| {
            row.key.ends_with(
                &name
                    .encode_utf16()
                    .flat_map(u16::to_be_bytes)
                    .collect::<Vec<_>>(),
            )
        }) {
            let id = row
                .value
                .iter()
                .take(8)
                .enumerate()
                .fold(0u64, |n, (i, b)| n | (u64::from(*b) << (8 * i)));
            ids.push(id);
        }
    }
    let raw: Vec<_> = latest
        .into_values()
        .filter(|r| {
            let Some(&descriptor) = r.key.first() else {
                return false;
            };
            let len = ((descriptor >> 5) + 1) as usize;
            let Some(bytes) = r.key.get(1..1 + len) else {
                return false;
            };
            let id = bytes.iter().fold(0u64, |n, b| (n << 8) | u64::from(*b));
            id == 0 || ids.contains(&id)
        })
        .collect();
    let tables = current_records(chromium_storage_indexeddb_core::decode_records(&raw))?;
    if !tables.contains_key("hosts") {
        return Err("No Termius hosts found in this profile".into());
    }
    let key = local_key()?;
    normalize(tables, key.as_slice())
}

fn decode_key(blob: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
    let utf8 = std::str::from_utf8(blob).ok().map(|s| s.trim().to_string());
    let utf16 = blob
        .len()
        .is_multiple_of(2)
        .then(|| {
            String::from_utf16(
                &blob
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .map(|b| u16::from_le_bytes([b[0], b[1]]))
                    .collect::<Vec<_>>(),
            )
            .ok()
        })
        .flatten();
    for value in [utf8, utf16].into_iter().flatten().map(Zeroizing::new) {
        if let Ok(key) = STANDARD.decode(value.trim()) {
            if key.len() == 32 {
                return Ok(Zeroizing::new(key));
            }
        }
    }
    Err("Termius local key is not a supported 32-byte key".into())
}

#[cfg(windows)]
fn local_key() -> Result<Zeroizing<Vec<u8>>, String> {
    use windows_sys::Win32::Security::Credentials::{
        CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC,
    };
    let target: Vec<u16> = "Termius/localKey\0".encode_utf16().collect();
    let mut credential: *mut CREDENTIALW = std::ptr::null_mut();
    // SAFETY: Win32 allocates credential on success; the borrowed blob is copied before
    // CredFree. Neither the key nor the credential is ever formatted or returned to JS.
    unsafe {
        if CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) == 0
            || credential.is_null()
        {
            return Err(
                "Termius local key not found. Open Termius with this Windows account first.".into(),
            );
        }
        let record = &*credential;
        let result = if record.CredentialBlob.is_null() || record.CredentialBlobSize > 4096 {
            Err("Invalid Termius local key record".into())
        } else {
            decode_key(std::slice::from_raw_parts(
                record.CredentialBlob,
                record.CredentialBlobSize as usize,
            ))
        };
        CredFree(credential.cast());
        result
    }
}

#[cfg(not(windows))]
fn local_key() -> Result<Zeroizing<Vec<u8>>, String> {
    #[cfg(target_os = "macos")]
    let output = std::process::Command::new("/usr/bin/security")
        .args([
            "find-generic-password",
            "-s",
            "Termius",
            "-a",
            "localKey",
            "-w",
        ])
        .output();
    #[cfg(not(target_os = "macos"))]
    let output = std::process::Command::new("secret-tool")
        .args(["lookup", "service", "termius-app", "account", "localKey"])
        .output();
    let mut output =
        output.map_err(|_| "Could not access the Termius local key in the system keychain")?;
    let bytes = Zeroizing::new(std::mem::take(&mut output.stdout));
    if !output.status.success() {
        return Err("Termius local key was not available from the system keychain".into());
    }
    decode_key(&bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn compressed_record() -> RecordValue {
        // Blink v17 + V8 v15 serialization of { id: 1 }.
        let value = [
            0xff, 0x11, 0xff, 0x0f, b'o', b'"', 2, b'i', b'd', b'I', 2, b'{', 1,
        ];
        let mut raw = vec![0xff, 0x11, 0x02];
        raw.extend(snap::raw::Encoder::new().compress_vec(&value).unwrap());
        // This is the exact failure path of the pinned IndexedDB decoder.
        assert!(blob_decoder::v8_value::deserialize_blink(&raw).is_err());
        RecordValue::Undecoded {
            raw,
            error: "unsupported wrapper".into(),
        }
    }

    #[test]
    fn imports_chromium_snappy_wrapped_records_without_skipping_them() {
        let record = IndexedDbRecord {
            database_id: 1,
            object_store_id: 1,
            database: Some("hosts".into()),
            object_store: Some("hosts".into()),
            key: chromium_storage_indexeddb_core::IdbKey::String("fixture".into()),
            value: compressed_record(),
            seq: 1,
            deleted: false,
        };
        let tables = current_records(vec![record]).unwrap();
        assert_eq!(tables["hosts"][0]["id"], 1);
    }

    #[test]
    fn bounds_decompression_and_rejects_corrupt_or_external_records() {
        let mut remaining = 0;
        assert_eq!(
            record_value(compressed_record(), &mut remaining).unwrap_err(),
            "Termius data exceeds the migration size limit"
        );
        let mut remaining = 128 * 1024 * 1024;
        // Valid Snappy length varint claiming 8 MiB + 1, with no payload.
        let huge = RecordValue::Undecoded {
            raw: vec![0xff, 0x11, 0x02, 0x81, 0x80, 0x80, 0x04],
            error: String::new(),
        };
        assert_eq!(
            record_value(huge, &mut remaining).unwrap_err(),
            "Termius data exceeds the migration size limit"
        );
        for (raw, expected) in [
            (vec![0xff, 0x11, 0x02, 1], "A compressed Termius record is invalid. No records were imported."),
            (vec![0xff, 0x11, 0x01, 1, 0], "Termius stores this record in an external file that this importer cannot read. No records were imported."),
            (vec![0xff, 0x11, 0x03], "A Termius record could not be decoded. No records were imported."),
        ] {
            let value = RecordValue::Undecoded { raw, error: "private record content".into() };
            assert_eq!(record_value(value, &mut remaining).unwrap_err(), expected);
        }
    }

    #[test]
    fn uses_latest_sequence_and_does_not_resurrect_deleted_hosts() {
        use chromium_storage_indexeddb_core::IdbKey;
        let record = |seq, deleted, label: &str| IndexedDbRecord {
            database_id: 1,
            object_store_id: 1,
            database: Some("hosts".into()),
            object_store: Some("hosts".into()),
            key: IdbKey::String("same".into()),
            seq,
            deleted,
            value: RecordValue::V8(V8Value::Object(vec![
                ("id".into(), V8Value::Int(1)),
                ("label".into(), V8Value::String(label.into())),
            ])),
        };
        let tables =
            current_records(vec![record(2, false, "latest"), record(1, false, "old")]).unwrap();
        assert_eq!(tables["hosts"][0]["label"], "latest");
        assert!(
            current_records(vec![record(1, false, "old"), record(3, true, "")])
                .unwrap()
                .is_empty()
        );
    }
    #[test]
    fn decrypts_nacl_envelope_and_rejects_wrong_keys() {
        let key = [7u8; 32];
        let nonce = [9u8; 24];
        let cipher = XSalsa20Poly1305::new_from_slice(&key).unwrap();
        let mut envelope = vec![4, 1];
        envelope.extend_from_slice(&nonce);
        envelope.extend(
            cipher
                .encrypt(Nonce::from_slice(&nonce), b"test-host".as_slice())
                .unwrap(),
        );
        let input = Value::String(STANDARD.encode(&envelope));
        assert_eq!(decrypt(&input, &cipher).unwrap(), "test-host");
        assert!(decrypt(&input, &XSalsa20Poly1305::new_from_slice(&[8; 32]).unwrap()).is_err());
        envelope[1] = 2;
        assert!(decrypt(&Value::String(STANDARD.encode(envelope)), &cipher).is_err());
    }
    #[test]
    fn resolves_local_relations_and_keeps_empty_names_and_passwords_out_of_preview() {
        let mut t = Tables::new();
        t.insert("hosts".into(), vec![serde_json::json!({"local_id":1,"address":"3232235777","ssh_config":{"local_id":2}})]);
        t.insert(
            "ssh_configs".into(),
            vec![serde_json::json!({"local_id":2,"identity":{"local_id":3},"port":2222})],
        );
        t.insert(
            "ssh_identities".into(),
            vec![serde_json::json!({"local_id":3,"username":"admin","password":"secret"})],
        );
        let scan = normalize(t, &[7; 32]).unwrap();
        let p = &scan.hosts[0].preview;
        assert_eq!(p.name, "192.168.1.1");
        assert_eq!(p.endpoint.port, 2222);
        assert_eq!(p.endpoint.user.as_deref(), Some("admin"));
        assert!(p.needs_password);
        assert!(!serde_json::to_string(p).unwrap().contains("secret"));
    }
}
