//! Binding a saved credential to a client key: the key a new pairing is issued with, and the
//! upgrade of a credential that was paired before device proof existed.
use super::*;
use std::time::{Duration, Instant};

/// The client key a new pairing was redeemed with, and the Host that issued the credential.
pub(crate) struct PairingKey {
    pub(crate) seed: device_proof::Seed,
    pub(crate) environment_id: String,
}

impl PairingKey {
    pub(crate) fn new(seed: device_proof::Seed, environment_id: &str) -> Self {
        Self {
            seed,
            environment_id: environment_id.to_owned(),
        }
    }

    /// Signs requests made with `token` until the guard is dropped (the machine is not saved yet).
    pub(crate) fn sign_for(&self, token: &str) -> device_proof::PendingProof {
        device_proof::PendingProof::new(token, &self.environment_id, self.seed)
    }

    pub(crate) fn encoded_seed(&self) -> String {
        device_proof::encode_seed(&self.seed)
    }
}

/// What the Host says about the caller's own credential, when it speaks device proof at all:
/// `(localDesktop, proofBound)`.
fn credential_state(descriptor: &Value) -> Option<(Option<bool>, Option<bool>)> {
    descriptor["capabilities"]
        .as_array()?
        .iter()
        .any(|item| item == device_proof::CAPABILITY)
        .then(|| {
            (
                descriptor["credential"]["localDesktop"].as_bool(),
                descriptor["credential"]["proofBound"].as_bool(),
            )
        })
}

/// The automatic local link is replaced when the Host reports that its credential is not this
/// computer's own, or has no key.
pub(super) fn needs_local_repair(descriptor: &Value) -> bool {
    credential_state(descriptor)
        .is_some_and(|(local, bound)| local == Some(false) || bound == Some(false))
}

/// A failing bind is tried again at most this often per machine.
const RETRY_AFTER: Duration = Duration::from_secs(60);
static ATTEMPTS: Mutex<Option<HashMap<String, Instant>>> = Mutex::new(None);

fn attempt_due(machine_id: &str) -> bool {
    let mut guard = ATTEMPTS.lock().unwrap_or_else(|e| e.into_inner());
    let attempts = guard.get_or_insert_with(HashMap::new);
    if attempts
        .get(machine_id)
        .is_some_and(|last| last.elapsed() < RETRY_AFTER)
    {
        return false;
    }
    attempts.insert(machine_id.to_owned(), Instant::now());
    true
}

/// After a successful `environment.describe`: a credential that predates device proof is bound
/// to a key now. The key is saved before the request, so an uncertain failure keeps it and the
/// next connect asks again with the same key. The automatic local link is re-paired instead
/// (`local_host`), and a public tunnel never reaches here for an unbound credential.
pub(super) fn upgrade(
    app: &AppHandle,
    state: &RemoteConnections,
    machine: &StoredMachine,
    descriptor: &Value,
) {
    if credential_state(descriptor).is_none_or(|(_, bound)| bound != Some(false))
        || is_local_sync(machine, &crate::local_host::local_device_name())
        || !attempt_due(&machine.id)
    {
        return;
    }
    if let Err(error) = bind(app, state, machine) {
        log::warn!("device proof: binding a saved credential failed: {error}");
    }
}

fn bind(app: &AppHandle, state: &RemoteConnections, machine: &StoredMachine) -> Result<(), String> {
    let seed = {
        let _guard = state
            .store
            .lock()
            .map_err(|_| "Connection store is locked")?;
        let path = store_path(app)?;
        let mut machines = read(&path)?;
        let saved = machines
            .iter_mut()
            .find(|saved| same_request_route(machine, saved))
            .ok_or("Connection changed")?;
        match saved.seed() {
            Some(seed) => seed,
            None => {
                let seed = device_proof::generate_seed()?;
                saved.proof_seed = Some(device_proof::encode_seed(&seed));
                write(&path, &machines)?;
                seed
            }
        }
    };
    let mut keyed = machine.clone();
    keyed.proof_seed = Some(device_proof::encode_seed(&seed));
    machine_rpc(
        state,
        &keyed,
        "devices.bindProofKey",
        json!({ "proofKey": device_proof::public_jwk(&seed)? }),
        false,
    )?;
    // Sockets opened before the bind carry no proof.
    state.invalidate_ws(&machine.id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn describe(local: bool, bound: bool, capable: bool) -> Value {
        json!({
            "capabilities": if capable { json!([device_proof::CAPABILITY]) } else { json!([]) },
            "credential": {"localDesktop": local, "proofBound": bound},
        })
    }

    #[test]
    fn the_local_link_is_repaired_only_by_a_host_that_speaks_device_proof() {
        assert!(!needs_local_repair(&describe(true, true, true)));
        assert!(needs_local_repair(&describe(false, true, true)));
        assert!(needs_local_repair(&describe(true, false, true)));
        assert!(!needs_local_repair(&describe(false, false, false)));
        assert!(!needs_local_repair(
            &json!({"capabilities": [device_proof::CAPABILITY]})
        ));
    }

    #[test]
    fn a_failing_bind_is_not_retried_within_a_minute() {
        assert!(attempt_due("proof-binding-test-machine"));
        assert!(!attempt_due("proof-binding-test-machine"));
        assert!(attempt_due("proof-binding-other-machine"));
    }
}
