# Private physical-store admission Node port

API2 exposes the Rust mechanical kernel to standalone Node and a narrow Windows
SQLite connection-identity extension from the SAME trusted `.node` image.
Mechanical bindings retain a real regular file and own writer/closing/closed
lock handles. The separate SQL function uses the actual SQLite connection HANDLE.
There is no GUI, Host-domain, profile discovery or application permission
dependency, and no separate SQLite engine is linked. File/path metadata alone
is not SQL connection proof. Neither API claims actor enrollment, complete writer
inventory, durability or checkpoint completion.

`loadPhysicalStoreAdmission(absoluteArtifact)` loads exactly one explicitly
supplied trusted `.node` file. There is no environment/profile/package binary
search and no source/native fallback. The private Host adapter is responsible
for supplying its reviewed packaged artifact and protected common registry root.
All cooperative participants must use that root and kernel protocol. Root ACL
policy and uncooperative namespace replacement remain the kernel's documented
caller assumptions. The file open is mechanical, not a new file-access grant.

## Private API and actual-job ownership

```js
const native = loadPhysicalStoreAdmission(explicitAbsoluteArtifact);
const registry = native.openRegistry(protectedRegistryRoot);
const store = registry.bindFile(existingDatabasePath);
const identityData = store.identity(); // { nativeFormat, links: bigint }, no SQL proof
const writer = store.tryWriter(); // native opaque handle, or null if busy
// The actual Host job must retain store + writer past public timeout/drop.
// ONLY its real terminal-close or Worker EXIT observer may do:
store.releaseWriter(writer);
```

`tryBeginClose()` closes new mechanical ingress independently of old writer
drain. `tryUpgrade(closing)` returns a Closed handle or null while busy. Every
error retains the SAME original Closing record; there is no unlock gap. After
success the original Closing handle cannot release the resulting Closed state.
`releaseClosing` and `releaseClosed` are distinct explicit operations.

Native class backing identities are private: no constructors, slot fields,
serialized release IDs, generic clear, caller Boolean settle, cancellation,
retry or automatic replay. Handles must match the exact owner and binding that
created them; wrong/type-confused/unknown/double release fails. Hardlink aliases
share the kernel's physical contention domain but remain separate binding
objects for release ownership.

Live kernel guards and their binding are held strongly in a process-native
registry, bounded at64 per owner and256 per loaded process addon image. Capacity
rejects new work without evicting old records. Checked u64 opaque counters never
wrap. Poisoned state fails closed. JS handle GC, dropped public Promises and
Node environment cleanup do not release a live writer or fence. The addon image
is pinned for process lifetime on Windows/Linux/macOS so worker unload cannot
destroy or reset that registry. The private host must load the one canonical
artifact; arbitrary copies/independent nonparticipants are not a discovery or
security boundary.

Lost tokens intentionally remain held until process death. There is no recovery
by claimed ID. Therefore the later Host adapter should own reservations in a
surviving coordinator environment and retain the real job's opaque token until
its actual terminal or EXIT; a worker environment that disappears with the only
token leaves conservative unknown ownership. Process death closes OS handles
after all in-process SQL worker threads die. This package itself cannot certify
that a caller's explicit release corresponds to SQL close; Host integration is
separate and is not implemented or claimed here.

## API2 actual SQLite connection identity

The loader requires ABI2 and the new exports. A trusted ABI1 image is refused
rather than silently falling back. `registryRootForDatabase` delegates to the
shared Rust kernel helper: a canonical absolute database path maps to its
parent/.bycoda-physical-admission-v1. Derivation performs no SQL or grant and
does not establish the caller's canonical/profile provenance.

`sqliteExtensionEntryPoint()` is exactly `sqlite3_bycodaphysical_init`.
`connectionAttestationSupported()` currently returns true only on Windows.

```js
const database = new DatabaseSync(canonicalPath, {
  readOnly: true,
  allowExtension: true,
});
database.loadExtension(explicitAbsoluteArtifact, native.sqliteExtensionEntryPoint());
database.enableLoadExtension(false);
const row = database.prepare("SELECT bycoda_connection_identity() AS value").get();
const data = JSON.parse(row.value); // { version:1, physicalFileId, links }
```

The direct-only, nondeterministic SQL function uses the actual sqlite3* supplied
by SQLite, targets only main, obtains WIN32_GET_HANDLE and reads full FILE_ID_INFO
plus current links on that borrowed regular disk HANDLE. It never closes/exposes
the original HANDLE or substitutes a pathname stat. No SQL mutation or mechanical
writer allocation occurs. Memory DBs, unsupported VFS/file identity and Unix init
refuse explicitly. HAS_MOVED is not used as false proof. A later Host factory
must attest its actual writable connection and retain its real job ownership.

Only unmodified SQLite3.53.2 public headers are vendored, with attribution and
exact hashes. The host SQLite library supplies all API functions. Per-connection
required-function tables and destructors avoid private object layouts or a mutable
global SQLite API table. Sixteen synchronized immutable engine-specific userdata
bootstrap slots recover the right context across connections/libraries. The entry
pins this image independently of NAPI registry creation, preserving callbacks
through environment cleanup. SQLite destroys matching contexts on function
replacement, registration failure and connection close.

This is an identity prerequisite. Host registration, actual-job handoff, Native
cohort integration and unjoined-platform behavior remain separate adapters.

## Build and exercise without a Node CLI

Root owns workspace membership, lockfiles and the sole Cargo lane. Exact pinned
Rust dependencies are napi3.15.0 (default off, napi8 + dyn-symbols),
napi-derive3.6.13 (default off, strict only; no source type generation),
napi-build2.6.0, cc1.10.0 and the local physical-store-admission kernel. No JS dependency
or napi/pnpm build CLI is required. ABI8 fits the standalone Node target policy.

```text
cargo build --locked -p bycoda-physical-store-admission-node --lib --target-dir temp/build/2026-10-30-physical-store-admission-node
cargo build --locked -p bycoda-physical-store-admission-node --features test-probe --bin physical-admission-probe --target-dir temp/build/2026-10-30-physical-store-admission-node
```

Copy the produced DLL/dylib/so to an explicit `.node` artifact in the ignored
build directory. Do not put binaries in this source package. Then set explicit
test-only absolute paths `BYCODA_PHYSICAL_ADMISSION_ADDON` and
`BYCODA_PHYSICAL_ADMISSION_PROBE`, plus preserved actual ABI1 image
`BYCODA_PHYSICAL_ADMISSION_API1_ADDON`, and run:

```text
node --expose-gc --test --test-timeout=15000 packages/physical-store-admission-node/tests/admission.test.mjs packages/physical-store-admission-node/tests/sqlite-identity.test.mjs
```

The probe is feature-gated test support, not part of a normal library build or
shipped UI. Tests use real OS locks and actual Node GC, Worker environment exit
and a child process. They compare independent Rust probe contention, drain and
close/refuse semantics, immutable opaque ownership, double release, hardlinks,
lost-token retention and bounded native capacity. The second file exercises real
DatabaseSync loading, independent contexts, readonly/closed/memory cases, links,
refused extra loading, Worker cleanup and actual ABI1 rejection. Fresh evidence remains
under temp/verification/2026-10-30-host-notes-writer/node-port. They use no live
database/profile. Actual Windows SQL identity results are scoped to the tested
artifact/runtime. There is no enrolled-Host, installed or six-platform execution
claim merely from compiling this source.
