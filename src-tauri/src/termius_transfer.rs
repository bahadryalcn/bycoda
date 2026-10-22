//! Build one additive inventory update. Shared by native UI and migration verification.
use crate::termius_reader::{HostPreview, Scan};
use serde::Serialize;
use serde_json::Value;
use std::{collections::HashSet, path::Path};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub imported: usize,
    pub skipped: usize,
    pub keys: usize,
}

pub fn duplicate(host: &HostPreview, record: &Value) -> bool {
    let existing = if record["kind"] == "ssh" {
        record["sshEndpoint"].clone()
    } else {
        let target = record
            .pointer("/ssh/target")
            .and_then(Value::as_str)
            .unwrap_or("");
        let (user, host) = target
            .rsplit_once('@')
            .map(|(u, h)| (Some(u), h))
            .unwrap_or((None, target));
        serde_json::json!({"host":host,"user":user,"port":record.pointer("/ssh/port").and_then(Value::as_u64).unwrap_or(22)})
    };
    existing["host"]
        .as_str()
        .is_some_and(|h| h.eq_ignore_ascii_case(&host.endpoint.host))
        && existing["user"].as_str().filter(|s| !s.is_empty())
            == host.endpoint.user.as_deref().filter(|s| !s.is_empty())
        && existing["port"].as_u64() == Some(u64::from(host.endpoint.port))
}

pub fn prepare(
    scan: &Scan,
    existing: &[Value],
    selected: &HashSet<String>,
    import_keys: bool,
    key_dir: &Path,
    validate: impl Fn(&Value) -> Result<(), String>,
) -> Result<(Vec<Value>, Outcome), String> {
    if selected.is_empty()
        || selected
            .iter()
            .any(|id| !scan.hosts.iter().any(|h| &h.preview.source_id == id))
    {
        return Err("Select valid records from the migration preview".into());
    }
    let mut records = existing.to_vec();
    let mut planned = Vec::new();
    let mut result = Outcome {
        imported: 0,
        skipped: 0,
        keys: 0,
    };
    for host in scan
        .hosts
        .iter()
        .filter(|h| selected.contains(&h.preview.source_id))
    {
        let p = &host.preview;
        if p.name.trim().is_empty() || p.name.len() > 200 || p.name.chars().any(char::is_control) {
            return Err("Termius contains an invalid server name".into());
        }
        if p.tags.len() > 32
            || p.tags
                .iter()
                .any(|t| t.len() > 80 || t.chars().any(char::is_control))
            || p.group
                .as_ref()
                .is_some_and(|g| g.len() > 100 || g.chars().any(char::is_control))
        {
            return Err("Server metadata is too large or invalid".into());
        }
        if p.requires_review {
            return Err("Review proxy or host-chain settings before importing this record".into());
        }
        if records.iter().any(|r| duplicate(p, r)) {
            result.skipped += 1;
            continue;
        }
        let value = serde_json::json!({"id":uuid::Uuid::new_v4().to_string(),"kind":"ssh","name":p.name.trim(),"sshEndpoint":p.endpoint,"metadata":{"group":p.group,"tags":p.tags,"favorite":false}});
        validate(&value)?;
        planned.push((records.len(), host));
        records.push(value);
    }
    // All rows are validated before writing a key. Inventory is persisted by the caller
    // once; errors never partially append records or overwrite existing identities.
    let mut key_paths = HashSet::new();
    for (index, host) in planned {
        if import_keys {
            if let Some(key) = &host.key {
                let path = crate::termius_keys::save(key_dir, key)?;
                records[index]["sshEndpoint"]["identityFile"] =
                    Value::String(path.to_string_lossy().into_owned());
                key_paths.insert(path);
            }
        }
        result.imported += 1;
    }
    result.keys = key_paths.len();
    Ok((records, result))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::termius_reader::{Candidate, Endpoint};
    fn scan(hosts: &[&str]) -> Scan {
        Scan {
            warnings: vec![],
            hosts: hosts
                .iter()
                .enumerate()
                .map(|(i, h)| Candidate {
                    key: None,
                    preview: HostPreview {
                        source_id: i.to_string(),
                        name: h.to_string(),
                        endpoint: Endpoint {
                            host: h.to_string(),
                            user: None,
                            port: 22,
                        },
                        group: Some("Production".into()),
                        tags: vec!["ops".into()],
                        has_key: false,
                        needs_password: false,
                        requires_review: false,
                        warnings: vec![],
                    },
                })
                .collect(),
        }
    }
    #[test]
    fn preserves_existing_records_and_skips_duplicates_in_the_same_batch() {
        let scan = scan(&["first.test", "new.test", "NEW.test"]);
        let old = serde_json::json!({"id":"old","kind":"ssh","name":"Keep me","sshEndpoint":{"host":"FIRST.test","port":22},"metadata":{"favorite":true,"unknown":"preserved"}});
        let selected = scan
            .hosts
            .iter()
            .map(|h| h.preview.source_id.clone())
            .collect();
        let (rows, outcome) = prepare(
            &scan,
            std::slice::from_ref(&old),
            &selected,
            false,
            Path::new("unused"),
            |_| Ok(()),
        )
        .unwrap();
        assert_eq!(outcome.imported, 1);
        assert_eq!(outcome.skipped, 2);
        assert_eq!(rows[0], old);
        assert_eq!(rows[1]["metadata"]["group"], "Production");
    }
    #[test]
    fn validation_failure_never_writes_keys_or_partial_inventory() {
        let scan = scan(&["first.test", "bad.test"]);
        let selected = scan
            .hosts
            .iter()
            .map(|h| h.preview.source_id.clone())
            .collect();
        let result = prepare(
            &scan,
            &[],
            &selected,
            true,
            Path::new("must-not-be-created"),
            |row| {
                if row["name"] == "bad.test" {
                    Err("invalid".into())
                } else {
                    Ok(())
                }
            },
        );
        assert!(result.is_err());
        assert!(!Path::new("must-not-be-created").exists());
    }
}
