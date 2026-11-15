//! Credential-free route authentication. Public environment IDs grant no trust.
use super::*;
use ring::{
    hmac,
    rand::{SecureRandom, SystemRandom},
};

fn message(kind: &str, side: &str, nonce: &str, environment_id: &str, origin: &str) -> String {
    format!("bycoda-host-proof-v1\n{kind}\n{side}\n{nonce}\n{environment_id}\n{origin}")
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// A request tag identifies the secret without sending its SHA-256 hash (the
/// proof key). Separate response tags cannot be forged by echoing the request.
pub(crate) fn verify(
    origin: &str,
    environment_id: &str,
    secret: &str,
    kind: &str,
) -> Result<(), String> {
    let mut bytes = [0u8; 32];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| "Host proof nonce unavailable")?;
    let nonce = hex(&bytes);
    let digest = hex(&Sha256::digest(secret.as_bytes()));
    let key = hmac::Key::new(hmac::HMAC_SHA256, digest.as_bytes());
    let proof = hex(hmac::sign(
        &key,
        message(kind, "request", &nonce, environment_id, origin).as_bytes(),
    )
    .as_ref());
    let response = ureq::AgentBuilder::new()
        .redirects(0)
        .timeout(std::time::Duration::from_secs(6))
        .build()
        .post(&format!("{origin}/.well-known/bycoda-host/proof"))
        .set("Content-Type", "application/json")
        .send_string(&json!({"kind": kind, "nonce": nonce, "environmentId": environment_id, "origin": origin, "proof": proof}).to_string())
        .map_err(|_| "Host possession proof could not be verified")?;
    let reply: Value = serde_json::from_reader(response.into_reader().take(4096))
        .map_err(|_| "Invalid Host possession proof")?;
    let supplied = reply["result"]["proof"]
        .as_str()
        .ok_or("Missing Host possession proof")?;
    if supplied.len() != 64 || !supplied.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Invalid Host possession proof".into());
    }
    let tag: Vec<u8> = (0..64)
        .step_by(2)
        .map(|index| u8::from_str_radix(&supplied[index..index + 2], 16).unwrap())
        .collect();
    hmac::verify(
        &key,
        message(kind, "response", &nonce, environment_id, origin).as_bytes(),
        &tag,
    )
    .map_err(|_| "Host possession proof did not match".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn node_and_native_share_the_same_protocol_vector() {
        let digest = hex(&Sha256::digest(b"fixture-secret"));
        let key = hmac::Key::new(hmac::HMAC_SHA256, digest.as_bytes());
        assert_eq!(
            hex(hmac::sign(
                &key,
                message(
                    "device",
                    "response",
                    &"0".repeat(64),
                    "env",
                    "https://host.test"
                )
                .as_bytes()
            )
            .as_ref()),
            "ada6ab4aafb0487bb059cbcbbe3a23c89a948c1e70ca979ccdb84ff60d38b823"
        );
    }

    /// HTTP fixture speaks the Host proof protocol and records every byte sent.
    #[test]
    fn fake_host_gets_no_secret_and_real_possession_passes_for_both_kinds() {
        for kind in ["pairing", "device"] {
            for genuine in [false, true] {
                let listener = TcpListener::bind("127.0.0.1:0").unwrap();
                let origin = format!("http://{}", listener.local_addr().unwrap());
                let server = std::thread::spawn(move || {
                    let (mut stream, _) = listener.accept().unwrap();
                    stream
                        .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                        .unwrap();
                    let mut bytes = Vec::new();
                    let mut byte = [0];
                    while !bytes.ends_with(b"\r\n\r\n") {
                        stream.read_exact(&mut byte).unwrap();
                        bytes.push(byte[0]);
                    }
                    let headers = String::from_utf8(bytes).unwrap();
                    assert!(!headers.to_ascii_lowercase().contains("authorization"));
                    let length: usize = headers
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(|value| value.trim().parse().unwrap())
                        })
                        .unwrap();
                    let mut body = vec![0; length];
                    stream.read_exact(&mut body).unwrap();
                    let text = String::from_utf8(body).unwrap();
                    assert!(!text.contains("ticket-or-bearer-secret"));
                    let digest = hex(&Sha256::digest(b"ticket-or-bearer-secret"));
                    assert!(!text.contains(&digest));
                    let input: Value = serde_json::from_str(&text).unwrap();
                    assert_eq!(input["environmentId"], "expected-environment");
                    let tag = if genuine {
                        let key = hmac::Key::new(hmac::HMAC_SHA256, digest.as_bytes());
                        hex(hmac::sign(
                            &key,
                            message(
                                kind,
                                "response",
                                input["nonce"].as_str().unwrap(),
                                "expected-environment",
                                input["origin"].as_str().unwrap(),
                            )
                            .as_bytes(),
                        )
                        .as_ref())
                    } else {
                        // Correct public identity and an echoed request still prove nothing.
                        input["proof"].as_str().unwrap().to_string()
                    };
                    let body =
                        json!({"environmentId":"expected-environment", "result":{"proof":tag}})
                            .to_string();
                    write!(
                        stream,
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    )
                    .unwrap();
                });
                assert_eq!(
                    verify(
                        &origin,
                        "expected-environment",
                        "ticket-or-bearer-secret",
                        kind
                    )
                    .is_ok(),
                    genuine
                );
                server.join().unwrap();
            }
        }
    }
}
