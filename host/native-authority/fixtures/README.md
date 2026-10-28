This Node child fixture exercises helper-client stream and lifecycle handling with real piped processes. It deliberately emits malformed frames, stalls or delays exit. It never connects to a Windows native pipe or supplies actor/domain authority. Fault modes and optional audit paths are selected only by trusted test spawn composition. These tests do not establish native executable, installed app or Node-to-native acceptance.

`source-helper.mjs` and `retained-helper.mjs` model closed source registration,
status and retained-byte messages for Node lifecycle and fault tests. They use
actual child streams but simulate the native source and its fences. The separate
opt-in `native-source-integration.test.ts` copies a freshly compiled Rust unit-test
executable, opens a real isolated native Store and uses actual Windows private
pipes. Its explicit seeded fence is test-only; it does not exercise an installed
GUI or qualify production writers, actor enrollment or authority transfer.
