//! Exact background payload admission before entering the original conversation window.
use serde_json::Value;

pub(super) fn validate_input(action: &str, input: &Value) -> Result<(), String> {
    let object = input.as_object().ok_or("Invalid background request")?;
    let read = action == "ui.background.read";
    let allowed: &[&str] = if read {
        &["target", "offset", "limit", "expectedPath", "designId"]
    } else {
        &[
            "target",
            "html",
            "title",
            "confirmed",
            "designId",
            "expectedUpdatedAt",
        ]
    };
    let text = |key: &str, max: usize| {
        input[key]
            .as_str()
            .is_some_and(|v| !v.trim().is_empty() && v.chars().count() <= max)
    };
    if !matches!(
        action,
        "ui.background.read" | "ui.background.save" | "ui.background.apply"
    ) || object.keys().any(|key| !allowed.contains(&key.as_str()))
        || !matches!(input["target"].as_str(), Some("global" | "project"))
        || (object.contains_key("designId") && !text("designId", 100))
    {
        return Err("Invalid background request".into());
    }
    if read {
        for (key, min, max) in [("offset", 0, 2_097_152), ("limit", 1, 32_000)] {
            if object.contains_key(key) && input[key].as_u64().is_none_or(|v| v < min || v > max) {
                return Err("Invalid background read bounds".into());
            }
        }
        if object.contains_key("expectedPath") && !text("expectedPath", 4096) {
            return Err("Invalid background source fence".into());
        }
    } else if input["confirmed"] != true
        || !text("title", 160)
        || input["html"]
            .as_str()
            .is_none_or(|html| html.trim().is_empty() || html.len() > 2_097_152)
        || (object.contains_key("designId") != object.contains_key("expectedUpdatedAt"))
        || (object.contains_key("expectedUpdatedAt")
            && input["expectedUpdatedAt"]
                .as_u64()
                .is_none_or(|v| v > 9_007_199_254_740_991))
    {
        return Err("Invalid confirmed background source".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn background_bounds_reject_unknown_fields_files_and_unconfirmed_effects() {
        let valid = json!({"target":"project","title":"Robotun adası","html":"<b>scene</b>","confirmed":true});
        for action in ["ui.background.save", "ui.background.apply"] {
            assert!(validate_input(action, &valid).is_ok());
            for (key, value) in [
                ("confirmed", json!(false)),
                ("path", json!("C:/secret")),
                ("html", json!("x".repeat(2_097_153))),
                ("target", json!("other")),
                ("designId", json!("missing-version")),
            ] {
                let mut input = valid.clone();
                input[key] = value;
                assert!(validate_input(action, &input).is_err(), "{key}");
            }
        }
        for input in [
            json!({"target":"global","limit":32001}),
            json!({"target":"global","offset":-1}),
            json!({"target":"global","html":"secret"}),
        ] {
            assert!(validate_input("ui.background.read", &input).is_err());
        }
    }
}
