//! App update checks for the update channel the user chose in Settings.
//!
//! Stable reads only the feed configured in `tauri.conf.json`. Preview also reads the
//! preview feed and offers whichever signed release is newer, so a preview user still
//! receives the next stable release once it overtakes the last preview. Both feeds are
//! fixed here: the renderer picks a channel, never a URL. Signatures are verified by the
//! updater plugin with the configured public key either way.

use std::{future::Future, time::Duration};

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

/// Upper bound for one feed request. The plugin has no default timeout, so a stalled
/// connection would otherwise leave the check pending forever.
const FEED_TIMEOUT: Duration = Duration::from_secs(15);

async fn check(builder: UpdaterBuilder) -> Result<Option<Update>, String> {
    let updater = builder
        .timeout(FEED_TIMEOUT)
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

fn newer<T>(
    stable: Option<T>,
    preview: Option<T>,
    version: impl Fn(&T) -> &str,
) -> Option<T> {
    match (stable, preview) {
        (Some(stable), Some(preview)) if is_newer(version(&preview), version(&stable)) => {
            Some(preview)
        }
        (Some(stable), _) => Some(stable),
        (None, preview) => preview,
    }
}

/// Runs both feed checks concurrently, so the wait is the slower feed rather than the sum.
/// One failed feed must not hide a release the other feed offers.
async fn check_both<T>(
    stable: impl Future<Output = Result<Option<T>, String>>,
    preview: impl Future<Output = Result<Option<T>, String>>,
    version: impl Fn(&T) -> &str,
) -> Result<Option<T>, String> {
    match tokio::join!(stable, preview) {
        (Ok(stable), Ok(preview)) => Ok(newer(stable, preview, version)),
        (Ok(found), Err(_)) | (Err(_), Ok(found)) => Ok(found),
        (Err(error), Err(_)) => Err(error),
    }
}

#[tauri::command]
pub async fn app_update_check<R: Runtime>(
    webview: Webview<R>,
    preview: bool,
) -> Result<Option<UpdateMetadata>, String> {
    let update = if preview {
        let feed = Url::parse(PREVIEW_FEED_URL).map_err(|error| error.to_string())?;
        let preview_builder = webview
            .updater_builder()
            .endpoints(vec![feed])
            .map_err(|error| error.to_string())?;
        check_both(
            check(webview.updater_builder()),
            check(preview_builder),
            |update: &Update| update.version.as_str(),
        )
        .await?
    } else {
        check(webview.updater_builder()).await?
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
    use std::time::Duration;

    use tokio::sync::Barrier;

    use super::{check_both, is_newer};

    fn version(candidate: &&'static str) -> &'static str {
        *candidate
    }

    #[tokio::test]
    async fn both_feeds_are_requested_concurrently() {
        // Each mocked feed only answers once the other has started, so a sequential
        // implementation never finishes and trips the deadline.
        let barrier = Barrier::new(2);
        let stable = async {
            barrier.wait().await;
            Ok(Some("0.6.94"))
        };
        let preview = async {
            barrier.wait().await;
            Ok(Some("0.6.95-preview.1.gabc"))
        };
        let found = tokio::time::timeout(
            Duration::from_secs(5),
            check_both(stable, preview, version),
        )
        .await
        .expect("feeds were not checked concurrently");
        assert_eq!(found, Ok(Some("0.6.95-preview.1.gabc")));
    }

    #[tokio::test]
    async fn a_failed_feed_does_not_hide_the_other_feed() {
        let stable = async { Err("timed out".to_string()) };
        let preview = async { Ok(Some("0.6.95-preview.1.gabc")) };
        assert_eq!(
            check_both(stable, preview, version).await,
            Ok(Some("0.6.95-preview.1.gabc"))
        );

        let stable = async { Ok(Some("0.6.94")) };
        let preview = async { Err("timed out".to_string()) };
        assert_eq!(check_both(stable, preview, version).await, Ok(Some("0.6.94")));

        let stable = async { Err::<Option<&'static str>, _>("stable failed".to_string()) };
        let preview = async { Err("preview failed".to_string()) };
        assert_eq!(
            check_both(stable, preview, version).await,
            Err("stable failed".to_string())
        );
    }

    #[tokio::test]
    async fn the_newer_signed_release_wins() {
        let stable = async { Ok(Some("0.6.95")) };
        let preview = async { Ok(Some("0.6.95-preview.42.gabcdef012345")) };
        assert_eq!(check_both(stable, preview, version).await, Ok(Some("0.6.95")));
    }

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
