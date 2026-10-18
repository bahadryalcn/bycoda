//! Only canonical references are durable. This module never launches a process.
use serde_json::{json, Value};
use std::collections::HashSet;

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 200
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._:-".contains(&c))
}

fn sanitize(raw: &Value) -> Result<Value, String> {
    if raw.get("version").and_then(Value::as_u64) != Some(1)
        || raw.get("enabled").and_then(Value::as_bool) != Some(true)
    {
        return Err("Invalid server tab restore version".into());
    }
    let tabs = raw
        .get("tabs")
        .and_then(Value::as_array)
        .ok_or("Invalid server tab references")?;
    if tabs.len() > 32 {
        return Err("Too many saved server tabs".into());
    }
    let mut seen = HashSet::new();
    let mut clean = Vec::new();
    for tab in tabs {
        let tab_id = tab
            .get("tabId")
            .and_then(Value::as_str)
            .filter(|id| valid_id(id))
            .ok_or("Invalid server tab reference")?;
        let server_id = tab
            .get("serverId")
            .and_then(Value::as_str)
            .filter(|id| valid_id(id))
            .ok_or("Invalid server reference")?;
        if !seen.insert(tab_id) {
            return Err("Duplicate server tab reference".into());
        }
        clean.push(json!({"tabId":tab_id,"serverId":server_id}));
    }
    let mut result = json!({"version":1,"enabled":true,"tabs":clean});
    if let Some(active) = raw.get("activeTabId") {
        let active = active
            .as_str()
            .filter(|id| seen.contains(id))
            .ok_or("Invalid active server tab")?;
        result["activeTabId"] = json!(active);
    }
    Ok(result)
}

/// Called under the existing SQLite mutex. Only the primary native window may
/// replace/remove this field; a detached/legacy writer preserves the latest row.
pub(super) fn merge(
    snapshot: &mut Value,
    previous: Option<&Value>,
    owner: bool,
) -> Result<(), String> {
    let raw = if owner && snapshot.get("serversRestore").is_some() {
        snapshot.get("serversRestore")
    } else {
        previous.and_then(|value| value.get("serversRestore"))
    };
    let clean = raw
        .filter(|value| !value.is_null())
        .map(sanitize)
        .transpose()?;
    let object = snapshot
        .as_object_mut()
        .ok_or("Workspace snapshot must be an object")?;
    match clean {
        Some(value) => {
            object.insert("serversRestore".into(), value);
        }
        None => {
            object.remove("serversRestore");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn saved() -> Value {
        json!({"serversRestore":{"version":1,"enabled":true,"tabs":[{"tabId":"ui-1","serverId":"server-1"}]}})
    }
    #[test]
    fn detached_and_legacy_writers_preserve_latest_references_and_other_fields() {
        let previous = saved();
        let mut next = json!({"tabs":[],"sessionRecovery":{"keep":true},"serversRestore":null});
        merge(&mut next, Some(&previous), false).unwrap();
        assert_eq!(next["serversRestore"], previous["serversRestore"]);
        assert_eq!(next["sessionRecovery"], json!({"keep":true}));
        let mut legacy = json!({"tabs":[]});
        merge(&mut legacy, Some(&previous), true).unwrap();
        assert_eq!(legacy["serversRestore"], previous["serversRestore"]);
    }
    #[test]
    fn primary_opt_out_removes_only_restore_and_allowlist_drops_input_and_endpoints() {
        let mut next = saved();
        next["serversRestore"]["tabs"][0]["input"] = json!("not-durable");
        next["serversRestore"]["endpoint"] = json!("not-durable");
        merge(&mut next, None, true).unwrap();
        assert!(!next.to_string().contains("not-durable"));
        next["tabs"] = json!([{"id":"retained"}]);
        next["serversRestore"] = Value::Null;
        merge(&mut next, Some(&saved()), true).unwrap();
        assert!(next.get("serversRestore").is_none());
        assert_eq!(next["tabs"][0]["id"], "retained");
    }
    #[test]
    fn malformed_reference_rejects_without_publishing_a_partial_snapshot() {
        let mut next = saved();
        next["serversRestore"]["tabs"][0]["serverId"] = json!("bad\nreference");
        assert!(merge(&mut next, None, true).is_err());
        next["serversRestore"] = json!({"version":2,"enabled":true,"tabs":[]});
        assert!(merge(&mut next, None, true).is_err());
    }
}
