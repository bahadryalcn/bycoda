//! Private atomic comparison of real retained Native inputs and a real write.
//! The owned result is produced only after FULL commit and durability restore.
//! It deliberately does not assert reducer application or producer completeness.
use super::*;
use crate::native_editor_drafts::EditorDraftValidationReceipt;
use crate::native_provider_output::NativeInputClaim;
use crate::session_store::authority::CheckedStoreTransaction;
use crate::session_store::native_raw_capture::{
    self as raw_store, RawCaptureArtifact, RawCaptureReceipt,
};
use crate::session_store::write_receipts::{NativeProjectionWriteClaim, NativeWriteComparison};
use rusqlite::OptionalExtension;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeProjectionReceipt {
    version: u8,
    qualified: CheckpointUnqualified,
    application_through: Option<u64>,
    native_write_id: String,
    normalized_input_sha256: String,
    sql_commitment_sha256: String,
    ordered_transcript_sha256: String,
    model_version: u64,
    native_input_count: usize,
    sql: NativeSqlCheckpointReceipt,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) raw_capture: Option<RawCaptureReceipt>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) editor_drafts: Option<EditorDraftValidationReceipt>,
}

pub(super) struct ProjectionEntry {
    fingerprint: String,
    pub(super) running: bool,
    result: Option<Result<NativeProjectionReceipt, String>>,
    raw_sha256: Option<String>,
    raw_expected: Option<RawCaptureReceipt>,
}

fn projection_fingerprint(comparison: &str, raw: Option<&RawCaptureArtifact>) -> String {
    match raw {
        Some(raw) => hash(
            format!(
                "native-projection-raw-v1:{}:{}",
                hash(comparison.as_bytes()),
                raw.sha256()
            )
            .as_bytes(),
        ),
        None => hash(comparison.as_bytes()),
    }
}

// All blobs are read from the one checked snapshot. The independent writer
// comparison checks the normalized original input and the entire current row.
fn expectation_at(
    tx: &CheckedStoreTransaction<'_>,
    write: &NativeWriteComparison<'_>,
    session: &str,
) -> Result<NativeCheckpointExpectation, String> {
    let mut remaining = 32 * 1024 * 1024usize;
    let mut blob = |table: &str, key: &str, column: &str| -> Result<Option<String>, String> {
        let query = format!(
            "SELECT typeof({column}),length(CAST({column} AS BLOB)),CASE WHEN typeof({column})='text' AND length(CAST({column} AS BLOB))<=?2 THEN {column} ELSE NULL END FROM {table} WHERE {key}=?1"
        );
        let value: Option<(String, i64, Option<String>)> = tx
            .connection()
            .query_row(
                &query,
                rusqlite::params![session, remaining as i64],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let Some((kind, bytes, raw)) = value else {
            return Ok(None);
        };
        let raw = raw.ok_or_else(|| failure("BLOB_CAPACITY"))?;
        if kind != "text" || bytes < 0 || bytes as usize != raw.len() || raw.len() > remaining {
            return Err(failure("CORRUPT"));
        }
        remaining -= raw.len();
        Ok(Some(raw))
    };
    let transcript = blob("session_transcripts", "id", "blocks_json")?
        .ok_or_else(|| failure("SESSION_MISSING"))?;
    let transcript_digest: [u8; 32] = Sha256::digest(transcript.as_bytes()).into();
    if transcript_digest != write.transcript_digest() {
        return Err(failure("TRANSCRIPT_VIEW_CHANGED"));
    }
    let draft = blob("composer_drafts", "session_id", "draft_json")?;
    let queue = blob("session_queues", "session_id", "queue_json")?;
    let digest_blob = |value: Option<String>| {
        value.map_or(ExpectedSqlBlob::Absent, |raw| ExpectedSqlBlob::Present {
            sha256: hash(raw.as_bytes()),
        })
    };
    Ok(NativeCheckpointExpectation {
        revision: write.ack().revision,
        updated_at: write.ack().updated_at,
        transcript_sha256: hash(transcript.as_bytes()),
        draft: digest_blob(draft),
        queue: digest_blob(queue),
    })
}

impl NativeRendererCheckpoints {
    pub(crate) fn issue_projection(
        &self,
        round: &NativeCheckpointRound,
        window: &tauri::Window,
        deadline: Instant,
        comparison_json: &str,
        raw: &RawCaptureArtifact,
    ) -> Result<NativeRendererChallenge, String> {
        let claim = NativeProjectionWriteClaim::parse(comparison_json)?;
        {
            let ledger = self.ledger.lock().map_err(|_| failure("UNAVAILABLE"))?;
            let actual = ledger
                .rounds
                .get(&round.id)
                .ok_or_else(|| failure("WRONG_ROUND"))?;
            if claim.session_id() != actual.scope.session_id
                || raw.session_id() != actual.scope.session_id
            {
                return Err(failure("WRONG_SCOPE"));
            }
        }
        let lifetime = deadline
            .checked_duration_since(Instant::now())
            .ok_or_else(|| failure("EXPIRED"))?;
        let mut challenge = self.issue(round, window, lifetime)?;
        self.bind_projection_comparison(&challenge.nonce, comparison_json, Some(raw))?;
        self.cap_projection_deadline(&mut challenge, deadline)?;
        Ok(challenge)
    }

    fn cap_projection_deadline(
        &self,
        challenge: &mut NativeRendererChallenge,
        deadline: Instant,
    ) -> Result<(), String> {
        let mut ledger = self.ledger.lock().map_err(|_| failure("UNAVAILABLE"))?;
        let entry = ledger
            .entries
            .get_mut(&challenge.nonce)
            .ok_or_else(|| failure("UNKNOWN_CHALLENGE"))?;
        entry.expires = entry.expires.min(deadline);
        challenge.expires_in_ms = entry
            .expires
            .checked_duration_since(Instant::now())
            .ok_or_else(|| failure("EXPIRED"))?
            .as_millis()
            .max(1) as u64;
        Ok(())
    }

    fn bind_projection_comparison(
        &self,
        nonce: &str,
        comparison_json: &str,
        raw: Option<&RawCaptureArtifact>,
    ) -> Result<(), String> {
        let mut ledger = self.ledger.lock().map_err(|_| failure("UNAVAILABLE"))?;
        let entry = ledger
            .entries
            .get_mut(nonce)
            .ok_or_else(|| failure("UNKNOWN_CHALLENGE"))?;
        entry.projection = Some(ProjectionEntry {
            fingerprint: projection_fingerprint(comparison_json, raw),
            running: false,
            result: None,
            raw_sha256: raw.map(|raw| raw.sha256().into()),
            raw_expected: None,
        });
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn test_issue_projection(
        &self,
        round: &NativeCheckpointRound,
        resources: &ResourceTable,
        comparison: &str,
    ) -> Result<NativeRendererChallenge, String> {
        self.test_issue_projection_before(
            round,
            resources,
            comparison,
            Instant::now() + Duration::from_secs(10),
        )
    }

    #[cfg(test)]
    pub(crate) fn test_issue_projection_before(
        &self,
        round: &NativeCheckpointRound,
        resources: &ResourceTable,
        comparison: &str,
        deadline: Instant,
    ) -> Result<NativeRendererChallenge, String> {
        let lifetime = deadline
            .checked_duration_since(Instant::now())
            .ok_or_else(|| failure("EXPIRED"))?;
        let mut challenge = self.issue_resources(round, resources, lifetime)?;
        self.bind_projection_comparison(&challenge.nonce, comparison, None)?;
        self.cap_projection_deadline(&mut challenge, deadline)?;
        Ok(challenge)
    }

    #[cfg(test)]
    pub(crate) fn test_issue_projection_raw(
        &self,
        round: &NativeCheckpointRound,
        resources: &ResourceTable,
        comparison: &str,
        raw: &RawCaptureArtifact,
    ) -> Result<NativeRendererChallenge, String> {
        let challenge = self.issue_resources(round, resources, Duration::from_secs(10))?;
        self.bind_projection_comparison(&challenge.nonce, comparison, Some(raw))?;
        Ok(challenge)
    }

    pub(crate) fn projection_checkpoint(
        &self,
        window: &tauri::Window,
        nonce: &str,
        comparison_json: &str,
        raw: &RawCaptureArtifact,
    ) -> Result<NativeProjectionReceipt, String> {
        if !valid_nonce(nonce) {
            return Err(failure("INVALID_CHALLENGE"));
        }
        let claim = NativeProjectionWriteClaim::parse(comparison_json)?;
        let fingerprint = projection_fingerprint(comparison_json, Some(raw));
        let captured = self
            .source
            .checked_source()
            .map_err(|error| error.to_string())?;
        let (round, owner) = {
            let ledger = self.ledger.lock().map_err(|_| failure("UNAVAILABLE"))?;
            if ledger.closed {
                return Err(failure("CLOSED"));
            }
            let entry = ledger
                .entries
                .get(nonce)
                .ok_or_else(|| failure("UNKNOWN_CHALLENGE"))?;
            let projection = entry
                .projection
                .as_ref()
                .ok_or_else(|| failure("WRONG_CHALLENGE_KIND"))?;
            if projection.fingerprint != fingerprint
                || projection.raw_sha256.as_deref() != Some(raw.sha256())
            {
                return Err(failure("CONFLICT"));
            }
            if projection.running {
                return Err(failure("PENDING"));
            }
            let round = ledger
                .rounds
                .get(&entry.round_id)
                .cloned()
                .ok_or_else(|| failure("WRONG_ROUND"))?;
            if claim.session_id() != round.scope.session_id
                || raw.session_id() != round.scope.session_id
            {
                return Err(failure("WRONG_SCOPE"));
            }
            // Short actual-resource validation. It must be dropped before Native
            // input preflight, which independently resolves current Tauri owners.
            native_window_lifecycle::with_checkpoint_resources(
                &entry.window,
                &window.resources_table(),
                captured.native_instance_id,
                |_, _| Ok(()),
            )?;
            if let Some(result) = &projection.result {
                return result.clone();
            }
            if Instant::now() >= entry.expires {
                return Err(failure("EXPIRED"));
            }
            (round, entry.window.clone())
        };
        let inputs = claim
            .items()
            .iter()
            .map(NativeInputClaim::parse_json)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("NATIVE_CHECKPOINT_INPUT_{error:?}"))?;
        let host = window
            .app_handle()
            .try_state::<crate::harness::HarnessHost>()
            .ok_or_else(|| failure("HARNESS_UNAVAILABLE"))?;
        let prepared = self.source.with_checked_store(|store| {
            host.prepare_native_output_inputs(store, &round.scope.session_id, &owner, &inputs)
                .map_err(|error| format!("NATIVE_CHECKPOINT_INPUT_{error:?}"))
        })?;
        self.projection_checkpoint_prepared_with_raw(
            &owner,
            nonce,
            comparison_json,
            prepared,
            Some(raw),
        )
    }

    /// Native-only handoff of retained inputs. No renderer can manufacture the
    /// current physical capture or this non-Serde prepared group.
    #[cfg(test)]
    pub(crate) fn projection_checkpoint_prepared(
        &self,
        current: &NativeCheckpointWindow,
        nonce: &str,
        comparison_json: &str,
        prepared: crate::native_provider_output::PreparedNativeInputGroup,
    ) -> Result<NativeProjectionReceipt, String> {
        self.projection_checkpoint_prepared_with_raw(
            current,
            nonce,
            comparison_json,
            prepared,
            None,
        )
    }

    pub(crate) fn projection_checkpoint_prepared_with_raw(
        &self,
        current: &NativeCheckpointWindow,
        nonce: &str,
        comparison_json: &str,
        prepared: crate::native_provider_output::PreparedNativeInputGroup,
        raw: Option<&RawCaptureArtifact>,
    ) -> Result<NativeProjectionReceipt, String> {
        let _call = self.admit_call()?;
        let claim = NativeProjectionWriteClaim::parse(comparison_json)?;
        let inputs = claim
            .items()
            .iter()
            .map(NativeInputClaim::parse_json)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("NATIVE_CHECKPOINT_INPUT_{error:?}"))?;
        let fingerprint = projection_fingerprint(comparison_json, raw);
        let captured = self
            .source
            .checked_source()
            .map_err(|error| error.to_string())?;
        let (round, owner) = {
            let ledger = self.ledger.lock().map_err(|_| failure("UNAVAILABLE"))?;
            if ledger.closed {
                return Err(failure("CLOSED"));
            }
            let entry = ledger
                .entries
                .get(nonce)
                .ok_or_else(|| failure("UNKNOWN_CHALLENGE"))?;
            if !entry.window.same_capture(current) {
                return Err(failure("WINDOW_CHANGED"));
            }
            native_window_lifecycle::with_checkpoint_owner_group(
                &[current],
                captured.native_instance_id,
                |_| Ok(()),
            )?;
            let projection = entry
                .projection
                .as_ref()
                .ok_or_else(|| failure("WRONG_CHALLENGE_KIND"))?;
            if projection.fingerprint != fingerprint
                || projection.raw_sha256.as_deref() != raw.map(|raw| raw.sha256())
            {
                return Err(failure("CONFLICT"));
            }
            if projection.running {
                return Err(failure("PENDING"));
            }
            let round = ledger
                .rounds
                .get(&entry.round_id)
                .cloned()
                .ok_or_else(|| failure("WRONG_ROUND"))?;
            if claim.session_id() != round.scope.session_id
                || prepared.logical_target() != round.scope.session_id
                || raw.is_some_and(|raw| raw.session_id() != round.scope.session_id)
            {
                return Err(failure("WRONG_SCOPE"));
            }
            if let Some(result) = &projection.result {
                return result.clone();
            }
            (round, entry.window.clone())
        };
        let operation = {
            let mut ledger = self.ledger.lock().map_err(|_| failure("UNAVAILABLE"))?;
            if ledger.closed {
                return Err(failure("CLOSED"));
            }
            let entry = ledger
                .entries
                .get_mut(nonce)
                .ok_or_else(|| failure("UNKNOWN_CHALLENGE"))?;
            let projection = entry
                .projection
                .as_mut()
                .ok_or_else(|| failure("WRONG_CHALLENGE_KIND"))?;
            if projection.running || projection.result.is_some() {
                return Err(failure("ALREADY_CONSUMED"));
            }
            let operation = native_window_lifecycle::with_checkpoint_owner_group(
                &[current],
                captured.native_instance_id,
                |group| {
                    group.begin_target_checkpoint_before(
                        &entry.window,
                        &round.closed,
                        entry.expires,
                    )
                },
            )?;
            projection.running = true;
            operation
        };
        // Required nesting: all physical owners -> stable stream states -> real
        // target barrier -> Store-owned FULL -> commit+restore -> release locks.
        let mut owners = prepared.owners();
        if !owners.iter().any(|capture| capture.same_capture(&owner)) {
            owners.push(&owner);
        }
        let mut raw_candidate = None;
        let result = native_window_lifecycle::with_checkpoint_owner_group(
            &owners,
            captured.native_instance_id,
            |group| {
                group.with_target_scope(&owner, &round.closed, || {
                    prepared.with_stable_inputs(&group, |stable| {
                        let checked_owner = group
                            .checked_window(&owner)
                            .ok_or_else(|| failure("WINDOW_CHANGED"))?;
                        self.source.with_checked_store(|store| {
                            let (
                                (sql, native_input_count, raw_receipt, editor_drafts),
                                committed_write,
                            ) = store.commit_projection_write_comparison(
                                &checked_owner,
                                &claim,
                                |tx, write| {
                                    store.assert_native_execution_idle_at(
                                        tx,
                                        &round.scope.session_id,
                                    )?;
                                    stable.validate_at(store, tx, |native_inputs| {
                                        if native_inputs.logical_target() != round.scope.session_id
                                            || native_inputs.len() != claim.items().len()
                                        {
                                            return Err(failure("WRONG_SCOPE"));
                                        }
                                        for index in 0..native_inputs.len() {
                                            let input = native_inputs
                                                .scope(index)
                                                .ok_or_else(|| failure("INPUT_MISSING"))?;
                                            let expected_input = inputs
                                                .get(index)
                                                .ok_or_else(|| failure("INPUT_MISSING"))?;
                                            if input.logical_session_id != round.scope.session_id
                                                || input.store_instance
                                                    != captured.native_instance_id
                                                || input.recipient_epoch != owner.incarnation()
                                                || input.source_store_id
                                                    != captured.identity.source_store_id
                                                || input.source_profile_id
                                                    != captured.identity.source_profile_id
                                                || input.routing_session_id
                                                    != expected_input.batch.session_id
                                                || input.process_epoch
                                                    != expected_input.batch.process_epoch
                                                || input.stream_epoch
                                                    != expected_input.batch.stream_epoch
                                                || input.sequence != expected_input.batch.sequence
                                                || input.channel != expected_input.batch.channel
                                                || input.item_index != expected_input.item_index
                                                || input.batch_sha256
                                                    != expected_input.batch.payload_sha256
                                            {
                                                return Err(failure("WRONG_SCOPE"));
                                            }
                                        }
                                        let expected =
                                            expectation_at(tx, write, &round.scope.session_id)?;
                                        let expected_fingerprint = expected.fingerprint()?;
                                        let editor_drafts = raw
                                            .map(|raw| {
                                                crate::native_editor_drafts::validate_capture_at(
                                                    tx,
                                                    store,
                                                    &checked_owner,
                                                    raw,
                                                )
                                            })
                                            .transpose()?
                                            .flatten()
                                            .map(|validated| validated.receipt());
                                        let descriptor = raw
                                            .map(|raw| {
                                                raw.descriptor(&hash(comparison_json.as_bytes()))
                                            })
                                            .transpose()?;
                                        let sql = store.renderer_checkpoint_commit_at_with_raw(
                                            tx,
                                            NativeCheckpointCommit {
                                                nonce,
                                                service_epoch: &self.epoch,
                                                round_id: &round.id,
                                                window_epoch: &owner.incarnation().to_string(),
                                                scope: &round.scope,
                                                row_identity: &round.row_identity,
                                                expected: &expected,
                                                fingerprint: &expected_fingerprint,
                                            },
                                            descriptor,
                                        )?;
                                        let raw_receipt = raw
                                            .map(|raw| raw_store::retain_at(tx, store, &sql, raw))
                                            .transpose()?;
                                        // Comparison data only until a committed SQL read proves it.
                                        raw_candidate = raw_receipt.clone();
                                        Ok((sql, native_inputs.len(), raw_receipt, editor_drafts))
                                    })
                                },
                            )?;
                            // The owned write exists only after the real FULL
                            // commit and restore. Build the wire observation
                            // from it, never from a callback's provisional data.
                            if committed_write.session_id() != sql.session_id
                                || committed_write.model_version() != claim.model_version()
                                || committed_write.source_store_id() != sql.source_store_id
                                || committed_write.source_profile_id() != sql.source_profile_id
                                || committed_write.native_instance_id().to_string()
                                    != sql.native_store_instance
                                || committed_write.ack().revision != sql.revision
                                || committed_write.ack().updated_at != sql.updated_at
                            {
                                return Err(failure("COMMITTED_COMPARISON_CHANGED"));
                            }
                            let hex = |bytes: [u8; 32]| {
                                bytes
                                    .iter()
                                    .map(|byte| format!("{byte:02x}"))
                                    .collect::<String>()
                            };
                            Ok(NativeProjectionReceipt {
                                version: 1,
                                qualified: CheckpointUnqualified,
                                application_through: None,
                                native_write_id: committed_write.native_write_id().into(),
                                normalized_input_sha256: hex(committed_write.input_digest()),
                                sql_commitment_sha256: hex(committed_write.sql_digest()),
                                ordered_transcript_sha256: hex(committed_write.transcript_digest()),
                                model_version: committed_write.model_version(),
                                native_input_count,
                                sql,
                                raw_capture: raw_receipt,
                                editor_drafts,
                            })
                        })
                    })
                })
            },
        );
        #[cfg(test)]
        let result = if self.lose_projection_reply.swap(false, Ordering::AcqRel) {
            result.and_then(|_| Err(failure("TEST_LOST_PROJECTION_REPLY")))
        } else {
            result
        };
        let result = operation.finish(result).map_err(|error| error.to_string());
        let mut ledger = self.ledger.lock().map_err(|_| failure("UNAVAILABLE"))?;
        if let Some(projection) = ledger
            .entries
            .get_mut(nonce)
            .and_then(|entry| entry.projection.as_mut())
        {
            projection.running = false;
            projection.result = Some(result.clone());
            projection.raw_expected = raw_candidate;
        }
        result
    }

    /// Original Native recovery locator; not an owned projection result.
    /// Copy before retire_round removes the challenge entry.
    pub(crate) fn projection_raw_recovery_binding(
        &self,
        nonce: &str,
    ) -> Result<Option<RawCaptureReceipt>, String> {
        let ledger = self.ledger.lock().map_err(|_| failure("UNAVAILABLE"))?;
        Ok(ledger
            .entries
            .get(nonce)
            .and_then(|entry| entry.projection.as_ref())
            .and_then(|projection| projection.raw_expected.clone()))
    }

    #[cfg(test)]
    pub(crate) fn test_lose_next_projection_reply(&self) {
        self.lose_projection_reply.store(true, Ordering::Release);
    }

    /// Read only the artifact of the original issued attempt. Retained metadata
    /// cannot recreate an owned write, a window, or an input/application proof.
    pub(crate) fn read_projection_raw(
        &self,
        owner: &NativeCheckpointWindow,
        expected: &RawCaptureReceipt,
    ) -> Result<RawCaptureReceipt, String> {
        let _call = self.admit_call()?;
        let captured = self
            .source
            .checked_source()
            .map_err(|error| error.to_string())?;
        if expected.sql.service_epoch != self.epoch
            || expected.sql.window_epoch != owner.incarnation().to_string()
            || expected.sql.native_store_instance != captured.native_instance_id.to_string()
            || expected.sql.source_store_id != captured.identity.source_store_id
            || expected.sql.source_profile_id != captured.identity.source_profile_id
        {
            return Err(failure("RAW_SOURCE_CHANGED"));
        }
        native_window_lifecycle::with_checkpoint_owner_group(
            &[owner],
            captured.native_instance_id,
            |_| {
                self.source.with_checked_store(|store| {
                    let conn = store.lock_conn()?;
                    let tx = rusqlite::Transaction::new_unchecked(
                        &conn,
                        rusqlite::TransactionBehavior::Deferred,
                    )
                    .map_err(|error| error.to_string())?;
                    let receipt = raw_store::read_at(&tx, store, expected)?;
                    tx.commit().map_err(|error| error.to_string())?;
                    Ok(receipt)
                })
            },
        )
    }
}
