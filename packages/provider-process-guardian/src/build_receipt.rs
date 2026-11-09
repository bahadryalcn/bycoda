//! Durable exact-generation proof; no process or timestamp identity is inferred.
use crate::protocol::Retirement;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::Path,
};
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BuildReceipt {
    pub nonce: String,
    pub path: String,
}

impl BuildReceipt {
    pub fn valid(&self) -> bool {
        let Ok(id) = Uuid::parse_str(&self.nonce) else {
            return false;
        };
        let path = Path::new(&self.path);
        id.get_version_num() == 4
            && id.to_string() == self.nonce
            && path.is_absolute()
            && path.file_name().and_then(|v| v.to_str())
                == Some(format!(".bycoda-build-retired-{}.json", self.nonce).as_str())
    }
    pub fn publish(&self) -> io::Result<()> {
        if !self.valid() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Invalid receipt identity",
            ));
        }
        let destination = Path::new(&self.path);
        let temporary = destination.with_extension(format!("{}.tmp", Uuid::new_v4()));
        #[derive(Serialize)]
        struct Proof<'a> {
            version: u8,
            nonce: &'a str,
            retirement: &'static str,
        }
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        let result = (|| {
            serde_json::to_writer(
                &mut file,
                &Proof {
                    version: 1,
                    nonce: &self.nonce,
                    retirement: "verified",
                },
            )?;
            file.write_all(b"\n")?;
            file.sync_all()?;
            fs::hard_link(&temporary, destination)?;
            Ok(())
        })();
        drop(file);
        let _ = fs::remove_file(temporary);
        result
    }
}

pub fn publish_if_verified(
    receipt: Option<BuildReceipt>,
    retirement: Retirement,
    child_waited: bool,
) {
    if retirement == Retirement::Verified && child_waited {
        if let Some(receipt) = receipt {
            let _ = receipt.publish();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn receipt_is_exact_and_never_replaces_an_existing_file() {
        let nonce = Uuid::new_v4().to_string();
        let dir = std::env::temp_dir().join(format!("bycoda-receipt-test-{}", Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let path = dir.join(format!(".bycoda-build-retired-{nonce}.json"));
        let receipt = BuildReceipt {
            nonce: nonce.clone(),
            path: path.to_string_lossy().into_owned(),
        };
        assert!(receipt.valid());
        receipt.publish().unwrap();
        let original = fs::read(&path).unwrap();
        assert!(receipt.publish().is_err());
        assert_eq!(fs::read(&path).unwrap(), original);
        assert!(!BuildReceipt {
            nonce: Uuid::new_v4().to_string(),
            path: receipt.path
        }
        .valid());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn unknown_or_unwaited_retirement_cannot_publish_a_receipt() {
        let nonce = Uuid::new_v4().to_string();
        let dir = std::env::temp_dir().join(format!("bycoda-receipt-unknown-{}", Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let path = dir.join(format!(".bycoda-build-retired-{nonce}.json"));
        let proof = BuildReceipt {
            nonce,
            path: path.to_string_lossy().into_owned(),
        };
        publish_if_verified(Some(proof.clone()), Retirement::Unknown, true);
        publish_if_verified(Some(proof), Retirement::Verified, false);
        assert!(!path.exists());
        fs::remove_dir_all(dir).unwrap();
    }
}
