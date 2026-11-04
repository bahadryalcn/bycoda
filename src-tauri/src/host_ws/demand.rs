//! Logical subscription union inside one already authenticated physical route.
//! No credentials, network, command execution or fabricated application ACKs.
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Cursor {
    epoch: String,
    sequence: u64,
}
impl Cursor {
    fn parse(value: &Value) -> Result<Self, &'static str> {
        let cursor = Self {
            epoch: value["epoch"].as_str().ok_or("cursor")?.into(),
            sequence: value["sequence"].as_u64().ok_or("cursor")?,
        };
        if cursor.epoch.is_empty() || cursor.sequence > 9_007_199_254_740_991 {
            return Err("cursor");
        }
        Ok(cursor)
    }
    fn value(&self) -> Value {
        json!({"epoch":self.epoch,"sequence":self.sequence})
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub(super) struct MemberId {
    pub owner: String,
    pub logical_id: String,
}
impl MemberId {
    pub fn new(owner: &str, logical_id: &str) -> Self {
        Self {
            owner: owner.into(),
            logical_id: logical_id.into(),
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum OperationKind {
    Open,
    Close,
    Ack,
}
#[derive(Clone, Debug)]
pub(super) struct Operation {
    pub id: String,
    pub key: String,
    pub serial: u64,
    pub kind: OperationKind,
    pub method: &'static str,
    pub params: Value,
}
#[derive(Debug)]
pub(super) enum Notice {
    Opened { member: MemberId, stream: String },
    Event { member: MemberId, event: Value },
    Rejected { member: MemberId },
}
#[derive(Default, Debug)]
pub(super) struct Effects {
    pub operations: Vec<Operation>,
    pub retired: Vec<String>,
    pub notices: Vec<Notice>,
}
impl Effects {
    fn append(&mut self, mut other: Self) {
        self.operations.append(&mut other.operations);
        self.retired.append(&mut other.retired);
        self.notices.append(&mut other.notices);
    }
}
struct Member {
    waiting: bool,
    /// Cursor the caller sent with its open; the resume point until it applies an event.
    requested: Option<Cursor>,
    applied: Option<Cursor>,
    baseline: Option<Cursor>,
    delivered: BTreeSet<u64>,
}
#[derive(PartialEq)]
enum Phase {
    Opening,
    Active,
    Closing,
    Failed,
}
struct Demand {
    shape: Value,
    wire: String,
    stream: Option<String>,
    virtual_stream: Option<String>,
    members: BTreeMap<MemberId, Member>,
    phase: Phase,
    current: Option<Operation>,
    serial: u64,
    refresh: bool,
    tombstoned: bool,
    first: Option<Cursor>,
    last_ack: Option<Cursor>,
    events: VecDeque<Value>,
    bytes: usize,
    recovery_attempts: usize,
    wire_sent: bool,
}
pub(super) struct DemandUnion {
    demands: HashMap<String, Demand>,
    members: HashMap<MemberId, String>,
    wire_keys: HashMap<String, String>,
    max_groups: usize,
    max_per_window: usize,
    max_members: usize,
    max_events: usize,
    max_group_bytes: usize,
    max_bytes: usize,
}
impl DemandUnion {
    pub fn new(
        max_groups: usize,
        max_per_window: usize,
        max_members: usize,
        max_events: usize,
        max_group_bytes: usize,
        max_bytes: usize,
    ) -> Self {
        Self {
            demands: HashMap::new(),
            members: HashMap::new(),
            wire_keys: HashMap::new(),
            max_groups,
            max_per_window,
            max_members,
            max_events,
            max_group_bytes,
            max_bytes,
        }
    }
    pub fn knows_wire(&self, wire: &str) -> bool {
        self.wire_keys.contains_key(wire)
    }
    pub fn operation_current(&self, operation: &Operation) -> bool {
        self.demands
            .get(&operation.key)
            .and_then(|d| d.current.as_ref())
            .is_some_and(|current| current.id == operation.id && current.serial == operation.serial)
    }
    pub fn requires_wire(&self, operation: &Operation) -> bool {
        operation.kind != OperationKind::Close
            || self
                .demands
                .get(&operation.key)
                .is_some_and(|demand| demand.wire_sent)
    }
    pub fn sent(&mut self, operation: &Operation) {
        if operation.kind == OperationKind::Open && self.operation_current(operation) {
            self.demands.get_mut(&operation.key).unwrap().wire_sent = true;
        }
    }
    fn shape(params: &Value) -> Value {
        let mut shape = params.as_object().cloned().unwrap_or_default();
        shape.remove("subscriptionId");
        shape.remove("cursor");
        Value::Object(shape)
    }
    fn operation(key: &str, demand: &mut Demand, kind: OperationKind, params: Value) -> Operation {
        demand.serial += 1;
        let method = match kind {
            OperationKind::Open => "subscriptions.open",
            OperationKind::Close => "subscriptions.close",
            OperationKind::Ack => "subscriptions.ack",
        };
        let operation = Operation {
            id: uuid::Uuid::new_v4().to_string(),
            key: key.into(),
            serial: demand.serial,
            kind,
            method,
            params,
        };
        demand.current = Some(operation.clone());
        operation
    }
    fn begin_open(key: &str, demand: &mut Demand) -> Operation {
        demand.phase = Phase::Opening;
        demand.wire_sent = false;
        demand.stream = None;
        demand.first = None;
        demand.last_ack = None;
        demand.events.clear();
        demand.bytes = 0;
        for member in demand.members.values_mut() {
            member.baseline = None;
            member.delivered.clear();
        }
        let mut params = demand.shape.clone();
        params["subscriptionId"] = demand.wire.clone().into();
        // Resume from the cursor every member already holds instead of
        // re-downloading the stream; members that disagree get a full snapshot.
        if let Some(cursor) = Self::shared_cursor(demand) {
            params["cursor"] = cursor.value();
        }
        Self::operation(key, demand, OperationKind::Open, params)
    }
    /// The one cursor all members agree on, if any.
    fn shared_cursor(demand: &Demand) -> Option<Cursor> {
        let mut shared: Option<Cursor> = None;
        for member in demand.members.values() {
            let cursor = member.applied.as_ref().or(member.requested.as_ref())?;
            match &shared {
                Some(existing) if existing != cursor => return None,
                Some(_) => {}
                None => shared = Some(cursor.clone()),
            }
        }
        shared
    }
    fn begin_close(key: &str, demand: &mut Demand, refresh: bool, effects: &mut Effects) {
        demand.refresh |= refresh;
        if demand.phase == Phase::Closing {
            return;
        }
        if let Some(previous) = demand.current.take() {
            effects.retired.push(previous.id);
        }
        demand.phase = Phase::Closing;
        let params = json!({"subscriptionId":demand.wire});
        effects
            .operations
            .push(Self::operation(key, demand, OperationKind::Close, params));
    }

    pub fn open(
        &mut self,
        owner: &str,
        params: &Value,
    ) -> Result<(MemberId, Effects), &'static str> {
        let id = params["subscriptionId"].as_str().ok_or("subscription")?;
        let member_id = MemberId::new(owner, id);
        if self.members.contains_key(&member_id) {
            return Err("duplicate");
        }
        if self.members.len() >= self.max_members
            || self.members.keys().filter(|m| m.owner == owner).count() >= self.max_per_window
        {
            return Err("limit");
        }
        let shape = Self::shape(params);
        let key = shape.to_string();
        if !self.demands.contains_key(&key) {
            if self.demands.len() >= self.max_groups {
                return Err("limit");
            }
            // A logical caller ID can be reused after release. A wire ID cannot:
            // late packets from its previous registration must remain fenced.
            let wire = uuid::Uuid::new_v4().to_string();
            self.wire_keys.insert(wire.clone(), key.clone());
            self.demands.insert(
                key.clone(),
                Demand {
                    shape,
                    wire,
                    stream: None,
                    virtual_stream: None,
                    members: BTreeMap::new(),
                    phase: Phase::Opening,
                    current: None,
                    serial: 0,
                    refresh: false,
                    tombstoned: false,
                    first: None,
                    last_ack: None,
                    events: VecDeque::new(),
                    bytes: 0,
                    recovery_attempts: 0,
                    wire_sent: false,
                },
            );
        }
        let demand = self.demands.get_mut(&key).expect("demand inserted");
        if demand.tombstoned || demand.phase == Phase::Failed {
            return Err("closed");
        }
        demand.members.insert(
            member_id.clone(),
            Member {
                waiting: true,
                requested: params
                    .get("cursor")
                    .and_then(|value| Cursor::parse(value).ok()),
                applied: None,
                baseline: None,
                delivered: BTreeSet::new(),
            },
        );
        self.members.insert(member_id.clone(), key.clone());
        let mut effects = Effects::default();
        if demand.phase == Phase::Active && demand.first.is_none() {
            if let Some(stream) = &demand.virtual_stream {
                demand.members.get_mut(&member_id).unwrap().waiting = false;
                effects.notices.push(Notice::Opened {
                    member: member_id.clone(),
                    stream: stream.clone(),
                });
            }
        } else if demand.phase == Phase::Active {
            Self::begin_close(&key, demand, true, &mut effects);
        } else if demand.phase == Phase::Opening && demand.current.is_none() {
            effects.operations.push(Self::begin_open(&key, demand));
        }
        Ok((member_id, effects))
    }

    pub fn close(&mut self, member: &MemberId) -> Result<Effects, &'static str> {
        let key = self.members.remove(member).ok_or("owner")?;
        let demand = self.demands.get_mut(&key).ok_or("owner")?;
        demand.members.remove(member);
        let mut effects = Effects::default();
        if demand.members.is_empty() {
            Self::begin_close(&key, demand, false, &mut effects);
            demand.refresh = false;
        } else if demand.phase == Phase::Active {
            effects.append(Self::schedule_ack(&key, demand));
        }
        Ok(effects)
    }
    pub fn detach(&mut self, active: impl Fn(&str) -> bool) -> Effects {
        let removed: Vec<_> = self
            .members
            .keys()
            .filter(|member| !active(&member.owner))
            .cloned()
            .collect();
        let mut effects = Effects::default();
        for member in removed {
            if let Ok(result) = self.close(&member) {
                effects.append(result);
            }
        }
        effects
    }
    fn rewrite(demand: &Demand, member: &MemberId, event: &Value) -> Value {
        let mut event = event.clone();
        event["params"]["subscriptionId"] = member.logical_id.clone().into();
        if let Some(stream) = &demand.virtual_stream {
            event["params"]["streamId"] = stream.clone().into();
        }
        event
    }
    fn baseline_applied(member: &Member) -> bool {
        member
            .baseline
            .as_ref()
            .zip(member.applied.as_ref())
            .is_some_and(|(baseline, applied)| {
                baseline.epoch == applied.epoch && applied.sequence >= baseline.sequence
            })
    }
    fn emit_event(
        demand: &mut Demand,
        event: &Value,
        effects: &mut Effects,
    ) -> Result<(), &'static str> {
        let cursor = Cursor::parse(&event["params"]["cursor"])?;
        let snapshot = event["params"]["kind"] == "snapshot";
        for (id, member) in &mut demand.members {
            if member.waiting {
                continue;
            }
            if snapshot && member.baseline.is_none() {
                member.baseline = Some(cursor.clone());
            } else if !Self::baseline_applied(member) {
                continue;
            }
            member.delivered.insert(cursor.sequence);
            let mut rewritten = event.clone();
            rewritten["params"]["subscriptionId"] = id.logical_id.clone().into();
            if let Some(stream) = &demand.virtual_stream {
                rewritten["params"]["streamId"] = stream.clone().into();
            }
            effects.notices.push(Notice::Event {
                member: id.clone(),
                event: rewritten,
            });
        }
        Ok(())
    }
    fn schedule_ack(key: &str, demand: &mut Demand) -> Effects {
        let mut effects = Effects::default();
        if demand.current.is_some() || demand.phase != Phase::Active || demand.members.is_empty() {
            return effects;
        }
        let Some(first) = &demand.first else {
            return effects;
        };
        let mut minimum = u64::MAX;
        for member in demand.members.values() {
            let Some(cursor) = &member.applied else {
                return effects;
            };
            if cursor.epoch != first.epoch || cursor.sequence < first.sequence {
                return effects;
            }
            minimum = minimum.min(cursor.sequence);
        }
        if demand
            .last_ack
            .as_ref()
            .is_some_and(|cursor| cursor.epoch == first.epoch && cursor.sequence >= minimum)
        {
            return effects;
        }
        let cursor = Cursor {
            epoch: first.epoch.clone(),
            sequence: minimum,
        };
        let params = json!({"subscriptionId":demand.wire,"cursor":cursor.value()});
        effects
            .operations
            .push(Self::operation(key, demand, OperationKind::Ack, params));
        effects
    }
    pub fn acknowledge(
        &mut self,
        member_id: &MemberId,
        raw: &Value,
    ) -> Result<Effects, &'static str> {
        let key = self.members.get(member_id).ok_or("owner")?.clone();
        let demand = self.demands.get_mut(&key).ok_or("owner")?;
        if demand.tombstoned || demand.phase != Phase::Active {
            return Err("closed");
        }
        let cursor = Cursor::parse(raw)?;
        let member = demand.members.get_mut(member_id).ok_or("owner")?;
        if member.applied.as_ref() == Some(&cursor) {
            return Ok(Self::schedule_ack(&key, demand));
        }
        if member
            .baseline
            .as_ref()
            .is_none_or(|baseline| baseline.epoch != cursor.epoch)
            || !member.delivered.contains(&cursor.sequence)
            || member.applied.as_ref().is_some_and(|previous| {
                previous.epoch == cursor.epoch && previous.sequence > cursor.sequence
            })
        {
            return Err("cursor");
        }
        member.applied = Some(cursor.clone());
        member
            .delivered
            .retain(|sequence| *sequence > cursor.sequence);
        let mut effects = Effects::default();
        if Self::baseline_applied(member) {
            for event in &demand.events {
                let event_cursor = Cursor::parse(&event["params"]["cursor"])?;
                if event_cursor.epoch == cursor.epoch
                    && event_cursor.sequence > cursor.sequence
                    && !member.delivered.contains(&event_cursor.sequence)
                {
                    member.delivered.insert(event_cursor.sequence);
                    let mut event = event.clone();
                    event["params"]["subscriptionId"] = member_id.logical_id.clone().into();
                    if let Some(stream) = &demand.virtual_stream {
                        event["params"]["streamId"] = stream.clone().into();
                    }
                    effects.notices.push(Notice::Event {
                        member: member_id.clone(),
                        event,
                    });
                }
            }
        }
        effects.append(Self::schedule_ack(&key, demand));
        Ok(effects)
    }

    pub fn complete(
        &mut self,
        operation: &Operation,
        result: &Value,
    ) -> Result<Effects, &'static str> {
        if !self.operation_current(operation) {
            return Ok(Effects::default());
        }
        let demand = self.demands.get_mut(&operation.key).ok_or("operation")?;
        demand.current = None;
        let mut effects = Effects::default();
        match operation.kind {
            OperationKind::Open => {
                if result["subscriptionId"] != demand.wire {
                    return Err("identity");
                }
                let stream = result["streamId"].as_str().ok_or("identity")?.to_owned();
                demand.virtual_stream.get_or_insert_with(|| stream.clone());
                demand.stream = Some(stream);
                demand.wire_sent = true;
                demand.phase = Phase::Active;
                for (id, member) in &mut demand.members {
                    if member.waiting {
                        member.waiting = false;
                        effects.notices.push(Notice::Opened {
                            member: id.clone(),
                            stream: demand.virtual_stream.clone().unwrap(),
                        });
                    }
                }
                let early = std::mem::take(&mut demand.events);
                demand.bytes = 0;
                for event in early {
                    effects.append(self.event(&event)?);
                }
            }
            OperationKind::Close => {
                // `false` confirms there was already no upstream registration.
                if !result["accepted"].is_boolean() {
                    return Err("close");
                }
                self.wire_keys.remove(&demand.wire);
                if demand.refresh && !demand.members.is_empty() && !demand.tombstoned {
                    demand.refresh = false;
                    demand.wire = uuid::Uuid::new_v4().to_string();
                    self.wire_keys
                        .insert(demand.wire.clone(), operation.key.clone());
                    effects
                        .operations
                        .push(Self::begin_open(&operation.key, demand));
                } else {
                    let ids: Vec<_> = demand.members.keys().cloned().collect();
                    for id in ids {
                        self.members.remove(&id);
                    }
                    self.demands.remove(&operation.key);
                }
            }
            OperationKind::Ack => {
                if result["accepted"] != true {
                    return Err("ack");
                }
                let cursor = Cursor::parse(&operation.params["cursor"])?;
                demand.last_ack = Some(cursor.clone());
                demand.recovery_attempts = 0;
                while demand.events.front().is_some_and(|event| {
                    event["params"]["cursor"]["epoch"] == cursor.epoch
                        && event["params"]["cursor"]["sequence"]
                            .as_u64()
                            .is_some_and(|seq| seq <= cursor.sequence)
                }) {
                    if let Some(event) = demand.events.pop_front() {
                        demand.bytes = demand.bytes.saturating_sub(event.to_string().len());
                    }
                }
                if demand.refresh {
                    Self::begin_close(&operation.key, demand, true, &mut effects);
                } else {
                    effects.append(Self::schedule_ack(&operation.key, demand));
                }
            }
        }
        Ok(effects)
    }

    fn resync(key: &str, demand: &mut Demand) -> Effects {
        let mut effects = Effects::default();
        if demand.phase == Phase::Closing || demand.tombstoned {
            return effects;
        }
        demand.recovery_attempts += 1;
        let cursor = demand.first.clone().unwrap_or(Cursor {
            epoch: "native-resync".into(),
            sequence: 0,
        });
        let event = json!({"jsonrpc":"2.0","method":"subscription.event","params":{"subscriptionId":demand.wire,"streamId":demand.virtual_stream.clone().unwrap_or_else(|| "native-resync".into()),"cursor":cursor.value(),"kind":"resync-required"}});
        for id in demand.members.keys() {
            effects.notices.push(Notice::Event {
                member: id.clone(),
                event: Self::rewrite(demand, id, &event),
            });
        }
        if demand.recovery_attempts > 2 {
            demand.tombstoned = true;
            for id in demand.members.keys() {
                effects
                    .notices
                    .push(Notice::Rejected { member: id.clone() });
            }
            Self::begin_close(key, demand, false, &mut effects);
            demand.refresh = false;
        } else {
            Self::begin_close(key, demand, true, &mut effects);
        }
        effects
    }
    pub fn failed(&mut self, operation: &Operation) -> Effects {
        if !self.operation_current(operation) {
            return Effects::default();
        }
        let demand = self.demands.get_mut(&operation.key).unwrap();
        demand.current = None;
        // A failed close cannot be retried invisibly: fence this target and let
        // the platform surface a blocked connection rather than claim an ACK.
        if operation.kind == OperationKind::Close {
            demand.phase = Phase::Failed;
        }
        Self::resync(&operation.key, demand)
    }
    pub fn event(&mut self, event: &Value) -> Result<Effects, &'static str> {
        let wire = event["params"]["subscriptionId"]
            .as_str()
            .ok_or("identity")?;
        let Some(key) = self.wire_keys.get(wire).cloned() else {
            return Ok(Effects::default());
        };
        let total_bytes: usize = self.demands.values().map(|d| d.bytes).sum();
        let demand = self.demands.get_mut(&key).unwrap();
        if demand
            .stream
            .as_ref()
            .is_some_and(|stream| event["params"]["streamId"] != *stream)
        {
            return Err("identity");
        }
        let mut effects = Effects::default();
        let kind = event["params"]["kind"].as_str().ok_or("event")?;
        if kind == "closed" {
            demand.tombstoned = true;
            for (id, member) in &demand.members {
                if member.waiting {
                    effects
                        .notices
                        .push(Notice::Rejected { member: id.clone() });
                } else {
                    effects.notices.push(Notice::Event {
                        member: id.clone(),
                        event: Self::rewrite(demand, id, event),
                    });
                }
            }
            Self::begin_close(&key, demand, false, &mut effects);
            demand.refresh = false;
            return Ok(effects);
        }
        if demand.phase == Phase::Closing || demand.tombstoned {
            return Ok(effects);
        }
        if kind == "resync-required" {
            return Ok(Self::resync(&key, demand));
        }
        let bytes = event.to_string().len();
        if demand.events.len() >= self.max_events
            || demand.bytes + bytes > self.max_group_bytes
            || total_bytes + bytes > self.max_bytes
        {
            return Ok(Self::resync(&key, demand));
        }
        if demand.phase == Phase::Opening {
            demand.events.push_back(event.clone());
            demand.bytes += bytes;
            return Ok(effects);
        }
        if demand.first.is_none() && kind != "snapshot" {
            return Ok(Self::resync(&key, demand));
        }
        let cursor = Cursor::parse(&event["params"]["cursor"])?;
        if kind == "snapshot"
            && demand
                .first
                .as_ref()
                .is_some_and(|first| first.epoch != cursor.epoch)
        {
            demand.events.clear();
            demand.bytes = 0;
            demand.first = None;
            demand.last_ack = None;
            for member in demand.members.values_mut() {
                member.baseline = None;
                member.delivered.clear();
            }
        }
        let previous = demand
            .events
            .back()
            .map(|event| Cursor::parse(&event["params"]["cursor"]))
            .transpose()?
            .or_else(|| demand.last_ack.clone());
        if let Some(previous) = previous {
            if kind != "snapshot"
                && (cursor.epoch != previous.epoch || cursor.sequence > previous.sequence + 1)
            {
                return Ok(Self::resync(&key, demand));
            }
            if cursor.sequence <= previous.sequence {
                return Ok(effects);
            }
        }
        if demand.first.is_none() {
            demand.first = Some(cursor);
        }
        demand.events.push_back(event.clone());
        demand.bytes += bytes;
        Self::emit_event(demand, event, &mut effects)?;
        Ok(effects)
    }
}

#[cfg(test)]
#[path = "demand_tests.rs"]
mod tests;
