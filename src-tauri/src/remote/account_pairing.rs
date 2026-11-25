//! Desktop-to-desktop pairing through the account mailbox. The renderer opens the sealed ticket
//! (it holds the key); this command redeems it. Native verifies the Host identity on the route
//! before the one-time ticket is sent, and the credential goes straight into the store.
use super::*;

const MAX_BODY_BYTES: u64 = 4096;
const MAX_ROUTES: usize = 4;
const IDENTITY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(6);
const REDEEM_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

fn agent(timeout: std::time::Duration) -> ureq::Agent {
    ureq::AgentBuilder::new()
        .redirects(0)
        .timeout_connect(std::time::Duration::from_secs(5))
        .timeout(timeout)
        .build()
}

/// `https` origins from the account, or an `http` loopback origin. Never any other plain HTTP.
fn route_origin(route: &str) -> Option<String> {
    endpoint(route).ok()
}

/// Public identity plus ticket possession must match before sending the ticket.
fn verify_identity(origin: &str, environment_id: &str, ticket: &str) -> Result<(), String> {
    let response = agent(IDENTITY_TIMEOUT)
        .get(&format!("{origin}/.well-known/bycoda-host"))
        .call()
        .map_err(|_| "Could not reach this computer on its published address")?;
    let descriptor: Value = serde_json::from_reader(response.into_reader().take(MAX_BODY_BYTES))
        .map_err(|_| "Invalid computer identity")?;
    if descriptor.get("environmentId").and_then(Value::as_str) != Some(environment_id) {
        return Err("This address belongs to a different computer".into());
    }
    host_proof::verify(origin, environment_id, ticket, "pairing", IDENTITY_TIMEOUT)
}

fn redeem_body(
    environment_id: &str,
    ticket: &str,
    claim_id: &str,
    device_name: &str,
    proof_key: &Value,
) -> Value {
    json!({
        "version": 1,
        "environmentId": environment_id,
        "ticket": ticket,
        "claimId": claim_id,
        "deviceName": device_name.chars().take(100).collect::<String>(),
        "proofKey": proof_key,
    })
}

/// Reads `{ "result": { deviceId, token, environmentId } }` and returns the token only when
/// the credential is for the expected environment.
fn redeemed_token(reply: &Value, environment_id: &str) -> Result<String, String> {
    let result = reply.get("result").ok_or("Pairing was refused")?;
    if result.get("environmentId").and_then(Value::as_str) != Some(environment_id) {
        return Err("Host identity changed".into());
    }
    result
        .get("token")
        .and_then(Value::as_str)
        .filter(|token| !token.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "Pairing was refused".into())
}

fn redeem(
    origin: &str,
    environment_id: &str,
    ticket: &str,
    claim_id: &str,
    device_name: &str,
    proof_key: &Value,
) -> Result<String, String> {
    let response = agent(REDEEM_TIMEOUT)
        .post(&format!("{origin}/mobile/pairing/redeem"))
        .set("Content-Type", "application/json")
        .send_string(
            &redeem_body(environment_id, ticket, claim_id, device_name, proof_key).to_string(),
        )
        .map_err(|_| "This computer refused the pairing. Try again.")?;
    let reply: Value = serde_json::from_reader(response.into_reader().take(MAX_BODY_BYTES))
        .map_err(|_| "Invalid pairing response")?;
    redeemed_token(&reply, environment_id)
}

/// Verifies the Host on the first reachable route, redeems the ticket there and saves the
/// machine. Another route that proves the same identity is learned as a tunnel alternative.
#[tauri::command]
pub async fn remote_pair_account(
    app: AppHandle,
    name: String,
    environment_id: String,
    routes: Vec<String>,
    ticket: String,
    claim_id: String,
    device_name: String,
) -> Result<Machine, String> {
    if routes.is_empty() || routes.len() > MAX_ROUTES {
        return Err("This computer has no published address".into());
    }
    crate::harness::run_blocking("remote_pair_account", move || {
        let origins: Vec<String> = routes
            .iter()
            .filter_map(|route| route_origin(route))
            .collect();
        let mut last = "Could not reach this computer on its published address".to_string();
        for (index, origin) in origins.iter().enumerate() {
            if let Err(error) = verify_identity(origin, &environment_id, &ticket) {
                last = error;
                continue;
            }
            // The credential is issued bound to a key generated here.
            let key = PairingKey::new(device_proof::generate_seed()?, &environment_id);
            let token = redeem(
                origin,
                &environment_id,
                &ticket,
                &claim_id,
                &device_name,
                &device_proof::public_jwk(&key.seed)?,
            )?;
            let state = app.state::<RemoteConnections>();
            let machine = connect_host(
                app.clone(),
                state,
                name,
                origin.clone(),
                token.clone(),
                false,
                Some(key),
            )?;
            if machine.environment_id != environment_id {
                return Err("Host identity changed".into());
            }
            for other in origins.iter().skip(index + 1) {
                if crate::remote_routes::verify_account_endpoint(
                    other,
                    &environment_id,
                    &token,
                    crate::remote_routes::IDENTITY_BUDGET,
                )
                .is_ok()
                {
                    crate::remote_routes::learn_account_endpoint(&environment_id, other.clone());
                    break;
                }
            }
            return Ok(machine);
        }
        Err(last)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_must_be_https_or_loopback() {
        assert!(route_origin("https://box.tailnet.ts.net").is_some());
        assert!(route_origin("http://127.0.0.1:8787").is_some());
        assert!(route_origin("http://192.168.1.4:8787").is_none());
        assert!(route_origin("http://box.example").is_none());
        assert!(route_origin("https://user:pw@box.example").is_none());
    }

    #[test]
    fn redemption_requires_the_expected_environment() {
        let reply = json!({"result":{"deviceId":"d","token":"secret","environmentId":"env-1"}});
        assert_eq!(redeemed_token(&reply, "env-1").unwrap(), "secret");
        assert!(redeemed_token(&reply, "env-2").is_err());
        assert!(redeemed_token(&json!({"error":"no"}), "env-1").is_err());
    }

    #[test]
    fn redeem_body_carries_the_protocol_fields() {
        let body = redeem_body(
            "env-1",
            "ticket",
            "claim",
            "Laptop",
            &json!({"kty":"OKP","crv":"Ed25519","x":"key"}),
        );
        assert_eq!(body["proofKey"]["crv"], "Ed25519");
        assert_eq!(body["version"], 1);
        assert_eq!(body["environmentId"], "env-1");
        assert_eq!(body["ticket"], "ticket");
        assert_eq!(body["claimId"], "claim");
        assert_eq!(body["deviceName"], "Laptop");
    }
}
