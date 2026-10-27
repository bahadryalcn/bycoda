import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
const bash =
  process.platform === "win32"
    ? join(process.env.ProgramFiles ?? "C:/Program Files", "Git/bin/bash.exe")
    : "/bin/bash";
const helper = fileURLToPath(new URL("./install-linux-deps-debian.sh", import.meta.url));
function run(t, phase, enabled = true, alwaysFail = false) {
  const root = mkdtempSync(join(tmpdir(), "bycoda-apt-fixture-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  mkdirSync(bin);
  const source = join(root, "original.sources");
  const original =
    "Types: deb\nURIs: http://azure.archive.ubuntu.com/ubuntu\nSuites: noble\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n";
  writeFileSync(source, original);
  writeFileSync(join(bin, "id"), '#!/bin/sh\nprintf "0\\n"\n', { mode: 0o755 });
  writeFileSync(
    join(bin, "apt-get"),
    `#!/bin/sh
set -eu
operation=""; source=""
for value in "$@"; do
  case "$value" in update|install) operation="$value";; Dir::Etc::sourcelist=*) source=$(printf '%s' "$value" | cut -d= -f2-);; esac
done
printf '%s\\n' "$operation" >> "$TEST_APT_LOG"
if [ -n "$source" ] && grep -q 'https://archive.ubuntu.com/ubuntu' "$source"; then printf 'https\\n' >> "$TEST_APT_LOG"; fi
if [ "$operation" = "$TEST_FAIL_PHASE" ] && { [ "$TEST_ALWAYS_FAIL" = true ] || [ ! -f "$TEST_FAILED_MARKER" ]; }; then
  touch "$TEST_FAILED_MARKER"; exit 73
fi
`,
    { mode: 0o755 },
  );
  const setup =
    process.platform === "win32"
      ? 'fake=$(cygpath -u "$TEST_FAKE_BIN"); export PATH="$fake:$PATH"; '
      : 'export PATH="$TEST_FAKE_BIN:$PATH"; ';
  const result = spawnSync(
    bash,
    [
      "-c",
      setup +
        'exec bash "$TEST_SOURCE_HELPER" --sources "$TEST_SOURCE_FILE"' +
        (enabled ? " --https-mirror-fallback" : ""),
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15000,
      env: {
        ...process.env,
        TEST_FAKE_BIN: bin,
        TEST_SOURCE_HELPER: helper,
        TEST_SOURCE_FILE: source,
        TEST_FAIL_PHASE: phase,
        TEST_ALWAYS_FAIL: String(alwaysFail),
        TEST_APT_LOG: join(root, "calls.log"),
        TEST_FAILED_MARKER: join(root, "failed"),
        TMPDIR: root.replaceAll("\\", "/"),
      },
    },
  );
  const calls = existsSync(join(root, "calls.log"))
    ? readFileSync(join(root, "calls.log"), "utf8").trim().split(/\r?\n/)
    : [];
  assert.equal(
    readFileSync(source, "utf8"),
    original,
    "system/source input must never be rewritten",
  );
  assert.deepEqual(
    readdirSync(root).filter((file) => file.startsWith("bycoda-apt-")),
    [],
    "fallback temp source removed",
  );
  return { result, calls };
}
test(
  "one measured update failure retries HTTPS once without changing the source",
  { skip: !existsSync(bash) },
  (t) => {
    const { result, calls } = run(t, "update");
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(calls, ["update", "update", "https", "install", "https"]);
  },
);
test(
  "package-download failure gets one HTTPS retry; repeat failure remains failure",
  { skip: !existsSync(bash) },
  (t) => {
    const { result, calls } = run(t, "install");
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(calls, ["update", "install", "update", "https", "install", "https"]);
    const failed = run(t, "update", true, true);
    assert.equal(failed.result.status, 73);
    assert.equal(failed.calls.filter((name) => name === "update").length, 2);
  },
);
test(
  "fallback remains opt-in and preserves the first failure status",
  { skip: !existsSync(bash) },
  (t) => {
    const { result, calls } = run(t, "update", false);
    assert.equal(result.status, 73);
    assert.deepEqual(calls, ["update"]);
  },
);
