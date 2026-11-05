# Native storage epoch

Use for native canonical migration, session effect admission and owned OpenCode
services. Browser fallback and Host-owned persistence retain their own adapters.

Source: `src-tauri/src/session_store/canonical_store.rs` and
`src-tauri/src/sync_owner.rs`. Apply the conditional
[owner decisions](decisions.md#native-storage-compatibility) when changing migration
or OpenCode service ownership.

Native canonical transactions preserve original legacy bytes, versioned keys,
tombstones and operation receipts. A compact receipt proves the operation outcome;
it does not contain the current value. Reread and compare exact versions and values
before publishing recovered state. Unknown effects retain their original identity.

Host binding migration requires verified native effect-guard readiness. Preserve
legacy sources before committing the migration marker; remove a localStorage key
only when its current bytes still match the durably preserved source. Canonical
refresh precedes new authority admission. Warm writers retain ownership until
actual retirement, independently of turn completion or observer cancellation.

Sync takeover requires exact page retirement and completed native I/O admission.
Across application restarts, probe the previous store instance's kernel lease;
missing or live evidence never proves retirement. Host record revision checks
reconcile conditional sync requests. A timeout alone proves neither delivery nor
retirement.
