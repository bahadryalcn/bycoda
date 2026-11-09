# agent-desktop integration provenance

The optional bycoda adapter targets Vercel Labs agent-desktop source commit
`9eb9b296192fcb70bda25e918cd6dd66abfa3d0d` and its JSON envelope version `2.5`.

- Source: https://github.com/vercel-labs/agent-desktop/tree/9eb9b296192fcb70bda25e918cd6dd66abfa3d0d
- License: Apache-2.0, copied unchanged to `LICENSE`.
- Adapter: `host/desktop/desktop-control-host.ts`.
- Wire contracts: `src/shared/model/host-contracts/desktop-control.ts`.

No upstream executable or agent skill is checked into this directory. The
optional preparation helper builds an artifact from the exact source commit;
preparing/importing it does not enable desktop control or change Host settings.

```sh
node scripts/setup/agent-desktop.mjs --plan
node scripts/setup/agent-desktop.mjs --prepare
node scripts/setup/agent-desktop.mjs --status
```

Preparation requires Git, the MSVC/Xcode/Linux C build tools for the current
platform, and Rust through rustup. It selects upstream's pinned Rust `1.89.0`
without changing the default toolchain, fetches only the exact Git commit,
checks the committed Cargo.lock and Apache license hashes, builds with
`cargo --locked --release`, then verifies the native `version` envelope.
Platform companions remain beside the CLI: the macOS accessibility helper and
Linux clipboard-owner helper are included in their respective artifacts.

The immutable artifact lives under
`~/.bycoda-build/helpers/agent-desktop/<commit>/<target>/`. Its `manifest.json`
records source/lock/license identity, compiler version and each packaged file's
SHA-256. Read-only discovery rechecks that complete manifest and every file;
PATH resolution alone is never trusted. An incompatible or modified artifact is
refused. Compiler output hashes identify that build; the build process is
reproducible from pinned inputs, without claiming bit-for-bit identical output
across different native linkers/SDKs.

Host packaging includes a verified prepared helper from the cache when present.
`node host/package.mjs --desktop-helper` requires it for every selected target;
`--desktop-helper-cache /absolute/cache` selects and requires a specific cache.
The package carries the executable, platform companions, license and manifest in
its `agent-desktop/` sibling directory. Packaged Host discovery verifies that
directory without Git or Rust. Preparing a helper remains an explicit action
when a package did not include one. No packaging action enables desktop input.

Importing a separately prepared/shipped artifact also needs no Git or Rust:

```sh
node scripts/setup/agent-desktop.mjs --import /path/to/prepared/bundle
```

The reusable module exports `desktopHelperPlan`, `prepareDesktopHelper`,
`readDesktopHelper`, `readDesktopHelperBundle`, `copyDesktopHelperBundle` and
`importDesktopHelper`. The Host may use the verified
result to populate the executable/hash fields, retaining the separate owner
enable action and app/physical-input permissions. Failed build workspaces and
compiler caches remain under the helper cache's `.work` directory; a busy or
unresolved preparation lock is reported instead of replaying another build.

For isolated development, `--cache-root temp/build/<task>/helpers` keeps artifacts
separate from installed app data. Production code uses the persistent default
cache or an explicitly supplied packaged artifact, never a source `temp/` path.
No command installs global packages, edits PATH, requests accessibility grants,
acquires microphone capture, or performs desktop input.

The npm/GitHub `1.0.2` release tag points to
`a47ed664e0db00d1d4df364eb3fe8a5599882f3c`, sixteen commits before this integration
pin. Equal CLI versions/protocols do not prove equal source. An existing release
binary must not be described as this exact pinned build. Native archives have
upstream release checksums and optional GitHub attestations; those are a separate
acquisition path from this source-pinned helper.

The adapter uses a private session namespace with tracing disabled and finite
argument arrays without a shell. Captures stay within the selected app/window.
Clipboard commands require exact native owner approval and bounded plain text.
Returned accessibility text is bounded,
returned only to the authorized caller, and excluded from operation receipts and
application logs. Snapshot refmaps use an instance-owned temporary directory
under private Host data, removed after its active children stop. A crashed
instance may leave its private cache for inspection.

## Windows release helper signing

`node host/package.mjs --desktop-helper --sign-desktop-helper` signs only the
verified copy under `build/host-packages/win32-<arch>/agent-desktop`, before the
Host archive and its checksum are created. Set `BYCODA_WINDOWS_SIGNING_CERT_SHA1`
to the exact certificate thumbprint already provisioned in the runner's Personal
certificate store. `BYCODA_WINDOWS_SIGNING_STORE` is `CurrentUser` by default or
explicitly `LocalMachine`. The private key remains in that store.

The Windows SDK SignTool uses SHA-256 and an RFC3161 timestamp, then verifies the
signature, selected signer and timestamp before updating the package manifest's
final binary hash. The pinned unsigned build cache and license stay unchanged.
An interrupted or unverifiable signature leaves an invalid package copy; rebuild
that copy rather than automatically replaying signing.

Stable Windows desktop packaging selects this path when the corresponding
repository variables are configured. Without a signing identity, CI explicitly
records the missing helper signing acceptance. Ordinary development and nonstable
packaging do not require a signing certificate. Updater signatures are separate
from Authenticode. Fixture tests do not establish a trusted certificate, actual
signed output, SmartScreen behavior or installed acceptance. SignTool options:
https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool

Review the pinned `README.md`, `docs/json-output.md` and
`skills/agent-desktop/references/commands-{observation,interaction,system}.md`
before changing flags, output parsing or delivery semantics.
