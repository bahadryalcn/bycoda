//! Syntax-preserving JSONC edits for outgoing MCP provider configuration.
use jsonc_parser::{
    cst::{CstContainerNode, CstInputValue, CstNode, CstObject, CstRootNode},
    ParseOptions,
};
use serde_json::Value;
use std::collections::HashSet;

fn check_duplicates(node: CstNode) -> Result<(), String> {
    if let CstNode::Container(CstContainerNode::Object(object)) = &node {
        let mut names = HashSet::new();
        for property in object.properties() {
            let name = property
                .decoded_name()
                .ok_or("Invalid config property name")?;
            if !names.insert(name) {
                return Err("Existing config has duplicate property names".into());
            }
        }
    }
    for child in node.children() {
        check_duplicates(child)?;
    }
    Ok(())
}

fn input(value: &Value) -> CstInputValue {
    match value {
        Value::Null => CstInputValue::Null,
        Value::Bool(value) => CstInputValue::Bool(*value),
        Value::Number(value) => CstInputValue::Number(value.to_string()),
        Value::String(value) => CstInputValue::String(value.clone()),
        Value::Array(values) => CstInputValue::Array(values.iter().map(input).collect()),
        Value::Object(values) => CstInputValue::Object(
            values
                .iter()
                .map(|(key, value)| (key.clone(), input(value)))
                .collect(),
        ),
    }
}

fn apply(
    object: &CstObject,
    before: &serde_json::Map<String, Value>,
    after: &serde_json::Map<String, Value>,
) -> Result<(), String> {
    for (key, old) in before {
        let Some(next) = after.get(key) else {
            object
                .get(key)
                .ok_or("Config property disappeared")?
                .remove();
            continue;
        };
        if old == next {
            continue;
        }
        if let (Some(old), Some(next)) = (old.as_object(), next.as_object()) {
            let child = object
                .object_value(key)
                .ok_or("Existing config is not an object")?;
            apply(&child, old, next)?;
        } else {
            object
                .get(key)
                .ok_or("Config property disappeared")?
                .set_value(input(next));
        }
    }
    for (key, value) in after {
        if !before.contains_key(key) {
            object.append(key, input(value));
        }
    }
    Ok(())
}

pub(super) fn edit(
    raw: &str,
    update: impl FnOnce(&mut Value) -> Result<(), String>,
) -> Result<String, String> {
    let options = ParseOptions {
        allow_comments: true,
        allow_trailing_commas: true,
        allow_loose_object_property_names: false,
        allow_missing_commas: false,
        allow_single_quoted_strings: false,
        allow_hexadecimal_numbers: false,
        allow_unary_plus_numbers: false,
        allow_bare_decimal_point_numbers: false,
        allow_non_finite_numbers: false,
        allow_extended_string_escapes: false,
    };
    let root = CstRootNode::parse(raw, &options)
        .map_err(|error| format!("Existing config is invalid JSON: {error}"))?;
    for child in root.children() {
        check_duplicates(child)?;
    }
    let object = root
        .object_value()
        .ok_or("Existing config must be a JSON object")?;
    let before = root
        .to_serde_value()
        .ok_or("Existing config cannot be decoded")?;
    let mut after = before.clone();
    update(&mut after)?;
    apply(
        &object,
        before
            .as_object()
            .ok_or("Existing config must be a JSON object")?,
        after
            .as_object()
            .ok_or("Existing config must be a JSON object")?,
    )?;
    Ok(root.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn nested_updates_and_removals_preserve_unrelated_comments() {
        let raw = "{\n // top\n \"mcpServers\": { \"one\": { \"command\": \"old\" }, \"two\": { \"command\": \"stay\" } },\n // other\n \"url\": \"https://host/a//b\"\n}";
        let edited = edit(raw, |value| {
            value["mcpServers"]["one"]["command"] = Value::String("new".into());
            value["mcpServers"].as_object_mut().unwrap().remove("two");
            Ok(())
        })
        .unwrap();
        assert!(edited.contains("// top"));
        assert!(edited.contains("// other"));
        assert!(edited.contains("https://host/a//b"));
        assert!(!edited.contains("\"two\""));
        let value: Value = serde_json::from_str(&super::super::strip_jsonc(&edited)).unwrap();
        assert_eq!(value["mcpServers"]["one"]["command"], "new");
    }
}
