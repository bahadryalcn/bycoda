//! App update checks for the update channel the user chose in Settings.
//!
//! Stable reads only the feed configured in `tauri.conf.json`. Preview also reads the
//! preview feed and offers whichever signed release is newer, so a preview user still
//! receives the next stable release once it overtakes the last preview. Both feeds are
//! fixed here: the renderer picks a channel, never a URL. Signatures are verified by the
//! updater plugin with the configured public key either way.

use serde::Serialize;
use tauri::{Manager, ResourceId, Runtime, Webview};
use tauri_plugin_updater::{Update, UpdaterBuilder, UpdaterExt};
use url::Url;

/// Must match `previewFeedUrl` in `scripts/release/release-candidate.mjs` (tested there).
pub const PREVIEW_FEED_URL: &str =
    "https://github.com/bahadryalcn/bycoda/releases/download/updater-feed/preview.json";

/// Same shape as the updater plugin's `check` result, so the renderer can wrap it in the
/// plugin's `Update` class and reuse its download and install commands.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    rid: ResourceId,
    current_version: String,
    version: String,
    body: Option<String>,
    raw_json: serde_json::Value,
}

async fn check(builder: UpdaterBuilder) -> Result<Option<Update>, String> {
    let updater = builder
        .header("Cache-Control", "no-cache")
        .and_then(|builder| builder.build())
        .map_err(|error| error.to_string())?;
    updater.check().await.map_err(|error| error.to_string())
}

/// True when `candidate` is a strictly newer semantic version than `current`.
fn is_newer(candidate: &str, current: &str) -> bool {
    match (
        semver::Version::parse(candidate),
        semver::Version::parse(current),
    ) {
        (Ok(candidate), Ok(current)) => candidate > current,
        _ => false,
    }
}

fn newer(stable: Option<Update>, preview: Option<Update>) -> Option<Update> {
    match (stable, preview) {
        (Some(stable), Some(preview)) if is_newer(&preview.version, &stable.version) => {
            Some(preview)
        }
        (Some(stable), _) => Some(stable),
        (None, preview) => preview,
    }
}

#[tauri::command]
pub async fn app_update_check<R: Runtime>(
    webview: Webview<R>,
    preview: bool,
) -> Result<Option<UpdateMetadata>, String> {
    let stable = check(webview.updater_builder()).await;
    let update = if preview {
        let feed = Url::parse(PREVIEW_FEED_URL).map_err(|error| error.to_string())?;
        let builder = webview
            .updater_builder()
            .endpoints(vec![feed])
            .map_err(|error| error.to_string())?;
        // One unreachable feed must not hide a release the other feed offers.
        match (stable, check(builder).await) {
            (Ok(stable), Ok(preview)) => newer(stable, preview),
            (Ok(found), Err(_)) | (Err(_), Ok(found)) => found,
            (Err(error), Err(_)) => return Err(error),
        }
    } else {
        stable?
    };
    Ok(update.map(|update| UpdateMetadata {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        body: update.body.clone(),
        raw_json: update.raw_json.clone(),
        rid: webview.resources_table().add(update),
    }))
}

#[cfg(test)]
mod tests {
    use super::is_newer;

    #[test]
    fn preview_sorts_between_its_stable_base_and_the_next_stable() {
        assert!(is_newer("0.6.95-preview.42.gabcdef012345", "0.6.94"));
        assert!(is_newer("0.6.95", "0.6.95-preview.42.gabcdef012345"));
        assert!(is_newer(
            "0.6.95-preview.43.g012345678901",
            "0.6.95-preview.42.gffffffffffff"
        ));
        assert!(!is_newer("0.6.94", "0.6.95-preview.1.gabc"));
        assert!(!is_newer("not-a-version", "0.6.94"));
    }
}
