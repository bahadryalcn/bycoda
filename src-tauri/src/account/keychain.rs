//! The OS credential store (Windows Credential Manager, macOS Keychain, Linux Secret
//! Service). Refresh tokens live only here; errors never carry the secret.
use super::error::AccountError;

const SERVICE: &str = "codes.bycoda.account";

pub(crate) trait SecretStore: Send + Sync {
    fn get(&self, account: &str) -> Result<Option<String>, AccountError>;
    fn set(&self, account: &str, secret: &str) -> Result<(), AccountError>;
    /// Deleting a missing entry succeeds.
    fn delete(&self, account: &str) -> Result<(), AccountError>;
}

pub(crate) struct OsStore;

fn entry(account: &str) -> Result<keyring::Entry, AccountError> {
    keyring::Entry::new(SERVICE, account).map_err(|_| AccountError::keychain())
}

impl SecretStore for OsStore {
    fn get(&self, account: &str) -> Result<Option<String>, AccountError> {
        match entry(account)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(AccountError::keychain()),
        }
    }

    fn set(&self, account: &str, secret: &str) -> Result<(), AccountError> {
        entry(account)?
            .set_password(secret)
            .map_err(|_| AccountError::keychain())
    }

    fn delete(&self, account: &str) -> Result<(), AccountError> {
        match entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(AccountError::keychain()),
        }
    }
}

#[cfg(test)]
#[derive(Default)]
pub(crate) struct MemoryStore(pub std::sync::Mutex<std::collections::HashMap<String, String>>);

#[cfg(test)]
impl SecretStore for MemoryStore {
    fn get(&self, account: &str) -> Result<Option<String>, AccountError> {
        Ok(self.0.lock().unwrap().get(account).cloned())
    }
    fn set(&self, account: &str, secret: &str) -> Result<(), AccountError> {
        self.0
            .lock()
            .unwrap()
            .insert(account.to_string(), secret.to_string());
        Ok(())
    }
    fn delete(&self, account: &str) -> Result<(), AccountError> {
        self.0.lock().unwrap().remove(account);
        Ok(())
    }
}
