//! Native validation consumes the generated, canonical TypeScript contracts.
use jsonschema::{PatternOptions, Validator};
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::{Arc, OnceLock},
    time::Duration,
};

const GENERATED: &str =
    include_str!("../../../src/shared/model/host-contracts/generated/manifest.json");

pub(super) struct Method {
    pub params: Validator,
    pub result: Validator,
    pub mutating: bool,
    pub requires_command_id: bool,
    pub required_capability: Option<String>,
    control: bool,
    control_types: Vec<String>,
    pub timeout: Duration,
    /// Per-method wait for the Host to admit the request, before dispatch.
    pub admission: Duration,
}

impl Method {
    pub fn control(&self, params: &Value) -> bool {
        self.control
            || params["type"]
                .as_str()
                .is_some_and(|kind| self.control_types.iter().any(|value| value == kind))
    }
}

pub(super) struct Contracts {
    pub manifest: Value,
    pub methods: HashMap<String, Method>,
    pub request: Validator,
    pub response: Validator,
    pub event: Validator,
    pub bulk_result: Option<Validator>,
    pub bulk_descriptor: Option<Validator>,
}

fn compile(value: &Value) -> Result<Validator, String> {
    jsonschema::draft202012::options()
        .with_pattern_options(PatternOptions::fancy_regex().backtrack_limit(20_000))
        .build(value)
        .map_err(|_| "Generated Host contract could not be compiled".to_owned())
}

impl Contracts {
    pub fn get() -> Result<Arc<Self>, String> {
        static CONTRACTS: OnceLock<Result<Arc<Contracts>, String>> = OnceLock::new();
        CONTRACTS
            .get_or_init(|| Self::parse(GENERATED).map(Arc::new))
            .clone()
    }

    pub fn parse(text: &str) -> Result<Self, String> {
        let manifest: Value = serde_json::from_str(text)
            .map_err(|_| "Generated Host manifest is invalid".to_owned())?;
        let entries = manifest["methods"]
            .as_object()
            .ok_or_else(|| "Generated Host methods are missing".to_owned())?;
        let mut methods = HashMap::new();
        for (name, entry) in entries {
            let kind = entry["kind"].as_str().unwrap_or("");
            // Unknown future effect kinds fail conservatively after dispatch.
            let mutating = !(kind == "query"
                || kind == "subscription"
                || (kind == "control"
                    && matches!(
                        name.as_str(),
                        "connection.hello" | "connection.probe" | "requests.cancel"
                    )));
            methods.insert(
                name.clone(),
                Method {
                    params: compile(&entry["params"])?,
                    result: compile(&entry["result"])?,
                    mutating,
                    requires_command_id: kind == "command",
                    required_capability: match entry.get("requiredCapability") {
                        None | Some(Value::Null) => None,
                        Some(Value::String(capability)) if !capability.is_empty() => {
                            Some(capability.clone())
                        }
                        _ => return Err("Generated Host capability policy is invalid".into()),
                    },
                    control: entry["cost"].as_str() == Some("control"),
                    control_types: entry["controlTypes"]
                        .as_array()
                        .map(|types| {
                            types
                                .iter()
                                .filter_map(Value::as_str)
                                .map(str::to_owned)
                                .collect()
                        })
                        .unwrap_or_default(),
                    timeout: Duration::from_millis(
                        entry["responseTimeoutMs"]
                            .as_u64()
                            .ok_or_else(|| "Generated Host deadline is missing".to_owned())?,
                    ),
                    admission: Duration::from_millis(
                        entry["admissionTimeoutMs"].as_u64().ok_or_else(|| {
                            "Generated Host admission deadline is missing".to_owned()
                        })?,
                    ),
                },
            );
        }
        if let Some(value) = manifest.get("aliases") {
            let aliases = value
                .as_object()
                .ok_or("Generated Host aliases are invalid")?;
            for (alias, target) in aliases {
                if methods.contains_key(alias)
                    || !target
                        .as_str()
                        .is_some_and(|name| methods.contains_key(name))
                {
                    return Err("Generated Host alias target is invalid".into());
                }
            }
        }
        Ok(Self {
            bulk_result: manifest["schemas"]
                .get("bulkResult")
                .map(compile)
                .transpose()?,
            bulk_descriptor: manifest["schemas"]
                .get("bulkDescriptor")
                .map(compile)
                .transpose()?,
            request: compile(&manifest["schemas"]["request"])?,
            response: compile(&manifest["schemas"]["response"])?,
            event: compile(&manifest["schemas"]["subscriptionEvent"])?,
            methods,
            manifest,
        })
    }

    pub fn limit(&self, name: &str) -> usize {
        self.manifest["limits"][name]
            .as_u64()
            .expect("validated generated limit") as usize
    }

    pub fn wire_method<'a>(&'a self, method: &'a str) -> &'a str {
        self.manifest["aliases"]
            .get(method)
            .and_then(Value::as_str)
            .unwrap_or(method)
    }

    pub fn duration(&self, name: &str) -> Duration {
        Duration::from_millis(self.limit(name) as u64)
    }

    pub fn protocol(&self) -> &str {
        self.manifest["subprotocol"]
            .as_str()
            .expect("generated subprotocol")
    }

    pub fn request_valid(&self, value: &Value) -> bool {
        self.request.is_valid(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn goal_alias_keeps_canonical_request_and_hello_grammar() {
        let contracts = Contracts::get().unwrap();
        let legacy = "goals.final-review.recheck";
        let canonical = "goals.finalReview.recheck";
        assert_eq!(contracts.wire_method(legacy), canonical);
        assert_eq!(
            contracts.wire_method("goals.final--review.recheck"),
            "goals.final--review.recheck"
        );
        let mut request = json!({"jsonrpc":"2.0","id":"alias.1","method":legacy,
            "params":{"goalId":"goal.1","expectedUpdatedAt":1}});
        assert!(!contracts.request_valid(&request));
        request["method"] = json!(canonical);
        assert!(contracts.request_valid(&request));
        let mut hello = json!({"environmentId":"host.1","connectionId":"connection.1",
            "wireVersion":2,"schemaVersion":1,"capabilities":["transport.ws.goals.v2"],"methods":[legacy]});
        assert!(!contracts.methods["connection.hello"]
            .result
            .is_valid(&hello));
        hello["methods"] = json!([canonical]);
        assert!(contracts.methods["connection.hello"]
            .result
            .is_valid(&hello));
    }

    #[test]
    fn alias_metadata_cannot_shadow_methods_chain_or_enable_unknown_targets() {
        for aliases in [
            json!([]),
            json!({"goals.final-review.recheck":false}),
            json!({"goals.final-review.recheck":"goals.unknown"}),
            json!({"projects.list":"goals.finalReview.recheck"}),
            json!({"goals.final-review.recheck":"goals.futureAlias","goals.futureAlias":"goals.finalReview.recheck"}),
        ] {
            let mut manifest: Value = serde_json::from_str(GENERATED).unwrap();
            manifest["aliases"] = aliases;
            assert!(Contracts::parse(&manifest.to_string()).is_err());
        }
    }

    #[test]
    fn capability_policy_accepts_omission_or_null_but_rejects_malformed_metadata() {
        let mut manifest: Value = serde_json::from_str(GENERATED).unwrap();
        manifest["methods"]["environment.describe"]["requiredCapability"] = Value::Null;
        manifest["methods"]["projects.list"]
            .as_object_mut()
            .unwrap()
            .remove("requiredCapability");
        let contracts = Contracts::parse(&manifest.to_string()).unwrap();
        assert!(contracts.methods["environment.describe"]
            .required_capability
            .is_none());
        assert!(contracts.methods["projects.list"]
            .required_capability
            .is_none());
        manifest["methods"]["environment.describe"]["requiredCapability"] = json!(true);
        assert!(Contracts::parse(&manifest.to_string()).is_err());
    }

    #[test]
    fn generated_lookaround_and_safe_counters_are_enforced() {
        let contracts = Contracts::get().unwrap();
        let hello = &contracts.methods["connection.hello"].params;
        let mut value = json!({"environmentId":"host.windows", "clientId":"desktop.1",
            "clientKind":"desktop", "supportedWireVersions":[2], "supportedSchemaVersions":[1]});
        assert!(hello.is_valid(&value));
        for invalid in [
            "host.windows\n",
            "host.windows\r",
            "host.windows\u{2028}",
            "",
            " host",
        ] {
            value["environmentId"] = json!(invalid);
            assert!(!hello.is_valid(&value), "accepted {invalid:?}");
        }
        let cursor = compile(&contracts.manifest["schemas"]["streamCursor"]).unwrap();
        assert!(cursor.is_valid(&json!({"epoch":"epoch.1","sequence":9_007_199_254_740_991u64})));
        assert!(!cursor.is_valid(&json!({"epoch":"epoch.1","sequence":9_007_199_254_740_992u64})));
        assert!(!cursor.is_valid(&json!({"epoch":"epoch.1","sequence":0.5})));
    }

    #[test]
    fn admission_budget_is_per_method_and_queue_commands_outlive_reconnects() {
        let contracts = Contracts::get().unwrap();
        let default = Duration::from_millis(5_000);
        let queue_budget = Duration::from_millis(90_000);
        for method in [
            "commands.dispatch",
            "commands.status",
            "sessions.queue.get",
            "sessions.queue.change",
            "sessions.queue.claim",
            "sessions.queue.finish",
            "sessions.queue.lease",
            "sessions.queue.release",
        ] {
            assert_eq!(
                contracts.methods[method].admission, queue_budget,
                "{method}"
            );
        }
        assert_eq!(contracts.methods["projects.list"].admission, default);
    }

    #[test]
    fn admission_budget_comes_from_each_method_descriptor() {
        let mut manifest: Value = serde_json::from_str(GENERATED).unwrap();
        manifest["methods"]["projects.list"]["admissionTimeoutMs"] = json!(7_000);
        manifest["methods"]["commands.dispatch"]["admissionTimeoutMs"] = json!(1_000);
        let contracts = Contracts::parse(&manifest.to_string()).unwrap();
        assert_eq!(
            contracts.methods["projects.list"].admission,
            Duration::from_millis(7_000)
        );
        assert_eq!(
            contracts.methods["commands.dispatch"].admission,
            Duration::from_millis(1_000)
        );
        // A method's budget must not be inherited from the manifest-wide default.
        assert_eq!(
            contracts.methods["commands.status"].admission,
            Duration::from_millis(90_000)
        );
    }

    #[test]
    fn method_without_admission_budget_is_rejected() {
        let mut manifest: Value = serde_json::from_str(GENERATED).unwrap();
        manifest["methods"]["projects.list"]
            .as_object_mut()
            .unwrap()
            .remove("admissionTimeoutMs");
        assert!(Contracts::parse(&manifest.to_string()).is_err());
    }
}
