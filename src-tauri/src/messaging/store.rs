use super::types::{Account, Secret};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Serializes read-modify-write cycles on the account list.
pub(crate) static STORE_LOCK: Mutex<()> = Mutex::new(());

pub(crate) struct Store {
    root: PathBuf,
}

impl Store {
    pub(crate) fn new(app_data: &Path) -> Self {
        Self {
            root: app_data.join("messaging"),
        }
    }

    fn accounts_path(&self) -> PathBuf {
        self.root.join("accounts.json")
    }

    fn secret_path(&self, id: &str) -> Result<PathBuf, String> {
        valid_id(id)?;
        Ok(self.root.join("secrets").join(format!("{id}.json")))
    }

    /// Missing file means no accounts; a corrupt file fails closed and is left in place.
    pub(crate) fn accounts(&self) -> Result<Vec<Account>, String> {
        match fs::read_to_string(self.accounts_path()) {
            Ok(raw) => serde_json::from_str(&raw)
                .map_err(|error| format!("Messaging accounts file is unreadable: {error}")),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(error) => Err(error.to_string()),
        }
    }

    pub(crate) fn write_accounts(&self, accounts: &[Account]) -> Result<(), String> {
        let raw = serde_json::to_string_pretty(accounts).map_err(|error| error.to_string())?;
        write_atomic(&self.accounts_path(), raw.as_bytes(), false)
    }

    pub(crate) fn secret(&self, id: &str) -> Result<Option<Secret>, String> {
        match fs::read_to_string(self.secret_path(id)?) {
            Ok(raw) => serde_json::from_str(&raw)
                .map(Some)
                .map_err(|_| "Stored credentials are unreadable. Reconnect this account.".into()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }

    pub(crate) fn write_secret(&self, id: &str, secret: &Secret) -> Result<(), String> {
        let raw = serde_json::to_vec(secret).map_err(|error| error.to_string())?;
        write_atomic(&self.secret_path(id)?, &raw, true)
    }

    pub(crate) fn delete_secret(&self, id: &str) -> Result<(), String> {
        match fs::remove_file(self.secret_path(id)?) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
}

pub(crate) fn valid_id(id: &str) -> Result<(), String> {
    if !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        Ok(())
    } else {
        Err("Invalid account id.".into())
    }
}

/// Temp file, fsync, then rename (rule rust-rename-without-fsync). Secret files are owner-only on Unix.
fn write_atomic(path: &Path, bytes: &[u8], secret: bool) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid storage path.")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temp = path.with_extension(format!("tmp-{}", uuid::Uuid::new_v4().simple()));
    let result = (|| {
        let mut options = fs::OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        if secret {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        #[cfg(not(unix))]
        let _ = secret;
        let mut file = options.open(&temp).map_err(|error| error.to_string())?;
        file.write_all(bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        drop(file);
        fs::rename(&temp, path).map_err(|error| error.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messaging::types::Provider;
    use serde_json::json;

    fn temp_root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "bycoda-messaging-{}",
            uuid::Uuid::new_v4().simple()
        ))
    }

    #[test]
    fn accounts_and_secrets_round_trip_and_missing_is_empty() {
        let root = temp_root();
        let store = Store::new(&root);
        assert!(store.accounts().unwrap().is_empty());
        assert!(store.secret("abc").unwrap().is_none());
        let account = Account {
            id: "abc".into(),
            provider: Provider::Slack,
            label: "Work".into(),
            identity: "team".into(),
            config: json!({}),
            created_at: 1,
            updated_at: 2,
        };
        store.write_accounts(&[account]).unwrap();
        assert_eq!(store.accounts().unwrap()[0].label, "Work");
        let mut secret = Secret::new();
        secret.insert("botToken".into(), json!("xoxb-1"));
        store.write_secret("abc", &secret).unwrap();
        assert_eq!(store.secret("abc").unwrap().unwrap(), secret);
        store.delete_secret("abc").unwrap();
        assert!(store.secret("abc").unwrap().is_none());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn corrupt_accounts_fail_closed_and_ids_are_path_safe() {
        let root = temp_root();
        let store = Store::new(&root);
        fs::create_dir_all(root.join("messaging")).unwrap();
        fs::write(root.join("messaging/accounts.json"), "{not json").unwrap();
        assert!(store.accounts().is_err());
        assert!(store.secret("../escape").is_err());
        assert!(valid_id("a-1").is_ok());
        assert!(valid_id("").is_err());
        let _ = fs::remove_dir_all(root);
    }
}
