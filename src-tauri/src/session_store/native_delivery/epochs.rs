//! Durable v2 stream data and exact semantic retirement barriers.
//! Host descriptions never create a caller, grant, local ACK or source freshness.
use super::*;
use serde::{Deserialize, Serialize};

const MARKER_ROWS: i64 = 1_000_000;
const MARKER_BYTES: i64 = 128 * 1024 * 1024;
const COMPACT_ROWS: i64 = 32;
const MAX_EPOCHS: i64 = 1024;
const TABLES: [&str; 10] = [
    "native_delivery_epoch_namespace",
    "native_delivery_epoch_namespace_witness",
    "native_delivery_epoch_intents",
    "native_delivery_epoch_intent_witnesses",
    "native_delivery_epochs",
    "native_delivery_epoch_witnesses",
    "native_delivery_epoch_allocations",
    "native_delivery_semantic_retirements",
    "native_delivery_semantic_budget",
    "native_delivery_semantic_budget_witness",
];

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct EpochDescription {
    pub(crate) version: u8,
    pub(crate) open_id: String,
    pub(crate) owner_id: String,
    pub(crate) generation: u64,
    pub(crate) through: u64,
    pub(crate) high_water: u64,
    pub(crate) closed: bool,
}
impl EpochDescription {
    fn validate(&self) -> Result<(), String> {
        if self.version != 2
            || !uuid(&self.open_id)
            || !uuid(&self.owner_id)
            || self.generation == 0
            || self.generation > MAX_SAFE as u64
            || self.through > self.high_water
            || self.high_water > MAX_SAFE as u64
            || (self.closed && self.through != self.high_water)
        {
            return Err(invalid());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
struct State {
    open_id: String,
    owner_id: String,
    generation: i64,
    source_store_id: String,
    source_profile_id: String,
    route: String,
    local_through: i64,
    high_water: i64,
    host_through: i64,
    host_high_water: i64,
    closed: bool,
}
impl State {
    fn description(&self) -> EpochDescription {
        EpochDescription {
            version: 2,
            open_id: self.open_id.clone(),
            owner_id: self.owner_id.clone(),
            generation: self.generation as u64,
            through: self.host_through as u64,
            high_water: self.host_high_water as u64,
            closed: self.closed,
        }
    }
    fn hash(&self) -> String {
        digest(&serde_json::to_string(self).expect("finite epoch metadata"))
    }
    fn validate(&self) -> Result<(), String> {
        self.description().validate()?;
        if !key(&self.source_store_id)
            || !key(&self.source_profile_id)
            || !hex(&self.route)
            || self.local_through < 0
            || self.high_water < self.local_through
            || self.high_water > MAX_SAFE
            || self.host_through < self.local_through
            || self.host_high_water > self.high_water
            || (self.closed && self.high_water != self.host_high_water)
        {
            return Err(invalid());
        }
        Ok(())
    }
}

#[derive(Clone, Debug)]
pub(crate) struct EpochHandle {
    state: State,
    runtime: uuid::Uuid,
    connection: usize,
}
impl EpochHandle {
    #[cfg(test)]
    pub(crate) fn open_id(&self) -> &str {
        &self.state.open_id
    }
    pub(crate) fn owner_id(&self) -> &str {
        &self.state.owner_id
    }
    pub(crate) fn generation(&self) -> u64 {
        self.state.generation as u64
    }
    /// Latest observed Host floor, not evidence that local rows can be deleted.
    pub(crate) fn through(&self) -> u64 {
        self.state.host_through as u64
    }
    #[cfg(test)]
    pub(crate) fn local_through(&self) -> u64 {
        self.state.local_through as u64
    }
    #[cfg(test)]
    pub(crate) fn high_water(&self) -> u64 {
        self.state.high_water as u64
    }
    #[cfg(test)]
    pub(crate) fn next_sequence(&self) -> Result<u64, String> {
        self.state
            .high_water
            .checked_add(1)
            .filter(|n| *n <= MAX_SAFE)
            .map(|n| n as u64)
            .ok_or_else(capacity)
    }
    #[cfg(test)]
    pub(crate) fn description(&self) -> EpochDescription {
        self.state.description()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct V2Id {
    pub(super) owner: String,
    pub(super) generation: i64,
    pub(super) sequence: i64,
}
pub(super) fn parse_id(value: &str) -> Option<V2Id> {
    let mut parts = value.split(':');
    if parts.next()? != "nd2" {
        return None;
    }
    let owner = parts.next()?;
    if !uuid(owner) {
        return None;
    }
    let number = |text: &str| {
        if text.is_empty() || text.starts_with('0') || !text.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        text.parse::<i64>()
            .ok()
            .filter(|n| *n > 0 && *n <= MAX_SAFE)
    };
    let generation = number(parts.next()?)?;
    let sequence = number(parts.next()?)?;
    if parts.next().is_some() {
        return None;
    }
    Some(V2Id {
        owner: owner.into(),
        generation,
        sequence,
    })
}

fn table(conn: &Connection, name: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
        [name],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}
fn anchor(conn: &Connection) -> Result<bool, String> {
    conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='native_delivery_epoch_semantic_guard')",[],|r|r.get(0)).map_err(|e|e.to_string())
}
pub(super) fn check_structure(conn: &Connection) -> Result<(), String> {
    let mut count = 0;
    for name in TABLES {
        if table(conn, name)? {
            count += 1;
        }
    }
    let anchored = anchor(conn)?;
    if count == 0 && !anchored {
        if exists(conn)? {
            let v2:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM native_delivery_originals WHERE original_id LIKE 'nd2:%')",[],|r|r.get(0)).map_err(|_|invalid())?;
            if v2 {
                return Err(invalid());
            }
        }
        if remote_ack_table_exists(conn)? {
            let v2:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM native_delivery_remote_acks WHERE original_id LIKE 'nd2:%')",[],|r|r.get(0)).map_err(|_|invalid())?;
            if v2 {
                return Err(invalid());
            }
        }
        return Ok(());
    }
    if count != TABLES.len() || !anchored || !exists(conn)? || !remote_ack_table_exists(conn)? {
        return Err(invalid());
    }
    namespace(conn)?;
    Ok(())
}
fn namespace(conn: &Connection) -> Result<(String, String), String> {
    let ids = identity(conn)?;
    let expected = digest(&serde_json::to_string(&(2, &ids.0, &ids.1)).map_err(|_| invalid())?);
    for name in [
        "native_delivery_epoch_namespace",
        "native_delivery_epoch_namespace_witness",
    ] {
        let stored: (String, String, String) = conn
            .query_row(
                &format!(
                    "SELECT {},{},{} FROM {name} WHERE id=1",
                    bounded("source_store_id", 1, 2048),
                    bounded("source_profile_id", 1, 2048),
                    bounded("digest", 64, 64)
                ),
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(|_| invalid())?;
        if stored != (ids.0.clone(), ids.1.clone(), expected.clone()) {
            return Err(stale());
        }
    }
    Ok(ids)
}

fn initialize(conn: &Connection) -> Result<(), String> {
    require_full(conn)?;
    check_structure(conn)?;
    if table(conn, TABLES[0])? {
        read_budget(conn)?;
        return Ok(());
    }
    schema(conn)?;
    remote_ack_schema(conn)?;
    conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
    let ids = identity(conn)?;
    let witness = digest(&serde_json::to_string(&(2, &ids.0, &ids.1)).map_err(|_| invalid())?);
    for name in [
        "native_delivery_epoch_namespace",
        "native_delivery_epoch_namespace_witness",
    ] {
        conn.execute(
            &format!("INSERT INTO {name} VALUES(1,?1,?2,?3)"),
            params![ids.0, ids.1, witness],
        )
        .map_err(|e| e.to_string())?;
    }
    let hash = budget_hash(&ids, 0, 0);
    for name in [
        "native_delivery_semantic_budget",
        "native_delivery_semantic_budget_witness",
    ] {
        conn.execute(&format!("INSERT INTO {name} VALUES(1,0,0,?1)"), [&hash])
            .map_err(|e| e.to_string())?;
    }
    install_guards(conn)?;
    check_structure(conn)
}

const STATE_COLUMNS:&str="open_id,owner_id,generation,source_store_id,source_profile_id,route_fingerprint,local_through,high_water,host_through,host_high_water,closed,digest";
fn bounded(column: &str, min: usize, max: usize) -> String {
    format!("CASE WHEN length(CAST({column} AS BLOB)) BETWEEN {min} AND {max} THEN {column} END")
}
fn state_columns() -> String {
    format!(
        "{},{},generation,{},{},{},local_through,high_water,host_through,host_high_water,closed,{}",
        bounded("open_id", 36, 36),
        bounded("owner_id", 36, 36),
        bounded("source_store_id", 1, 2048),
        bounded("source_profile_id", 1, 2048),
        bounded("route_fingerprint", 64, 64),
        bounded("digest", 64, 64)
    )
}
fn decode_state(row: &rusqlite::Row<'_>) -> rusqlite::Result<(State, String)> {
    Ok((
        State {
            open_id: row.get(0)?,
            owner_id: row.get(1)?,
            generation: row.get(2)?,
            source_store_id: row.get(3)?,
            source_profile_id: row.get(4)?,
            route: row.get(5)?,
            local_through: row.get(6)?,
            high_water: row.get(7)?,
            host_through: row.get(8)?,
            host_high_water: row.get(9)?,
            closed: match row.get::<_, i64>(10)? {
                0 => false,
                1 => true,
                _ => return Err(rusqlite::Error::InvalidQuery),
            },
        },
        row.get(11)?,
    ))
}
fn state(conn: &Connection, owner: &str, generation: i64) -> Result<State, String> {
    state_inner(conn, owner, generation, true)
}
fn state_inner(
    conn: &Connection,
    owner: &str,
    generation: i64,
    check_budget: bool,
) -> Result<State, String> {
    check_structure(conn)?;
    let read = |name: &str| {
        conn.query_row(
            &format!(
                "SELECT {} FROM {name} WHERE owner_id=?1 AND generation=?2",
                state_columns()
            ),
            params![owner, generation],
            decode_state,
        )
        .map_err(|_| invalid())
    };
    let (value, hash) = read("native_delivery_epochs")?;
    if read("native_delivery_epoch_witnesses")? != (value.clone(), hash.clone())
        || value.hash() != hash
    {
        return Err(invalid());
    }
    value.validate()?;
    let ids = namespace(conn)?;
    if ids.0 != value.source_store_id || ids.1 != value.source_profile_id {
        return Err(stale());
    }
    let intent = read_intent(conn, &ids, &value.route)?.ok_or_else(invalid)?;
    if intent != value.open_id {
        return Err(invalid());
    }
    let expected = value.high_water - value.local_through;
    if expected > MAX_ROWS as i64 {
        return Err(invalid());
    }
    let actual:i64=conn.query_row("SELECT COUNT(*) FROM native_delivery_epoch_allocations a JOIN native_delivery_originals o ON o.original_id=a.original_id AND o.source_store_id=a.source_store_id AND o.source_profile_id=a.source_profile_id AND o.route_fingerprint=a.route_fingerprint AND o.semantic_key=a.semantic_key AND o.method=a.method AND o.payload_sha256=a.payload_sha256 AND o.payload_bytes=a.payload_bytes WHERE a.owner_id=?1 AND a.generation=?2 AND a.sequence>?3 AND a.sequence<=?4 AND a.original_id='nd2:'||a.owner_id||':'||a.generation||':'||a.sequence",params![value.owner_id,value.generation,value.local_through,value.high_water],|r|r.get(0)).map_err(|_|invalid())?;
    let stray:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM native_delivery_epoch_allocations WHERE owner_id=?1 AND generation=?2 AND (sequence<=?3 OR sequence>?4))",params![value.owner_id,value.generation,value.local_through,value.high_water],|r|r.get(0)).map_err(|_|invalid())?;
    if actual != expected || stray {
        return Err(invalid());
    }
    if value.local_through > 0 {
        let covered:i64=conn.query_row("SELECT COUNT(*) FROM native_delivery_semantic_retirements WHERE owner_id=?1 AND generation=?2 AND sequence BETWEEN 1 AND ?3 AND source_store_id=?4 AND source_profile_id=?5 AND route_fingerprint=?6",params![value.owner_id,value.generation,value.local_through,value.source_store_id,value.source_profile_id,value.route],|r|r.get(0)).map_err(|_|invalid())?;
        if covered != value.local_through {
            return Err(invalid());
        }
    }
    if check_budget {
        read_budget(conn)?;
    }
    Ok(value)
}
fn read_intent(
    conn: &Connection,
    ids: &(String, String),
    route: &str,
) -> Result<Option<String>, String> {
    let read = |name: &str| {
        conn.query_row(&format!("SELECT {},{},bound_generation,{} FROM {name} WHERE source_store_id=?1 AND source_profile_id=?2 AND route_fingerprint=?3",bounded("open_id",36,36),bounded("bound_owner",36,36),bounded("digest",64,64)),params![ids.0,ids.1,route],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Option<String>>(1)?,r.get::<_,Option<i64>>(2)?,r.get::<_,String>(3)?))).optional().map_err(|_|invalid())
    };
    let intent = read("native_delivery_epoch_intents")?;
    if read("native_delivery_epoch_intent_witnesses")? != intent {
        return Err(invalid());
    }
    if let Some((id, owner, generation, hash)) = &intent {
        if *id != deterministic_open_id(ids, route)
            || *hash != intent_hash(ids, route, id, owner.as_deref(), *generation)
        {
            return Err(invalid());
        }
        match (owner, generation) {
            (Some(owner), Some(generation))
                if uuid(owner) && *generation > 0 && *generation <= MAX_SAFE =>
            {
                for table in ["native_delivery_epochs", "native_delivery_epoch_witnesses"] {
                    let present:bool=conn.query_row(&format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE owner_id=?1 AND generation=?2 AND open_id=?3 AND source_store_id=?4 AND source_profile_id=?5 AND route_fingerprint=?6)"),params![owner,generation,id,ids.0,ids.1,route],|r|r.get(0)).map_err(|_|invalid())?;
                    if !present {
                        return Err(invalid());
                    }
                }
            }
            (None, None) => {
                let premature:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM native_delivery_epochs WHERE source_store_id=?1 AND source_profile_id=?2 AND route_fingerprint=?3)",params![ids.0,ids.1,route],|r|r.get(0)).map_err(|_|invalid())?;
                if premature {
                    return Err(invalid());
                }
            }
            _ => return Err(invalid()),
        }
    } else {
        let bound:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM native_delivery_epochs WHERE source_store_id=?1 AND source_profile_id=?2 AND route_fingerprint=?3)",params![ids.0,ids.1,route],|r|r.get(0)).map_err(|_|invalid())?;
        if bound {
            return Err(invalid());
        }
    }
    Ok(intent.map(|v| v.0))
}
fn save_state(conn: &Connection, value: &State, insert: bool) -> Result<(), String> {
    value.validate()?;
    let hash = value.hash();
    for name in ["native_delivery_epochs", "native_delivery_epoch_witnesses"] {
        let sql = if insert {
            format!("INSERT INTO {name}({STATE_COLUMNS}) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)")
        } else {
            format!("UPDATE {name} SET local_through=?7,high_water=?8,host_through=?9,host_high_water=?10,closed=?11,digest=?12 WHERE open_id=?1 AND owner_id=?2 AND generation=?3 AND source_store_id=?4 AND source_profile_id=?5 AND route_fingerprint=?6")
        };
        if conn
            .execute(
                &sql,
                params![
                    value.open_id,
                    value.owner_id,
                    value.generation,
                    value.source_store_id,
                    value.source_profile_id,
                    value.route,
                    value.local_through,
                    value.high_water,
                    value.host_through,
                    value.host_high_water,
                    i64::from(value.closed),
                    hash
                ],
            )
            .map_err(|e| e.to_string())?
            != 1
        {
            return Err(stale());
        }
    }
    Ok(())
}
fn handle(conn: &Connection, store: &SessionStore, value: State) -> EpochHandle {
    EpochHandle {
        state: value,
        runtime: store.native_instance_id(),
        connection: conn as *const Connection as usize,
    }
}
fn pinned(conn: &Connection, expected: &EpochHandle) -> Result<State, String> {
    if conn as *const Connection as usize != expected.connection {
        return Err(stale());
    }
    let value = state(conn, &expected.state.owner_id, expected.state.generation)?;
    if value.open_id != expected.state.open_id
        || value.route != expected.state.route
        || value.source_store_id != expected.state.source_store_id
        || value.source_profile_id != expected.state.source_profile_id
    {
        return Err(stale());
    }
    Ok(value)
}
fn runtime(store: &SessionStore, handle: &EpochHandle) -> Result<(), String> {
    if store.native_instance_id() != handle.runtime {
        return Err(stale());
    }
    Ok(())
}

pub(crate) fn open_id(store: &SessionStore, route: &str) -> Result<String, String> {
    if !hex(route) {
        return Err(invalid());
    }
    write(store, |conn| {
        initialize(conn)?;
        let ids = namespace(conn)?;
        if let Some(id) = read_intent(conn, &ids, route)? {
            return Ok(id);
        }
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM native_delivery_epoch_intents",
                [],
                |r| r.get(0),
            )
            .map_err(|_| invalid())?;
        if count >= MAX_EPOCHS {
            return Err(capacity());
        }
        let id = deterministic_open_id(&ids, route);
        let hash = intent_hash(&ids, route, &id, None, None);
        for name in [
            "native_delivery_epoch_intents",
            "native_delivery_epoch_intent_witnesses",
        ] {
            conn.execute(
                &format!("INSERT INTO {name} VALUES(?1,?2,?3,?4,NULL,NULL,?5)"),
                params![ids.0, ids.1, route, id, hash],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(id)
    })
}
fn intent_hash(
    ids: &(String, String),
    route: &str,
    id: &str,
    owner: Option<&str>,
    generation: Option<i64>,
) -> String {
    digest(
        &serde_json::to_string(&(&ids.0, &ids.1, route, id, owner, generation))
            .expect("finite immutable intent binding"),
    )
}
fn deterministic_open_id(ids: &(String, String), route: &str) -> String {
    let raw = serde_json::to_vec(&(
        "bycoda.native.delivery.epoch.open.v2",
        &ids.0,
        &ids.1,
        route,
    ))
    .expect("finite immutable intent identity");
    let hash = Sha256::digest(&raw);
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&hash[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    uuid::Uuid::from_bytes(bytes).to_string()
}
#[cfg(test)]
pub(crate) fn bind(
    store: &SessionStore,
    route: &str,
    description: &EpochDescription,
) -> Result<EpochHandle, String> {
    description.validate()?;
    if !hex(route) {
        return Err(invalid());
    }
    write(store, |conn| bind_tx(conn, store, route, description))
}
pub(crate) fn bind_tx(
    conn: &Connection,
    store: &SessionStore,
    route: &str,
    description: &EpochDescription,
) -> Result<EpochHandle, String> {
    require_full(conn)?;
    description.validate()?;
    if !hex(route) {
        return Err(invalid());
    }
    initialize(conn)?;
    let ids = namespace(conn)?;
    if read_intent(conn, &ids, route)?.as_deref() != Some(&description.open_id) {
        return Err(stale());
    }
    let old:Option<(String,i64)>=conn.query_row(&format!("SELECT {},generation FROM native_delivery_epochs WHERE source_store_id=?1 AND source_profile_id=?2 AND route_fingerprint=?3",bounded("owner_id",36,36)),params![ids.0,ids.1,route],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(|_|invalid())?;
    let mut value = if let Some((owner, generation)) = old {
        if owner != description.owner_id || generation as u64 != description.generation {
            return Err(stale());
        }
        let value = state(conn, &owner, generation)?;
        if description.through < value.host_through as u64
            || description.high_water < value.host_high_water as u64
            || description.high_water > value.high_water as u64
            || (value.closed && !description.closed)
        {
            return Err(stale());
        }
        value
    } else {
        if description.through != 0 || description.high_water != 0 || description.closed {
            return Err(invalid());
        }
        let value = State {
            open_id: description.open_id.clone(),
            owner_id: description.owner_id.clone(),
            generation: description.generation as i64,
            source_store_id: ids.0,
            source_profile_id: ids.1,
            route: route.into(),
            local_through: 0,
            high_water: 0,
            host_through: 0,
            host_high_water: 0,
            closed: false,
        };
        save_state(conn, &value, true)?;
        let ids = (
            value.source_store_id.clone(),
            value.source_profile_id.clone(),
        );
        let hash = intent_hash(
            &ids,
            route,
            &value.open_id,
            Some(&value.owner_id),
            Some(value.generation),
        );
        for name in [
            "native_delivery_epoch_intents",
            "native_delivery_epoch_intent_witnesses",
        ] {
            if conn.execute(&format!("UPDATE {name} SET bound_owner=?1,bound_generation=?2,digest=?3 WHERE source_store_id=?4 AND source_profile_id=?5 AND route_fingerprint=?6 AND bound_owner IS NULL AND bound_generation IS NULL"),params![value.owner_id,value.generation,hash,ids.0,ids.1,route]).map_err(|e|e.to_string())?!=1 {return Err(stale());}
        }
        return Ok(handle(conn, store, value));
    };
    value.host_through = description.through as i64;
    value.host_high_water = description.high_water as i64;
    value.closed = description.closed;
    save_state(conn, &value, false)?;
    Ok(handle(conn, store, value))
}
pub(crate) fn current(store: &SessionStore, expected: &EpochHandle) -> Result<EpochHandle, String> {
    runtime(store, expected)?;
    let conn = store.lock_conn()?;
    Ok(handle(&conn, store, pinned(&conn, expected)?))
}

pub(crate) fn prepare(
    store: &SessionStore,
    semantic_key: &str,
    route: &str,
    method: &str,
    raw: &str,
    epoch: &EpochHandle,
) -> Result<Original, String> {
    prepare_with_budget(
        store,
        semantic_key,
        route,
        method,
        raw,
        epoch,
        result_budget(method)?,
    )
}

pub(crate) fn prepare_with_budget(
    store: &SessionStore,
    semantic_key: &str,
    route: &str,
    method: &str,
    raw: &str,
    epoch: &EpochHandle,
    budget: usize,
) -> Result<Original, String> {
    prepare_inputs(semantic_key, route, method, raw)?;
    runtime(store, epoch)?;
    write(store, |conn| {
        let mut value = pinned(conn, epoch)?;
        if value.route != route {
            return Err(stale());
        }
        prepare_tx(
            conn,
            store,
            semantic_key,
            route,
            method,
            raw,
            budget,
            |conn| {
                if value.closed {
                    return Err(
                    "NATIVE_DELIVERY_EPOCH_CLOSED: this stream cannot allocate another original"
                        .into(),
                );
                }
                if value.host_through != value.local_through {
                    return Err("NATIVE_DELIVERY_EPOCH_UNCONFIRMED: Host floor lacks matching local consumption/retirement evidence".into());
                }
                value.high_water = value
                    .high_water
                    .checked_add(1)
                    .filter(|n| *n <= MAX_SAFE)
                    .ok_or_else(capacity)?;
                save_state(conn, &value, false)?;
                let id = format!(
                    "nd2:{}:{}:{}",
                    value.owner_id, value.generation, value.high_water
                );
                conn.execute("INSERT INTO native_delivery_epoch_allocations VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",params![id,value.owner_id,value.generation,value.high_water,semantic_key,route,method,value.source_store_id,value.source_profile_id,digest(raw),raw.len() as i64]).map_err(|e|e.to_string())?;
                Ok(id)
            },
        )
    })
}
pub(super) fn legacy_allocation_allowed(conn: &Connection, route: &str) -> Result<(), String> {
    if !table(conn, "native_delivery_epochs")? {
        return Ok(());
    }
    let ids = namespace(conn)?;
    let bound:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM native_delivery_epochs WHERE source_store_id=?1 AND source_profile_id=?2 AND route_fingerprint=?3)",params![ids.0,ids.1,route],|r|r.get(0)).map_err(|_|invalid())?;
    if bound {
        return Err(
            "NATIVE_DELIVERY_V2_REQUIRED: this route already initialized an ordered stream".into(),
        );
    }
    Ok(())
}

pub(super) fn validate_original(conn: &Connection, original: &Original) -> Result<(), String> {
    let Some(id) = parse_id(original.id()) else {
        return Ok(());
    };
    let value = state(conn, &id.owner, id.generation)?;
    if id.sequence <= value.local_through
        || id.sequence > value.high_water
        || original.source_store_id != value.source_store_id
        || original.source_profile_id != value.source_profile_id
        || original.route_fingerprint != value.route
    {
        return Err(invalid());
    }
    let matched:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM native_delivery_epoch_allocations WHERE original_id=?1 AND owner_id=?2 AND generation=?3 AND sequence=?4 AND semantic_key=?5 AND route_fingerprint=?6 AND method=?7 AND source_store_id=?8 AND source_profile_id=?9 AND payload_sha256=?10 AND payload_bytes=?11)",params![original.id,id.owner,id.generation,id.sequence,original.semantic_key,original.route_fingerprint,original.method,original.source_store_id,original.source_profile_id,original.payload_sha256,original.payload_bytes as i64],|r|r.get(0)).map_err(|_|invalid())?;
    if !matched {
        return Err(invalid());
    }
    Ok(())
}
pub(crate) fn for_original(
    store: &SessionStore,
    original: &Original,
) -> Result<Option<EpochHandle>, String> {
    check_runtime(store, original)?;
    let Some(id) = parse_id(original.id()) else {
        return Ok(None);
    };
    let conn = store.lock_conn()?;
    let _ = super::current(&conn, original)?;
    Ok(Some(handle(
        &conn,
        store,
        state(&conn, &id.owner, id.generation)?,
    )))
}

fn budget_hash(ids: &(String, String), rows: i64, bytes: i64) -> String {
    digest(&serde_json::to_string(&(&ids.0, &ids.1, rows, bytes)).expect("finite marker budget"))
}
fn read_budget(conn: &Connection) -> Result<(i64, i64), String> {
    let ids = namespace(conn)?;
    let read = |name: &str| {
        conn.query_row(
            &format!(
                "SELECT rows,bytes,{} FROM {name} WHERE id=1",
                bounded("digest", 64, 64)
            ),
            [],
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, String>(2)?,
                ))
            },
        )
        .map_err(|_| invalid())
    };
    let value = read("native_delivery_semantic_budget")?;
    if read("native_delivery_semantic_budget_witness")? != value
        || value.0 < 0
        || value.0 > MARKER_ROWS
        || value.1 < 0
        || value.1 > MARKER_BYTES
        || budget_hash(&ids, value.0, value.1) != value.2
    {
        return Err(invalid());
    }
    let actual: (i64, i64) = conn
        .query_row(
            "SELECT COUNT(*),COALESCE(SUM(weight),0) FROM native_delivery_semantic_retirements",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| invalid())?;
    if actual != (value.0, value.1) {
        return Err(invalid());
    }
    Ok((value.0, value.1))
}
pub(super) fn check_semantic(
    conn: &Connection,
    ids: &(String, String),
    semantic: &str,
    route: &str,
    method: &str,
    hash: &str,
    bytes: usize,
) -> Result<(), String> {
    check_structure(conn)?;
    if !table(conn, "native_delivery_semantic_retirements")? {
        return Ok(());
    }
    read_budget(conn)?;
    // A v1 writer must not remint an original after losing a v2 slot/marker.
    // Validate the bounded initialized stream catalog; never reconstruct tips.
    let mut intents = conn
        .prepare(&format!(
            "SELECT {} FROM native_delivery_epoch_intents LIMIT 1025",
            bounded("route_fingerprint", 64, 64)
        ))
        .map_err(|_| invalid())?;
    let routes = intents
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|_| invalid())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| invalid())?;
    if routes.len() > MAX_EPOCHS as usize {
        return Err(invalid());
    }
    for route in routes {
        read_intent(conn, ids, &route)?;
    }
    let mut statement = conn
        .prepare(&format!(
            "SELECT {},generation FROM native_delivery_epochs LIMIT 1025",
            bounded("owner_id", 36, 36)
        ))
        .map_err(|_| invalid())?;
    let bound = statement
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
        .map_err(|_| invalid())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| invalid())?;
    if bound.len() > MAX_EPOCHS as usize {
        return Err(invalid());
    }
    for (owner, generation) in bound {
        state_inner(conn, &owner, generation, false)?;
    }
    let old:Option<(String,String,String,i64)>=conn.query_row(&format!("SELECT {},{},{},payload_bytes FROM native_delivery_semantic_retirements WHERE source_store_id=?1 AND source_profile_id=?2 AND semantic_key=?3",bounded("route_fingerprint",64,64),bounded("method",1,128),bounded("payload_sha256",64,64)),params![ids.0,ids.1,semantic],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().map_err(|_|invalid())?;
    if let Some(old) = old {
        if old != (route.into(), method.into(), hash.into(), bytes as i64) {
            return Err("NATIVE_DELIVERY_CONFLICT: this retired original key belongs to a different route, method or exact request bytes".into());
        }
        return Err("NATIVE_DELIVERY_RETIRED: this semantic original was durably consumed and compacted; do not create another identity".into());
    }
    Ok(())
}

fn prefix(
    conn: &Connection,
    value: &State,
    end: i64,
    runtime: uuid::Uuid,
    connection: usize,
    strict: bool,
) -> Result<Vec<Original>, String> {
    let mut originals = Vec::new();
    for sequence in value.local_through + 1..=end {
        let id = format!("nd2:{}:{}:{}", value.owner_id, value.generation, sequence);
        let original = read(conn, &id, runtime, connection)?.ok_or_else(invalid)?;
        if original.phase() != Phase::Acknowledged || !remote_acked(conn, &original)? {
            if strict {
                return Err("NATIVE_DELIVERY_EPOCH_HOLE: Host floor cannot replace local consume and remote ACK evidence".into());
            }
            break;
        }
        originals.push(original);
    }
    Ok(originals)
}
pub(crate) fn eligible_through(store: &SessionStore, epoch: &EpochHandle) -> Result<u64, String> {
    runtime(store, epoch)?;
    let conn = store.lock_conn()?;
    let value = pinned(&conn, epoch)?;
    let end = value.high_water.min(value.local_through + COMPACT_ROWS);
    let rows = prefix(&conn, &value, end, epoch.runtime, epoch.connection, false)?;
    Ok((value.local_through + rows.len() as i64) as u64)
}
#[cfg(test)]
pub(crate) fn compact(
    store: &SessionStore,
    epoch: &EpochHandle,
    description: &EpochDescription,
) -> Result<usize, String> {
    runtime(store, epoch)?;
    write(store, |conn| compact_tx(conn, epoch, description))
}
pub(crate) fn compact_tx(
    conn: &Connection,
    epoch: &EpochHandle,
    description: &EpochDescription,
) -> Result<usize, String> {
    compact_limits(conn, epoch, description, MARKER_ROWS, MARKER_BYTES)
}
fn compact_limits(
    conn: &Connection,
    epoch: &EpochHandle,
    description: &EpochDescription,
    max_rows: i64,
    max_bytes: i64,
) -> Result<usize, String> {
    require_full(conn)?;
    description.validate()?;
    let mut value = pinned(conn, epoch)?;
    if description.open_id != value.open_id
        || description.owner_id != value.owner_id
        || description.generation as i64 != value.generation
        || description.through < value.host_through as u64
        || description.high_water < value.host_high_water as u64
        || description.high_water > value.high_water as u64
        || (value.closed && !description.closed)
    {
        return Err(stale());
    }
    let end = (description.through as i64).min(value.local_through + COMPACT_ROWS);
    let originals = prefix(conn, &value, end, epoch.runtime, epoch.connection, true)?;
    let (rows, bytes) = read_budget(conn)?;
    let weights = originals.iter().map(marker_weight).collect::<Vec<_>>();
    let added = weights
        .iter()
        .try_fold(0i64, |sum, n| sum.checked_add(*n))
        .ok_or_else(capacity)?;
    let total_rows = rows
        .checked_add(originals.len() as i64)
        .ok_or_else(capacity)?;
    let total_bytes = bytes.checked_add(added).ok_or_else(capacity)?;
    if total_rows > max_rows || total_bytes > max_bytes {
        return Err(capacity());
    }
    value.host_through = description.through as i64;
    value.host_high_water = description.high_water as i64;
    value.closed = description.closed;
    value.local_through = end.max(value.local_through);
    save_state(conn, &value, false)?;
    let ids = namespace(conn)?;
    let mut used_rows = rows;
    let mut used_bytes = bytes;
    for (original, weight) in originals.iter().zip(weights) {
        let id = parse_id(original.id()).ok_or_else(invalid)?;
        let consumed = original.consumed_result()?;
        used_rows += 1;
        used_bytes += weight;
        let budget_digest = budget_hash(&ids, used_rows, used_bytes);
        conn.execute("INSERT INTO native_delivery_semantic_retirements VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",params![original.source_store_id,original.source_profile_id,original.semantic_key,original.route_fingerprint,original.method,original.id,id.owner,id.generation,id.sequence,original.payload_sha256,original.payload_bytes as i64,consumed.0,consumed.1 as i64,weight,budget_digest]).map_err(|e|e.to_string())?;
        conn.execute(
            "DELETE FROM native_delivery_remote_acks WHERE original_id=?1",
            [original.id()],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM native_delivery_originals WHERE original_id=?1",
            [original.id()],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM native_delivery_epoch_allocations WHERE original_id=?1",
            [original.id()],
        )
        .map_err(|e| e.to_string())?;
    }
    if read_budget(conn)? != (total_rows, total_bytes) {
        return Err(invalid());
    }
    Ok(originals.len())
}
fn marker_weight(o: &Original) -> i64 {
    (320 + o.source_store_id.len()
        + o.source_profile_id.len()
        + o.semantic_key.len()
        + o.route_fingerprint.len()
        + o.method.len()
        + o.id.len()
        + o.payload_sha256.len()
        + o.result_sha256.as_ref().map_or(0, String::len)) as i64
}

const SCHEMA: &str = r#"
CREATE TABLE native_delivery_epoch_namespace(id INTEGER PRIMARY KEY CHECK(id=1),source_store_id TEXT NOT NULL,source_profile_id TEXT NOT NULL,digest TEXT NOT NULL);
CREATE TABLE native_delivery_epoch_namespace_witness(id INTEGER PRIMARY KEY CHECK(id=1),source_store_id TEXT NOT NULL,source_profile_id TEXT NOT NULL,digest TEXT NOT NULL);
CREATE TABLE native_delivery_epoch_intents(source_store_id TEXT NOT NULL,source_profile_id TEXT NOT NULL,route_fingerprint TEXT NOT NULL,open_id TEXT NOT NULL UNIQUE,bound_owner TEXT,bound_generation INTEGER,digest TEXT NOT NULL,PRIMARY KEY(source_store_id,source_profile_id,route_fingerprint));
CREATE TABLE native_delivery_epoch_intent_witnesses(source_store_id TEXT NOT NULL,source_profile_id TEXT NOT NULL,route_fingerprint TEXT NOT NULL,open_id TEXT NOT NULL UNIQUE,bound_owner TEXT,bound_generation INTEGER,digest TEXT NOT NULL,PRIMARY KEY(source_store_id,source_profile_id,route_fingerprint));
CREATE TABLE native_delivery_epochs(open_id TEXT NOT NULL UNIQUE,owner_id TEXT NOT NULL,generation INTEGER NOT NULL,source_store_id TEXT NOT NULL,source_profile_id TEXT NOT NULL,route_fingerprint TEXT NOT NULL,local_through INTEGER NOT NULL,high_water INTEGER NOT NULL,host_through INTEGER NOT NULL,host_high_water INTEGER NOT NULL,closed INTEGER NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(owner_id,generation),UNIQUE(source_store_id,source_profile_id,route_fingerprint));
CREATE TABLE native_delivery_epoch_witnesses(open_id TEXT NOT NULL UNIQUE,owner_id TEXT NOT NULL,generation INTEGER NOT NULL,source_store_id TEXT NOT NULL,source_profile_id TEXT NOT NULL,route_fingerprint TEXT NOT NULL,local_through INTEGER NOT NULL,high_water INTEGER NOT NULL,host_through INTEGER NOT NULL,host_high_water INTEGER NOT NULL,closed INTEGER NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(owner_id,generation),UNIQUE(source_store_id,source_profile_id,route_fingerprint));
CREATE TABLE native_delivery_epoch_allocations(original_id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,generation INTEGER NOT NULL,sequence INTEGER NOT NULL,semantic_key TEXT NOT NULL,route_fingerprint TEXT NOT NULL,method TEXT NOT NULL,source_store_id TEXT NOT NULL,source_profile_id TEXT NOT NULL,payload_sha256 TEXT NOT NULL,payload_bytes INTEGER NOT NULL,UNIQUE(owner_id,generation,sequence));
CREATE TABLE native_delivery_semantic_retirements(source_store_id TEXT NOT NULL,source_profile_id TEXT NOT NULL,semantic_key TEXT NOT NULL,route_fingerprint TEXT NOT NULL,method TEXT NOT NULL,original_id TEXT NOT NULL UNIQUE,owner_id TEXT NOT NULL,generation INTEGER NOT NULL,sequence INTEGER NOT NULL,payload_sha256 TEXT NOT NULL,payload_bytes INTEGER NOT NULL,result_sha256 TEXT NOT NULL,result_bytes INTEGER NOT NULL,weight INTEGER NOT NULL,budget_digest TEXT NOT NULL,PRIMARY KEY(source_store_id,source_profile_id,semantic_key));
CREATE UNIQUE INDEX native_delivery_semantic_epoch_sequence ON native_delivery_semantic_retirements(owner_id,generation,sequence);
CREATE TABLE native_delivery_semantic_budget(id INTEGER PRIMARY KEY CHECK(id=1),rows INTEGER NOT NULL,bytes INTEGER NOT NULL,digest TEXT NOT NULL);
CREATE TABLE native_delivery_semantic_budget_witness(id INTEGER PRIMARY KEY CHECK(id=1),rows INTEGER NOT NULL,bytes INTEGER NOT NULL,digest TEXT NOT NULL);
"#;

fn install_guards(conn: &Connection) -> Result<(), String> {
    for name in TABLES {
        let duplicate=match name {
            "native_delivery_epoch_namespace" | "native_delivery_epoch_namespace_witness" | "native_delivery_semantic_budget" | "native_delivery_semantic_budget_witness" => "o.id=NEW.id",
            "native_delivery_epoch_intents" | "native_delivery_epoch_intent_witnesses" => "o.open_id=NEW.open_id OR (o.source_store_id=NEW.source_store_id AND o.source_profile_id=NEW.source_profile_id AND o.route_fingerprint=NEW.route_fingerprint)",
            "native_delivery_epochs" | "native_delivery_epoch_witnesses" => "o.open_id=NEW.open_id OR (o.owner_id=NEW.owner_id AND o.generation=NEW.generation) OR (o.source_store_id=NEW.source_store_id AND o.source_profile_id=NEW.source_profile_id AND o.route_fingerprint=NEW.route_fingerprint)",
            "native_delivery_epoch_allocations" => "o.original_id=NEW.original_id OR (o.owner_id=NEW.owner_id AND o.generation=NEW.generation AND o.sequence=NEW.sequence)",
            "native_delivery_semantic_retirements" => "o.original_id=NEW.original_id OR (o.source_store_id=NEW.source_store_id AND o.source_profile_id=NEW.source_profile_id AND o.semantic_key=NEW.semantic_key) OR (o.owner_id=NEW.owner_id AND o.generation=NEW.generation AND o.sequence=NEW.sequence)",
            _=>return Err(invalid()),
        };
        conn.execute_batch(&format!("CREATE TRIGGER {name}_no_replace BEFORE INSERT ON {name} WHEN EXISTS(SELECT 1 FROM {name} o WHERE {duplicate}) BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_IMMUTABLE'); END;")).map_err(|e|e.to_string())?;
    }
    for name in [
        "native_delivery_epoch_namespace",
        "native_delivery_epoch_namespace_witness",
        "native_delivery_semantic_retirements",
    ] {
        conn.execute_batch(&format!("CREATE TRIGGER {name}_immutable BEFORE UPDATE ON {name} BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_IMMUTABLE'); END; CREATE TRIGGER {name}_retained BEFORE DELETE ON {name} BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_RETAINED'); END;")).map_err(|e|e.to_string())?;
    }
    for name in [
        "native_delivery_epoch_intents",
        "native_delivery_epoch_intent_witnesses",
    ] {
        conn.execute_batch(&format!("CREATE TRIGGER {name}_immutable BEFORE UPDATE ON {name} WHEN NEW.source_store_id IS NOT OLD.source_store_id OR NEW.source_profile_id IS NOT OLD.source_profile_id OR NEW.route_fingerprint IS NOT OLD.route_fingerprint OR NEW.open_id IS NOT OLD.open_id OR OLD.bound_owner IS NOT NULL OR OLD.bound_generation IS NOT NULL OR NEW.bound_owner IS NULL OR length(CAST(NEW.bound_owner AS BLOB))!=36 OR NEW.bound_generation IS NULL OR NEW.bound_generation<1 OR NEW.bound_generation>9007199254740991 OR length(CAST(NEW.digest AS BLOB))!=64 BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_IMMUTABLE'); END;
          CREATE TRIGGER {name}_retained BEFORE DELETE ON {name} BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_RETAINED'); END;")).map_err(|e|e.to_string())?;
    }
    for name in ["native_delivery_epochs", "native_delivery_epoch_witnesses"] {
        conn.execute_batch(&format!("CREATE TRIGGER {name}_identity BEFORE UPDATE OF open_id,owner_id,generation,source_store_id,source_profile_id,route_fingerprint ON {name} BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_IMMUTABLE'); END;
          CREATE TRIGGER {name}_monotonic BEFORE UPDATE ON {name} WHEN NEW.local_through<OLD.local_through OR NEW.local_through>OLD.local_through+32 OR NEW.high_water<OLD.high_water OR NEW.high_water>OLD.high_water+1 OR NEW.host_through<OLD.host_through OR NEW.host_high_water<OLD.host_high_water OR NEW.local_through>NEW.host_through OR NEW.host_through>NEW.host_high_water OR NEW.host_high_water>NEW.high_water OR NEW.high_water>9007199254740991 OR NEW.closed<OLD.closed OR NEW.closed NOT IN(0,1) BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_EPOCH_REGRESSION'); END;
          CREATE TRIGGER {name}_retained BEFORE DELETE ON {name} BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_RETAINED'); END;")).map_err(|e|e.to_string())?;
    }
    for name in [
        "native_delivery_semantic_budget",
        "native_delivery_semantic_budget_witness",
    ] {
        conn.execute_batch(&format!("CREATE TRIGGER {name}_monotonic BEFORE UPDATE ON {name} WHEN NEW.id!=OLD.id OR NEW.rows<OLD.rows OR NEW.rows>OLD.rows+32 OR NEW.rows>1000000 OR NEW.bytes<OLD.bytes OR NEW.bytes>134217728 BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_CAPACITY'); END; CREATE TRIGGER {name}_retained BEFORE DELETE ON {name} BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_RETAINED'); END;")).map_err(|e|e.to_string())?;
    }
    conn.execute_batch(GUARDS).map_err(|e| e.to_string())
}

const GUARDS: &str = r#"
CREATE TRIGGER native_delivery_epoch_semantic_guard BEFORE INSERT ON native_delivery_originals
WHEN EXISTS(SELECT 1 FROM native_delivery_semantic_retirements m WHERE m.source_store_id=NEW.source_store_id AND m.source_profile_id=NEW.source_profile_id AND m.semantic_key=NEW.semantic_key) OR EXISTS(SELECT 1 FROM native_delivery_epoch_allocations a WHERE a.source_store_id=NEW.source_store_id AND a.source_profile_id=NEW.source_profile_id AND a.semantic_key=NEW.semantic_key AND a.original_id!=NEW.original_id)
BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_RETIRED'); END;
CREATE TRIGGER native_delivery_epoch_insert_guard BEFORE INSERT ON native_delivery_originals WHEN NEW.original_id LIKE 'nd2:%' AND NOT EXISTS(
 SELECT 1 FROM native_delivery_epoch_allocations a JOIN native_delivery_epochs e ON e.owner_id=a.owner_id AND e.generation=a.generation
 JOIN native_delivery_epoch_witnesses w ON w.owner_id=e.owner_id AND w.generation=e.generation AND w.digest=e.digest AND w.open_id=e.open_id AND w.source_store_id=e.source_store_id AND w.source_profile_id=e.source_profile_id AND w.route_fingerprint=e.route_fingerprint AND w.local_through=e.local_through AND w.high_water=e.high_water AND w.host_through=e.host_through AND w.host_high_water=e.host_high_water AND w.closed=e.closed
 WHERE a.original_id=NEW.original_id AND NEW.original_id='nd2:'||a.owner_id||':'||a.generation||':'||a.sequence
 AND a.source_store_id=NEW.source_store_id AND a.source_profile_id=NEW.source_profile_id AND a.semantic_key=NEW.semantic_key AND a.route_fingerprint=NEW.route_fingerprint AND a.method=NEW.method AND a.payload_sha256=NEW.payload_sha256 AND a.payload_bytes=NEW.payload_bytes AND a.sequence=e.high_water AND a.sequence>e.local_through AND e.closed=0)
BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_EPOCH_INVALID'); END;
CREATE TRIGGER native_delivery_epoch_legacy_guard BEFORE INSERT ON native_delivery_originals WHEN NEW.original_id NOT LIKE 'nd2:%' AND EXISTS(
 SELECT 1 FROM native_delivery_epochs e WHERE e.source_store_id=NEW.source_store_id AND e.source_profile_id=NEW.source_profile_id AND e.route_fingerprint=NEW.route_fingerprint)
BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_V2_REQUIRED'); END;
CREATE TRIGGER native_delivery_epoch_allocation_immutable BEFORE UPDATE ON native_delivery_epoch_allocations BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_IMMUTABLE'); END;
CREATE TRIGGER native_delivery_epoch_allocation_valid BEFORE INSERT ON native_delivery_epoch_allocations WHEN NOT EXISTS(
 SELECT 1 FROM native_delivery_epochs e JOIN native_delivery_epoch_witnesses w ON w.owner_id=e.owner_id AND w.generation=e.generation
 AND w.open_id=e.open_id AND w.source_store_id=e.source_store_id AND w.source_profile_id=e.source_profile_id AND w.route_fingerprint=e.route_fingerprint AND w.local_through=e.local_through AND w.high_water=e.high_water AND w.host_through=e.host_through AND w.host_high_water=e.host_high_water AND w.closed=e.closed AND w.digest=e.digest
 WHERE NEW.original_id='nd2:'||NEW.owner_id||':'||NEW.generation||':'||NEW.sequence
 AND e.owner_id=NEW.owner_id AND e.generation=NEW.generation AND e.source_store_id=NEW.source_store_id AND e.source_profile_id=NEW.source_profile_id AND e.route_fingerprint=NEW.route_fingerprint
 AND NEW.sequence=e.high_water AND NEW.sequence>e.local_through AND e.closed=0
 AND typeof(NEW.generation)='integer' AND NEW.generation BETWEEN 1 AND 9007199254740991 AND typeof(NEW.sequence)='integer' AND NEW.sequence BETWEEN 1 AND 9007199254740991
 AND length(CAST(NEW.semantic_key AS BLOB)) BETWEEN 1 AND 2048 AND length(CAST(NEW.payload_sha256 AS BLOB))=64 AND NEW.payload_bytes BETWEEN 1 AND 16777216
 AND NEW.method IN('native.buffers.update','native.services.conversation.desktop.finish','native.services.workspace.format'))
BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_EPOCH_INVALID'); END;
CREATE TRIGGER native_delivery_semantic_marker_valid BEFORE INSERT ON native_delivery_semantic_retirements WHEN NOT EXISTS(
 SELECT 1 FROM native_delivery_originals o JOIN native_delivery_remote_acks r ON r.original_id=o.original_id AND r.result_sha256=o.result_sha256 AND r.result_bytes=o.result_bytes
 JOIN native_delivery_epoch_allocations a ON a.original_id=o.original_id
 JOIN native_delivery_epochs e ON e.owner_id=a.owner_id AND e.generation=a.generation
 JOIN native_delivery_epoch_witnesses w ON w.owner_id=e.owner_id AND w.generation=e.generation AND w.digest=e.digest AND w.open_id=e.open_id AND w.source_store_id=e.source_store_id AND w.source_profile_id=e.source_profile_id AND w.route_fingerprint=e.route_fingerprint AND w.local_through=e.local_through AND w.high_water=e.high_water AND w.host_through=e.host_through AND w.host_high_water=e.host_high_water AND w.closed=e.closed AND w.local_through=e.local_through
 WHERE o.phase='acknowledged' AND o.original_id=NEW.original_id AND o.original_id='nd2:'||a.owner_id||':'||a.generation||':'||a.sequence
 AND a.semantic_key=o.semantic_key AND a.source_store_id=o.source_store_id AND a.source_profile_id=o.source_profile_id AND a.route_fingerprint=o.route_fingerprint AND a.method=o.method AND a.payload_sha256=o.payload_sha256 AND a.payload_bytes=o.payload_bytes
 AND e.source_store_id=o.source_store_id AND e.source_profile_id=o.source_profile_id AND e.route_fingerprint=o.route_fingerprint
 AND o.semantic_key=NEW.semantic_key AND o.source_store_id=NEW.source_store_id AND o.source_profile_id=NEW.source_profile_id AND o.route_fingerprint=NEW.route_fingerprint AND o.method=NEW.method AND o.payload_sha256=NEW.payload_sha256 AND o.payload_bytes=NEW.payload_bytes AND o.result_sha256=NEW.result_sha256 AND o.result_bytes=NEW.result_bytes AND a.owner_id=NEW.owner_id AND a.generation=NEW.generation AND a.sequence=NEW.sequence AND a.sequence<=e.local_through AND e.local_through<=e.host_through
 AND NEW.weight=320+length(CAST(NEW.source_store_id AS BLOB))+length(CAST(NEW.source_profile_id AS BLOB))+length(CAST(NEW.semantic_key AS BLOB))+length(CAST(NEW.route_fingerprint AS BLOB))+length(CAST(NEW.method AS BLOB))+length(CAST(NEW.original_id AS BLOB))+length(CAST(NEW.payload_sha256 AS BLOB))+length(CAST(NEW.result_sha256 AS BLOB)))
BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_EPOCH_UNCONFIRMED'); END;
CREATE TRIGGER native_delivery_semantic_marker_capacity BEFORE INSERT ON native_delivery_semantic_retirements WHEN length(CAST(NEW.budget_digest AS BLOB))!=64 OR NOT EXISTS(
 SELECT 1 FROM native_delivery_semantic_budget b JOIN native_delivery_semantic_budget_witness w ON w.id=b.id AND w.rows=b.rows AND w.bytes=b.bytes AND w.digest=b.digest
 WHERE b.id=1 AND b.rows>=0 AND b.rows<1000000 AND b.bytes>=0 AND NEW.weight>0 AND b.bytes<=134217728-NEW.weight)
BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_CAPACITY'); END;
CREATE TRIGGER native_delivery_semantic_marker_account AFTER INSERT ON native_delivery_semantic_retirements BEGIN
 UPDATE native_delivery_semantic_budget SET rows=rows+1,bytes=bytes+NEW.weight,digest=NEW.budget_digest WHERE id=1;
 UPDATE native_delivery_semantic_budget_witness SET rows=rows+1,bytes=bytes+NEW.weight,digest=NEW.budget_digest WHERE id=1;
END;
DROP TRIGGER native_delivery_no_delete;
CREATE TRIGGER native_delivery_no_delete BEFORE DELETE ON native_delivery_originals WHEN OLD.phase!='acknowledged' OR NOT EXISTS(
 SELECT 1 FROM native_delivery_semantic_retirements m JOIN native_delivery_epochs e ON e.owner_id=m.owner_id AND e.generation=m.generation JOIN native_delivery_epoch_witnesses w ON w.owner_id=e.owner_id AND w.generation=e.generation AND w.digest=e.digest AND w.open_id=e.open_id AND w.source_store_id=e.source_store_id AND w.source_profile_id=e.source_profile_id AND w.route_fingerprint=e.route_fingerprint AND w.local_through=e.local_through AND w.high_water=e.high_water AND w.host_through=e.host_through AND w.host_high_water=e.host_high_water AND w.closed=e.closed AND w.local_through=e.local_through
 WHERE OLD.original_id='nd2:'||m.owner_id||':'||m.generation||':'||m.sequence AND m.original_id=OLD.original_id AND m.source_store_id=OLD.source_store_id AND m.source_profile_id=OLD.source_profile_id AND m.semantic_key=OLD.semantic_key AND m.route_fingerprint=OLD.route_fingerprint AND m.method=OLD.method AND m.payload_sha256=OLD.payload_sha256 AND m.payload_bytes=OLD.payload_bytes AND m.result_sha256=OLD.result_sha256 AND m.result_bytes=OLD.result_bytes AND m.sequence<=e.local_through AND e.local_through<=e.host_through)
BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_RETAINED'); END;
DROP TRIGGER native_delivery_remote_ack_retained;
CREATE TRIGGER native_delivery_remote_ack_retained BEFORE DELETE ON native_delivery_remote_acks WHEN NOT EXISTS(
 SELECT 1 FROM native_delivery_semantic_retirements m JOIN native_delivery_epochs e ON e.owner_id=m.owner_id AND e.generation=m.generation JOIN native_delivery_epoch_witnesses w ON w.owner_id=e.owner_id AND w.generation=e.generation AND w.digest=e.digest AND w.open_id=e.open_id AND w.source_store_id=e.source_store_id AND w.source_profile_id=e.source_profile_id AND w.route_fingerprint=e.route_fingerprint AND w.local_through=e.local_through AND w.high_water=e.high_water AND w.host_through=e.host_through AND w.host_high_water=e.host_high_water AND w.closed=e.closed AND w.local_through=e.local_through
 JOIN native_delivery_originals o ON o.original_id=m.original_id AND o.phase='acknowledged' AND o.result_sha256=m.result_sha256 AND o.result_bytes=m.result_bytes
 WHERE m.original_id=OLD.original_id AND m.original_id='nd2:'||m.owner_id||':'||m.generation||':'||m.sequence
 AND o.source_store_id=m.source_store_id AND o.source_profile_id=m.source_profile_id AND o.route_fingerprint=m.route_fingerprint AND o.semantic_key=m.semantic_key AND o.method=m.method AND o.payload_sha256=m.payload_sha256 AND o.payload_bytes=m.payload_bytes
 AND m.result_sha256=OLD.result_sha256 AND m.result_bytes=OLD.result_bytes AND m.sequence<=e.local_through AND e.local_through<=e.host_through)
BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_RETAINED'); END;
CREATE TRIGGER native_delivery_epoch_allocation_retained BEFORE DELETE ON native_delivery_epoch_allocations WHEN NOT EXISTS(
 SELECT 1 FROM native_delivery_semantic_retirements m JOIN native_delivery_epochs e ON e.owner_id=m.owner_id AND e.generation=m.generation JOIN native_delivery_epoch_witnesses w ON w.owner_id=e.owner_id AND w.generation=e.generation AND w.digest=e.digest AND w.open_id=e.open_id AND w.source_store_id=e.source_store_id AND w.source_profile_id=e.source_profile_id AND w.route_fingerprint=e.route_fingerprint AND w.local_through=e.local_through AND w.high_water=e.high_water AND w.host_through=e.host_through AND w.host_high_water=e.host_high_water AND w.closed=e.closed AND w.local_through=e.local_through
 WHERE m.original_id=OLD.original_id AND m.original_id='nd2:'||m.owner_id||':'||m.generation||':'||m.sequence
 AND m.source_store_id=OLD.source_store_id AND m.source_profile_id=OLD.source_profile_id AND m.route_fingerprint=OLD.route_fingerprint AND m.semantic_key=OLD.semantic_key AND m.method=OLD.method AND m.payload_sha256=OLD.payload_sha256 AND m.payload_bytes=OLD.payload_bytes
 AND m.owner_id=OLD.owner_id AND m.generation=OLD.generation AND m.sequence=OLD.sequence AND m.sequence<=e.local_through
 AND NOT EXISTS(SELECT 1 FROM native_delivery_originals o WHERE o.original_id=OLD.original_id))
BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_RETAINED'); END;
"#;

#[cfg(test)]
#[path = "epoch_tests.rs"]
mod tests;
