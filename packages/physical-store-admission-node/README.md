# Private physical-store admission Node port

This package exposes the existing Rust mechanical kernel to standalone Node.
It opens an existing regular physical file, retains its real OS identity, and
owns writer/closing/closed lock handles. It has no GUI, Host domain, SQLite,
profile discovery or application permission dependency. A path and its identity
data are **not** proof about a separate SQL connection, actor enrollment,
complete writer inventory, durability or checkpoint completion.

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

## Build and exercise without a Node CLI

Root owns workspace membership, lockfiles and the sole Cargo lane. Exact pinned
Rust dependencies are napi3.15.0 (default off, napi8 + dyn-symbols),
napi-derive3.6.13 (default off, strict only; no source type generation),
napi-build2.6.0 and the local physical-store-admission kernel. No JS dependency
or napi/pnpm build CLI is required. ABI8 fits the standalone Node target policy.

```text
cargo build --locked -p bycoda-physical-store-admission-node --lib --target-dir temp/build/2026-10-30-physical-store-admission-node
cargo build --locked -p bycoda-physical-store-admission-node --features test-probe --bin physical-admission-probe --target-dir temp/build/2026-10-30-physical-store-admission-node
```

Copy the produced DLL/dylib/so to an explicit `.node` artifact in the ignored
build directory. Do not put binaries in this source package. Then set explicit
test-only absolute paths `BYCODA_PHYSICAL_ADMISSION_ADDON` and
`BYCODA_PHYSICAL_ADMISSION_PROBE`, and run:

```text
node --expose-gc --test --test-timeout=15000 packages/physical-store-admission-node/tests/admission.test.mjs
```

The probe is feature-gated test support, not part of a normal library build or
shipped UI. Tests use real OS locks and actual Node GC, Worker environment exit
and a child process. They compare independent Rust probe contention, drain and
close/refuse semantics, immutable opaque ownership, double release, hardlinks,
lost-token retention and bounded native capacity. Fresh files/evidence remain
under temp/verification/2026-10-30-host-notes-writer/node-port. They use no live
database/profile and make no SQL-attestation, enrolled-Host, installed or
six-platform execution claim merely from compiling this source.
