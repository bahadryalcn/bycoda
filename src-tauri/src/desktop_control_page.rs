//! A routing guard for one native webview incarnation. This is not execution authority.
use crate::control::receipts::WindowIssuer;
use std::sync::{Arc, Mutex, OnceLock};

#[derive(Default)]
struct PageTokens {
    entries: Vec<(Arc<WindowIssuer>, String)>,
}
impl PageTokens {
    fn issue(&mut self, owner: &Arc<WindowIssuer>) -> Result<String, String> {
        self.entries.retain(|(issuer, _)| !issuer.is_retired());
        if let Some((_, token)) = self
            .entries
            .iter()
            .find(|(issuer, _)| Arc::ptr_eq(issuer, owner))
        {
            return Ok(token.clone());
        }
        if self.entries.len() >= 64 {
            return Err("Desktop page ownership capacity is full.".into());
        }
        let token = uuid::Uuid::new_v4().to_string();
        self.entries.push((owner.clone(), token.clone()));
        Ok(token)
    }
    fn verify(&self, owner: &Arc<WindowIssuer>, token: &str) -> Result<(), String> {
        if self
            .entries
            .iter()
            .any(|(issuer, original)| Arc::ptr_eq(issuer, owner) && original == token)
        {
            Ok(())
        } else {
            Err("Desktop command belongs to another page.".into())
        }
    }
}
fn tokens() -> &'static Mutex<PageTokens> {
    static TOKENS: OnceLock<Mutex<PageTokens>> = OnceLock::new();
    TOKENS.get_or_init(|| Mutex::new(PageTokens::default()))
}

#[tauri::command]
pub fn desktop_control_page_token(window: tauri::WebviewWindow) -> Result<String, String> {
    let owner = crate::control::receipts::capture(&window)?;
    owner.with_live(|| {
        tokens()
            .lock()
            .map_err(|_| "Desktop page ownership unavailable.")?
            .issue(&owner)
    })
}

#[tauri::command]
pub fn desktop_control_page_verify(
    window: tauri::WebviewWindow,
    token: String,
) -> Result<(), String> {
    let owner = crate::control::receipts::capture(&window)?;
    owner.with_live(|| {
        tokens()
            .lock()
            .map_err(|_| "Desktop page ownership unavailable.")?
            .verify(&owner, &token)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_issuer_is_required_and_retired_pages_release_capacity() {
        let mut registry = PageTokens::default();
        let owner = Arc::new(WindowIssuer::default());
        let other = Arc::new(WindowIssuer::default());
        let token = registry.issue(&owner).unwrap();
        assert_eq!(registry.issue(&owner).unwrap(), token);
        assert!(registry.verify(&other, &token).is_err());
        for _ in 0..100 {
            let retired = Arc::new(WindowIssuer::default());
            registry.issue(&retired).unwrap();
            tauri::Resource::close(retired);
        }
        registry.issue(&other).unwrap();
        assert_eq!(registry.entries.len(), 2);
        assert!(registry.verify(&owner, &token).is_ok());
        tauri::Resource::close(owner.clone());
        assert!(owner.with_live(|| registry.verify(&owner, &token)).is_err());
    }
}
