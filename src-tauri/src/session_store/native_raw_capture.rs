//! Exact mounted Composer data retained beside its actual FULL SQL parent.
//! Neither retained bytes nor a receipt grant a current renderer or input proof.
use super::{authority::CheckedStoreTransaction, SessionStore};
use crate::native_authority_checkpoint::{
    ExpectedSqlBlob, NativeCheckpointExpectation, NativeSqlCheckpointReceipt,
};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::de::{self, DeserializeSeed, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fmt;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, OnceLock,
};

const MAX_BYTES: usize = 16 * 1024 * 1024;
const MEMORY_BYTES: usize = 64 * 1024 * 1024;
const MAX_SNAPSHOTS: usize = 256;
const MAX_NODES: usize = 65_536;
const MAX_DEPTH: usize = 16;
const MAX_SAFE: u64 = 9_007_199_254_740_991;
const MAX_ROWS: i64 = 4096;
const STORE_BYTES: i64 = 128 * 1024 * 1024;
const PARENT_BYTES: usize = 8192;
const TABLES: [&str; 5] = [
    "native_raw_capture_namespace",
    "native_raw_capture_namespace_witness",
    "native_raw_capture_budget",
    "native_raw_capture_budget_witness",
    "native_raw_captures",
];

fn failure(code: &str) -> String {
    format!("NATIVE_RAW_CAPTURE_{code}")
}
fn digest(raw: &[u8]) -> String {
    format!("{:x}", Sha256::digest(raw))
}
fn hex(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn identifier(value: &str) -> bool {
    !value.is_empty() && value.len() <= 512 && !value.chars().any(char::is_control)
}
fn uuid(value: &str) -> bool {
    value.len() == 36 && uuid::Uuid::parse_str(value).is_ok_and(|id| id.to_string() == value)
}

struct MemoryBudget {
    used: AtomicUsize,
    limit: usize,
}
struct Charge {
    budget: Arc<MemoryBudget>,
    bytes: usize,
}
impl Charge {
    fn reserve(budget: Arc<MemoryBudget>, bytes: usize) -> Result<Self, String> {
        budget
            .used
            .try_update(Ordering::AcqRel, Ordering::Acquire, |used| {
                used.checked_add(bytes).filter(|next| *next <= budget.limit)
            })
            .map_err(|_| failure("MEMORY_CAPACITY"))?;
        Ok(Self { budget, bytes })
    }
}
impl Drop for Charge {
    fn drop(&mut self) {
        self.budget.used.fetch_sub(self.bytes, Ordering::AcqRel);
    }
}
fn memory_budget() -> Arc<MemoryBudget> {
    static BUDGET: OnceLock<Arc<MemoryBudget>> = OnceLock::new();
    BUDGET
        .get_or_init(|| {
            Arc::new(MemoryBudget {
                used: AtomicUsize::new(0),
                limit: MEMORY_BYTES,
            })
        })
        .clone()
}
struct Artifact {
    raw: String,
    sha256: String,
    session: String,
    count: usize,
    _charge: Charge,
}
#[derive(Clone)]
pub(crate) struct RawCaptureArtifact(Arc<Artifact>);
impl fmt::Debug for RawCaptureArtifact {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        out.debug_struct("RawCaptureArtifact")
            .field("sha256", &self.sha256())
            .field("byte_length", &self.raw().len())
            .field("snapshot_count", &self.0.count)
            .finish()
    }
}
impl RawCaptureArtifact {
    pub(crate) fn parse(raw: String, session: &str) -> Result<Self, String> {
        Self::parse_with_budget(raw, session, memory_budget())
    }
    fn parse_with_budget(
        raw: String,
        session: &str,
        budget: Arc<MemoryBudget>,
    ) -> Result<Self, String> {
        if raw.is_empty() || raw.len() > MAX_BYTES {
            return Err(failure("CAPACITY"));
        }
        let charge = Charge::reserve(budget, raw.len())?;
        let count = validate_raw(&raw, session)?;
        Ok(Self(Arc::new(Artifact {
            sha256: digest(raw.as_bytes()),
            raw,
            session: session.into(),
            count,
            _charge: charge,
        })))
    }
    pub(crate) fn raw(&self) -> &str {
        &self.0.raw
    }
    pub(crate) fn sha256(&self) -> &str {
        &self.0.sha256
    }
    pub(crate) fn session_id(&self) -> &str {
        &self.0.session
    }
    pub(crate) fn descriptor(
        &self,
        comparison_sha256: &str,
    ) -> Result<RawCaptureDescriptor, String> {
        let value = RawCaptureDescriptor {
            version: 1,
            sha256: self.sha256().into(),
            byte_length: self.raw().len() as u64,
            snapshot_count: self.0.count as u64,
            comparison_sha256: comparison_sha256.into(),
        };
        value.validate()?;
        Ok(value)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RawCaptureDescriptor {
    pub(crate) version: u8,
    pub(crate) sha256: String,
    pub(crate) byte_length: u64,
    pub(crate) snapshot_count: u64,
    pub(crate) comparison_sha256: String,
}
impl RawCaptureDescriptor {
    pub(crate) fn validate(&self) -> Result<(), String> {
        if self.version != 1
            || !hex(&self.sha256)
            || !hex(&self.comparison_sha256)
            || self.byte_length == 0
            || self.byte_length > MAX_BYTES as u64
            || self.snapshot_count > MAX_SNAPSHOTS as u64
        {
            return Err(failure("INVALID_DESCRIPTOR"));
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RawCaptureReceipt {
    pub(crate) version: u8,
    pub(crate) sql: NativeSqlCheckpointReceipt,
}
impl RawCaptureReceipt {
    /// Data-reference construction only; it does not validate storage or authority.
    pub(crate) fn from_sql(sql: &NativeSqlCheckpointReceipt) -> Result<Self, String> {
        validate_parent(sql)?;
        Ok(Self {
            version: 1,
            sql: sql.clone(),
        })
    }
}

// Count nodes/depth and reject ambiguous object keys DURING parsing. Only a
// bounded shape is kept; opaque scalar text is not duplicated into a JSON DOM.
struct Bounds {
    nodes: usize,
}
struct Seed<'a> {
    bounds: &'a mut Bounds,
    depth: usize,
}
enum Shape {
    Scalar,
    Unsigned(u64),
    Array(Vec<Shape>),
    Object(HashMap<String, Shape>),
}
impl Shape {
    fn field(&self, key: &str) -> Option<&Self> {
        if let Self::Object(fields) = self {
            fields.get(key)
        } else {
            None
        }
    }
}
impl<'de> DeserializeSeed<'de> for Seed<'_> {
    type Value = Shape;
    fn deserialize<D: de::Deserializer<'de>>(self, input: D) -> Result<Shape, D::Error> {
        self.bounds.nodes += 1;
        if self.depth > MAX_DEPTH || self.bounds.nodes > MAX_NODES {
            return Err(de::Error::custom("raw capture bounds"));
        }
        input.deserialize_any(self)
    }
}
impl<'de> Visitor<'de> for Seed<'_> {
    type Value = Shape;
    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("bounded plain JSON")
    }
    fn visit_bool<E: de::Error>(self, _: bool) -> Result<Shape, E> {
        Ok(Shape::Scalar)
    }
    fn visit_i64<E: de::Error>(self, _: i64) -> Result<Shape, E> {
        Ok(Shape::Scalar)
    }
    fn visit_u64<E: de::Error>(self, value: u64) -> Result<Shape, E> {
        Ok(Shape::Unsigned(value))
    }
    fn visit_f64<E: de::Error>(self, value: f64) -> Result<Shape, E> {
        if value.is_finite() {
            Ok(Shape::Scalar)
        } else {
            Err(E::custom("nonfinite JSON"))
        }
    }
    fn visit_str<E: de::Error>(self, _: &str) -> Result<Shape, E> {
        Ok(Shape::Scalar)
    }
    fn visit_none<E: de::Error>(self) -> Result<Shape, E> {
        Ok(Shape::Scalar)
    }
    fn visit_unit<E: de::Error>(self) -> Result<Shape, E> {
        Ok(Shape::Scalar)
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut values: A) -> Result<Shape, A::Error> {
        let mut children = Vec::new();
        while let Some(child) = values.next_element_seed(Seed {
            bounds: self.bounds,
            depth: self.depth + 1,
        })? {
            children.push(child);
        }
        Ok(Shape::Array(children))
    }
    fn visit_map<A: MapAccess<'de>>(self, mut fields: A) -> Result<Shape, A::Error> {
        let mut children = HashMap::new();
        while let Some(key) = fields.next_key::<String>()? {
            if children.contains_key(&key) {
                return Err(de::Error::custom("duplicate JSON field"));
            }
            let child = fields.next_value_seed(Seed {
                bounds: self.bounds,
                depth: self.depth + 1,
            })?;
            children.insert(key, child);
        }
        Ok(Shape::Object(children))
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Capture {
    version: u8,
    kind: String,
    qualified: bool,
    session_id: String,
    snapshots: Vec<Mount>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProducerCapture {
    version: u8,
    kind: String,
    qualified: bool,
    session_id: String,
    snapshots: Vec<Mount>,
    producer_coverage: String,
    producer_epochs: ProducerEpochs,
    producers: Vec<Producer>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProducerEpochs {
    #[serde(deserialize_with = "safe_counter")]
    parent: u64,
    #[serde(deserialize_with = "safe_counter")]
    editor: u64,
}
#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
enum ProducerKind {
    QuestionDraft,
    SessionParent,
    ComposerParent,
    QueueEdit,
    BtwParent,
    FileEditor,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Producer {
    #[serde(deserialize_with = "safe_counter")]
    id: u64,
    #[serde(deserialize_with = "safe_counter")]
    revision: u64,
    kind: ProducerKind,
    #[serde(default, deserialize_with = "optional_string")]
    session_id: Option<String>,
    snapshot: JsonObject,
    #[serde(default)]
    undefined_paths: Vec<Vec<PathSegment>>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Mount {
    #[serde(deserialize_with = "safe_counter")]
    id: u64,
    #[serde(deserialize_with = "safe_counter")]
    revision: u64,
    #[serde(default, deserialize_with = "optional_string")]
    session_id: Option<String>,
    snapshot: Snapshot,
    #[serde(default)]
    undefined_paths: Vec<Vec<PathSegment>>,
}
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
enum PathSegment {
    Key(String),
    Index(u64),
}
struct Counter;
impl Visitor<'_> for Counter {
    type Value = u64;
    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("a nonnegative safe integer")
    }
    fn visit_u64<E: de::Error>(self, value: u64) -> Result<u64, E> {
        if value <= MAX_SAFE {
            Ok(value)
        } else {
            Err(E::custom("unsafe integer"))
        }
    }
    fn visit_i64<E: de::Error>(self, value: i64) -> Result<u64, E> {
        u64::try_from(value)
            .map_err(|_| E::custom("negative integer"))
            .and_then(|value| self.visit_u64(value))
    }
    fn visit_f64<E: de::Error>(self, value: f64) -> Result<u64, E> {
        if value.is_finite() && value >= 0.0 && value.fract() == 0.0 && value <= MAX_SAFE as f64 {
            Ok(value as u64)
        } else {
            Err(E::custom("unsafe integer"))
        }
    }
}
fn safe_counter<'de, D: de::Deserializer<'de>>(input: D) -> Result<u64, D::Error> {
    input.deserialize_any(Counter)
}
impl<'de> Deserialize<'de> for PathSegment {
    fn deserialize<D: de::Deserializer<'de>>(input: D) -> Result<Self, D::Error> {
        struct Segment;
        impl Visitor<'_> for Segment {
            type Value = PathSegment;
            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("an object key or safe array index")
            }
            fn visit_str<E: de::Error>(self, value: &str) -> Result<PathSegment, E> {
                Ok(PathSegment::Key(value.into()))
            }
            fn visit_u64<E: de::Error>(self, value: u64) -> Result<PathSegment, E> {
                Counter.visit_u64(value).map(PathSegment::Index)
            }
            fn visit_i64<E: de::Error>(self, value: i64) -> Result<PathSegment, E> {
                Counter.visit_i64(value).map(PathSegment::Index)
            }
            fn visit_f64<E: de::Error>(self, value: f64) -> Result<PathSegment, E> {
                Counter.visit_f64(value).map(PathSegment::Index)
            }
        }
        input.deserialize_any(Segment)
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Snapshot {
    text: JsonString,
    attachments: JsonArray,
    mcp_tags: JsonArray,
    #[serde(default, deserialize_with = "optional_string")]
    mode: Option<String>,
}
fn optional_string<'de, D: de::Deserializer<'de>>(input: D) -> Result<Option<String>, D::Error> {
    String::deserialize(input).map(Some)
}
struct JsonString;
impl<'de> Deserialize<'de> for JsonString {
    fn deserialize<D: de::Deserializer<'de>>(input: D) -> Result<Self, D::Error> {
        struct Text;
        impl Visitor<'_> for Text {
            type Value = JsonString;
            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("exact text")
            }
            fn visit_str<E: de::Error>(self, _: &str) -> Result<JsonString, E> {
                Ok(JsonString)
            }
        }
        input.deserialize_str(Text)
    }
}
struct JsonArray;
impl<'de> Deserialize<'de> for JsonArray {
    fn deserialize<D: de::Deserializer<'de>>(input: D) -> Result<Self, D::Error> {
        struct Array;
        impl<'de> Visitor<'de> for Array {
            type Value = JsonArray;
            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("plain JSON array")
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut values: A) -> Result<JsonArray, A::Error> {
                while values.next_element::<de::IgnoredAny>()?.is_some() {}
                Ok(JsonArray)
            }
        }
        input.deserialize_seq(Array)
    }
}
struct JsonObject;
impl<'de> Deserialize<'de> for JsonObject {
    fn deserialize<D: de::Deserializer<'de>>(input: D) -> Result<Self, D::Error> {
        struct Object;
        impl<'de> Visitor<'de> for Object {
            type Value = JsonObject;
            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("plain JSON object")
            }
            fn visit_map<A: MapAccess<'de>>(self, mut values: A) -> Result<JsonObject, A::Error> {
                while values
                    .next_entry::<de::IgnoredAny, de::IgnoredAny>()?
                    .is_some()
                {}
                Ok(JsonObject)
            }
        }
        input.deserialize_map(Object)
    }
}
fn validate_raw(raw: &str, session: &str) -> Result<usize, String> {
    if raw.is_empty() || raw.len() > MAX_BYTES || !identifier(session) {
        return Err(failure("CAPACITY"));
    }
    let mut input = serde_json::Deserializer::from_str(raw);
    let shape = Seed {
        bounds: &mut Bounds { nodes: 0 },
        depth: 0,
    }
    .deserialize(&mut input)
    .map_err(|_| failure("INVALID_JSON"))?;
    input.end().map_err(|_| failure("INVALID_JSON"))?;
    match shape.field("version") {
        Some(Shape::Unsigned(1)) => {
            let capture: Capture =
                serde_json::from_str(raw).map_err(|_| failure("INVALID_SHAPE"))?;
            if capture.version != 1
                || capture.kind != "mounted-composer-raw-capture"
                || capture.qualified
                || capture.session_id != session
                || capture.snapshots.len() > MAX_SNAPSHOTS
            {
                return Err(failure("INVALID_SHAPE"));
            }
            validate_mounts(&capture.snapshots, &shape, session)?;
            Ok(capture.snapshots.len())
        }
        Some(Shape::Unsigned(2)) => {
            let capture: ProducerCapture =
                serde_json::from_str(raw).map_err(|_| failure("INVALID_SHAPE"))?;
            let total = capture
                .snapshots
                .len()
                .checked_add(capture.producers.len())
                .ok_or_else(|| failure("CAPACITY"))?;
            if capture.version != 2
                || capture.kind != "mounted-native-input-capture"
                || capture.qualified
                || capture.session_id != session
                || capture.producer_coverage != "unknown"
                || total > MAX_SNAPSHOTS
            {
                return Err(failure("INVALID_SHAPE"));
            }
            let _ = (
                capture.producer_epochs.parent,
                capture.producer_epochs.editor,
            );
            validate_mounts(&capture.snapshots, &shape, session)?;
            let Some(Shape::Array(shapes)) = shape.field("producers") else {
                return Err(failure("INVALID_SHAPE"));
            };
            if shapes.len() != capture.producers.len() {
                return Err(failure("INVALID_SHAPE"));
            }
            let mut ids = HashSet::new();
            for (producer, shape) in capture.producers.iter().zip(shapes) {
                if producer.id == 0
                    || producer.id > MAX_SAFE
                    || producer.revision > MAX_SAFE
                    || !ids.insert(producer.id)
                    || producer.session_id.as_ref().is_some_and(|id| id != session)
                {
                    return Err(failure("INVALID_SHAPE"));
                }
                // The six families remain unqualified data, including nested
                // child/provider identities which this parser never rebinds.
                let _ = (&producer.kind, &producer.snapshot);
                validate_undefined_paths(
                    shape
                        .field("snapshot")
                        .ok_or_else(|| failure("INVALID_SHAPE"))?,
                    &producer.undefined_paths,
                    false,
                )?;
            }
            Ok(total)
        }
        _ => Err(failure("INVALID_SHAPE")),
    }
}
fn validate_mounts(mounted: &[Mount], shape: &Shape, session: &str) -> Result<(), String> {
    let mut mounts = HashSet::new();
    let Some(Shape::Array(shapes)) = shape.field("snapshots") else {
        return Err(failure("INVALID_SHAPE"));
    };
    if shapes.len() != mounted.len() {
        return Err(failure("INVALID_SHAPE"));
    }
    for (mount, shape) in mounted.iter().zip(shapes) {
        if mount.id == 0
            || mount.id > MAX_SAFE
            || mount.revision > MAX_SAFE
            || !mounts.insert(mount.id)
            || mount.session_id.as_ref().is_some_and(|id| id != session)
            || mount
                .snapshot
                .mode
                .as_ref()
                .is_some_and(|mode| mode != "save")
        {
            return Err(failure("INVALID_SHAPE"));
        }
        let _ = (
            &mount.snapshot.text,
            &mount.snapshot.attachments,
            &mount.snapshot.mcp_tags,
        );
        validate_undefined_paths(
            shape
                .field("snapshot")
                .ok_or_else(|| failure("INVALID_SHAPE"))?,
            &mount.undefined_paths,
            true,
        )?;
    }
    Ok(())
}
fn validate_undefined_paths(
    snapshot: &Shape,
    paths: &[Vec<PathSegment>],
    composer: bool,
) -> Result<(), String> {
    let mut seen = HashSet::new();
    for path in paths {
        if path.is_empty() || path.len() > MAX_DEPTH || !seen.insert(path) {
            return Err(failure("INVALID_UNDEFINED_PATH"));
        }
        if composer
            && !matches!(&path[0],PathSegment::Key(root) if matches!(root.as_str(),"attachments"|"mcpTags"|"mode"))
        {
            return Err(failure("INVALID_UNDEFINED_PATH"));
        }
        let mut current = snapshot;
        for (index, segment) in path.iter().enumerate() {
            if index == path.len() - 1 {
                if !matches!((current,segment),(Shape::Object(fields),PathSegment::Key(key)) if !fields.contains_key(key))
                {
                    return Err(failure("INVALID_UNDEFINED_PATH"));
                }
            } else {
                current = match (current, segment) {
                    (Shape::Object(fields), PathSegment::Key(key)) => fields.get(key),
                    (Shape::Array(values), PathSegment::Index(index)) if *index <= MAX_SAFE => {
                        usize::try_from(*index)
                            .ok()
                            .and_then(|index| values.get(index))
                    }
                    _ => None,
                }
                .ok_or_else(|| failure("INVALID_UNDEFINED_PATH"))?;
            }
        }
    }
    Ok(())
}

fn validate_parent(sql: &NativeSqlCheckpointReceipt) -> Result<(), String> {
    if sql.version != 1
        || ![
            &sql.nonce,
            &sql.service_epoch,
            &sql.round_id,
            &sql.window_epoch,
            &sql.native_store_instance,
        ]
        .into_iter()
        .all(|id| uuid(id))
        || ![
            &sql.environment_id,
            &sql.source_store_id,
            &sql.source_profile_id,
            &sql.session_id,
            &sql.migration_id,
        ]
        .into_iter()
        .all(|id| identifier(id))
        || sql.generation > MAX_SAFE
    {
        return Err(failure("INVALID_PARENT"));
    }
    sql.raw_capture
        .as_ref()
        .ok_or_else(|| failure("PARENT_REFERENCE_MISSING"))?
        .validate()?;
    expectation(sql).fingerprint()?;
    Ok(())
}
fn expectation(sql: &NativeSqlCheckpointReceipt) -> NativeCheckpointExpectation {
    let blob = |value: &Option<String>| {
        value
            .as_ref()
            .map_or(ExpectedSqlBlob::Absent, |value| ExpectedSqlBlob::Present {
                sha256: value.clone(),
            })
    };
    NativeCheckpointExpectation {
        revision: sql.revision,
        updated_at: sql.updated_at,
        transcript_sha256: sql.transcript_sha256.clone(),
        draft: blob(&sql.draft_sha256),
        queue: blob(&sql.queue_sha256),
    }
}

fn storage_error(_: rusqlite::Error) -> String {
    failure("STORAGE_CORRUPT")
}
fn sqlite_error(error: String) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other(error)))
}
fn table_count(conn: &Connection) -> Result<i64, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN (?1,?2,?3,?4,?5)",
        params![TABLES[0], TABLES[1], TABLES[2], TABLES[3], TABLES[4]],
        |row| row.get(0),
    )
    .map_err(storage_error)
}
fn has_anchor_column(conn: &Connection) -> Result<bool, String> {
    conn.query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('native_authority_identity') WHERE name='raw_capture_version')", [], |row| row.get(0)).map_err(storage_error)
}
fn source_ids(conn: &Connection) -> Result<(String, String), String> {
    conn.query_row("SELECT CASE WHEN typeof(source_store_id)='text' AND length(CAST(source_store_id AS BLOB)) BETWEEN 1 AND 512 THEN source_store_id ELSE NULL END,CASE WHEN typeof(source_profile_id)='text' AND length(CAST(source_profile_id AS BLOB)) BETWEEN 1 AND 512 THEN source_profile_id ELSE NULL END FROM native_authority_identity WHERE id=1", [], |row| Ok((row.get(0)?,row.get(1)?))).map_err(storage_error)
}
fn namespace_digest(ids: &(String, String)) -> String {
    digest(&serde_json::to_vec(&(1, &ids.0, &ids.1)).expect("finite namespace"))
}
fn budget_digest(ids: &(String, String), rows: i64, bytes: i64) -> String {
    digest(&serde_json::to_vec(&(1, &ids.0, &ids.1, rows, bytes)).expect("finite budget"))
}
fn require_full(conn: &Connection) -> Result<(), String> {
    let synchronous: i64 = conn
        .pragma_query_value(None, "synchronous", |row| row.get(0))
        .map_err(storage_error)?;
    if conn.is_autocommit() || synchronous != 2 {
        return Err(failure("FULL_TRANSACTION_REQUIRED"));
    }
    Ok(())
}

/// Initialization is a critical, bounded metadata migration; reads never call it.
pub(crate) fn ensure_schema(conn: &Connection) -> rusqlite::Result<()> {
    if !conn.is_autocommit() {
        return Err(sqlite_error(failure("STORAGE_BUSY")));
    }
    let previous: i64 = conn.pragma_query_value(None, "synchronous", |row| row.get(0))?;
    conn.pragma_update(None, "synchronous", "FULL")?;
    let work = (|| {
        let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;
        ensure_inner(&tx).map_err(sqlite_error)?;
        tx.commit()
    })();
    let restored = conn.pragma_update(None, "synchronous", previous);
    work.and(restored)
}
fn ensure_inner(conn: &Connection) -> Result<(), String> {
    require_full(conn)?;
    let tables = table_count(conn)?;
    if !has_anchor_column(conn)? {
        if tables != 0 || raw_parent_count(conn, None)? != 0 {
            return Err(failure("INITIALIZED_STATE_MISSING"));
        }
        conn.execute_batch("ALTER TABLE native_authority_identity ADD COLUMN raw_capture_version INTEGER NOT NULL DEFAULT 0").map_err(storage_error)?;
    }
    let anchor: i64 = conn.query_row("SELECT CASE WHEN typeof(raw_capture_version)='integer' THEN raw_capture_version ELSE NULL END FROM native_authority_identity WHERE id=1",[],|row|row.get(0)).map_err(storage_error)?;
    if anchor == 0 {
        if tables != 0 || raw_parent_count(conn, None)? != 0 {
            return Err(failure("INITIALIZED_STATE_MISSING"));
        }
        let ids = source_ids(conn)?;
        conn.execute_batch(SCHEMA).map_err(storage_error)?;
        for name in [&TABLES[0], &TABLES[1]] {
            conn.execute(&format!("INSERT INTO {name}(id,source_store_id,source_profile_id,digest) VALUES(1,?1,?2,?3)"),params![ids.0,ids.1,namespace_digest(&ids)]).map_err(storage_error)?;
        }
        for name in [&TABLES[2], &TABLES[3]] {
            conn.execute(
                &format!("INSERT INTO {name}(id,rows,bytes,digest) VALUES(1,0,0,?1)"),
                [budget_digest(&ids, 0, 0)],
            )
            .map_err(storage_error)?;
        }
        conn.execute_batch(GUARDS).map_err(storage_error)?;
        conn.execute("UPDATE native_authority_identity SET raw_capture_version=1 WHERE id=1 AND raw_capture_version=0",[]).map_err(storage_error)?;
    } else if anchor != 1 || tables != TABLES.len() as i64 {
        return Err(failure("INITIALIZED_STATE_MISSING"));
    }
    health(conn, None)?;
    validate_retained_headers(conn)?;
    Ok(())
}
fn raw_parent_count(conn: &Connection, pending: Option<&str>) -> Result<i64, String> {
    let malformed: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM native_renderer_checkpoint_receipts WHERE CASE WHEN typeof(receipt_json)!='text' OR length(CAST(receipt_json AS BLOB))>8192 THEN 1 ELSE NOT json_valid(receipt_json) END)",[],|row|row.get(0)).map_err(storage_error)?;
    if malformed {
        return Err(failure("PARENT_CORRUPT"));
    }
    conn.query_row("SELECT COUNT(*) FROM native_renderer_checkpoint_receipts WHERE json_type(receipt_json,'$.rawCapture') IS NOT NULL AND (?1 IS NULL OR nonce!=?1)",[pending],|row|row.get(0)).map_err(storage_error)
}
fn namespace(conn: &Connection) -> Result<(String, String), String> {
    if !has_anchor_column(conn)? || table_count(conn)? != TABLES.len() as i64 {
        return Err(failure("INITIALIZED_STATE_MISSING"));
    }
    let anchor: bool = conn.query_row("SELECT typeof(raw_capture_version)='integer' AND raw_capture_version=1 FROM native_authority_identity WHERE id=1",[],|row|row.get(0)).map_err(storage_error)?;
    if !anchor {
        return Err(failure("INITIALIZED_STATE_MISSING"));
    }
    validate_schema_guards(conn)?;
    let ids = source_ids(conn)?;
    let expected = namespace_digest(&ids);
    for name in [&TABLES[0], &TABLES[1]] {
        let row: (String,String,String) = conn.query_row(&format!("SELECT CASE WHEN typeof(source_store_id)='text' AND length(CAST(source_store_id AS BLOB))<=512 THEN source_store_id ELSE NULL END,CASE WHEN typeof(source_profile_id)='text' AND length(CAST(source_profile_id AS BLOB))<=512 THEN source_profile_id ELSE NULL END,CASE WHEN typeof(digest)='text' AND length(CAST(digest AS BLOB))=64 THEN digest ELSE NULL END FROM {name} WHERE id=1"),[],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).map_err(storage_error)?;
        if row.0 != ids.0 || row.1 != ids.1 || row.2 != expected {
            return Err(failure("SOURCE_CHANGED"));
        }
    }
    Ok(ids)
}
fn validate_schema_guards(conn: &Connection) -> Result<(), String> {
    let normalize = |value: &str| {
        value
            .trim()
            .trim_end_matches(';')
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
    };
    for (kind, prefix, definition) in [
        ("table", "CREATE TABLE ", SCHEMA),
        ("trigger", "CREATE TRIGGER ", GUARDS),
    ] {
        for fragment in definition.split(prefix).skip(1) {
            let suffix = fragment.trim();
            let name = suffix
                .split(|c: char| c.is_whitespace() || c == '(')
                .next()
                .ok_or_else(|| failure("SCHEMA_CHANGED"))?;
            let expected = normalize(&format!("{prefix}{suffix}"));
            let actual:String=conn.query_row("SELECT CASE WHEN typeof(sql)='text' AND length(CAST(sql AS BLOB))<=24576 THEN sql ELSE NULL END FROM sqlite_master WHERE type=?1 AND name=?2",params![kind,name],|row|row.get(0)).map_err(storage_error)?;
            if normalize(&actual) != expected {
                return Err(failure("SCHEMA_CHANGED"));
            }
        }
    }
    Ok(())
}
fn health(conn: &Connection, pending: Option<&str>) -> Result<(i64, i64), String> {
    let ids = namespace(conn)?;
    let mut budget = None;
    for name in [&TABLES[2], &TABLES[3]] {
        let row: (i64,i64,String) = conn.query_row(&format!("SELECT rows,bytes,CASE WHEN typeof(digest)='text' AND length(CAST(digest AS BLOB))=64 THEN digest ELSE NULL END FROM {name} WHERE id=1"),[],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).map_err(storage_error)?;
        if row.0 < 0
            || row.0 > MAX_ROWS
            || row.1 < 0
            || row.1 > STORE_BYTES
            || row.2 != budget_digest(&ids, row.0, row.1)
            || budget.as_ref().is_some_and(|old| old != &row)
        {
            return Err(failure("BUDGET_CORRUPT"));
        }
        budget = Some(row);
    }
    let budget = budget.ok_or_else(|| failure("BUDGET_CORRUPT"))?;
    let actual: (i64,i64,i64,i64) = conn.query_row("SELECT COUNT(*),COALESCE(SUM(weight),0),COALESCE(MIN(ordinal),0),COALESCE(MAX(ordinal),0) FROM native_raw_captures",[],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?))).map_err(storage_error)?;
    if actual.0 != budget.0
        || actual.1 != budget.1
        || actual.3 != budget.0
        || actual.2 != if budget.0 > 0 { 1 } else { 0 }
        || raw_parent_count(conn, pending)? != budget.0
    {
        return Err(failure("RETAINED_STATE_MISSING"));
    }
    let mismatched: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM native_raw_captures r LEFT JOIN native_renderer_checkpoint_receipts p ON p.nonce=r.nonce WHERE p.nonce IS NULL OR json_type(p.receipt_json,'$.rawCapture') IS NOT 'object' OR json_extract(p.receipt_json,'$.nonce') IS NOT r.nonce OR json_extract(p.receipt_json,'$.sourceStoreId') IS NOT r.source_store_id OR json_extract(p.receipt_json,'$.sourceProfileId') IS NOT r.source_profile_id OR json_extract(p.receipt_json,'$.rawCapture.version') IS NOT 1 OR json_extract(p.receipt_json,'$.rawCapture.sha256') IS NOT r.raw_sha256 OR json_extract(p.receipt_json,'$.rawCapture.byteLength') IS NOT r.raw_bytes OR json_extract(p.receipt_json,'$.rawCapture.snapshotCount') IS NOT r.snapshot_count OR json_extract(p.receipt_json,'$.rawCapture.comparisonSha256') IS NOT r.comparison_sha256 OR p.payload_digest IS NOT r.payload_digest OR typeof(r.raw_json)!='text' OR length(CAST(r.raw_json AS BLOB)) IS NOT r.raw_bytes OR r.raw_bytes<=0 OR r.raw_bytes>16777216)",[],|row|row.get(0)).map_err(storage_error)?;
    if mismatched {
        return Err(failure("PARENT_REFERENCE_CHANGED"));
    }
    Ok((budget.0, budget.1))
}

fn parent_at(
    conn: &Connection,
    sql: &NativeSqlCheckpointReceipt,
) -> Result<(String, String), String> {
    validate_parent(sql)?;
    let row: Option<(String,String)> = conn.query_row("SELECT CASE WHEN typeof(payload_digest)='text' AND length(CAST(payload_digest AS BLOB))=64 THEN payload_digest ELSE NULL END,CASE WHEN typeof(receipt_json)='text' AND length(CAST(receipt_json AS BLOB))<=8192 THEN receipt_json ELSE NULL END FROM native_renderer_checkpoint_receipts WHERE nonce=?1",[&sql.nonce],|row|Ok((row.get(0)?,row.get(1)?))).optional().map_err(storage_error)?;
    let (fingerprint, raw) = row.ok_or_else(|| failure("PARENT_MISSING"))?;
    if raw.len() > PARENT_BYTES {
        return Err(failure("PARENT_CORRUPT"));
    }
    let retained: NativeSqlCheckpointReceipt =
        serde_json::from_str(&raw).map_err(|_| failure("PARENT_CORRUPT"))?;
    if &retained != sql || fingerprint != expectation(sql).fingerprint()? {
        return Err(failure("PARENT_CHANGED"));
    }
    Ok((fingerprint, raw))
}
fn weight(raw_bytes: u64, parent_bytes: usize, sql: &NativeSqlCheckpointReceipt) -> i64 {
    (768 + raw_bytes
        + parent_bytes as u64
        + sql.nonce.len() as u64
        + sql.source_store_id.len() as u64
        + sql.source_profile_id.len() as u64) as i64
}
fn row_digest(
    sql: &NativeSqlCheckpointReceipt,
    parent_sha: &str,
    fingerprint: &str,
    ordinal: i64,
    weight: i64,
    budget: &str,
) -> Result<String, String> {
    let descriptor = sql
        .raw_capture
        .as_ref()
        .ok_or_else(|| failure("PARENT_REFERENCE_MISSING"))?;
    Ok(digest(
        &serde_json::to_vec(&(
            1,
            &sql.nonce,
            &sql.source_store_id,
            &sql.source_profile_id,
            parent_sha,
            fingerprint,
            descriptor,
            ordinal,
            weight,
            budget,
        ))
        .map_err(|_| failure("INVALID_PARENT"))?,
    ))
}

pub(crate) fn retain_at(
    checked: &CheckedStoreTransaction<'_>,
    store: &SessionStore,
    sql: &NativeSqlCheckpointReceipt,
    artifact: &RawCaptureArtifact,
) -> Result<RawCaptureReceipt, String> {
    retain_with_limits(checked, store, sql, artifact, MAX_ROWS, STORE_BYTES)
}
fn retain_with_limits(
    checked: &CheckedStoreTransaction<'_>,
    store: &SessionStore,
    sql: &NativeSqlCheckpointReceipt,
    artifact: &RawCaptureArtifact,
    row_limit: i64,
    byte_limit: i64,
) -> Result<RawCaptureReceipt, String> {
    if !checked.is_for(store)
        || checked.native_instance_id().to_string() != sql.native_store_instance
    {
        return Err(failure("WRONG_STORE_TRANSACTION"));
    }
    let conn = checked.connection();
    require_full(conn)?;
    if !checked.has_new_renderer_checkpoint_parent(&sql.nonce) {
        return Err(failure("PARENT_NOT_CURRENT_TRANSACTION"));
    }
    let receipt = RawCaptureReceipt::from_sql(sql)?;
    if artifact.session_id() != sql.session_id
        || sql.raw_capture.as_ref()
            != Some(
                &artifact.descriptor(
                    &sql.raw_capture
                        .as_ref()
                        .ok_or_else(|| failure("PARENT_REFERENCE_MISSING"))?
                        .comparison_sha256,
                )?,
            )
    {
        return Err(failure("RAW_CHANGED"));
    }
    let ids = namespace(conn)?;
    if ids != (sql.source_store_id.clone(), sql.source_profile_id.clone()) {
        return Err(failure("SOURCE_CHANGED"));
    }
    let (fingerprint, parent) = parent_at(conn, sql)?;
    let (rows, bytes) = health(conn, Some(&sql.nonce))?;
    let raw = sql
        .raw_capture
        .as_ref()
        .ok_or_else(|| failure("PARENT_REFERENCE_MISSING"))?;
    let added = weight(raw.byte_length, parent.len(), sql);
    if rows >= row_limit
        || bytes
            .checked_add(added)
            .is_none_or(|next| next > byte_limit)
    {
        return Err(failure("CAPACITY"));
    }
    let next_budget = budget_digest(&ids, rows + 1, bytes + added);
    let parent_sha = digest(parent.as_bytes());
    let row_hash = row_digest(
        sql,
        &parent_sha,
        &fingerprint,
        rows + 1,
        added,
        &next_budget,
    )?;
    conn.execute("INSERT INTO native_raw_captures(nonce,source_store_id,source_profile_id,parent_sha256,payload_digest,raw_sha256,raw_bytes,snapshot_count,comparison_sha256,raw_json,ordinal,weight,budget_digest,row_digest) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",params![sql.nonce,sql.source_store_id,sql.source_profile_id,parent_sha,fingerprint,raw.sha256,raw.byte_length as i64,raw.snapshot_count as i64,raw.comparison_sha256,artifact.raw(),rows+1,added,next_budget,row_hash]).map_err(|error| error.to_string())?;
    health(conn, None)?;
    Ok(receipt)
}

/// Private live continuation: old native runtime provenance cannot become current.
pub(crate) fn read_at(
    conn: &Connection,
    store: &SessionStore,
    expected: &RawCaptureReceipt,
) -> Result<RawCaptureReceipt, String> {
    if expected.sql.native_store_instance != store.native_instance_id().to_string() {
        return Err(failure("RUNTIME_CHANGED"));
    }
    read_retained_at(conn, store, expected)
}
/// Exact historical data verification only, preserving the original runtime in
/// the returned reference. This cannot create a current window/round capability.
pub(crate) fn read_retained_at(
    conn: &Connection,
    store: &SessionStore,
    expected: &RawCaptureReceipt,
) -> Result<RawCaptureReceipt, String> {
    if expected.version != 1 {
        return Err(failure("INVALID_RECEIPT"));
    }
    validate_read_binding(conn, store)?;
    let ids = namespace(conn)?;
    if ids
        != (
            expected.sql.source_store_id.clone(),
            expected.sql.source_profile_id.clone(),
        )
    {
        return Err(failure("SOURCE_CHANGED"));
    }
    health(conn, None)?;
    let (fingerprint, parent) = parent_at(conn, &expected.sql)?;
    let header = header_at(conn, &expected.sql, &parent, &fingerprint)?;
    let raw: String = conn.query_row("SELECT CASE WHEN typeof(raw_json)='text' AND length(CAST(raw_json AS BLOB)) BETWEEN 1 AND 16777216 THEN raw_json ELSE NULL END FROM native_raw_captures WHERE nonce=?1",[&expected.sql.nonce],|row|row.get(0)).map_err(storage_error)?;
    let descriptor = expected
        .sql
        .raw_capture
        .as_ref()
        .ok_or_else(|| failure("PARENT_REFERENCE_MISSING"))?;
    if raw.len() as u64 != descriptor.byte_length
        || digest(raw.as_bytes()) != descriptor.sha256
        || validate_raw(&raw, &expected.sql.session_id)? as u64 != descriptor.snapshot_count
        || header.0 != descriptor.byte_length as i64
    {
        return Err(failure("RAW_CHANGED"));
    }
    Ok(expected.clone())
}
fn validate_read_binding(conn: &Connection, store: &SessionStore) -> Result<(), String> {
    // No recursive main-Store lock: the actual caller normally holds it already.
    // File-backed Stores have their own independent immutable identity reader.
    let reader = store
        .list_conn
        .try_lock()
        .map_err(|_| failure("READ_STORE_BUSY"))?;
    if let Some(reader) = reader.as_ref() {
        if conn.path() != reader.path() || source_ids(conn)? != source_ids(reader)? {
            return Err(failure("SOURCE_CHANGED"));
        }
    } else {
        match store.conn.try_lock() {
            Ok(actual) if !std::ptr::eq(conn, &**actual) => return Err(failure("SOURCE_CHANGED")),
            Err(std::sync::TryLockError::Poisoned(_)) => return Err(failure("READ_STORE_BUSY")),
            _ if conn.path().is_some_and(|path| !path.is_empty()) => {
                return Err(failure("SOURCE_CHANGED"));
            }
            _ => {}
        }
    }
    Ok(())
}
type HeaderRow = (
    String,
    String,
    i64,
    i64,
    String,
    String,
    i64,
    i64,
    String,
    String,
);
fn header_at(
    conn: &Connection,
    sql: &NativeSqlCheckpointReceipt,
    parent: &str,
    fingerprint: &str,
) -> Result<(i64, i64), String> {
    let row: Option<HeaderRow> = conn.query_row("SELECT CASE WHEN typeof(parent_sha256)='text' AND length(CAST(parent_sha256 AS BLOB))=64 THEN parent_sha256 ELSE NULL END,CASE WHEN typeof(raw_sha256)='text' AND length(CAST(raw_sha256 AS BLOB))=64 THEN raw_sha256 ELSE NULL END,raw_bytes,snapshot_count,CASE WHEN typeof(comparison_sha256)='text' AND length(CAST(comparison_sha256 AS BLOB))=64 THEN comparison_sha256 ELSE NULL END,CASE WHEN typeof(payload_digest)='text' AND length(CAST(payload_digest AS BLOB))=64 THEN payload_digest ELSE NULL END,ordinal,weight,CASE WHEN typeof(budget_digest)='text' AND length(CAST(budget_digest AS BLOB))=64 THEN budget_digest ELSE NULL END,CASE WHEN typeof(row_digest)='text' AND length(CAST(row_digest AS BLOB))=64 THEN row_digest ELSE NULL END FROM native_raw_captures WHERE nonce=?1",[&sql.nonce],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?,r.get(8)?,r.get(9)?))).optional().map_err(storage_error)?;
    let row = row.ok_or_else(|| failure("RAW_MISSING"))?;
    let raw = sql
        .raw_capture
        .as_ref()
        .ok_or_else(|| failure("PARENT_REFERENCE_MISSING"))?;
    if row.0 != digest(parent.as_bytes())
        || row.1 != raw.sha256
        || row.2 != raw.byte_length as i64
        || row.3 != raw.snapshot_count as i64
        || row.4 != raw.comparison_sha256
        || row.5 != fingerprint
        || row.6 <= 0
        || row.6 > MAX_ROWS
        || row.7 != weight(raw.byte_length, parent.len(), sql)
        || !hex(&row.8)
        || row.9 != row_digest(sql, &row.0, fingerprint, row.6, row.7, &row.8)?
    {
        return Err(failure("RETAINED_METADATA_CHANGED"));
    }
    Ok((row.2, row.6))
}
fn validate_retained_headers(conn: &Connection) -> Result<(), String> {
    let mut statement = conn.prepare("SELECT CASE WHEN typeof(nonce)='text' AND length(CAST(nonce AS BLOB))=36 THEN nonce ELSE NULL END FROM native_raw_captures LIMIT 4097").map_err(storage_error)?;
    let nonces = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(storage_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(storage_error)?;
    if nonces.len() > MAX_ROWS as usize {
        return Err(failure("CAPACITY"));
    }
    for nonce in nonces {
        if !uuid(&nonce) {
            return Err(failure("RETAINED_METADATA_CHANGED"));
        }
        let raw: String = conn.query_row("SELECT CASE WHEN typeof(receipt_json)='text' AND length(CAST(receipt_json AS BLOB))<=8192 THEN receipt_json ELSE NULL END FROM native_renderer_checkpoint_receipts WHERE nonce=?1",[&nonce],|row|row.get(0)).map_err(storage_error)?;
        let sql: NativeSqlCheckpointReceipt =
            serde_json::from_str(&raw).map_err(|_| failure("PARENT_CORRUPT"))?;
        let (fingerprint, parent) = parent_at(conn, &sql)?;
        header_at(conn, &sql, &parent, &fingerprint)?;
    }
    Ok(())
}

const SCHEMA: &str = r#"
CREATE TABLE native_raw_capture_namespace(id INTEGER PRIMARY KEY CHECK(id=1),source_store_id TEXT NOT NULL,source_profile_id TEXT NOT NULL,digest TEXT NOT NULL);
CREATE TABLE native_raw_capture_namespace_witness(id INTEGER PRIMARY KEY CHECK(id=1),source_store_id TEXT NOT NULL,source_profile_id TEXT NOT NULL,digest TEXT NOT NULL);
CREATE TABLE native_raw_capture_budget(id INTEGER PRIMARY KEY CHECK(id=1),rows INTEGER NOT NULL,bytes INTEGER NOT NULL,digest TEXT NOT NULL);
CREATE TABLE native_raw_capture_budget_witness(id INTEGER PRIMARY KEY CHECK(id=1),rows INTEGER NOT NULL,bytes INTEGER NOT NULL,digest TEXT NOT NULL);
CREATE TABLE native_raw_captures(nonce TEXT PRIMARY KEY REFERENCES native_renderer_checkpoint_receipts(nonce),source_store_id TEXT NOT NULL,source_profile_id TEXT NOT NULL,parent_sha256 TEXT NOT NULL,payload_digest TEXT NOT NULL,raw_sha256 TEXT NOT NULL,raw_bytes INTEGER NOT NULL,snapshot_count INTEGER NOT NULL,comparison_sha256 TEXT NOT NULL,raw_json TEXT NOT NULL,ordinal INTEGER NOT NULL UNIQUE,weight INTEGER NOT NULL,budget_digest TEXT NOT NULL,row_digest TEXT NOT NULL);
"#;
const GUARDS: &str = r#"
CREATE TRIGGER native_raw_identity_no_replace BEFORE INSERT ON native_authority_identity WHEN EXISTS(SELECT 1 FROM native_authority_identity WHERE id=NEW.id AND raw_capture_version=1) BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER native_raw_identity_immutable BEFORE UPDATE ON native_authority_identity WHEN OLD.raw_capture_version=1 AND (NEW.id!=OLD.id OR NEW.source_store_id!=OLD.source_store_id OR NEW.source_profile_id!=OLD.source_profile_id OR NEW.raw_capture_version!=OLD.raw_capture_version) BEGIN SELECT RAISE(ABORT,'NATIVE_RAW_CAPTURE_RETAINED'); END;
CREATE TRIGGER native_raw_identity_retained BEFORE DELETE ON native_authority_identity WHEN OLD.raw_capture_version=1 BEGIN SELECT RAISE(ABORT,'NATIVE_RAW_CAPTURE_RETAINED'); END;
CREATE TRIGGER native_raw_namespace_no_insert BEFORE INSERT ON native_raw_capture_namespace BEGIN SELECT RAISE(ABORT,'NATIVE_RAW_CAPTURE_RETAINED'); END;
CREATE TRIGGER native_raw_namespace_witness_no_insert BEFORE INSERT ON native_raw_capture_namespace_witness BEGIN SELECT RAISE(ABORT,'NATIVE_RAW_CAPTURE_RETAINED'); END;
CREATE TRIGGER native_raw_namespace_no_update BEFORE UPDATE ON native_raw_capture_namespace BEGIN SELECT RAISE(ABORT,'NATIVE_RAW_CAPTURE_RETAINED'); END;
CREATE TRIGGER native_raw_namespace_witness_no_update BEFORE UPDATE ON native_raw_capture_namespace_witness BEGIN SELECT RAISE(ABORT,'NATIVE_RAW_CAPTURE_RETAINED'); END;
CREATE TRIGGER native_raw_namespace_no_delete BEFORE DELETE ON native_raw_capture_namespace BEGIN SELECT RAISE(ABORT,'NATIVE_RAW_CAPTURE_RETAINED'); END;
CREATE TRIGGER native_raw_namespace_witness_no_delete BEFORE DELETE ON native_raw_capture_namespace_witness BEGIN SELECT RAISE(ABORT,'NATIVE_RAW_CAPTURE_RETAINED'); END;
CREATE TRIGGER native_raw_budget_no_insert BEFORE INSERT ON native_raw_capture_budget BEGIN SELECT RAISE(ABORT,'NATIVE_RAW_CAPTURE_RETAINED'); END;
CREATE TRIGGER native_raw_budget_witness_no_insert BEFORE INSERT ON native_raw_capture_budget_witness BEGIN SELECT RAISE(ABORT,'NATIVE_RAW_CAPTURE_RETAINED'); END;
CREATE TRIGGER native_raw_budget_no_delete BEFORE DELETE ON native_raw_capture_budget BEGIN SELECT RAISE(ABORT,'NATIVE_RAW_CAPTURE_RETAINED'); END;
CREATE TRIGGER native_raw_budget_witness_no_delete BEFORE DELETE ON native_raw_capture_budget_witness BEGIN SELECT RAISE(ABORT,'NATIVE_RAW_CAPTURE_RETAINED'); END;
CREATE TRIGGER native_raw_budget_monotonic BEFORE UPDATE ON native_raw_capture_budget WHEN NEW.id!=OLD.id OR NEW.rows!=OLD.rows+1 OR NEW.rows>4096 OR NEW.bytes<=OLD.bytes OR NEW.bytes>134217728 BEGIN SELECT RAISE(ABORT,'NATIVE_RAW_CAPTURE_CAPACITY'); END;
CREATE TRIGGER native_raw_budget_witness_monotonic BEFORE UPDATE ON native_raw_capture_budget_witness WHEN NEW.id!=OLD.id OR NEW.rows!=OLD.rows+1 OR NEW.rows>4096 OR NEW.bytes<=OLD.bytes OR NEW.bytes>134217728 BEGIN SELECT RAISE(ABORT,'NATIVE_RAW_CAPTURE_CAPACITY'); END;
CREATE TRIGGER native_raw_no_replace BEFORE INSERT ON native_raw_captures WHEN EXISTS(SELECT 1 FROM native_raw_captures WHERE nonce=NEW.nonce OR ordinal=NEW.ordinal) BEGIN SELECT RAISE(ABORT,'NATIVE_RAW_CAPTURE_RETAINED'); END;
CREATE TRIGGER native_raw_no_update BEFORE UPDATE ON native_raw_captures BEGIN SELECT RAISE(ABORT,'NATIVE_RAW_CAPTURE_RETAINED'); END;
CREATE TRIGGER native_raw_no_delete BEFORE DELETE ON native_raw_captures BEGIN SELECT RAISE(ABORT,'NATIVE_RAW_CAPTURE_RETAINED'); END;
CREATE TRIGGER native_raw_admission BEFORE INSERT ON native_raw_captures BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM native_authority_identity i JOIN native_raw_capture_namespace n ON n.id=i.id JOIN native_raw_capture_namespace_witness w ON w.id=n.id WHERE i.id=1 AND i.raw_capture_version=1 AND i.source_store_id=n.source_store_id AND i.source_profile_id=n.source_profile_id AND n.source_store_id=w.source_store_id AND n.source_profile_id=w.source_profile_id AND n.digest=w.digest AND NEW.source_store_id=i.source_store_id AND NEW.source_profile_id=i.source_profile_id) THEN RAISE(ABORT,'NATIVE_RAW_CAPTURE_SOURCE_CHANGED') END;
 SELECT CASE WHEN typeof(NEW.raw_json)!='text' OR length(CAST(NEW.raw_json AS BLOB))!=NEW.raw_bytes OR NEW.raw_bytes<=0 OR NEW.raw_bytes>16777216 OR NEW.snapshot_count<0 OR NEW.snapshot_count>256 OR NEW.weight<=NEW.raw_bytes OR length(NEW.parent_sha256)!=64 OR length(NEW.raw_sha256)!=64 OR length(NEW.comparison_sha256)!=64 OR length(NEW.payload_digest)!=64 OR length(NEW.row_digest)!=64 OR length(NEW.budget_digest)!=64 THEN RAISE(ABORT,'NATIVE_RAW_CAPTURE_CAPACITY') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM native_renderer_checkpoint_receipts p WHERE p.nonce=NEW.nonce AND json_valid(p.receipt_json) AND length(CAST(p.receipt_json AS BLOB))<=8192 AND p.payload_digest=NEW.payload_digest AND json_type(p.receipt_json,'$.rawCapture')='object' AND json_extract(p.receipt_json,'$.nonce')=NEW.nonce AND json_extract(p.receipt_json,'$.sourceStoreId')=NEW.source_store_id AND json_extract(p.receipt_json,'$.sourceProfileId')=NEW.source_profile_id AND json_extract(p.receipt_json,'$.rawCapture.version')=1 AND json_extract(p.receipt_json,'$.rawCapture.sha256')=NEW.raw_sha256 AND json_extract(p.receipt_json,'$.rawCapture.byteLength')=NEW.raw_bytes AND json_extract(p.receipt_json,'$.rawCapture.snapshotCount')=NEW.snapshot_count AND json_extract(p.receipt_json,'$.rawCapture.comparisonSha256')=NEW.comparison_sha256 AND NEW.weight=768+NEW.raw_bytes+length(CAST(p.receipt_json AS BLOB))+length(CAST(NEW.nonce AS BLOB))+length(CAST(NEW.source_store_id AS BLOB))+length(CAST(NEW.source_profile_id AS BLOB))) THEN RAISE(ABORT,'NATIVE_RAW_CAPTURE_PARENT_CHANGED') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM native_raw_capture_budget b JOIN native_raw_capture_budget_witness w ON w.id=b.id WHERE b.id=1 AND b.rows=w.rows AND b.bytes=w.bytes AND b.digest=w.digest AND NEW.ordinal=b.rows+1 AND b.rows<4096 AND b.bytes+NEW.weight<=134217728 AND b.rows=(SELECT COUNT(*) FROM native_raw_captures) AND b.bytes=(SELECT COALESCE(SUM(weight),0) FROM native_raw_captures)) THEN RAISE(ABORT,'NATIVE_RAW_CAPTURE_CAPACITY') END;
END;
CREATE TRIGGER native_raw_account AFTER INSERT ON native_raw_captures BEGIN
 UPDATE native_raw_capture_budget SET rows=rows+1,bytes=bytes+NEW.weight,digest=NEW.budget_digest WHERE id=1;
 UPDATE native_raw_capture_budget_witness SET rows=rows+1,bytes=bytes+NEW.weight,digest=NEW.budget_digest WHERE id=1;
END;
"#;

#[cfg(test)]
#[path = "native_raw_capture/tests.rs"]
mod tests;
