//! Closed, bounded private parent protocol. Provider bytes never enter its parser.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::{self, BufRead, Write};
use std::path::Path;
use uuid::{Uuid, Variant};

pub const VERSION: u8 = 1;
pub const MAX_FRAME_BYTES: usize = 1024 * 1024;
pub const MAX_DATA_BYTES: usize = 64 * 1024;
pub const MAX_COMMAND_ID: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Binding {
    pub guardian_id: String,
    pub parent_id: String,
    pub owner_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ParentCommand {
    Start {
        version: u8,
        #[serde(deserialize_with = "uuid_v4")]
        guardian_id: String,
        #[serde(deserialize_with = "uuid_v4")]
        parent_id: String,
        command: String,
        args: Vec<String>,
        cwd: String,
        env: BTreeMap<String, String>,
    },
    Write {
        version: u8,
        #[serde(deserialize_with = "uuid_v4")]
        guardian_id: String,
        #[serde(deserialize_with = "uuid_v4")]
        parent_id: String,
        #[serde(deserialize_with = "uuid_v4")]
        owner_id: String,
        id: u64,
        data: String,
    },
    Stop {
        version: u8,
        #[serde(deserialize_with = "uuid_v4")]
        guardian_id: String,
        #[serde(deserialize_with = "uuid_v4")]
        parent_id: String,
        #[serde(deserialize_with = "uuid_v4")]
        owner_id: String,
        id: u64,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Refusal {
    Identity,
    Sequence,
    Invalid,
    Stopping,
    Capacity,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Retirement {
    Verified,
    Unknown,
    Unsupported,
    NotStarted,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum StartFailure {
    InvalidStart,
    SpawnFailed,
    Unsupported,
    Io,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Stream {
    Stdout,
    Stderr,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum GuardianReply {
    Ready {
        version: u8,
        guardian_id: String,
        platform: String,
        containment: String,
    },
    Started {
        version: u8,
        guardian_id: String,
        parent_id: String,
        owner_id: String,
        pid: u32,
    },
    Written {
        version: u8,
        guardian_id: String,
        parent_id: String,
        owner_id: String,
        id: u64,
        ok: bool,
    },
    Rejected {
        version: u8,
        guardian_id: String,
        parent_id: String,
        owner_id: String,
        id: u64,
        reason: Refusal,
    },
    Data {
        version: u8,
        guardian_id: String,
        parent_id: String,
        owner_id: String,
        stream: Stream,
        data: String,
    },
    Settled {
        version: u8,
        guardian_id: String,
        parent_id: Option<String>,
        owner_id: Option<String>,
        exit_code: Option<i32>,
        retirement: Retirement,
    },
    Failed {
        version: u8,
        guardian_id: String,
        parent_id: Option<String>,
        reason: StartFailure,
    },
}

pub fn is_uuid_v4(value: &str) -> bool {
    Uuid::parse_str(value).is_ok_and(|id| {
        id.get_version_num() == 4 && id.get_variant() == Variant::RFC4122 && id.to_string() == value
    })
}

fn uuid_v4<'de, D: serde::Deserializer<'de>>(input: D) -> Result<String, D::Error> {
    let value = String::deserialize(input)?;
    if !is_uuid_v4(&value) {
        return Err(serde::de::Error::custom("Invalid construction identity"));
    }
    Ok(value)
}

pub fn valid_start(
    command: &str,
    args: &[String],
    cwd: &str,
    env: &BTreeMap<String, String>,
) -> bool {
    !command.contains('\0')
        && Path::new(command).is_absolute()
        && !cwd.contains('\0')
        && Path::new(cwd).is_absolute()
        && args.iter().all(|arg| !arg.contains('\0'))
        && env.iter().all(|(key, value)| {
            !key.is_empty() && !key.contains(['=', '\0']) && !value.contains('\0')
        })
}

pub fn decode_data(value: &str) -> io::Result<Vec<u8>> {
    if value.len() > MAX_DATA_BYTES.div_ceil(3) * 4 {
        return Err(invalid("Provider data exceeds its limit"));
    }
    let bytes = STANDARD
        .decode(value)
        .map_err(|_| invalid("Invalid provider data"))?;
    if bytes.len() > MAX_DATA_BYTES || STANDARD.encode(&bytes) != value {
        return Err(invalid("Invalid provider data"));
    }
    Ok(bytes)
}

pub fn encode_data(value: &[u8]) -> String {
    STANDARD.encode(value)
}

/// Stop at the bound before copying/allocating an oversized line. Partial EOF is
/// not a complete command, and JSON/UTF-8/duplicate DTO fields remain closed.
pub fn read_frame(input: &mut impl BufRead) -> io::Result<Option<Vec<u8>>> {
    let mut frame = Vec::new();
    loop {
        let available = input.fill_buf()?;
        if available.is_empty() {
            return if frame.is_empty() {
                Ok(None)
            } else {
                Err(invalid("Truncated control frame"))
            };
        }
        let newline = available.iter().position(|byte| *byte == b'\n');
        let take = newline.map_or(available.len(), |position| position + 1);
        if frame
            .len()
            .checked_add(take)
            .is_none_or(|size| size > MAX_FRAME_BYTES)
        {
            return Err(invalid("Control frame exceeds its limit"));
        }
        frame.extend_from_slice(&available[..take]);
        input.consume(take);
        if newline.is_some() {
            frame.pop();
            if frame.is_empty() {
                return Err(invalid("Empty control frame"));
            }
            return Ok(Some(frame));
        }
    }
}

pub fn read_command(input: &mut impl BufRead) -> io::Result<Option<ParentCommand>> {
    read_frame(input)?
        .map(|frame| serde_json::from_slice(&frame).map_err(|_| invalid("Invalid control frame")))
        .transpose()
}

pub fn write_reply(output: &mut impl Write, reply: &GuardianReply) -> io::Result<()> {
    let mut frame = serde_json::to_vec(reply).map_err(|_| invalid("Invalid reply frame"))?;
    if frame.len() >= MAX_FRAME_BYTES {
        return Err(invalid("Reply frame exceeds its limit"));
    }
    frame.push(b'\n');
    output.write_all(&frame)?;
    output.flush()
}

fn invalid(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}
