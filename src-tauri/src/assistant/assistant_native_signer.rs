//! Native-only Ed25519 installation identity. Public identity is exported for
//! explicit out-of-band Host-owner enrollment; no Host may enroll itself.
use std::io::Write;
use std::path::Path;
use base64::{engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD}, Engine};
use ring::{rand::SystemRandom, signature::{Ed25519KeyPair, KeyPair}};
use sha2::{Digest, Sha256};
use serde_json::{json, Value};

pub(crate) struct NativeSigner { key: Ed25519KeyPair }
impl NativeSigner {
    pub(crate) fn load_or_create(path: &Path) -> Result<Self, String> {
        if path.exists() { return Self::load(path); }
        let parent = path.parent().ok_or("Native key directory unavailable")?;
        std::fs::create_dir_all(parent).map_err(|_| "Native key directory unavailable")?;
        let bytes = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new()).map_err(|_| "Native key generation failed")?;
        let temp = parent.join(format!(".native-admission-{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| -> Result<(), String> {
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
            let mut file = options.open(&temp).map_err(|_| "Native key creation failed")?;
            file.write_all(bytes.as_ref()).map_err(|_| "Native key creation failed")?;
            file.sync_all().map_err(|_| "Native key creation failed")?;
            match std::fs::hard_link(&temp, path) {
                Ok(()) => {},
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {},
                Err(_) => return Err("Native key publication failed".into()),
            }
            Ok(())
        })();
        let _ = std::fs::remove_file(&temp);
        result?;
        Self::load(path)
    }
    fn load(path: &Path) -> Result<Self, String> {
        let metadata = std::fs::symlink_metadata(path).map_err(|_| "Native key unavailable")?;
        if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 1024 { return Err("Invalid native key; owner recovery required".into()); }
        let bytes = zeroize::Zeroizing::new(std::fs::read(path).map_err(|_| "Native key unavailable")?);
        let key = Ed25519KeyPair::from_pkcs8(&bytes).map_err(|_| "Invalid native key; owner recovery required")?;
        Ok(Self { key })
    }
    pub(crate) fn identity(&self) -> Value {
        // Ed25519 SubjectPublicKeyInfo: RFC 8410 algorithm identifier + raw key.
        let mut der = vec![0x30,0x2a,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x03,0x21,0x00];
        der.extend_from_slice(self.key.public_key().as_ref());
        let fingerprint = format!("{:x}", Sha256::digest(&der));
        json!({"installationId":format!("native-{}",&fingerprint[..32]),"publicKey":format!("-----BEGIN PUBLIC KEY-----\n{}\n-----END PUBLIC KEY-----\n",STANDARD.encode(&der)),"fingerprint":fingerprint})
    }
    /** Caller verifies exact local WindowIssuer and reviewed operation digest before signing. */
    pub(crate) fn sign_challenge(&self, challenge: &Value, expected_host: &str, expected_action: &str, expected_digest: &str) -> Result<Value, String> {
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_| "Clock unavailable")?.as_millis() as u64;
        self.sign_challenge_at(challenge, expected_host, expected_action, expected_digest, now)
    }
    fn sign_challenge_at(&self, challenge: &Value, expected_host: &str, expected_action: &str, expected_digest: &str, now: u64) -> Result<Value, String> {
        let identity = self.identity();
        if challenge["installationId"] != identity["installationId"] || challenge["hostId"] != expected_host || challenge["action"] != expected_action || challenge["requestDigest"] != expected_digest { return Err("Native approval challenge does not match the reviewed operation".into()); }
        let nonce = challenge["nonce"].as_str().filter(|s| s.len()==64 && s.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))).ok_or("Invalid native approval nonce")?;
        let expires = challenge["expiresAt"].as_u64().ok_or("Invalid native approval expiry")?;
        if expires <= now || expires > now.saturating_add(30_000) { return Err("Native approval challenge expired".into()); }
        let bytes = serde_json::to_vec(&json!(["bycoda-native-admission-v1",identity["installationId"],expected_host,expected_action,expected_digest,nonce,expires])).map_err(|_| "Invalid native approval")?;
        Ok(json!({"challenge":challenge,"signature":URL_SAFE_NO_PAD.encode(self.key.sign(&bytes).as_ref())}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_key_persists_and_only_signs_exact_challenge() {
        let directory = std::env::temp_dir().join(format!("bycoda-native-key-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("key.pk8");
        let first = NativeSigner::load_or_create(&path).unwrap();
        let identity = first.identity();
        let second = NativeSigner::load_or_create(&path).unwrap();
        assert_eq!(identity, second.identity());
        let expires = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64 + 10_000;
        let challenge = json!({"installationId":identity["installationId"],"hostId":"host", "action":"assistant.delegation.issue", "requestDigest":"a".repeat(64), "nonce":"b".repeat(64), "expiresAt":expires});
        assert!(first.sign_challenge(&challenge, "host", "assistant.delegation.issue", &"a".repeat(64)).is_ok());
        assert!(first.sign_challenge(&challenge, "other", "assistant.delegation.issue", &"a".repeat(64)).is_err());
        assert!(first.sign_challenge(&challenge, "host", "assistant.delegation.issue", &"c".repeat(64)).is_err());
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn rust_node_native_proof_vector_preserves_turkish_input() {
        let key = Ed25519KeyPair::from_seed_unchecked(&[1u8; 32]).unwrap();
        let signer = NativeSigner { key };
        let operation = "{\"text\":\"İstanbul için çalışma\"}";
        let digest = format!("{:x}", Sha256::digest(operation.as_bytes()));
        assert_eq!(digest, "60506d7e46f9de7139fa04d4e8e07ff3f363d678a82dd116a5fc5e6baf085614");
        assert_eq!(signer.identity()["installationId"], "native-fd110d301d2f077de1414b8f99f441b1");
        let challenge = json!({"installationId":signer.identity()["installationId"],"hostId":"host","action":"assistant.delegation.issue","requestDigest":digest,"nonce":"b".repeat(64),"expiresAt":2000});
        let proof = signer.sign_challenge_at(&challenge, "host", "assistant.delegation.issue", &digest, 1000).unwrap();
        assert_eq!(proof["signature"], "lh0won5CPeE4qugKK48x17KvxE43EAIu_xjhXmqtb6HQmVDP4zMDK8L6f9HDDFgnw6lPRXFJqixlxaQOJp44AA");
    }
}
