# Native snapshot converter fixture

`native-snapshot-v1.json` is a sanitized derivative of the actual retained
snapshot captured on 2026-10-28 through the Rust fixture's real SessionStore,
private Windows pipe, real native helper child and Node source registry. The
original local evidence is
`temp/verification/2026-10-28-native-target/native-snapshot-capture.json` and
`root-native-source-capture.log`. This maintained fixture does not depend on
those ignored files at test time.

The working-directory path, timestamps and environment/profile/store identities
were replaced with stable fixture values. Transcript text, block payloads and
the native SQL-row layout remain the captured values. `sourceJson` was rebuilt
after those replacements and `sourceDigest` recomputed. `evidenceDigest` is an
explicit all-zero placeholder: this file is not an authenticated native fence,
actor qualification, Complete cohort proof or installed-app acceptance.

Rich metadata and negative converter tests derive additional synthetic cases
from this source shape and label those cases separately. Integration acceptance
uses the current actual native producer; this static fixture tests deterministic
conversion and preservation rather than authenticity.
