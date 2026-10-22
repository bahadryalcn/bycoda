//! Saved-server MCP adapter. Reuses public inventory projections and native validators;
//! never reads raw store records, credentials, or private keys.
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

fn required(input: &Value, key: &str) -> Result<String, String> {
    input[key]
        .as_str()
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| format!("{key} is required"))
}

fn page(mut values: Vec<Value>, input: &Value) -> Result<Value, String> {
    let offset = input
        .get("offset")
        .map(|v| v.as_u64().ok_or("Invalid offset"))
        .transpose()?
        .unwrap_or(0);
    let limit = input
        .get("limit")
        .map(|v| {
            v.as_u64()
                .filter(|n| (1..=100).contains(n))
                .ok_or("Invalid limit")
        })
        .transpose()?
        .unwrap_or(30);
    let search = input["search"].as_str().unwrap_or("").to_lowercase();
    values.retain(|value| {
        let matches_kind = input["kind"]
            .as_str()
            .is_none_or(|kind| value["kind"] == kind);
        let matches_favorite = input["favorite"]
            .as_bool()
            .is_none_or(|favorite| value["metadata"]["favorite"] == favorite);
        let matches_search = search.is_empty()
            || [
                value["name"].as_str(),
                value["metadata"]["group"].as_str(),
                value["sshEndpoint"]["host"].as_str(),
            ]
            .into_iter()
            .flatten()
            .any(|value| value.to_lowercase().contains(&search))
            || value["metadata"]["tags"].as_array().is_some_and(|tags| {
                tags.iter()
                    .filter_map(Value::as_str)
                    .any(|tag| tag.to_lowercase().contains(&search))
            });
        matches_kind && matches_favorite && matches_search
    });
    let total = values.len() as u64;
    let next = offset.saturating_add(limit);
    Ok(
        json!({"items": values.into_iter().skip(usize::try_from(offset).unwrap_or(usize::MAX)).take(limit as usize).collect::<Vec<_>>(),
        "total": total, "nextOffset": if next < total { Some(next) } else { None }}),
    )
}

pub(super) fn call(app: &AppHandle, action: &str, input: &Value) -> Result<Value, String> {
    use crate::server_inventory as inventory;
    let state = app.state::<crate::remote::RemoteConnections>();
    match action {
        "servers.list" | "servers.get" => {
            // server_inventory_list projects StoredMachine to Machine and strips host tokens.
            let values = inventory::server_inventory_list(app.clone(), state)?
                .into_iter()
                .map(serde_json::to_value)
                .collect::<Result<Vec<_>, _>>()
                .map_err(|_| "Invalid server metadata")?;
            if action == "servers.get" {
                let id = required(input, "id")?;
                values
                    .into_iter()
                    .find(|value| value["id"] == id)
                    .ok_or_else(|| "Server no longer exists".into())
            } else {
                page(values, input)
            }
        }
        "servers.ssh.save" => {
            let endpoint = serde_json::from_value(input["endpoint"].clone())
                .map_err(|_| "Invalid SSH endpoint")?;
            let saved = inventory::server_ssh_save(
                app.clone(),
                state,
                input["id"].as_str().map(str::to_owned),
                required(input, "name")?,
                endpoint,
                input["importOnly"].as_bool(),
            )?;
            serde_json::to_value(saved).map_err(|_| "Invalid server metadata".into())
        }
        "servers.ssh.remove" => {
            inventory::server_ssh_remove(app.clone(), state, required(input, "id")?)?;
            Ok(json!({"removed": true}))
        }
        "servers.ssh.identity.set" => {
            if input.get("identityFile").is_none()
                || (!input["identityFile"].is_null() && !input["identityFile"].is_string())
            {
                return Err("identityFile must be a path or null".into());
            }
            let saved = inventory::server_ssh_identity_set(
                app.clone(),
                state,
                required(input, "id")?,
                input["identityFile"].as_str().map(str::to_owned),
            )?;
            serde_json::to_value(saved).map_err(|_| "Invalid server metadata".into())
        }
        "servers.metadata.update" => {
            inventory::server_metadata_update(
                app.clone(),
                state,
                required(input, "id")?,
                input["metadata"].clone(),
            )?;
            Ok(json!({"updated": true}))
        }
        "servers.activity.bookmark" => {
            inventory::server_activity_bookmark(
                app.clone(),
                state,
                required(input, "id")?,
                required(input, "eventId")?,
                input["bookmarked"]
                    .as_bool()
                    .ok_or("bookmarked is required")?,
            )?;
            Ok(json!({"updated": true}))
        }
        _ => Err("Unsupported saved-server tool".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn public_inventory_projection_does_not_expose_host_tokens() {
        let record = json!({"id":"host","name":"Build","endpoint":"http://127.0.0.1:3000",
            "environmentId":"remote-env","token":"secret-host-token","metadata":{"tags":[],"favorite":false}});
        let projected =
            serde_json::to_value(crate::server_inventory::project(&record).unwrap()).unwrap();
        assert_eq!(projected["machine"]["environmentId"], "remote-env");
        assert!(projected["machine"].get("token").is_none());
        assert!(!projected.to_string().contains("secret-host-token"));
    }
    #[test]
    fn filters_before_pagination_and_limits_results() {
        let records = vec![
            json!({"id":"one","name":"First","kind":"ssh","metadata":{"favorite":false}}),
            json!({"id":"two","name":"Second","kind":"ssh","metadata":{"favorite":true,"tags":["PROD"]}}),
            json!({"id":"three","name":"Third","kind":"host","metadata":{"favorite":true,"tags":["prod"]}}),
        ];
        let result = page(
            records.clone(),
            &json!({"search":"prod","favorite":true,"limit":1}),
        )
        .unwrap();
        assert_eq!(result["total"], 2);
        assert_eq!(result["items"][0]["id"], "two");
        assert_eq!(result["nextOffset"], 1);
        assert_eq!(
            page(records.clone(), &json!({"offset":u64::MAX})).unwrap()["items"],
            json!([])
        );
        assert!(page(records.clone(), &json!({"limit":101})).is_err());
        assert!(page(records, &json!({"offset":-1})).is_err());
    }
    #[test]
    fn requires_explicit_nonempty_identifiers() {
        assert!(required(&json!({"id":""}), "id").is_err());
        assert!(required(&json!({"id":1}), "id").is_err());
        assert!(required(&json!({}), "id").is_err());
    }
}
