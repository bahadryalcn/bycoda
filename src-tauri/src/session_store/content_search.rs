//! Full-text search over the message content of every stored session.
//!
//! Transcripts live as one JSON blob per session, so a `LIKE` over the blobs
//! reads every byte of every session on each keystroke. This module keeps a
//! separate index instead:
//!
//! * `session_search_blocks` holds the searchable text of each message block
//!   (what the snippet is cut from), keyed by `session key << 20 | block index`.
//! * `session_search_fts` is a contentless FTS5 table over the *folded* text of
//!   the same rows, with the same rowids, so a match maps straight back to its
//!   block and (`rowid >> 20`) to its session.
//! * `session_search_index` maps a session id to its key and records the
//!   `updated_at` the index was built from.
//!
//! The index is derived data: nothing here ever rewrites `sessions`, and a
//! session whose recorded `updated_at` differs from the live one is simply
//! re-indexed. That is how existing rows are covered after the migration — the
//! migration only creates empty tables (instant), and [`sync_index`] fills them
//! lazily, from a background thread after startup and, bounded by a time budget,
//! ahead of each search. Small transactional revision/dirty rows identify changed
//! sessions; foreground searches never reconstruct the full freshness library.
//!
//! Matching is token-based: every whitespace-separated query term must occur,
//! the last word of each term as a prefix (the FTS table keeps prefix indexes
//! for 2-4 characters, without which a two-letter prefix expands to every token
//! that starts with it and takes tens of seconds). Mid-word substrings are not found
//! (`tication` does not match `authentication`); that is the price of the index.
//!
//! Folding (see [`fold_char`]) is applied to the indexed text, to the query and
//! to the highlighter alike, one `char` to one `char`, so offsets in the folded
//! text are offsets in the original.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{
    begin_session_search, session_search_is_current, SearchProgressGuard, SessionSearchRelease,
    SessionSearchToken, SessionStore, SEARCH_PROGRESS_INTERVAL,
};

/// Block index within a session lives in the low bits of the FTS rowid.
const KEY_SHIFT: u32 = 20;
const MAX_BLOCKS_PER_SESSION: usize = (1 << KEY_SHIFT) - 1;
/// Indexed text per block. Conversation text is rarely near this; tool output is.
const MAX_BLOCK_CHARS: usize = 32 * 1024;
const MAX_TOOL_BLOCK_CHARS: usize = 8 * 1024;
/// Tool output is the bulk of a multi-megabyte transcript. It gets a budget per
/// session so it can never crowd out the conversation text, which is always
/// indexed.
const MAX_TOOL_CHARS_PER_SESSION: usize = 1024 * 1024;
const MAX_RESULT_SESSIONS: usize = 60;
const MAX_HITS_PER_SESSION: usize = 5;
const MAX_RANGES_PER_SNIPPET: usize = 8;
const SNIPPET_RADIUS: usize = 60;
const MAX_QUERY_TERMS: usize = 12;
const MAX_QUERY_CHARS: usize = 200;
/// How long one search may spend indexing sessions that are not indexed yet.
const SEARCH_SYNC_BUDGET: Duration = Duration::from_millis(1500);
const INDEXED_ROLES: [&str; 6] = ["user", "assistant", "tool", "tasks", "plan", "image"];

pub(super) fn ensure_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS session_search_index (
           key INTEGER PRIMARY KEY AUTOINCREMENT,
           session_id TEXT NOT NULL UNIQUE,
           source_updated_at INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS session_search_blocks (
           id INTEGER PRIMARY KEY,
           block_id TEXT NOT NULL,
           role TEXT NOT NULL,
           text TEXT NOT NULL
         );
         CREATE VIRTUAL TABLE IF NOT EXISTS session_search_fts USING fts5(
           folded,
           content = '',
           contentless_delete = 1,
           prefix = '2 3 4',
           tokenize = 'unicode61 remove_diacritics 0'
         );",
    )?;
    if !conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='sessions')",
        [],
        |row| row.get::<_, bool>(0),
    )? {
        return Ok(());
    }
    let columns = conn
        .prepare("PRAGMA table_info(session_search_index)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if !columns.iter().any(|column| column == "source_version") {
        conn.execute_batch(
            "ALTER TABLE session_search_index ADD COLUMN source_version INTEGER NOT NULL DEFAULT 0",
        )?;
    }
    conn.execute_batch(&format!("
      CREATE TABLE IF NOT EXISTS session_search_revision (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL);
      INSERT OR IGNORE INTO session_search_revision VALUES(1,0);
      CREATE TABLE IF NOT EXISTS session_search_source_revision (session_id TEXT PRIMARY KEY, version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS session_search_dirty (session_id TEXT PRIMARY KEY, updated_at INTEGER NOT NULL, version INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS session_search_dirty_newest ON session_search_dirty(updated_at DESC, session_id);
      INSERT OR IGNORE INTO session_search_source_revision SELECT id,0 FROM sessions;
      UPDATE session_search_revision SET version=MAX(version, COALESCE((SELECT MAX(version) FROM session_search_source_revision),0)) WHERE id=1;
      INSERT INTO session_search_dirty SELECT s.id,s.updated_at,r.version FROM sessions s
        JOIN session_search_source_revision r ON r.session_id=s.id LEFT JOIN session_search_index i ON i.session_id=s.id
        WHERE s.has_user_message=1 AND s.inbox_ask IS NULL
          AND (i.session_id IS NULL OR i.source_updated_at!=s.updated_at OR i.source_version!=r.version)
        ON CONFLICT(session_id) DO UPDATE SET updated_at=excluded.updated_at,version=excluded.version;
      DELETE FROM session_search_dirty WHERE session_id NOT IN(SELECT id FROM sessions);
      DELETE FROM session_search_source_revision WHERE session_id NOT IN(SELECT id FROM sessions);
      CREATE TRIGGER IF NOT EXISTS session_search_dirty_insert AFTER INSERT ON sessions BEGIN
        UPDATE session_search_revision SET version=version+1 WHERE id=1;
        INSERT INTO session_search_source_revision VALUES(NEW.id,(SELECT version FROM session_search_revision WHERE id=1))
          ON CONFLICT(session_id) DO UPDATE SET version=excluded.version;
        DELETE FROM session_search_dirty WHERE session_id=NEW.id;
        INSERT INTO session_search_dirty SELECT NEW.id,NEW.updated_at,(SELECT version FROM session_search_revision WHERE id=1)
          WHERE NEW.has_user_message=1 AND NEW.inbox_ask IS NULL;
      END;
      CREATE TRIGGER IF NOT EXISTS session_search_dirty_update AFTER UPDATE OF updated_at,blocks_json,has_user_message,inbox_ask ON sessions
        WHEN OLD.updated_at IS NOT NEW.updated_at OR OLD.blocks_json IS NOT NEW.blocks_json
          OR OLD.has_user_message IS NOT NEW.has_user_message OR OLD.inbox_ask IS NOT NEW.inbox_ask BEGIN
        UPDATE session_search_revision SET version=version+1 WHERE id=1;
        INSERT INTO session_search_source_revision VALUES(NEW.id,(SELECT version FROM session_search_revision WHERE id=1))
          ON CONFLICT(session_id) DO UPDATE SET version=excluded.version;
        DELETE FROM session_search_dirty WHERE session_id=NEW.id;
        INSERT INTO session_search_dirty SELECT NEW.id,NEW.updated_at,(SELECT version FROM session_search_revision WHERE id=1)
          WHERE NEW.has_user_message=1 AND NEW.inbox_ask IS NULL;
        DELETE FROM session_search_fts WHERE rowid BETWEEN
          (SELECT key << {KEY_SHIFT} FROM session_search_index WHERE session_id=NEW.id)
          AND (SELECT (key << {KEY_SHIFT}) | ((1 << {KEY_SHIFT})-1) FROM session_search_index WHERE session_id=NEW.id)
          AND (NEW.has_user_message!=1 OR NEW.inbox_ask IS NOT NULL);
        DELETE FROM session_search_blocks WHERE id BETWEEN
          (SELECT key << {KEY_SHIFT} FROM session_search_index WHERE session_id=NEW.id)
          AND (SELECT (key << {KEY_SHIFT}) | ((1 << {KEY_SHIFT})-1) FROM session_search_index WHERE session_id=NEW.id)
          AND (NEW.has_user_message!=1 OR NEW.inbox_ask IS NOT NULL);
        DELETE FROM session_search_index WHERE session_id=NEW.id AND (NEW.has_user_message!=1 OR NEW.inbox_ask IS NOT NULL);
      END;
      CREATE TRIGGER IF NOT EXISTS session_search_dirty_delete AFTER DELETE ON sessions BEGIN
        DELETE FROM session_search_fts WHERE rowid BETWEEN
          (SELECT key << {KEY_SHIFT} FROM session_search_index WHERE session_id=OLD.id)
          AND (SELECT (key << {KEY_SHIFT}) | ((1 << {KEY_SHIFT})-1) FROM session_search_index WHERE session_id=OLD.id);
        DELETE FROM session_search_blocks WHERE id BETWEEN
          (SELECT key << {KEY_SHIFT} FROM session_search_index WHERE session_id=OLD.id)
          AND (SELECT (key << {KEY_SHIFT}) | ((1 << {KEY_SHIFT})-1) FROM session_search_index WHERE session_id=OLD.id);
        DELETE FROM session_search_index WHERE session_id=OLD.id;
        DELETE FROM session_search_source_revision WHERE session_id=OLD.id;
        DELETE FROM session_search_dirty WHERE session_id=OLD.id;
      END;"))?;
    // Repair a legacy build's orphan rows once at open, not on every query.
    prune_orphans(conn)
}

// --- folding and tokenising -------------------------------------------------

/// Case- and Turkish-insensitive fold, one `char` in, one `char` out.
///
/// `I`, `İ`, `ı` all become `i`, so `ISPARTA`, `İsparta` and `ısparta` find each
/// other (Rust's and SQLite's own lowercasing maps `I` to `i` but leaves `ı`,
/// and turns `İ` into two chars). The Turkish letters `ç ğ ö ş ü` and the
/// circumflexed `â î û` lose their marks, so a query typed on a non-Turkish
/// keyboard still matches. The cost: `sık` and `sik` are the same word here.
/// Other scripts and accents are only case-folded.
pub(super) fn fold_char(c: char) -> char {
    match c {
        'İ' | 'I' | 'ı' | 'î' | 'Î' => 'i',
        'ç' | 'Ç' => 'c',
        'ğ' | 'Ğ' => 'g',
        'ö' | 'Ö' => 'o',
        'ş' | 'Ş' => 's',
        'ü' | 'Ü' | 'û' | 'Û' => 'u',
        'â' | 'Â' => 'a',
        _ => c.to_lowercase().next().unwrap_or(c),
    }
}

pub(super) fn fold_text(text: &str) -> String {
    text.chars().map(fold_char).collect()
}

fn tokenize(folded: &str) -> Vec<String> {
    folded
        .split(|c: char| !c.is_alphanumeric())
        .filter(|token| !token.is_empty())
        .map(str::to_owned)
        .collect()
}

/// A query is a list of terms (whitespace-separated); a term is the tokens of
/// one word (`session_store.rs` is the three tokens `session store rs`).
type Terms = Vec<Vec<String>>;

fn parse_query(query: &str) -> Terms {
    let query: String = query.chars().take(MAX_QUERY_CHARS).collect();
    query
        .split_whitespace()
        .take(MAX_QUERY_TERMS)
        .map(|word| tokenize(&fold_text(word)))
        .filter(|tokens| !tokens.is_empty())
        .collect()
}

/// `"a b" * AND "c" *`: each term a phrase whose last token is a prefix.
/// Tokens are alphanumeric only, so nothing needs escaping inside the quotes.
fn fts_query(terms: &Terms) -> String {
    terms
        .iter()
        .map(|tokens| format!("\"{}\" *", tokens.join(" ")))
        .collect::<Vec<_>>()
        .join(" AND ")
}

/// Char ranges of the maximal alphanumeric runs in `folded`.
fn token_spans(folded: &[char]) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    let mut start = None;
    for (index, c) in folded.iter().enumerate() {
        match (c.is_alphanumeric(), start) {
            (true, None) => start = Some(index),
            (false, Some(from)) => {
                spans.push((from, index));
                start = None;
            }
            _ => {}
        }
    }
    if let Some(from) = start {
        spans.push((from, folded.len()));
    }
    spans
}

/// Char ranges of the tokens in `folded` that match a query token: exactly, or
/// as a prefix for the last token of each term.
fn matched_ranges(folded: &[char], terms: &Terms) -> Vec<(usize, usize)> {
    let mut needles: Vec<(Vec<char>, bool)> = Vec::new();
    for tokens in terms {
        for (index, token) in tokens.iter().enumerate() {
            needles.push((token.chars().collect(), index + 1 == tokens.len()));
        }
    }
    let mut ranges = Vec::new();
    for (start, end) in token_spans(folded) {
        let token = &folded[start..end];
        let hit = needles.iter().find(|(needle, prefix)| {
            token.len() >= needle.len()
                && token[..needle.len()] == needle[..]
                && (*prefix || token.len() == needle.len())
        });
        if let Some((needle, _)) = hit {
            ranges.push((start, start + needle.len()));
        }
    }
    ranges
}

fn compact_chars(text: &str) -> Vec<char> {
    let mut out: Vec<char> = Vec::new();
    for c in text.chars() {
        if c.is_whitespace() {
            if out.last().is_some_and(|last| *last != ' ') {
                out.push(' ');
            }
        } else {
            out.push(c);
        }
    }
    if out.last() == Some(&' ') {
        out.pop();
    }
    out
}

fn utf16_len(chars: &[char]) -> u32 {
    chars.iter().map(|c| c.len_utf16() as u32).sum()
}

/// Converts char ranges inside `chars[window]` to UTF-16 offsets relative to
/// `prefix_units` (the units that precede the window in the output string).
fn utf16_ranges(
    chars: &[char],
    window: (usize, usize),
    ranges: &[(usize, usize)],
    prefix_units: u32,
) -> Vec<[u32; 2]> {
    ranges
        .iter()
        .filter(|(start, end)| *start >= window.0 && *end <= window.1)
        .take(MAX_RANGES_PER_SNIPPET)
        .map(|(start, end)| {
            let before = prefix_units + utf16_len(&chars[window.0..*start]);
            [before, before + utf16_len(&chars[*start..*end])]
        })
        .collect()
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Snippet {
    pub text: String,
    /// UTF-16 `[start, end)` offsets into `text`, ready for `String.slice`.
    pub ranges: Vec<[u32; 2]>,
}

fn make_snippet(text: &str, terms: &Terms) -> Snippet {
    let chars = compact_chars(text);
    let folded: Vec<char> = chars.iter().map(|c| fold_char(*c)).collect();
    let ranges = matched_ranges(&folded, terms);
    let (start, end) = match ranges.first() {
        Some((from, to)) => (
            from.saturating_sub(SNIPPET_RADIUS),
            (to + SNIPPET_RADIUS).min(chars.len()),
        ),
        None => (0, (SNIPPET_RADIUS * 2).min(chars.len())),
    };
    let lead = start > 0;
    let mut out = String::new();
    if lead {
        out.push('…');
    }
    out.extend(&chars[start..end]);
    if end < chars.len() {
        out.push('…');
    }
    Snippet {
        text: out,
        ranges: utf16_ranges(&chars, (start, end), &ranges, u32::from(lead)),
    }
}

/// The title's highlight ranges when every query token occurs in it.
fn title_match(title: &str, terms: &Terms) -> Option<Vec<[u32; 2]>> {
    let chars: Vec<char> = title.chars().collect();
    let folded: Vec<char> = chars.iter().map(|c| fold_char(*c)).collect();
    let spans: Vec<String> = token_spans(&folded)
        .into_iter()
        .map(|(start, end)| folded[start..end].iter().collect())
        .collect();
    for tokens in terms {
        for (index, token) in tokens.iter().enumerate() {
            let prefix = index + 1 == tokens.len();
            let found = spans.iter().any(|span| {
                if prefix {
                    span.starts_with(token.as_str())
                } else {
                    span == token
                }
            });
            if !found {
                return None;
            }
        }
    }
    let ranges = matched_ranges(&folded, terms);
    Some(utf16_ranges(&chars, (0, chars.len()), &ranges, 0))
}

// --- indexing ---------------------------------------------------------------

struct IndexedBlock {
    block_id: String,
    role: String,
    text: String,
}

#[cfg(test)]
fn extract_blocks(blocks: &Value) -> Vec<IndexedBlock> {
    let Some(items) = blocks.as_array() else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let mut tool_chars = 0usize;
    for block in items {
        if out.len() >= MAX_BLOCKS_PER_SESSION {
            break;
        }
        if let Some(value) = extract_block(block, &mut tool_chars) {
            out.push(value);
        }
    }
    out
}

fn extract_block(block: &Value, tool_chars: &mut usize) -> Option<IndexedBlock> {
    let role = block
        .get("role")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let id = block.get("id").and_then(Value::as_str).unwrap_or_default();
    if id.is_empty()
        || !INDEXED_ROLES.contains(&role)
        || (role == "tool" && *tool_chars >= MAX_TOOL_CHARS_PER_SESSION)
    {
        return None;
    }
    let max = if role == "tool" {
        MAX_TOOL_BLOCK_CHARS
    } else {
        MAX_BLOCK_CHARS
    };
    let mut text = String::new();
    let mut count = 0;
    for path in [
        "/text",
        "/image/name",
        "/image/alt",
        "/tool/title",
        "/tool/detail",
        "/tool/preview/query",
        "/tool/preview/path",
        "/tool/preview/output",
        "/tool/preview/title",
    ] {
        let Some(part) = block
            .pointer(path)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|part| !part.is_empty())
        else {
            continue;
        };
        if !text.is_empty() && count < max {
            text.push('\n');
            count += 1;
        }
        for ch in part.chars().take(max.saturating_sub(count)) {
            text.push(ch);
            count += 1;
        }
        if count >= max {
            break;
        }
    }
    if text.is_empty() {
        return None;
    }
    if role == "tool" {
        *tool_chars += count;
    }
    Some(IndexedBlock {
        block_id: id.into(),
        role: role.into(),
        text,
    })
}

fn may_continue(deadline: Option<Instant>, keep_going: &dyn Fn() -> bool) -> bool {
    !deadline.is_some_and(|limit| Instant::now() >= limit) && keep_going()
}

fn key_range(key: i64) -> (i64, i64) {
    (
        key << KEY_SHIFT,
        (key << KEY_SHIFT) | ((1 << KEY_SHIFT) - 1),
    )
}

fn clear_rows(conn: &Connection, key: i64) -> rusqlite::Result<()> {
    let (low, high) = key_range(key);
    conn.execute(
        "DELETE FROM session_search_fts WHERE rowid BETWEEN ?1 AND ?2",
        params![low, high],
    )?;
    conn.execute(
        "DELETE FROM session_search_blocks WHERE id BETWEEN ?1 AND ?2",
        params![low, high],
    )?;
    Ok(())
}

/// Drops a deleted session's index rows. Call inside the deleting transaction.
pub(super) fn forget_session(conn: &Connection, session_id: &str) -> rusqlite::Result<()> {
    let key: Option<i64> = conn
        .query_row(
            "SELECT key FROM session_search_index WHERE session_id = ?1",
            params![session_id],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(key) = key {
        clear_rows(conn, key)?;
        conn.execute(
            "DELETE FROM session_search_index WHERE key = ?1",
            params![key],
        )?;
    }
    Ok(())
}

/// Replaces a session's index rows, unless the session changed since the blocks
/// were read (then the next sync picks it up again). Returns whether it wrote.
fn write_index(
    conn: &Connection,
    session_id: &str,
    updated_at: i64,
    version: i64,
    blocks: &[IndexedBlock],
    deadline: Option<Instant>,
    keep_going: &dyn Fn() -> bool,
) -> rusqlite::Result<bool> {
    if !may_continue(deadline, keep_going) {
        return Ok(false);
    }
    let tx = conn.unchecked_transaction()?;
    let current: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM sessions s JOIN session_search_source_revision r ON r.session_id=s.id
          WHERE s.id=?1 AND s.updated_at=?2 AND r.version=?3 AND s.has_user_message=1 AND s.inbox_ask IS NULL)",
        params![session_id, updated_at, version],
        |row| row.get(0),
    )?;
    if !current {
        return Ok(false);
    }
    let key: Option<i64> = tx
        .query_row(
            "SELECT key FROM session_search_index WHERE session_id = ?1",
            params![session_id],
            |row| row.get(0),
        )
        .optional()?;
    let key = match key {
        Some(key) => {
            tx.execute(
                "UPDATE session_search_index SET source_updated_at=?2,source_version=?3 WHERE key=?1",
                params![key, updated_at, version],
            )?;
            key
        }
        None => {
            tx.execute(
                "INSERT INTO session_search_index (session_id, source_updated_at, source_version)
                 VALUES (?1, ?2, ?3)",
                params![session_id, updated_at, version],
            )?;
            tx.last_insert_rowid()
        }
    };
    {
        // Rows are keyed by block position, so an append or a grown last block
        // leaves every earlier row identical; only rows whose stored text
        // differs are rewritten, which is also what makes edits, removals and
        // reorders land exactly as a full rebuild would.
        let (low, high) = key_range(key);
        let mut statement = tx.prepare(
            "SELECT id, block_id, role, text FROM session_search_blocks
                 WHERE id BETWEEN ?1 AND ?2",
        )?;
        let rows = statement.query_map(params![low, high], |row| {
            Ok((row.get(0)?, (row.get(1)?, row.get(2)?, row.get(3)?)))
        })?;
        let mut existing: HashMap<i64, (String, String, String)> = HashMap::new();
        for row in rows {
            if !may_continue(deadline, keep_going) {
                return Ok(false);
            }
            let (id, value) = row?;
            existing.insert(id, value);
        }
        let mut delete_block = tx.prepare("DELETE FROM session_search_blocks WHERE id = ?1")?;
        let mut delete_fts = tx.prepare("DELETE FROM session_search_fts WHERE rowid = ?1")?;
        let mut insert_block = tx.prepare(
            "INSERT INTO session_search_blocks (id, block_id, role, text)
             VALUES (?1, ?2, ?3, ?4)",
        )?;
        let mut insert_fts =
            tx.prepare("INSERT INTO session_search_fts (rowid, folded) VALUES (?1, ?2)")?;
        for (offset, block) in blocks.iter().enumerate() {
            if !may_continue(deadline, keep_going) {
                return Ok(false);
            }
            let id = low + offset as i64;
            if let Some((block_id, role, text)) = existing.get(&id) {
                if *block_id == block.block_id && *role == block.role && *text == block.text {
                    continue;
                }
                delete_block.execute(params![id])?;
                delete_fts.execute(params![id])?;
            }
            insert_block.execute(params![id, block.block_id, block.role, block.text])?;
            insert_fts.execute(params![id, fold_text(&block.text)])?;
        }
        for id in existing
            .keys()
            .filter(|id| **id >= low + blocks.len() as i64)
        {
            if !may_continue(deadline, keep_going) {
                return Ok(false);
            }
            delete_block.execute(params![id])?;
            delete_fts.execute(params![id])?;
        }
    }
    tx.execute(
        "DELETE FROM session_search_dirty WHERE session_id=?1 AND version=?2",
        params![session_id, version],
    )?;
    tx.commit()?;
    Ok(true)
}

fn es(error: rusqlite::Error) -> String {
    error.to_string()
}

/// Sessions the index does not cover (or covers at an older `updated_at`),
/// newest first. Reads only the covering index, never a transcript.
fn stale_sessions(conn: &Connection) -> rusqlite::Result<Vec<(String, i64, i64)>> {
    conn.prepare("SELECT session_id,updated_at,version FROM session_search_dirty ORDER BY updated_at DESC,session_id LIMIT 64")?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
        .collect()
}

fn pending_count(conn: &Connection) -> rusqlite::Result<usize> {
    conn.query_row("SELECT COUNT(*) FROM session_search_dirty", [], |row| {
        row.get::<_, i64>(0).map(|value| value as usize)
    })
}

fn with_index_reader<T>(
    store: &SessionStore,
    read: impl FnOnce(&Connection) -> Result<T, String>,
) -> Result<T, String> {
    let reader = store
        .read_conn
        .lock()
        .map_err(|_| "Session search reader is locked")?;
    if let Some(reader) = reader.as_ref() {
        read(reader)
    } else {
        let conn = store.lock_conn()?;
        read(&conn)
    }
}

fn prune_orphans(conn: &Connection) -> rusqlite::Result<()> {
    let orphans: Vec<String> = conn
        .prepare(
            "SELECT session_id FROM session_search_index
             WHERE session_id NOT IN (SELECT id FROM sessions)",
        )?
        .query_map([], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    for id in orphans {
        let tx = conn.unchecked_transaction()?;
        forget_session(&tx, &id)?;
        tx.commit()?;
    }
    Ok(())
}

/// Indexes one session. The store lock is held only to read the blob and to
/// write the rows, not while the JSON is parsed.
fn index_session(
    store: &SessionStore,
    id: &str,
    updated_at: i64,
    version: i64,
    deadline: Option<Instant>,
    keep_going: &dyn Fn() -> bool,
) -> Result<bool, String> {
    let length: Option<i64> = with_index_reader(store, |conn| {
        conn.query_row(
        "SELECT COALESCE(st.length,-1) FROM sessions s JOIN session_search_source_revision r ON r.session_id=s.id
          LEFT JOIN session_block_state st ON st.session_id=s.id WHERE s.id=?1 AND s.updated_at=?2 AND r.version=?3",
        params![id,updated_at,version], |row| row.get(0),
    ).optional().map_err(es)
    })?;
    let Some(length) = length else {
        return Ok(false);
    };
    let mut blocks = Vec::new();
    let mut tool_chars = 0;
    if length >= 0 {
        let mut cursor = 0i64;
        while cursor < length && blocks.len() < MAX_BLOCKS_PER_SESSION {
            if !may_continue(deadline, keep_going) {
                return Ok(false);
            }
            let batch = with_index_reader(store, |conn| {
                let current: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM session_search_source_revision WHERE session_id=?1 AND version=?2)", params![id,version], |row| row.get(0)).map_err(es)?;
                if !current {
                    return Ok(None);
                }
                let mut statement = conn.prepare("SELECT ordinal,block_json FROM session_blocks WHERE session_id=?1 AND ordinal>=?2 ORDER BY ordinal LIMIT 64").map_err(es)?;
                let mut rows = statement.query(params![id, cursor]).map_err(es)?;
                let mut out: Vec<(i64, String)> = Vec::new();
                let mut bytes = 0;
                while let Some(row) = rows.next().map_err(es)? {
                    let raw: String = row.get(1).map_err(es)?;
                    if !out.is_empty() && bytes + raw.len() > 2 * 1024 * 1024 {
                        break;
                    }
                    bytes += raw.len();
                    out.push((row.get(0).map_err(es)?, raw));
                }
                Ok(Some(out))
            })?;
            let Some(batch) = batch else {
                return Ok(false);
            };
            if batch.is_empty() {
                break;
            }
            for (ordinal, raw) in batch {
                if !may_continue(deadline, keep_going) {
                    return Ok(false);
                }
                cursor = ordinal + 1;
                match serde_json::from_str::<Value>(&raw) {
                    Ok(value) => {
                        if let Some(block) = extract_block(&value, &mut tool_chars) {
                            blocks.push(block);
                        }
                    }
                    Err(_) => {
                        blocks.clear();
                        cursor = length;
                        break;
                    }
                }
                if blocks.len() >= MAX_BLOCKS_PER_SESSION {
                    break;
                }
            }
        }
    } else {
        let raw: Option<String> = with_index_reader(store, |conn| {
            conn.query_row(
            "SELECT s.blocks_json FROM sessions s JOIN session_search_source_revision r ON r.session_id=s.id WHERE s.id=?1 AND r.version=?2",
            params![id,version], |row| row.get(0),
        ).optional().map_err(es)
        })?;
        let Some(raw) = raw else {
            return Ok(false);
        };
        let offsets = match super::incremental::legacy_offsets(&raw, &|| {
            may_continue(deadline, keep_going)
        }) {
            Ok(Some(offsets)) => offsets,
            Ok(None) => return Ok(false),
            Err(_) => Vec::new(), // Legacy malformed blobs stay untouched and index as empty.
        };
        for (start, end) in offsets {
            if !may_continue(deadline, keep_going) {
                return Ok(false);
            }
            let block: Value =
                serde_json::from_str(&raw[start..end]).map_err(|error| error.to_string())?;
            if let Some(block) = extract_block(&block, &mut tool_chars) {
                blocks.push(block);
            }
            if blocks.len() >= MAX_BLOCKS_PER_SESSION {
                break;
            }
        }
    }
    if !may_continue(deadline, keep_going) {
        return Ok(false);
    }
    let conn = store.lock_conn()?;
    write_index(
        &conn, id, updated_at, version, &blocks, deadline, keep_going,
    )
    .map_err(es)
}

/// Brings the index up to date, newest sessions first, until `deadline` passes
/// or `keep_going` says stop. Returns how many sessions are still unindexed.
pub(super) fn sync_index(
    store: &SessionStore,
    deadline: Option<Instant>,
    keep_going: &dyn Fn() -> bool,
) -> Result<usize, String> {
    while may_continue(deadline, keep_going) {
        let stale = with_index_reader(store, |conn| stale_sessions(conn).map_err(es))?;
        if stale.is_empty() {
            break;
        }
        let mut progressed = false;
        for (id, updated_at, version) in stale {
            if !may_continue(deadline, keep_going) {
                break;
            }
            if index_session(store, &id, updated_at, version, deadline, keep_going)? {
                progressed = true;
            } else if !may_continue(deadline, keep_going) {
                break;
            }
        }
        if !progressed {
            break;
        }
    }
    with_index_reader(store, |conn| pending_count(conn).map_err(es))
}

/// Startup pass: index everything, in the background, off the UI path.
pub(super) fn index_in_background(store: &SessionStore) {
    let Ok(_guard) = store.search_index_lock.lock() else {
        return;
    };
    if let Err(error) = sync_index(
        store,
        Some(Instant::now() + Duration::from_secs(30)),
        &|| true,
    ) {
        eprintln!("session search index: {error}");
    }
}

// --- searching --------------------------------------------------------------

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ContentSearchOptions {
    pub query: String,
    /// Project folders to search in; empty means every project.
    #[serde(default)]
    pub cwds: Vec<String>,
    #[serde(default)]
    pub harness: Option<String>,
    #[serde(default)]
    pub include_archived: bool,
    /// Inclusive `updated_at` bounds, in milliseconds.
    #[serde(default)]
    pub since: Option<i64>,
    #[serde(default)]
    pub until: Option<i64>,
    #[serde(default)]
    pub search_owner: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContentSearchHit {
    pub block_id: String,
    pub role: String,
    pub snippet: String,
    pub ranges: Vec<[u32; 2]>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContentSearchSession {
    pub session_id: String,
    pub cwd: String,
    pub harness: String,
    pub title: String,
    pub title_ranges: Vec<[u32; 2]>,
    pub created_at: i64,
    pub updated_at: i64,
    pub archived: bool,
    /// Blocks that matched, of which `hits` carries the first few.
    pub hit_count: i64,
    pub hits: Vec<ContentSearchHit>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ContentSearchResult {
    pub sessions: Vec<ContentSearchSession>,
    /// More sessions matched than are listed.
    pub truncated: bool,
    /// Sessions not indexed yet (their titles are searched, their text is not).
    pub pending: usize,
}

/// Path identity as the frontend's `pathKey`: slashes, no trailing slash, and
/// case-insensitive for Windows drive and UNC paths.
fn path_key(path: &str) -> String {
    let slashed = path.replace('\\', "/");
    let trimmed = slashed.trim_end_matches('/');
    let trimmed = if trimmed.is_empty() { "/" } else { trimmed };
    let bytes = trimmed.as_bytes();
    let windows = (bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':')
        || trimmed.starts_with("//");
    if windows {
        trimmed.to_lowercase()
    } else {
        trimmed.to_owned()
    }
}

struct SessionMeta {
    key: Option<i64>,
    id: String,
    cwd: String,
    harness: String,
    title: String,
    created_at: i64,
    updated_at: i64,
    archived: bool,
}

pub(super) fn search_content(
    store: &SessionStore,
    options: &ContentSearchOptions,
) -> Result<ContentSearchResult, String> {
    let terms = parse_query(&options.query);
    if terms.is_empty() {
        return Ok(ContentSearchResult::default());
    }
    let token = begin_session_search(&options.search_owner);
    let _release = SessionSearchRelease(token.clone());

    // Index what is missing, within a budget, unless a background pass is
    // already at it.
    let pending = match store.search_index_lock.try_lock() {
        Ok(_guard) => {
            let deadline = Instant::now() + SEARCH_SYNC_BUDGET;
            sync_index(store, Some(deadline), &|| {
                session_search_is_current(token.as_ref())
            })?
        }
        Err(_) => with_index_reader(store, |conn| pending_count(conn).map_err(es))?,
    };
    if !session_search_is_current(token.as_ref()) {
        return Ok(ContentSearchResult::default());
    }

    let read_conn = store
        .read_conn
        .lock()
        .map_err(|_| "Session read store is locked")?;
    let result = if let Some(conn) = read_conn.as_ref() {
        run_search(conn, options, &terms, token.as_ref())
    } else {
        let conn = store.lock_conn()?;
        run_search(&conn, options, &terms, token.as_ref())
    };
    match result {
        Ok(Some(mut result)) => {
            result.pending = pending;
            Ok(result)
        }
        // Superseded or cancelled: the caller discards it anyway.
        Ok(None) => Ok(ContentSearchResult::default()),
        Err(_) if !session_search_is_current(token.as_ref()) => Ok(ContentSearchResult::default()),
        Err(error) => Err(error),
    }
}

fn run_search(
    conn: &Connection,
    options: &ContentSearchOptions,
    terms: &Terms,
    token: Option<&SessionSearchToken>,
) -> Result<Option<ContentSearchResult>, String> {
    let progress_token = token.cloned();
    conn.progress_handler(
        SEARCH_PROGRESS_INTERVAL as i32,
        Some(move || !session_search_is_current(progress_token.as_ref())),
    )
    .map_err(es)?;
    let _progress_guard = SearchProgressGuard(conn);

    let scope: Vec<String> = options.cwds.iter().map(|cwd| path_key(cwd)).collect();
    let harness = options
        .harness
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let metas: Vec<SessionMeta> = conn
        .prepare(
            "SELECT i.key, s.id, s.cwd, s.harness, s.title, s.created_at, s.updated_at, s.archived
             FROM sessions AS s INDEXED BY sessions_cwd_cover_idx
             LEFT JOIN session_search_index AS i ON i.session_id = s.id
             WHERE s.has_user_message = 1
               AND s.id NOT IN (SELECT id FROM sessions WHERE inbox_ask IS NOT NULL)",
        )
        .map_err(es)?
        .query_map([], |row| {
            Ok(SessionMeta {
                key: row.get(0)?,
                id: row.get(1)?,
                cwd: row.get(2)?,
                harness: row.get(3)?,
                title: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                archived: row.get::<_, i64>(7)? != 0,
            })
        })
        .map_err(es)?
        .collect::<rusqlite::Result<_>>()
        .map_err(es)?;
    let metas: Vec<SessionMeta> = metas
        .into_iter()
        .filter(|meta| {
            (options.include_archived || !meta.archived)
                && harness.is_none_or(|wanted| meta.harness == wanted)
                && options.since.is_none_or(|since| meta.updated_at >= since)
                && options.until.is_none_or(|until| meta.updated_at <= until)
                && (scope.is_empty() || scope.contains(&path_key(&meta.cwd)))
        })
        .collect();

    let fts = fts_query(terms);
    let counts: HashMap<i64, i64> = conn
        .prepare(&format!(
            "SELECT rowid >> {KEY_SHIFT}, COUNT(*) FROM session_search_fts
             WHERE session_search_fts MATCH ?1 GROUP BY rowid >> {KEY_SHIFT}"
        ))
        .map_err(es)?
        .query_map(params![fts], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(es)?
        .collect::<rusqlite::Result<_>>()
        .map_err(es)?;
    if !session_search_is_current(token) {
        return Ok(None);
    }

    let mut found: Vec<(SessionMeta, i64, Vec<[u32; 2]>)> = metas
        .into_iter()
        .filter_map(|meta| {
            let count = meta
                .key
                .and_then(|key| counts.get(&key))
                .copied()
                .unwrap_or(0);
            let title = title_match(&meta.title, terms);
            if count == 0 && title.is_none() {
                return None;
            }
            Some((meta, count, title.unwrap_or_default()))
        })
        .collect();
    found.sort_by(|a, b| {
        b.0.updated_at
            .cmp(&a.0.updated_at)
            .then_with(|| a.0.id.cmp(&b.0.id))
    });
    let truncated = found.len() > MAX_RESULT_SESSIONS;
    found.truncate(MAX_RESULT_SESSIONS);

    let mut hits_statement = conn
        .prepare(
            "SELECT b.id, b.block_id, b.role, b.text
             FROM session_search_fts
             JOIN session_search_blocks AS b ON b.id = session_search_fts.rowid
             WHERE session_search_fts MATCH ?1
               AND session_search_fts.rowid BETWEEN ?2 AND ?3
             ORDER BY session_search_fts.rowid LIMIT ?4",
        )
        .map_err(es)?;
    let mut sessions = Vec::with_capacity(found.len());
    for (meta, count, title_ranges) in found {
        if !session_search_is_current(token) {
            return Ok(None);
        }
        let mut hits = Vec::new();
        if let (Some(key), true) = (meta.key, count > 0) {
            let (low, high) = key_range(key);
            let rows: Vec<(i64, String, String, String)> = hits_statement
                .query_map(
                    params![fts, low, high, MAX_HITS_PER_SESSION as i64],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .map_err(es)?
                .collect::<rusqlite::Result<_>>()
                .map_err(es)?;
            hits = rows
                .into_iter()
                .map(|(_, block_id, role, text)| {
                    let snippet = make_snippet(&text, terms);
                    ContentSearchHit {
                        block_id,
                        role,
                        snippet: snippet.text,
                        ranges: snippet.ranges,
                    }
                })
                .collect();
        }
        sessions.push(ContentSearchSession {
            session_id: meta.id,
            cwd: meta.cwd,
            harness: meta.harness,
            title: meta.title,
            title_ranges,
            created_at: meta.created_at,
            updated_at: meta.updated_at,
            archived: meta.archived,
            hit_count: count,
            hits,
        });
    }
    Ok(Some(ContentSearchResult {
        sessions,
        truncated,
        pending: 0,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn insert_session(conn: &Connection, id: &str, cwd: &str, title: &str, blocks: &Value) {
        insert_session_at(conn, id, cwd, title, blocks, 1_000);
    }

    fn insert_session_at(
        conn: &Connection,
        id: &str,
        cwd: &str,
        title: &str,
        blocks: &Value,
        updated_at: i64,
    ) {
        conn.execute(
            "INSERT OR REPLACE INTO sessions
               (id, cwd, harness, model, runtime_mode, title, blocks_json,
                created_at, updated_at, has_user_message)
             VALUES (?1, ?2, 'claude', 'm', 'supervised', ?3, ?4, 1, ?5, 1)",
            params![id, cwd, title, blocks.to_string(), updated_at],
        )
        .unwrap();
    }

    fn message(id: &str, role: &str, text: &str) -> Value {
        json!({ "id": id, "role": role, "text": text })
    }

    fn options(query: &str) -> ContentSearchOptions {
        ContentSearchOptions {
            query: query.into(),
            ..Default::default()
        }
    }

    fn search(store: &SessionStore, query: &str) -> ContentSearchResult {
        search_content(store, &options(query)).unwrap()
    }

    #[test]
    fn bundled_sqlite_has_fts5_with_contentless_delete() {
        let conn = Connection::open_in_memory().unwrap();
        let version: String = conn
            .query_row("SELECT sqlite_version()", [], |row| row.get(0))
            .unwrap();
        ensure_schema(&conn).unwrap_or_else(|e| panic!("sqlite {version} lacks FTS5: {e}"));
    }

    #[test]
    fn dirty_queue_does_not_enumerate_fresh_history_and_tracks_same_timestamp_changes() {
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        };
        let store = SessionStore::open_in_memory().unwrap();
        {
            let conn = store.lock_conn().unwrap();
            let tx = conn.unchecked_transaction().unwrap();
            for index in 0..10_000 {
                insert_session_at(&tx, &format!("s{index}"), "/w", "T", &json!([]), 1000);
            }
            tx.execute_batch("INSERT INTO session_search_index(session_id,source_updated_at,source_version)
              SELECT s.id,s.updated_at,r.version FROM sessions s JOIN session_search_source_revision r ON r.session_id=s.id;
              DELETE FROM session_search_dirty;").unwrap();
            tx.commit().unwrap();
            let steps = Arc::new(AtomicUsize::new(0));
            let count = steps.clone();
            conn.progress_handler(
                100,
                Some(move || {
                    count.fetch_add(1, Ordering::Relaxed);
                    false
                }),
            )
            .unwrap();
            let control: Vec<String> = conn
                .prepare("SELECT session_id FROM session_search_index")
                .unwrap()
                .query_map([], |row| row.get(0))
                .unwrap()
                .collect::<rusqlite::Result<_>>()
                .unwrap();
            assert_eq!(control.len(), 10_000);
            let before = steps.swap(0, Ordering::Relaxed);
            assert_eq!(pending_count(&conn).unwrap(), 0);
            assert!(stale_sessions(&conn).unwrap().is_empty());
            let after = steps.load(Ordering::Relaxed);
            conn.progress_handler(0, None::<fn() -> bool>).unwrap();
            println!("native fresh-index 10k metadata rows: control progress ticks {before}; dirty queue {after}");
            assert!(before > after);
            insert_session_at(
                &conn,
                "changed",
                "/w",
                "T",
                &json!([message("m", "user", "alpha")]),
                1000,
            );
        }
        assert_eq!(sync_index(&store, None, &|| true).unwrap(), 0);
        assert_eq!(search(&store, "alpha").sessions.len(), 1);
        {
            let conn = store.lock_conn().unwrap();
            conn.execute(
                "UPDATE sessions SET blocks_json=?2 WHERE id=?1",
                params!["changed", json!([message("m", "user", "beta")]).to_string()],
            )
            .unwrap();
        }
        assert_eq!(search(&store, "beta").sessions.len(), 1);
        assert!(search(&store, "alpha").sessions.is_empty());
    }

    #[test]
    fn a_changing_session_does_not_starve_independent_indexing_work() {
        let store = SessionStore::open_in_memory().unwrap();
        {
            let conn = store.lock_conn().unwrap();
            insert_session_at(
                &conn,
                "stable",
                "/w",
                "Stable",
                &json!([message("stable-block", "user", "stableword")]),
                1000,
            );
            insert_session_at(
                &conn,
                "hot",
                "/w",
                "Hot",
                &json!([message("hot-block", "user", "hotword")]),
                2000,
            );
        }
        // Model a source that changes during catch-up. A failed version pin is
        // not global cancellation: another session must still make progress.
        let keep = || {
            if let Ok(conn) = store.conn.try_lock() {
                conn.execute(
                    "UPDATE sessions SET updated_at=updated_at+1 WHERE id='hot'",
                    [],
                )
                .unwrap();
            }
            true
        };
        assert_eq!(sync_index(&store, None, &keep).unwrap(), 1);
        let conn = store.lock_conn().unwrap();
        assert!(conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM session_search_index WHERE session_id='stable')",
                [],
                |row| row.get::<_, bool>(0)
            )
            .unwrap());
        assert_eq!(pending_count(&conn).unwrap(), 1);
    }

    #[test]
    fn cancelled_large_session_indexing_keeps_last_published_revision_and_pending_work() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let store = SessionStore::open_in_memory().unwrap();
        {
            let conn = store.lock_conn().unwrap();
            insert_session_at(
                &conn,
                "s",
                "/w",
                "T",
                &json!([message("old", "user", "oldneedle")]),
                1000,
            );
        }
        assert_eq!(sync_index(&store, None, &|| true).unwrap(), 0);
        {
            let conn = store.lock_conn().unwrap();
            let blocks = Value::Array(
                (0..5000)
                    .map(|index| message(&format!("b{index}"), "assistant", "newneedle"))
                    .collect(),
            );
            insert_session_at(&conn, "s", "/w", "T", &blocks, 2000);
            let raw: Vec<String> = blocks
                .as_array()
                .unwrap()
                .iter()
                .map(Value::to_string)
                .collect();
            super::super::incremental::checkpoint(&conn, "s", &blocks, &raw).unwrap();
        }
        let checks = AtomicUsize::new(0);
        assert_eq!(
            sync_index(&store, None, &|| checks.fetch_add(1, Ordering::Relaxed)
                < 12)
            .unwrap(),
            1
        );
        {
            let conn = store.lock_conn().unwrap();
            assert_eq!(
                conn.query_row(
                    "SELECT source_updated_at FROM session_search_index WHERE session_id='s'",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
                1000
            );
            let version: i64 = conn
                .query_row(
                    "SELECT version FROM session_search_dirty WHERE session_id='s'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            let candidate = extract_blocks(&Value::Array(
                (0..100)
                    .map(|index| {
                        message(&format!("new-{index}"), "user", "partial must stay hidden")
                    })
                    .collect(),
            ));
            let writes = AtomicUsize::new(0);
            assert!(
                !write_index(&conn, "s", 2000, version, &candidate, None, &|| writes
                    .fetch_add(1, Ordering::Relaxed)
                    < 12)
                .unwrap()
            );
            assert_eq!(
                conn.query_row(
                    "SELECT source_updated_at FROM session_search_index WHERE session_id='s'",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
                1000
            );
            assert_eq!(
                conn.query_row("SELECT COUNT(*) FROM session_search_blocks", [], |row| row
                    .get::<_, i64>(
                    0
                ))
                .unwrap(),
                1
            );
            assert_eq!(pending_count(&conn).unwrap(), 1);
        }
        assert_eq!(sync_index(&store, None, &|| true).unwrap(), 0);
        assert_eq!(search(&store, "newneedle").sessions.len(), 1);
        assert!(search(&store, "oldneedle").sessions.is_empty());
    }

    #[test]
    fn turkish_text_folds_to_the_same_tokens() {
        let folded = fold_text("İSPARTA ısparta Isparta çğöşü ÇĞÖŞÜ");
        assert_eq!(folded, "isparta isparta isparta cgosu cgosu");
        assert_eq!(fold_text("KIRMIZI"), "kirmizi");
        assert_eq!(fold_text("Kırmızı"), "kirmizi");
        // One char in, one char out: offsets in the folded text are valid in
        // the original, which the highlighter relies on.
        for text in ["İİİ", "Şişli çarşı", "ǅ ẞ ΑΣ"] {
            assert_eq!(fold_text(text).chars().count(), text.chars().count());
        }
    }

    #[test]
    fn query_terms_are_tokenised_and_prefix_matched() {
        let terms = parse_query("Session_Store.rs  İsparta");
        assert_eq!(terms, vec![vec!["session", "store", "rs"], vec!["isparta"]]);
        assert_eq!(
            fts_query(&terms),
            "\"session store rs\" * AND \"isparta\" *"
        );
        assert!(parse_query("  !!! ").is_empty());
    }

    #[test]
    fn search_finds_message_text_across_projects_with_a_highlighted_snippet() {
        let store = SessionStore::open_in_memory().unwrap();
        {
            let conn = store.lock_conn().unwrap();
            insert_session(
                &conn,
                "a",
                "/work/a",
                "Alpha chat",
                &json!([
                    message("u1", "user", "How do we fix the websocket reconnect loop?"),
                    message("a1", "assistant", "Backoff the websocket reconnect timer."),
                    message("a2", "assistant", "Unrelated answer."),
                ]),
            );
            insert_session(
                &conn,
                "b",
                "/work/b",
                "Beta chat",
                &json!([message("u1", "user", "nothing relevant here")]),
            );
        }
        let result = search(&store, "WebSocket");
        assert_eq!(result.sessions.len(), 1);
        assert_eq!(result.pending, 0);
        let session = &result.sessions[0];
        assert_eq!(session.session_id, "a");
        assert_eq!(session.hit_count, 2);
        assert_eq!(
            session
                .hits
                .iter()
                .map(|hit| hit.block_id.as_str())
                .collect::<Vec<_>>(),
            vec!["u1", "a1"]
        );
        let hit = &session.hits[0];
        let [start, end] = hit.ranges[0];
        let units: Vec<u16> = hit.snippet.encode_utf16().collect();
        assert_eq!(
            String::from_utf16(&units[start as usize..end as usize]).unwrap(),
            "websocket"
        );
    }

    #[test]
    fn turkish_queries_match_across_case_and_diacritics() {
        let store = SessionStore::open_in_memory().unwrap();
        {
            let conn = store.lock_conn().unwrap();
            insert_session(
                &conn,
                "t",
                "/work/t",
                "Türkçe sohbet",
                &json!([
                    message("m1", "user", "ISPARTA'daki gül bahçesi çok güzel"),
                    message("m2", "assistant", "İstanbul Şişli'de kırmızı ışık"),
                ]),
            );
        }
        for (query, block) in [
            ("isparta", "m1"),
            ("ısparta", "m1"),
            ("İSPARTA", "m1"),
            ("gul bahcesi", "m1"),
            ("güzel", "m1"),
            ("istanbul", "m2"),
            ("İstanbul", "m2"),
            ("sisli", "m2"),
            ("ŞİŞLİ", "m2"),
            ("kirmizi isik", "m2"),
            ("Kırmızı Işık", "m2"),
        ] {
            let result = search(&store, query);
            assert_eq!(result.sessions.len(), 1, "query {query:?}");
            assert_eq!(
                result.sessions[0].hits[0].block_id, block,
                "query {query:?}"
            );
        }
        // Title hits carry highlight ranges even when no block matches.
        let by_title = search(&store, "turkce");
        assert_eq!(by_title.sessions[0].hit_count, 0);
        assert_eq!(by_title.sessions[0].title_ranges, vec![[0, 6]]);
    }

    #[test]
    fn terms_must_all_match_in_the_same_block() {
        let store = SessionStore::open_in_memory().unwrap();
        {
            let conn = store.lock_conn().unwrap();
            insert_session(
                &conn,
                "a",
                "/work/a",
                "Chat",
                &json!([
                    message("m1", "user", "alpha only"),
                    message("m2", "user", "beta only"),
                    message("m3", "user", "alpha and beta together"),
                ]),
            );
        }
        let result = search(&store, "alpha beta");
        assert_eq!(result.sessions[0].hit_count, 1);
        assert_eq!(result.sessions[0].hits[0].block_id, "m3");
        // The last word is a prefix.
        assert_eq!(search(&store, "alp").sessions[0].hit_count, 2);
        assert!(search(&store, "lpha").sessions.is_empty());
    }

    #[test]
    fn filters_scope_provider_archive_and_dates() {
        let store = SessionStore::open_in_memory().unwrap();
        {
            let conn = store.lock_conn().unwrap();
            let blocks = json!([message("m", "user", "needle in a haystack")]);
            insert_session_at(&conn, "old", "C:\\Work\\One", "One", &blocks, 1_000);
            insert_session_at(&conn, "new", "/work/two", "Two", &blocks, 9_000);
            conn.execute("UPDATE sessions SET harness = 'codex' WHERE id = 'new'", [])
                .unwrap();
            insert_session_at(&conn, "gone", "/work/two", "Three", &blocks, 5_000);
            conn.execute("UPDATE sessions SET archived = 1 WHERE id = 'gone'", [])
                .unwrap();
        }
        let ids = |options: ContentSearchOptions| -> Vec<String> {
            search_content(&store, &options)
                .unwrap()
                .sessions
                .into_iter()
                .map(|session| session.session_id)
                .collect()
        };
        let base = options("needle");
        assert_eq!(ids(base.clone()), vec!["new", "old"]);
        assert_eq!(
            ids(ContentSearchOptions {
                include_archived: true,
                ..base.clone()
            }),
            vec!["new", "gone", "old"]
        );
        assert_eq!(
            ids(ContentSearchOptions {
                cwds: vec!["c:/work/one/".into()],
                ..base.clone()
            }),
            vec!["old"]
        );
        assert_eq!(
            ids(ContentSearchOptions {
                harness: Some("codex".into()),
                ..base.clone()
            }),
            vec!["new"]
        );
        assert_eq!(
            ids(ContentSearchOptions {
                since: Some(500),
                until: Some(2_000),
                ..base
            }),
            vec!["old"]
        );
    }

    #[test]
    fn a_changed_session_is_reindexed_and_a_deleted_one_forgotten() {
        let store = SessionStore::open_in_memory().unwrap();
        {
            let conn = store.lock_conn().unwrap();
            insert_session_at(
                &conn,
                "s",
                "/w",
                "T",
                &json!([message("m", "user", "first draft")]),
                1_000,
            );
        }
        assert_eq!(search(&store, "first").sessions.len(), 1);
        {
            let conn = store.lock_conn().unwrap();
            insert_session_at(
                &conn,
                "s",
                "/w",
                "T",
                &json!([message("m", "user", "second draft")]),
                2_000,
            );
        }
        assert!(search(&store, "first").sessions.is_empty());
        assert_eq!(search(&store, "second").sessions.len(), 1);

        let conn = store.lock_conn().unwrap();
        crate::session_store::delete_session(&conn, "s").unwrap();
        let rows: i64 = conn
            .query_row(
                "SELECT (SELECT COUNT(*) FROM session_search_index)
                      + (SELECT COUNT(*) FROM session_search_blocks)",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(rows, 0);
    }

    #[test]
    fn indexing_leaves_the_transcript_untouched_and_skips_unparseable_ones() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        insert_session(
            &conn,
            "ok",
            "/w",
            "T",
            &json!([message("m", "user", "hello")]),
        );
        conn.execute(
            "INSERT INTO sessions (id, cwd, harness, model, runtime_mode, title,
               blocks_json, created_at, updated_at, has_user_message)
             VALUES ('bad', '/w', 'claude', 'm', 's', 'Bad', 'not json', 1, 1, 1)",
            [],
        )
        .unwrap();
        drop(conn);
        assert_eq!(sync_index(&store, None, &|| true).unwrap(), 0);
        let conn = store.lock_conn().unwrap();
        let raw: String = conn
            .query_row(
                "SELECT blocks_json FROM sessions WHERE id = 'bad'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(raw, "not json");
    }

    #[test]
    fn an_existing_database_gains_the_index_without_touching_its_sessions() {
        let path = std::env::temp_dir().join(format!(
            "bycoda-content-search-migrate-{}.db",
            std::process::id()
        ));
        let blocks = json!([message("m", "user", "legacy transcript with a needle")]);
        {
            // A database from before the index existed: sessions, no search tables.
            let store = SessionStore::open(path.clone()).unwrap();
            let conn = store.lock_conn().unwrap();
            insert_session(&conn, "old", "/w", "Legacy", &blocks);
            conn.execute_batch(
                "DROP TABLE session_search_fts;
                 DROP TABLE session_search_blocks;
                 DROP TABLE session_search_index;",
            )
            .unwrap();
        }
        let store = SessionStore::open(path.clone()).unwrap();
        // Opening only created empty tables; the session is found once indexed.
        let indexed: i64 = store
            .lock_conn()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM session_search_index", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(indexed, 0);
        assert_eq!(search(&store, "needle").sessions.len(), 1);
        let raw: String = store
            .lock_conn()
            .unwrap()
            .query_row(
                "SELECT blocks_json FROM sessions WHERE id = 'old'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(raw, blocks.to_string());
        drop(store);
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
        }
    }

    #[test]
    fn tool_output_is_budgeted_but_conversation_text_is_always_indexed() {
        let mut blocks = Vec::new();
        let filler = "x ".repeat(MAX_TOOL_BLOCK_CHARS);
        for index in 0..400 {
            blocks.push(json!({
                "id": format!("t{index}"), "role": "tool", "text": "",
                "tool": { "title": "Run", "detail": filler }
            }));
        }
        blocks.push(message("late", "assistant", "the conclusion"));
        let extracted = extract_blocks(&Value::Array(blocks));
        let tools = extracted.iter().filter(|b| b.role == "tool").count();
        assert!(tools * MAX_TOOL_BLOCK_CHARS >= MAX_TOOL_CHARS_PER_SESSION);
        assert!(tools < 400);
        assert!(extracted.iter().any(|b| b.block_id == "late"));
    }

    #[test]
    fn a_superseded_search_returns_nothing() {
        let store = SessionStore::open_in_memory().unwrap();
        {
            let conn = store.lock_conn().unwrap();
            insert_session(
                &conn,
                "a",
                "/w",
                "T",
                &json!([message("m", "user", "needle")]),
            );
        }
        let owner = "content-search-superseded";
        let stale = begin_session_search(owner).unwrap();
        begin_session_search(owner);
        let conn = store.lock_conn().unwrap();
        let result = run_search(
            &conn,
            &options("needle"),
            &parse_query("needle"),
            Some(&stale),
        );
        assert!(matches!(result, Ok(None)));
        super::super::cancel_owned_session_search(owner);
    }

    /// Timing on a database the size of a heavily used install. Run with
    /// `cargo test -p bycoda --lib -- --ignored --nocapture synthetic`.
    #[test]
    #[ignore = "writes ~400 MB; run by hand for timings"]
    fn synthetic_database_timings() {
        let dir =
            std::env::temp_dir().join(format!("bycoda-content-search-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("bycoda.db");
        let store = SessionStore::open(path.clone()).unwrap();

        // 600 sessions in 47 projects: 40 giants of ~6 MiB (mostly tool output),
        // the rest 20-400 KB of conversation. Words come from a fixed
        // vocabulary, plus one rare needle per tenth session.
        let words: Vec<String> = (0..4000).map(|i| format!("w{i}x{}", i % 97)).collect();
        let mut seed = 0x2545_f491_4f6c_dd1du64;
        let mut next = move || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed
        };
        let started = Instant::now();
        {
            let conn = store.lock_conn().unwrap();
            let tx = conn.unchecked_transaction().unwrap();
            for session in 0..600usize {
                let giant = session % 15 == 0;
                let target = if giant {
                    6 * 1024 * 1024
                } else {
                    (20 + (next() % 380) as usize) * 1024
                };
                let mut blocks = Vec::new();
                let mut size = 0usize;
                let mut index = 0usize;
                while size < target {
                    let tool = giant && !index.is_multiple_of(3);
                    let length = if tool { 3000 } else { 60 };
                    let mut text = String::new();
                    for _ in 0..length / 6 {
                        text.push_str(&words[(next() % words.len() as u64) as usize]);
                        text.push(' ');
                    }
                    if session % 10 == 0 && index == 5 {
                        text.push_str("zebrafinch needle ışık İstanbul");
                    }
                    size += text.len() + 60;
                    blocks.push(if tool {
                        json!({"id": format!("b{index}"), "role": "tool", "text": "",
                               "tool": {"title": "Bash", "detail": text}})
                    } else {
                        message(
                            &format!("b{index}"),
                            if index.is_multiple_of(2) {
                                "user"
                            } else {
                                "assistant"
                            },
                            &text,
                        )
                    });
                    index += 1;
                }
                insert_session_at(
                    &tx,
                    &format!("imp-{session}"),
                    &format!("/projects/p{}", session % 47),
                    &format!("Session {session} about w{}x1", session % 50),
                    &Value::Array(blocks),
                    1_000 + session as i64,
                );
            }
            tx.commit().unwrap();
        }
        let db_bytes = std::fs::metadata(&path).unwrap().len();
        println!(
            "built in {:?}; sessions db {} MiB",
            started.elapsed(),
            db_bytes >> 20
        );

        let started = Instant::now();
        let first = search_content(&store, &options("zebrafinch")).unwrap();
        println!(
            "first search incl. {} ms indexing budget: {:?}, {} sessions, pending {}",
            SEARCH_SYNC_BUDGET.as_millis(),
            started.elapsed(),
            first.sessions.len(),
            first.pending
        );

        let started = Instant::now();
        let remaining = sync_index(&store, None, &|| true).unwrap();
        println!(
            "full backfill of the rest: {:?} (remaining {remaining})",
            started.elapsed()
        );
        let total_bytes = std::fs::metadata(&path).unwrap().len()
            + std::fs::metadata(path.with_extension("db-wal"))
                .map(|m| m.len())
                .unwrap_or(0);
        println!("db + wal after indexing: {} MiB", total_bytes >> 20);

        for query in [
            "zebrafinch",
            "zebrafinch needle",
            "ışık",
            "istanbul",
            "w17x17",
            "w1",
            "bash",
            "session about",
        ] {
            let mut best = Duration::MAX;
            let mut sessions = 0;
            for _ in 0..5 {
                let started = Instant::now();
                let result = search_content(&store, &options(query)).unwrap();
                best = best.min(started.elapsed());
                sessions = result.sessions.len();
            }
            println!("query {query:>18?}: best of 5 {best:>10.2?}  {sessions} sessions");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Everything the index holds for a store, in a comparable form: the block
    /// rows, the FTS doc sizes, and which rowids each probe word matches.
    fn index_dump(store: &SessionStore) -> Vec<String> {
        let conn = store.lock_conn().unwrap();
        let mut out = Vec::new();
        let mut blocks = conn
            .prepare("SELECT id, block_id, role, text FROM session_search_blocks ORDER BY id")
            .unwrap();
        for row in blocks
            .query_map([], |r| {
                Ok(format!(
                    "block {} {} {} {}",
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?
                ))
            })
            .unwrap()
        {
            out.push(row.unwrap());
        }
        let mut sizes = conn
            .prepare("SELECT id, sz FROM session_search_fts_docsize ORDER BY id")
            .unwrap();
        for row in sizes
            .query_map([], |r| {
                Ok(format!(
                    "size {} {:?}",
                    r.get::<_, i64>(0)?,
                    r.get::<_, Vec<u8>>(1)?
                ))
            })
            .unwrap()
        {
            out.push(row.unwrap());
        }
        for word in [
            "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "grown",
        ] {
            let mut hits = conn
                .prepare(
                    "SELECT rowid FROM session_search_fts WHERE session_search_fts MATCH ?1
                     ORDER BY rowid",
                )
                .unwrap();
            let ids: Vec<i64> = hits
                .query_map([format!("\"{word}\" *")], |r| r.get(0))
                .unwrap()
                .map(Result::unwrap)
                .collect();
            out.push(format!("match {word} {ids:?}"));
        }
        out
    }

    #[test]
    fn incremental_reindex_matches_a_full_rebuild() {
        let store = SessionStore::open_in_memory().unwrap();
        let steps: Vec<Vec<Value>> = vec![
            vec![
                message("a", "user", "alpha one"),
                message("b", "assistant", "beta two"),
            ],
            // append
            vec![
                message("a", "user", "alpha one"),
                message("b", "assistant", "beta two"),
                message("c", "user", "gamma three"),
            ],
            // last block grows
            vec![
                message("a", "user", "alpha one"),
                message("b", "assistant", "beta two"),
                message("c", "user", "gamma three grown longer"),
            ],
            // middle block edited
            vec![
                message("a", "user", "alpha one"),
                message("b", "assistant", "epsilon edited"),
                message("c", "user", "gamma three grown longer"),
            ],
            // block removed from the middle
            vec![
                message("a", "user", "alpha one"),
                message("c", "user", "gamma three grown longer"),
            ],
            // reorder plus a new block
            vec![
                message("c", "user", "gamma three grown longer"),
                message("a", "user", "alpha one"),
                message("d", "tool", "delta zeta"),
            ],
            // truncated back to one block
            vec![message("d", "tool", "delta zeta")],
        ];
        for (step, blocks) in steps.iter().enumerate() {
            let blocks = Value::Array(blocks.clone());
            {
                let conn = store.lock_conn().unwrap();
                insert_session_at(&conn, "s", "/w", "T", &blocks, 1_000 + step as i64);
            }
            assert_eq!(sync_index(&store, None, &|| true).unwrap(), 0);

            let fresh = SessionStore::open_in_memory().unwrap();
            {
                let conn = fresh.lock_conn().unwrap();
                insert_session_at(&conn, "s", "/w", "T", &blocks, 1_000 + step as i64);
            }
            assert_eq!(sync_index(&fresh, None, &|| true).unwrap(), 0);
            assert_eq!(index_dump(&store), index_dump(&fresh), "step {step}");
        }
    }
}
