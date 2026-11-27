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
    } else if input["html"]
        .as_str()
        .is_some_and(|html| html.len() > 2_097_152)
    {
        return Err("Background HTML exceeds 2 MiB".into());
    } else if input["confirmed"] != true
        || !text("title", 160)
        || input["html"]
            .as_str()
            .is_none_or(|html| html.trim().is_empty())
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

    #[test]
    fn read_accepts_valid_design_id_and_boundary_values() {
        let input = json!({"target":"global","designId":"design-1","offset":0,"limit":1,"expectedPath":"p".repeat(4096)});
        assert!(validate_input("ui.background.read", &input).is_ok());
        for bad in [
            json!({"target":"global","expectedPath":"p".repeat(4097)}),
            json!({"target":"global","limit":0}),
            json!({"target":"global","limit":1.5}),
            json!({"target":"global","designId":""}),
        ] {
            assert!(validate_input("ui.background.read", &bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn design_id_and_expected_updated_at_travel_together() {
        let base = json!({"target":"project","title":"T","html":"<b>x</b>","confirmed":true});
        let mut paired = base.clone();
        paired["designId"] = json!("d1");
        paired["expectedUpdatedAt"] = json!(9_007_199_254_740_991u64);
        assert!(validate_input("ui.background.save", &paired).is_ok());
        let mut over = paired.clone();
        over["expectedUpdatedAt"] = json!(9_007_199_254_740_992u64);
        assert!(validate_input("ui.background.save", &over).is_err());
        let mut only_id = base.clone();
        only_id["designId"] = json!("d1");
        assert!(validate_input("ui.background.save", &only_id).is_err());
        let mut only_time = base;
        only_time["expectedUpdatedAt"] = json!(1);
        assert!(validate_input("ui.background.save", &only_time).is_err());
    }

    #[test]
    fn oversize_html_has_a_specific_error() {
        let input =
            json!({"target":"project","title":"T","html":"x".repeat(2_097_153),"confirmed":true});
        assert_eq!(
            validate_input("ui.background.save", &input).unwrap_err(),
            "Background HTML exceeds 2 MiB"
        );
        let exact =
            json!({"target":"project","title":"T","html":"x".repeat(2_097_152),"confirmed":true});
        assert!(validate_input("ui.background.save", &exact).is_ok());
    }
}
