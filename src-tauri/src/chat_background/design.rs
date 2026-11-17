//! Portable named designs. Metadata never contains a machine path; media travels inline.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::Path;
use tauri::{AppHandle, Window};

const MAX_ARTIFACT_BYTES: u64 = 140 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesignMetadata {
    name: String,
    kind: String,
    look: serde_json::Value,
    #[serde(default)]
    prompt: String,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Asset {
    extension: String,
    sha256: String,
    base64: String,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Artifact {
    format: String,
    version: u32,
    design: DesignMetadata,
    asset: Option<Asset>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedDesign {
    design: DesignMetadata,
    asset_path: Option<String>,
}

fn validate_metadata(design: &DesignMetadata) -> Result<(), String> {
    if design.name.trim().is_empty()
        || design.name.chars().count() > 160
        || !["theme", "image", "scene", "motion"].contains(&design.kind.as_str())
        || design.prompt.chars().count() > 2000
        || !design.look.is_object()
        || serde_json::to_vec(&design.look)
            .map_err(|e| e.to_string())?
            .len()
            > 32_000
    {
        return Err("Invalid design metadata".into());
    }
    Ok(())
}

fn validate_kind(kind: &str, extension: Option<&str>) -> Result<(), String> {
    let html = extension.is_some_and(|ext| ext == "html" || ext == "htm");
    if (kind == "scene" && !html)
        || (kind == "image" && (extension.is_none() || html))
        || (kind == "motion" && extension.is_some())
    {
        return Err("Design media does not match its type".into());
    }
    Ok(())
}

type DecodedAsset = (String, Vec<u8>);

fn decode_artifact(bytes: &[u8]) -> Result<(DesignMetadata, Option<DecodedAsset>), String> {
    if bytes.len() as u64 > MAX_ARTIFACT_BYTES {
        return Err("Design file is too large".into());
    }
    let artifact: Artifact = serde_json::from_slice(bytes).map_err(|_| "Invalid design file")?;
    if artifact.format != "bycoda-design" || artifact.version != 1 {
        return Err("Unsupported design file".into());
    }
    validate_metadata(&artifact.design)?;
    let asset = artifact
        .asset
        .map(|asset| -> Result<DecodedAsset, String> {
            let extension =
                super::background_extension(Path::new(&format!("asset.{}", asset.extension)))?;
            if extension != asset.extension {
                return Err("Invalid design media extension".into());
            }
            let bytes = STANDARD
                .decode(asset.base64)
                .map_err(|_| "Invalid design media encoding")?;
            let limit = match extension.as_str() {
                "mp4" | "webm" => 100 * 1024 * 1024,
                "html" | "htm" => 2 * 1024 * 1024,
                _ => super::MAX_BACKGROUND_BYTES as usize,
            };
            if bytes.len() > limit {
                return Err("Design media is too large".into());
            }
            super::validate_background_bytes(&bytes, &extension)?;
            if asset.sha256 != format!("{:x}", Sha256::digest(&bytes)) {
                return Err("Design media checksum does not match".into());
            }
            Ok((extension, bytes))
        })
        .transpose()?;
    validate_kind(
        &artifact.design.kind,
        asset.as_ref().map(|(extension, _)| extension.as_str()),
    )?;
    Ok((artifact.design, asset))
}

#[tauri::command]
pub async fn export_appearance_design(
    app: AppHandle,
    window: Window,
    path: String,
    design: DesignMetadata,
    asset_path: Option<String>,
) -> Result<(), String> {
    let admission = crate::native_window_lifecycle::admit_window_buffers(&window)?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        validate_metadata(&design)?;
        let asset = if let Some(source) = asset_path {
            let root = super::backgrounds_dir(&app)?
                .canonicalize()
                .map_err(|e| e.to_string())?;
            let source = Path::new(&source)
                .canonicalize()
                .map_err(|_| "Saved design media is missing")?;
            if !source.starts_with(root) {
                return Err("Design media is outside the library".into());
            }
            let extension = super::validate_background_file(&source)?;
            let bytes = super::read_background_bytes(&source, &extension)?;
            Some(Asset {
                extension,
                sha256: format!("{:x}", Sha256::digest(&bytes)),
                base64: STANDARD.encode(bytes),
            })
        } else {
            None
        };
        validate_kind(
            &design.kind,
            asset.as_ref().map(|asset| asset.extension.as_str()),
        )?;
        let artifact = Artifact {
            format: "bycoda-design".into(),
            version: 1,
            design,
            asset,
        };
        let bytes = serde_json::to_vec(&artifact).map_err(|e| e.to_string())?;
        if bytes.len() as u64 > MAX_ARTIFACT_BYTES {
            return Err("Design file is too large".into());
        }
        let target = crate::file_access::require(&app, Path::new(&path), true)?;
        crate::file_access::durable_write(&target, &bytes)
    })
    .await
    .map_err(|e| e.to_string())?;
    admission.finish(result)
}

#[tauri::command]
pub async fn import_appearance_design(
    app: AppHandle,
    window: Window,
    path: String,
) -> Result<ImportedDesign, String> {
    let admission = crate::native_window_lifecycle::admit_window_buffers(&window)?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        let source = crate::file_access::require(&app, Path::new(&path), false)?;
        let mut bytes = Vec::new();
        std::fs::File::open(source)
            .map_err(|e| e.to_string())?
            .take(MAX_ARTIFACT_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        let (design, asset) = decode_artifact(&bytes)?;
        let asset_path = asset
            .map(|(extension, bytes)| super::store_background_bytes(&app, &bytes, &extension))
            .transpose()?;
        Ok(ImportedDesign { design, asset_path })
    })
    .await
    .map_err(|e| e.to_string())?;
    admission.finish(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn artifact() -> serde_json::Value {
        let bytes = b"<html><b>scene</b></html>";
        serde_json::json!({"format":"bycoda-design","version":1,"design":{"name":"Lake","kind":"scene","look":{"image":{"scope":"all"}},"prompt":"lake at dusk"},"asset":{"extension":"html","sha256":format!("{:x}",Sha256::digest(bytes)),"base64":STANDARD.encode(bytes)}})
    }
    #[test]
    fn portable_scene_roundtrip_has_exact_source_and_no_path() {
        let bytes = serde_json::to_vec(&artifact()).unwrap();
        let (design, asset) = decode_artifact(&bytes).unwrap();
        assert_eq!(design.name, "Lake");
        assert_eq!(asset.unwrap().1, b"<html><b>scene</b></html>");
    }
    #[test]
    fn rejects_unknown_paths_corrupt_assets_missing_media_and_versions() {
        for mutate in [0, 1, 2, 3, 4] {
            let mut value = artifact();
            match mutate {
                0 => value["asset"]["path"] = "C:/secret".into(),
                1 => value["asset"]["sha256"] = "wrong".into(),
                2 => value["asset"] = serde_json::Value::Null,
                3 => value["version"] = 2.into(),
                _ => value["asset"]["extension"] = "../html".into(),
            }
            assert!(decode_artifact(&serde_json::to_vec(&value).unwrap()).is_err());
        }
    }
    #[test]
    fn motion_preset_can_travel_without_media() {
        let mut value = artifact();
        value["design"]["kind"] = "motion".into();
        value["asset"] = serde_json::Value::Null;
        assert!(decode_artifact(&serde_json::to_vec(&value).unwrap()).is_ok());
    }
}
