# Assistant native admission

Room source identity, paired-device authentication and a native installation's
authority are separate. A paired owner token does not prove that a particular
native window reviewed an operation. Privileged Room delegation and visibility
transitions therefore use an independently provisioned native signing key.

## Provisioning

Trust is empty by default. The desktop keeps its Ed25519 private key in its
private native profile and exports only installation identity, public key and
fingerprint. Native signing is internal to reviewed operations; there is no
renderer command for signing arbitrary data. No model/tool output or incoming
message can enroll a key.

The Host owner independently reviews the installation, exact Host ID and SPKI
SHA-256 fingerprint. The local Host CLI provides these commands:

- `native-admission-preview-enroll`
- `native-admission-enroll`
- `native-admission-preview-revoke`
- `native-admission-revoke`

Use `--data-dir`, `--host-id` and `--installation-id`; enrollment also takes
`--public-key` with a public PEM file. Preview returns the exact destination,
public key, fingerprint, registry revision and proposal hash. Applying requires
that same `--reviewed-hash` and `--revision`; a changed proposal or registry must
be reviewed again. These commands are local owner operations, not paired-device
RPCs. This document grants no enrollment or installation permission.

The default file is `native-admission-registry.json` in the Host data directory.
`BYCODA_NATIVE_ADMISSION_REGISTRY` selects an explicitly configured path. Keep
the directory OS-private. An absent default registry grants nothing; corrupt or
invalid configuration fails closed. A selected explicit path must exist.

## Operation proof and revocation

The Host issues a bounded, single-use challenge with its Host identity,
installation identity, action, exact request digest, random nonce and expiry.
The native coordinator verifies the current Room/window issuer and exact target,
shows the required review, and signs the challenge. The Host independently hashes
the raw operation string and parses only those signed bytes. Reuse, altered
payload, wrong Host/installation, expired challenge or unknown key is refused.

`NativeAdmissionOwner` reloads registry state. Registry generation changes
invalidate pending proofs, including revoke followed by reenrollment of the same
key. Delayed effects also retain the captured registry revision.

Supported CLI writers and `withEffect` use the same registry lock. The Host
rechecks authority under that lock and holds it until the canonical effect
settles. Never release it because an observer timed out while physical work
continues. Do not perform user approval, relay waits or recursively acquire the
same lock inside the effect. Lock acquisition is bounded; inability to acquire
does not prove an operation stopped or a revocation completed.

Do not manually edit the registry or remove its lock while a Host/effect is
active. Such writes bypass the supported ordering protocol. A leftover lock
requires owner recovery after confirming no live effect; PID alone is not
settlement evidence. Keep uncertain receipts and original operation identities.

## Owners and acceptance

The Room Browser panel uses `control_room_browser_panel_request` and the private
`native.services.assistant.browser.panel` HTTP operation. It retains the actual
Room thread, project CWD, invoking Native device and privacy admission until the
response is written. Browser input keeps its original operation ID after unknown
delivery. A preview has separate page-readiness and mounted-panel acknowledgements.

Summary generation and artifact commit qualify their source separately. Project
summaries retain exact project/CWD proofs; account-only summaries use signed
`privacy.account.capture` from the actual Global Room window and exact account
grant versions. No project or coding session is synthesized for account access.

Host verification: `host/assistant/native/assistant-native-admission.ts`.
Owner CLI: `host/native-admission-cli.ts`, `host/native-admission-lock.ts`.
Source/target coordination: `host/assistant/room/assistant-room-native-adapter.ts`,
`host/assistant/room/assistant-room-native-target.ts`, `host/assistant/room/assistant-room-delegation.ts`.
Native coordinator: `src-tauri/src/assistant/assistant_room_delegation.rs`.

Account voice output retains a durable lease for its real Host, Room thread,
provider generation, original paired device and account grant versions. Grant
withdrawal blocks new access immediately and persists requested permissions
before waiting for old output to retire. A failed wait or Host restart must not
restore the old permission. The owner can inspect and retry that pending change.

The private retirement relay is claimable only by the original device. Native
code pins the actual physical window issuer, waits for its exact generation to
close and signs the exact Host challenge afterward. Closing may unregister the
Room source; a replacement window or source cannot attest the old generation.
The frontend waits for actual WebSocket, audio and local-resource closure;
calling `close` alone is not a receipt. Ordinary disconnects retain bounded
closed-generation tombstones for acknowledgement recovery.

This protocol does not prove a provider erased previously disclosed data.
Desktop restart or eviction of an old frontend tombstone can leave retirement
unconfirmed. That state remains held; it is not evidence that an old connection
is still running or that closure completed. Durable native closure recovery is
separate from the in-memory frontend registry.

Source owners: `host/assistant/voice/assistant-voice-retirement.ts`,
`src-tauri/src/voice_generation_retirement.rs` and
`src/features/voice/model/voiceGenerationRetirement.ts`.

Cryptographic fixtures, source checks, native compilation, actual enrollment,
installed native dialogs and live remote effects are distinct evidence. The task
handoff records which routes are wired and which privacy guards remain missing.
