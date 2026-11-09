//! Reads conversation visuals that the local Host stored by content hash
//! (host/conversation/inline-visual-store.ts). Read-only and id-addressed: the
//! renderer can never name a path, and a file whose hash differs is rejected.
use sha2::{Digest, Sha256};
use std::path::Path;

// 512,000 HTML characters can take about 3 bytes each once UTF-8 and JSON escaped.
const MAX_BYTES: u64 = 4 * 1024 * 1024;

fn valid_id(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn read_visual(dir: &Path, id: &str) -> Result<String, String> {
    if !valid_id(id) {
        return Err("Invalid visual id".into());
    }
    let path = dir.join("inline-visuals").join(format!("{id}.json"));
    let size = std::fs::metadata(&path)
        .map_err(|_| "Visual is not stored on this machine".to_string())?
        .len();
    if size > MAX_BYTES {
        return Err("Visual is too large".into());
    }
    let bytes = std::fs::read(&path).map_err(|_| "Visual could not be read".to_string())?;
    if format!("{:x}", Sha256::digest(&bytes)) != id {
        return Err("Visual content does not match its id".into());
    }
    String::from_utf8(bytes).map_err(|_| "Visual is not valid text".to_string())
}

/// Returns the stored JSON; the renderer validates its shape before use.
#[tauri::command]
pub async fn inline_visual_read(id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = crate::local_host::host_data_dir()
            .ok_or_else(|| "Local Host data folder is unknown".to_string())?;
        read_visual(&dir, &id)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_only_hash_matching_files_by_id() {
        let dir = std::env::temp_dir().join(format!("bycoda-inline-visual-{}", std::process::id()));
        let folder = dir.join("inline-visuals");
        std::fs::create_dir_all(&folder).unwrap();
        let body = r#"{"version":1,"title":"Chart","html":"<b>x</b>","height":200}"#;
        let id = format!("{:x}", Sha256::digest(body.as_bytes()));
        std::fs::write(folder.join(format!("{id}.json")), body).unwrap();
        assert_eq!(read_visual(&dir, &id).unwrap(), body);

        let forged = format!("{:x}", Sha256::digest(b"other"));
        std::fs::write(folder.join(format!("{forged}.json")), body).unwrap();
        assert!(read_visual(&dir, &forged).is_err());
        assert!(read_visual(&dir, "../secret").is_err());
        assert!(read_visual(&dir, &id.to_uppercase()).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
