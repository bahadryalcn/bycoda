//! Organization is admitted through the same retained native owner as workspace writes.
use serde_json::Value;

pub(crate) fn validate(action: &str, input: &Value, request_id: &str) -> Result<(), String> {
    if action != "organization.patch" {
        return Err("Invalid organization action".into());
    }
    let object = input
        .as_object()
        .filter(|v| v.len() == 3)
        .ok_or("Invalid organization input")?;
    if object.get("requestId").and_then(Value::as_str) != Some(request_id)
        || request_id.is_empty()
        || request_id.len() > 300
    {
        return Err("Organization request identity changed".into());
    }
    let revision = object
        .get("expectedRevision")
        .and_then(Value::as_str)
        .ok_or("Invalid organization revision")?;
    if revision.len() != 64
        || !revision
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        || !object.get("change").is_some_and(Value::is_object)
    {
        return Err("Invalid organization review".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn rejects_changed_identity_or_injected_target() {
        let mut input = json!({"requestId":"original","expectedRevision":"a".repeat(64),"change":{"kind":"projectName","name":"Name"}});
        assert!(validate("organization.patch", &input, "original").is_ok());
        assert!(validate("organization.patch", &input, "other").is_err());
        input["cwd"] = json!("/foreign");
        assert!(validate("organization.patch", &input, "original").is_err());
    }
}
