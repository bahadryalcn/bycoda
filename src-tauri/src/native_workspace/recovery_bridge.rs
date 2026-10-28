//! Read-only Host reports pinned to the actual Native-selected profile and Store.
//! Metadata strings route retained data; they never create an actor or operation grant.
use crate::native_authority_bootstrap::HostBootstrap;
use crate::remote::NativeWorkspaceTransport;
use crate::session_store::SessionStore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::{AppHandle, Manager};

const MAX_SAFE: u64 = 9_007_199_254_740_991;
const MAX_RAW: usize = 1024 * 1024;
static ACTIVE: AtomicUsize = AtomicUsize::new(0);
fn unavailable() -> String {
    "HOST_BUFFER_RECOVERY_UNAVAILABLE".into()
}
fn invalid() -> String {
    "HOST_BUFFER_RECOVERY_INVALID_RESPONSE".into()
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn identity(value: &str) -> bool {
    !value.is_empty() && value.len() <= 512 && !value.chars().any(char::is_control)
}
fn digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
fn safe(value: &Value) -> bool {
    value.as_u64().is_some_and(|v| v <= MAX_SAFE)
}
fn declared_keys(value: &Value, required: &[&str], optional: &[&str]) -> bool {
    value.as_object().is_some_and(|object| {
        required.iter().all(|key| object.contains_key(*key))
            && object
                .keys()
                .all(|key| required.contains(&key.as_str()) || optional.contains(&key.as_str()))
    })
}
struct Permit;
impl Permit {
    fn acquire() -> Result<Self, String> {
        ACTIVE
            .try_update(Ordering::AcqRel, Ordering::Acquire, |n| {
                (n < 4).then_some(n + 1)
            })
            .map_err(|_| "HOST_BUFFER_RECOVERY_CAPACITY")?;
        Ok(Self)
    }
}
impl Drop for Permit {
    fn drop(&mut self) {
        ACTIVE.fetch_sub(1, Ordering::AcqRel);
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecoveryContext {
    host_environment_id: String,
    source_store_id: String,
    source_profile_id: String,
    native_store_instance: String,
    client_id: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecoverySource {
    report_id: String,
    report_version: u64,
    owner_id: String,
    owner_version: u64,
    snapshot_digest: String,
}
impl RecoverySource {
    fn validate(&self) -> Result<(), String> {
        if !digest(&self.report_id)
            || !digest(&self.snapshot_digest)
            || !identity(&self.owner_id)
            || self.report_version > MAX_SAFE
            || self.owner_version > MAX_SAFE
        {
            return Err(unavailable());
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecoveryCursor {
    version: u8,
    cursor_id: String,
    page: u64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListRequest {
    after: Option<RecoveryCursor>,
    limit: u32,
}
impl ListRequest {
    fn validate(&self, expected: &Option<RecoveryContext>) -> Result<(), String> {
        if !(1..=100).contains(&self.limit) {
            return Err(unavailable());
        }
        if let Some(cursor) = &self.after {
            if expected.is_none()
                || cursor.version != 1
                || cursor.page > MAX_SAFE
                || uuid::Uuid::parse_str(&cursor.cursor_id).is_err()
            {
                return Err(unavailable());
            }
        }
        Ok(())
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryPage {
    version: u8,
    qualified: bool,
    resolution: &'static str,
    context: RecoveryContext,
    records: Vec<Value>,
    next: Option<RecoveryCursor>,
    incomplete: bool,
    duplicates_possible: bool,
    unavailable: bool,
}

fn context_from_profile(
    store: &SessionStore,
    environment: &str,
    profile: &Path,
) -> Result<RecoveryContext, String> {
    let ids = store.authority_identity().map_err(|_| unavailable())?;
    if !identity(environment)
        || !identity(&ids.source_store_id)
        || !identity(&ids.source_profile_id)
    {
        return Err(unavailable());
    }
    Ok(RecoveryContext {
        host_environment_id: environment.into(),
        source_store_id: ids.source_store_id,
        source_profile_id: ids.source_profile_id,
        native_store_instance: store.native_instance_id().to_string(),
        client_id: hash(crate::fs::path_to_js(profile).as_bytes()),
    })
}
fn context(
    app: &AppHandle,
    store: &SessionStore,
    environment: &str,
) -> Result<RecoveryContext, String> {
    let profile = app.path().app_data_dir().map_err(|_| unavailable())?;
    context_from_profile(store, environment, &profile)
}
struct Bridge<'a> {
    app: &'a AppHandle,
    selected: HostBootstrap,
    host: NativeWorkspaceTransport,
    context: RecoveryContext,
}
impl<'a> Bridge<'a> {
    fn capture(
        app: &'a AppHandle,
        store: &SessionStore,
        expected: Option<&RecoveryContext>,
    ) -> Result<Self, String> {
        let base = crate::bundled_host::native_authority_profile().ok_or_else(unavailable)?;
        let selected = HostBootstrap::discover(&base).map_err(|_| unavailable())?;
        let captured = context(app, store, &selected.description.environment_id)?;
        if expected.is_some_and(|value| value != &captured) {
            return Err(unavailable());
        }
        let host = NativeWorkspaceTransport::connect_recovery(
            app,
            &selected.recovery_endpoint().map_err(|_| unavailable())?,
            &captured.host_environment_id,
        )
        .map_err(|_| unavailable())?;
        let bridge = Self {
            app,
            selected,
            host,
            context: captured,
        };
        bridge.assert_current()?;
        Ok(bridge)
    }
    fn assert_current(&self) -> Result<(), String> {
        self.host
            .assert_recovery_current(self.app)
            .map_err(|_| unavailable())?;
        self.selected.assert_current().map_err(|_| unavailable())?;
        let base = crate::bundled_host::native_authority_profile()
            .ok_or_else(unavailable)?
            .canonicalize()
            .map_err(|_| unavailable())?;
        if base != self.selected.directory() {
            return Err(unavailable());
        }
        let actual = self
            .app
            .try_state::<SessionStore>()
            .ok_or_else(unavailable)?;
        if context(
            self.app,
            actual.inner(),
            &self.selected.description.environment_id,
        )? != self.context
        {
            return Err(unavailable());
        }
        Ok(())
    }
    fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        self.assert_current()?;
        let value = self
            .host
            .call_recovery(self.app, method, params)
            .map_err(|_| unavailable())?;
        self.assert_current()?;
        Ok(value)
    }
}
fn provenance_matches(value: &Value, context: &RecoveryContext) -> bool {
    declared_keys(
        value,
        &[
            "version",
            "sourceStoreId",
            "sourceProfileId",
            "storeInstance",
            "windowIncarnation",
            "kind",
            "reportVersion",
            "reportNonce",
            "snapshotDigest",
        ],
        &[],
    ) && value["version"] == 2
        && value["sourceStoreId"] == context.source_store_id
        && value["sourceProfileId"] == context.source_profile_id
        && matches!(
            value["kind"].as_str(),
            Some("physical" | "unattributed" | "legacy" | "retained")
        )
        && safe(&value["reportVersion"])
        && value["reportVersion"] != 0
        && value["snapshotDigest"].as_str().is_some_and(digest)
        && ["storeInstance", "windowIncarnation", "reportNonce"]
            .iter()
            .all(|key| {
                value[*key].is_null()
                    || value[*key]
                        .as_str()
                        .is_some_and(|v| v.len() == 36 && uuid::Uuid::parse_str(v).is_ok())
            })
}
fn metadata_matches(row: &Value, context: &RecoveryContext) -> bool {
    let keys = [
        "source",
        "clientId",
        "instanceId",
        "processId",
        "updatedAt",
        "byteLength",
        "bufferCount",
        "dirtyCount",
        "unknown",
        "provenance",
        "lineage",
        "ownerMissing",
        "compatibilityHoldId",
        "verification",
        "retention",
        "inspectable",
        "qualified",
        "resolution",
    ];
    if !row.as_object().is_some_and(|object| {
        object.len() == keys.len() && object.keys().all(|key| keys.contains(&key.as_str()))
    }) {
        return false;
    }
    let source: RecoverySource = match serde_json::from_value(row["source"].clone()) {
        Ok(value) => value,
        Err(_) => return false,
    };
    source.validate().is_ok()
        && provenance_matches(&row["provenance"], context)
        && row["clientId"] == context.client_id
        && row["qualified"] == false
        && row["resolution"] == "unsupported"
        && row["contentAvailable"].is_null()
        && row["instanceId"].as_str().is_some_and(identity)
        && [
            "processId",
            "updatedAt",
            "byteLength",
            "bufferCount",
            "dirtyCount",
        ]
        .iter()
        .all(|key| safe(&row[*key]))
        && row["processId"].as_u64().is_some_and(|v| v > 0)
        && row["byteLength"]
            .as_u64()
            .is_some_and(|v| v <= 64 * 1024 * 1024)
        && row["bufferCount"].as_u64().is_some_and(|v| v <= 10_000)
        && row["dirtyCount"].as_u64() <= row["bufferCount"].as_u64()
        && ["unknown", "ownerMissing", "inspectable"]
            .iter()
            .all(|key| row[*key].is_boolean())
        && row["inspectable"].as_bool() == row["byteLength"].as_u64().map(|n| n <= MAX_RAW as u64)
        && row["compatibilityHoldId"].as_str().is_some_and(digest)
        && matches!(row["lineage"].as_str(), Some("physical" | "legacy"))
        && matches!(
            row["verification"].as_str(),
            Some("raw-checked" | "metadata-only")
        )
        && matches!(
            row["retention"].as_str(),
            Some("current" | "held" | "historical")
        )
        && serde_json::to_vec(row).is_ok_and(|bytes| bytes.len() <= 64 * 1024)
}
fn decode_page(
    value: Value,
    context: RecoveryContext,
    limit: u32,
    after: Option<&RecoveryCursor>,
) -> Result<RecoveryPage, String> {
    if value["version"] != 1 || value["qualified"] != false {
        return Err(invalid());
    }
    let rows = value["records"].as_array().ok_or_else(invalid)?;
    if rows.len() > limit as usize {
        return Err(invalid());
    }
    let next = if value["next"].is_null() {
        None
    } else {
        let cursor: RecoveryCursor =
            serde_json::from_value(value["next"].clone()).map_err(|_| invalid())?;
        if cursor.version != 1
            || cursor.page > MAX_SAFE
            || uuid::Uuid::parse_str(&cursor.cursor_id).is_err()
        {
            return Err(invalid());
        }
        if cursor.page != after.map_or(1, |prior| prior.page.saturating_add(1))
            || after.is_some_and(|prior| prior.cursor_id != cursor.cursor_id)
        {
            return Err(invalid());
        }
        Some(cursor)
    };
    let mut records = Vec::new();
    let mut missing = false;
    for row in rows {
        // Unrelated profiles are not exposed even as labels/counts. An older
        // same-client source with unknown/mixed Store provenance stays unavailable.
        if row["clientId"] != context.client_id {
            continue;
        }
        if metadata_matches(row, &context) {
            records.push(row.clone());
        } else {
            missing = true;
        }
    }
    Ok(RecoveryPage {
        version: 1,
        qualified: false,
        resolution: "unsupported",
        context,
        records,
        next,
        incomplete: value["incomplete"].as_bool().ok_or_else(invalid)?,
        duplicates_possible: value["duplicatesPossible"].as_bool().ok_or_else(invalid)?,
        unavailable: missing,
    })
}
fn validate_read(
    value: &Value,
    source: &RecoverySource,
    context: &RecoveryContext,
) -> Result<Vec<Value>, String> {
    if !declared_keys(
        value,
        &[
            "version",
            "qualified",
            "source",
            "rawReport",
            "owner",
            "resolution",
        ],
        &[],
    ) || !declared_keys(
        &value["owner"],
        &["ownerId", "updatedAt", "unknown", "buffers", "source"],
        &[],
    ) || !safe(&value["owner"]["updatedAt"])
        || !value["owner"]["unknown"].is_boolean()
        || value["version"] != 1
        || value["qualified"] != false
        || value["resolution"] != "unsupported"
    {
        return Err(invalid());
    }
    let actual: RecoverySource =
        serde_json::from_value(value["source"].clone()).map_err(|_| invalid())?;
    if &actual != source {
        return Err(unavailable());
    }
    let raw = value["rawReport"].as_str().ok_or_else(invalid)?;
    if raw.len() > MAX_RAW || hash(raw.as_bytes()) != source.snapshot_digest {
        return Err(unavailable());
    }
    let report: Value =
        serde_json::from_str(raw.strip_prefix('\u{feff}').unwrap_or(raw)).map_err(|_| invalid())?;
    if !declared_keys(
        &report,
        &[
            "clientId",
            "instanceId",
            "device",
            "processId",
            "receivedAt",
            "owners",
        ],
        &["retiredAt", "recovery"],
    ) || report["clientId"] != context.client_id
        || !report["device"].as_str().is_some_and(digest)
        || !report["instanceId"].as_str().is_some_and(identity)
        || !report["processId"]
            .as_u64()
            .is_some_and(|value| value > 0 && value <= MAX_SAFE)
        || !safe(&report["receivedAt"])
        || report.get("retiredAt").is_some_and(|value| !safe(value))
    {
        return Err(unavailable());
    }
    let key = serde_json::to_vec(&json!([
        report["device"],
        report["clientId"],
        report["instanceId"]
    ]))
    .map_err(|_| invalid())?;
    let (report_version, owner_version) = if let Some(recovery) = report.get("recovery") {
        if !declared_keys(
            recovery,
            &["reportVersion", "ownerVersions"],
            &[
                "version",
                "kind",
                "ownerLineages",
                "heldOwnerIds",
                "parentReportId",
                "sourceOwnerId",
                "holdDigest",
                "clockId",
            ],
        ) || recovery.get("version").is_some_and(|value| value != 1)
            || recovery
                .get("kind")
                .is_some_and(|value| !matches!(value.as_str(), Some("projection" | "hold")))
            || !recovery["ownerVersions"]
                .as_object()
                .is_some_and(|versions| {
                    versions.len() <= 20_000
                        && versions
                            .iter()
                            .all(|(id, version)| identity(id) && safe(version))
                })
            || recovery.get("ownerLineages").is_some_and(|value| {
                !value.as_object().is_some_and(|lineages| {
                    lineages.len() <= 20_000
                        && lineages.iter().all(|(id, kind)| {
                            identity(id) && matches!(kind.as_str(), Some("physical" | "legacy"))
                        })
                })
            })
            || recovery.get("heldOwnerIds").is_some_and(|value| {
                !value.as_array().is_some_and(|ids| {
                    ids.len() <= 20_000 && ids.iter().all(|id| id.as_str().is_some_and(identity))
                })
            })
            || ["parentReportId", "holdDigest"].iter().any(|key| {
                recovery
                    .get(*key)
                    .is_some_and(|value| !value.as_str().is_some_and(digest))
            })
            || ["sourceOwnerId", "clockId"].iter().any(|key| {
                recovery
                    .get(*key)
                    .is_some_and(|value| !value.as_str().is_some_and(identity))
            })
        {
            return Err(unavailable());
        }
        let version = recovery["reportVersion"]
            .as_u64()
            .filter(|v| *v <= MAX_SAFE)
            .ok_or_else(invalid)?;
        let owner = recovery["ownerVersions"][&source.owner_id]
            .as_u64()
            .filter(|v| *v <= MAX_SAFE)
            .ok_or_else(invalid)?;
        (version, owner)
    } else {
        (0, 0)
    };
    if hash(&key) != source.report_id
        || report_version != source.report_version
        || owner_version != source.owner_version
    {
        return Err(unavailable());
    }
    let owners = report["owners"].as_array().ok_or_else(invalid)?;
    if owners.len() > 20_000
        || owners.iter().any(|owner| {
            !declared_keys(
                owner,
                &["ownerId", "updatedAt", "unknown", "buffers", "source"],
                &[],
            ) || !provenance_matches(&owner["source"], context)
                || !owner["ownerId"].as_str().is_some_and(identity)
                || !safe(&owner["updatedAt"])
                || !owner["unknown"].is_boolean()
                || !owner["buffers"].as_array().is_some_and(|buffers| {
                    buffers.len() <= 10_000
                        && buffers.iter().all(|buffer| {
                            declared_keys(buffer, &["path", "dirty"], &[])
                                && buffer["path"].as_str().is_some_and(|path| {
                                    path.len() <= 32768
                                        && !path.contains('\0')
                                        && Path::new(path).is_absolute()
                                })
                                && buffer["dirty"].is_boolean()
                        })
                })
        })
    {
        return Err(unavailable());
    }
    let selected = owners
        .iter()
        .find(|owner| owner["ownerId"] == source.owner_id)
        .ok_or_else(unavailable)?;
    for field in ["ownerId", "updatedAt", "unknown", "source"] {
        if selected[field] != value["owner"][field] {
            return Err(unavailable());
        }
    }
    let buffers = selected["buffers"].as_array().ok_or_else(invalid)?;
    let returned = value["owner"]["buffers"].as_array().ok_or_else(invalid)?;
    if buffers.len() > 10_000 || buffers.len() != returned.len() {
        return Err(invalid());
    }
    let mut projected = Vec::with_capacity(buffers.len());
    for (buffer, actual) in buffers.iter().zip(returned) {
        let path = buffer["path"].as_str().ok_or_else(invalid)?;
        let dirty = buffer["dirty"].as_bool().ok_or_else(invalid)?;
        if path.len() > 32768
            || path.contains('\0')
            || !std::path::Path::new(path).is_absolute()
            || actual["path"] != path
            || actual["dirty"] != dirty
            || !declared_keys(actual, &["path", "dirty"], &[])
        {
            return Err(invalid());
        }
        projected.push(json!({"path":path,"dirty":dirty}));
    }
    Ok(projected)
}
fn project_read(
    value: &Value,
    source: &RecoverySource,
    context: &RecoveryContext,
) -> Result<Value, String> {
    let buffers = validate_read(value, source, context)?;
    let owner = &value["owner"];
    // Only this closed validated projection crosses IPC. The original UTF-8 raw
    // string is preserved verbatim; it is never JSON-reserialized or BOM-stripped.
    Ok(
        json!({"version":1,"qualified":false,"source":source,"rawReport":value["rawReport"],"owner":{"ownerId":owner["ownerId"],"updatedAt":owner["updatedAt"],"unknown":owner["unknown"],"buffers":buffers,"source":owner["source"]},"resolution":"unsupported","context":context,"buffers":buffers,"contentAvailable":false}),
    )
}
pub(super) fn list(
    app: &AppHandle,
    store: &SessionStore,
    request: ListRequest,
    expected: Option<RecoveryContext>,
) -> Result<RecoveryPage, String> {
    request.validate(&expected)?;
    let _permit = Permit::acquire()?;
    let bridge = Bridge::capture(app, store, expected.as_ref())?;
    let value = bridge.call(
        "native.buffers.recovery.list",
        json!({"after":request.after,"limit":request.limit}),
    )?;
    let page = decode_page(
        value,
        bridge.context.clone(),
        request.limit,
        request.after.as_ref(),
    )?;
    bridge.assert_current()?;
    Ok(page)
}
pub(super) fn read(
    app: &AppHandle,
    store: &SessionStore,
    source: RecoverySource,
    expected: RecoveryContext,
) -> Result<Value, String> {
    source.validate()?;
    let _permit = Permit::acquire()?;
    let bridge = Bridge::capture(app, store, Some(&expected))?;
    let value = bridge.call(
        "native.buffers.recovery.read",
        serde_json::to_value(&source).map_err(|_| invalid())?,
    )?;
    let value = project_read(&value, &source, &bridge.context)?;
    bridge.assert_current()?;
    Ok(value)
}
pub(super) fn status(
    app: &AppHandle,
    store: &SessionStore,
    source: RecoverySource,
    expected: RecoveryContext,
) -> Result<Value, String> {
    source.validate()?;
    let _permit = Permit::acquire()?;
    let bridge = Bridge::capture(app, store, Some(&expected))?;
    let params = serde_json::to_value(&source).map_err(|_| invalid())?;
    let value = bridge.call("native.buffers.recovery.status", params.clone())?;
    if value["version"] != 1
        || value["qualified"] != false
        || value["resolution"] != "unsupported"
        || value["source"] != params
    {
        return Err(invalid());
    }
    let found = value["found"].as_bool().ok_or_else(invalid)?;
    let inspectable = value["inspectable"].as_bool().ok_or_else(invalid)?;
    let verified = found
        && inspectable
        && bridge
            .call("native.buffers.recovery.read", params)
            .and_then(|read| validate_read(&read, &source, &bridge.context))
            .is_ok();
    bridge.assert_current()?;
    Ok(
        json!({"version":1,"qualified":false,"resolution":"unsupported","context":bridge.context,"source":source,"found":verified,"inspectable":verified,"unavailable":found && !verified}),
    )
}

#[cfg(test)]
#[path = "recovery_bridge_tests.rs"]
mod tests;
