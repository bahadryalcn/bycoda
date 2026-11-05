# Native storage epoch

Use for native canonical migration, session effect admission and owned OpenCode
services. Browser fallback and Host-owned persistence retain their own adapters.

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

## Conditional owner decisions

Recorded 2026-11-05 from owner messages in audit Codex thread
`01a1a5a6-d0a0-72d3-9776-38e8b3800c5c`; original message timestamps unavailable.

> o zaman böyle bir problemimiz yok herkes günceller eski sürümünü kullanmazlar

Mixed old/new application versions writing the same profile are unsupported after
migration. This does not authorize data deletion, installation or process stops.

> Hayır; OpenCode’u kullanmıyorum veya yalnız Bycoda içinden kullanıyorum

External OpenCode CLI/web use of the same conversation concurrently with Bycoda
is outside this migration's compatibility scope. Preserve provider history,
configuration and authentication; never adopt or stop unrelated external daemons.
