//! Device proof-of-possession (spec v1, `temp/local/ingress-authority/dpop-spec.md`): every
//! request made with a device credential carries a short-lived Ed25519 proof in the `DPoP`
//! header. Byte-compatible with `src/integrations/device-proof.ts`; the pinned vector is tested.
//!
//! The 32-byte seed of one credential lives in the saved machine record, sealed like its token
//! (`credential_store`). Signing finds the seed by token, so every transport that sends
//! `Authorization: Bearer <device token>` only asks `header_for`.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ring::{
    rand::{SecureRandom, SystemRandom},
    signature::{Ed25519KeyPair, KeyPair},
};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Mutex;

pub(crate) const HEADER: &str = "DPoP";
pub(crate) const CAPABILITY: &str = "auth.deviceProof.v1";

pub(crate) type Seed = [u8; 32];

fn b64(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

pub(crate) fn generate_seed() -> Result<Seed, String> {
    let mut seed = [0u8; 32];
    SystemRandom::new()
        .fill(&mut seed)
        .map_err(|_| "A device key could not be generated")?;
    Ok(seed)
}

pub(crate) fn encode_seed(seed: &Seed) -> String {
    b64(seed)
}

pub(crate) fn decode_seed(text: &str) -> Option<Seed> {
    URL_SAFE_NO_PAD.decode(text).ok()?.try_into().ok()
}

fn key_pair(seed: &Seed) -> Result<Ed25519KeyPair, String> {
    Ed25519KeyPair::from_seed_unchecked(seed).map_err(|_| "Invalid device key".to_string())
}

/// The public key `x` of the JWK, base64url without padding.
pub(crate) fn public_x(seed: &Seed) -> Result<String, String> {
    Ok(b64(key_pair(seed)?.public_key().as_ref()))
}

/// The public JWK sent as `proofKey` when a credential is issued or bound.
pub(crate) fn public_jwk(seed: &Seed) -> Result<serde_json::Value, String> {
    Ok(json!({"kty": "OKP", "crv": "Ed25519", "x": public_x(seed)?}))
}

/// RFC 7638 thumbprint, as the Host stores it (only the tests compare it here): SHA-256 of the members in the fixed order crv, kty, x.
#[cfg(test)]
pub(crate) fn thumbprint(x: &str) -> String {
    b64(&Sha256::digest(
        format!(r#"{{"crv":"Ed25519","kty":"OKP","x":"{x}"}}"#).as_bytes(),
    ))
}

fn text(value: &str) -> String {
    serde_json::Value::String(value.to_owned()).to_string()
}

/// `htu` is the path without query or fragment.
fn path_only(path: &str) -> &str {
    path.split(['?', '#']).next().unwrap_or(path)
}

pub(crate) fn sign_at(
    seed: &Seed,
    token: &str,
    method: &str,
    path: &str,
    environment_id: &str,
    jti: &str,
    iat: u64,
) -> Result<String, String> {
    let pair = key_pair(seed)?;
    let x = b64(pair.public_key().as_ref());
    let header = format!(
        r#"{{"typ":"dpop+jwt","alg":"EdDSA","jwk":{{"kty":"OKP","crv":"Ed25519","x":"{x}"}}}}"#
    );
    let payload = format!(
        r#"{{"jti":{},"htm":{},"htu":{},"iat":{iat},"ath":{},"eid":{}}}"#,
        text(jti),
        text(&method.to_ascii_uppercase()),
        text(path_only(path)),
        text(&b64(&Sha256::digest(token.as_bytes()))),
        text(environment_id),
    );
    let signing_input = format!("{}.{}", b64(header.as_bytes()), b64(payload.as_bytes()));
    let signature = pair.sign(signing_input.as_bytes());
    Ok(format!("{signing_input}.{}", b64(signature.as_ref())))
}

/// A fresh proof for one request: random `jti`, current `iat`.
pub(crate) fn sign(
    seed: &Seed,
    token: &str,
    method: &str,
    path: &str,
    environment_id: &str,
) -> Result<String, String> {
    let mut jti = [0u8; 16];
    SystemRandom::new()
        .fill(&mut jti)
        .map_err(|_| "A device proof could not be generated")?;
    let iat = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "The system clock is before 1970")?
        .as_secs();
    sign_at(seed, token, method, path, environment_id, &b64(&jti), iat)
}

#[derive(Clone)]
struct Binding {
    seed: Seed,
    environment_id: String,
}

/// Seeds of the saved machines, rebuilt on every store read.
static SAVED: Mutex<Option<HashMap<String, Binding>>> = Mutex::new(None);
/// Seeds of a credential that is being paired or bound and is not saved yet.
static PENDING: Mutex<Option<HashMap<String, Binding>>> = Mutex::new(None);

fn lookup(token: &str) -> Option<Binding> {
    for registry in [&PENDING, &SAVED] {
        let guard = registry.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(found) = guard.as_ref().and_then(|map| map.get(token)) {
            return Some(found.clone());
        }
    }
    None
}

/// Replaces the saved seeds: `(token, environment id, seed)` of every machine that has one.
pub(crate) fn replace_saved(entries: impl Iterator<Item = (String, String, Seed)>) {
    let map = entries
        .map(|(token, environment_id, seed)| {
            (
                token,
                Binding {
                    seed,
                    environment_id,
                },
            )
        })
        .collect();
    *SAVED.lock().unwrap_or_else(|e| e.into_inner()) = Some(map);
}

/// Signs requests of a credential before it is saved (pairing, upgrade); see `PendingProof`.
pub(crate) struct PendingProof {
    token: String,
}

impl PendingProof {
    pub(crate) fn new(token: &str, environment_id: &str, seed: Seed) -> Self {
        PENDING
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get_or_insert_with(HashMap::new)
            .insert(
                token.to_owned(),
                Binding {
                    seed,
                    environment_id: environment_id.to_owned(),
                },
            );
        Self {
            token: token.to_owned(),
        }
    }
}

impl Drop for PendingProof {
    fn drop(&mut self) {
        if let Some(map) = PENDING.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
            map.remove(&self.token);
        }
    }
}

/// The `DPoP` header value for a request made with `token`, or `None` when the credential has
/// no key (not paired with one yet, or a non-device bearer such as a capability).
pub(crate) fn header_for(token: &str, method: &str, path: &str) -> Option<String> {
    let binding = lookup(token)?;
    sign(&binding.seed, token, method, path, &binding.environment_id).ok()
}

/// A Host that answered `X-Bycoda-Auth-Stage: proof` refused the device proof itself.
pub(crate) const STAGE_HEADER: &str = "X-Bycoda-Auth-Stage";

#[cfg(test)]
mod tests {
    use super::*;

    const SEED: Seed = {
        let mut seed = [0u8; 32];
        let mut index = 0;
        while index < 32 {
            seed[index] = index as u8;
            index += 1;
        }
        seed
    };
    const X: &str = "A6EHv_POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg";
    const TOKEN: &str = "gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp8";
    const PROOF: &str = "eyJ0eXAiOiJkcG9wK2p3dCIsImFsZyI6IkVkRFNBIiwiandrIjp7Imt0eSI6Ik9LUCIsImNydiI6IkVkMjU1MTkiLCJ4IjoiQTZFSHZfUE9FTDRkY04wWTUwdkFtV2ZrMWpDYnBRMWZIZHlHWkJKVk1iZyJ9fQ.eyJqdGkiOiJBQUVDQXdRRkJnY0lDUW9MREEwT0R3IiwiaHRtIjoiUE9TVCIsImh0dSI6Ii9ycGMiLCJpYXQiOjE3OTAwMDAwMDAsImF0aCI6InJONHpKMjhBRzczUGJzSjJuUjhsSFdIMGVJcU51S1NWckc0QndIYVJIR0UiLCJlaWQiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEifQ.MFIkUC7G-TknFRRokVtOYcsWXHjsyrjtskB9-UgEvq4SEV2zoVtxYIIwfr-PECPOfAXx-sikHf1dA-qjL076Aw";

    #[test]
    fn reproduces_the_pinned_vector_exactly() {
        assert_eq!(public_x(&SEED).unwrap(), X);
        assert_eq!(thumbprint(X), "1IG2tMH7J2wbJZnOf8LJzQitKf7LMvoAElsuDMVM54Y");
        let proof = sign_at(
            &SEED,
            TOKEN,
            "post",
            "/rpc?ignored=1",
            "00000000-0000-4000-8000-000000000001",
            "AAECAwQFBgcICQoLDA0ODw",
            1_790_000_000,
        )
        .unwrap();
        assert_eq!(proof, PROOF);
    }

    #[test]
    fn seeds_round_trip_and_reject_other_lengths() {
        let seed = generate_seed().unwrap();
        assert_eq!(decode_seed(&encode_seed(&seed)), Some(seed));
        assert_eq!(decode_seed("AAAA"), None);
        assert_eq!(public_jwk(&SEED).unwrap()["x"], X);
    }

    #[test]
    fn signs_only_for_registered_credentials_and_pending_ones_leave() {
        let token = "registered-token-for-the-proof-test";
        assert!(header_for(token, "POST", "/rpc").is_none());
        {
            let _pending = PendingProof::new(token, "env-1", SEED);
            let proof = header_for(token, "GET", "/ws").unwrap();
            assert_eq!(proof.split('.').count(), 3);
        }
        assert!(header_for(token, "POST", "/rpc").is_none());
    }
}
