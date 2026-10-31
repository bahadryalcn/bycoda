/** Release integration contracts, evaluated offline: never dispatches or registers a runner. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  selectWindowsRunner,
  windowsHeavyConcurrencyGroup,
  windowsSelfHostedLabels,
} from "../checks/windows-runner-policy.mjs";
import { windowsContext } from "../checks/windows-runner-policy-fixtures.mjs";

const desktop = readFileSync(
  new URL("../../.github/workflows/desktop-package.yml", import.meta.url),
  "utf8",
);
const cache = readFileSync(
  new URL("../../.github/workflows/release-cache.yml", import.meta.url),
  "utf8",
);
function job(source, name) {
  const block = new RegExp(
    `^  ${name}:\\r?\\n([\\s\\S]*?)(?=^  [a-zA-Z][a-zA-Z0-9-]*:|$(?![\\s\\S]))`,
    "m",
  ).exec(source);
  assert(block, `Missing ${name} job`);
  return block[1];
}

test("trusted stable tags, nightly and manual package callers share the guarded Windows queue", () => {
  const contexts = [
    windowsContext({ workflow: "release.yml", job: "package", ref: "refs/tags/v0.6.94" }),
    windowsContext({
      workflow: "release-candidate.yml",
      job: "package",
      eventName: "workflow_dispatch",
    }),
    windowsContext({ workflow: "nightly-candidate.yml", job: "package", eventName: "schedule" }),
    windowsContext({
      workflow: "nightly-candidate.yml",
      job: "package",
      eventName: "workflow_dispatch",
    }),
  ];
  for (const context of contexts) {
    const input = { ...context, scope: "package" };
    assert.equal(selectWindowsRunner(input).runsOn, "windows-latest");
    assert.deepEqual(selectWindowsRunner({ ...input, enabled: "true" }), {
      selfHosted: true,
      runsOn: windowsSelfHostedLabels,
      concurrencyGroup: windowsHeavyConcurrencyGroup,
      reason: "trusted-workflow-source",
    });
    for (const eventName of [
      "pull_request",
      "pull_request_target",
      "workflow_run",
      "workflow_call",
    ])
      assert.equal(selectWindowsRunner({ ...input, enabled: "true", eventName }).selfHosted, false);
    assert.equal(
      selectWindowsRunner({ ...input, enabled: "true", repository: "fork/bycoda" }).selfHosted,
      false,
    );
  }
  for (const context of [
    windowsContext({
      workflow: "desktop-package.yml",
      job: "package",
      eventName: "workflow_dispatch",
    }),
    windowsContext({
      workflow: "release.yml",
      job: "package",
      ref: "refs/tags/v0.6.94",
      eventName: "workflow_dispatch",
    }),
    windowsContext({ workflow: "release-candidate.yml", job: "package" }),
    windowsContext({
      workflow: "release-candidate.yml",
      job: "package",
      ref: "refs/heads/feature",
      eventName: "workflow_dispatch",
    }),
  ])
    assert.equal(
      selectWindowsRunner({ ...context, scope: "package", enabled: "true" }).selfHosted,
      false,
    );
});

test("cache warming only accepts the trusted default branch and shares the package queue", () => {
  for (const eventName of ["push", "workflow_dispatch"]) {
    const context = windowsContext({ workflow: "release-cache.yml", job: "warm", eventName });
    assert.equal(
      selectWindowsRunner({ ...context, scope: "release-cache", enabled: "true" }).concurrencyGroup,
      windowsHeavyConcurrencyGroup,
    );
    for (const mutation of [
      { eventName: "pull_request" },
      { eventName: "schedule" },
      { workflowSha: "b".repeat(40) },
      { repositoryId: "1" },
      { ref: "refs/heads/feature" },
    ])
      assert.equal(
        selectWindowsRunner({ ...context, ...mutation, scope: "release-cache", enabled: "true" })
          .selfHosted,
        false,
      );
  }
});

test("hosted planning cannot execute package source or supply signing secrets", () => {
  for (const [source, scope] of [
    [desktop, "package"],
    [cache, "release-cache"],
  ]) {
    const planning = job(source, "windows-route");
    assert.match(planning, /runs-on: ubuntu-latest/);
    assert.match(planning, /ref: \$\{\{ github\.workflow_sha \}\}/);
    assert.match(planning, /persist-credentials: false/);
    assert.match(planning, /install: "false"/);
    assert.match(
      planning,
      /WINDOWS_SELF_HOSTED_OPT_IN: \$\{\{ vars\.BYCODA_WINDOWS_SELF_HOSTED \}\}/,
    );
    assert(planning.includes(`windows-runner-policy.mjs --scope ${scope} --github-output`));
    assert(!/secrets\.|pnpm (?:exec|install|run)|inputs\.expected-sha|self-hosted/.test(planning));
  }
});

test("Windows package and warm jobs require isolation, clean checkouts and noncancelling bounded queues", () => {
  for (const [source, name, platform] of [
    [desktop, "package", "windows-x64"],
    [cache, "warm", "windows-latest"],
  ]) {
    const heavy = job(source, name);
    assert.match(
      heavy,
      name === "package" ? /needs: \[windows-route, common-build\]/ : /needs: windows-route/,
    );
    assert(
      heavy.includes(
        `matrix.platform == '${platform}' && fromJSON(needs.windows-route.outputs.windows_runs_on)`,
      ),
    );
    assert.match(
      heavy,
      /concurrency:[\s\S]*windows_self_hosted == 'true'[\s\S]*windows_concurrency_group[\s\S]*cancel-in-progress: false\r?\n\s+queue: max/,
    );
    assert.match(heavy, /-Mode Verify -Purpose package -ExportEnvironment/);
    assert(heavy.indexOf("-Purpose package") < heavy.indexOf("uses: dtolnay/rust-toolchain@"));
    assert.match(
      heavy,
      /uses: Swatinem\/rust-cache@[^\r\n]+\r?\n\s+if: matrix\.platform != 'windows[^']*' \|\| needs\.windows-route\.outputs\.windows_self_hosted != 'true'/,
    );
    assert(
      !/clean: false|ACTIONS_RUNNER_HOOK_JOB_STARTED:|windows-runner\.ps1[^\r\n]+-(?:Register|Run)|continue-on-error:/.test(
        heavy,
      ),
    );
  }
  // All non-Windows variants retain the matrix's hosted runner fallback.
  assert.match(
    desktop,
    /fromJSON\(needs\.windows-route\.outputs\.windows_runs_on\) \|\| matrix\.runner/,
  );
  assert.match(
    cache,
    /fromJSON\(needs\.windows-route\.outputs\.windows_runs_on\) \|\| matrix\.platform/,
  );
});

test("routing preserves signed-tag, immutable-source and actual native-smoke publication prerequisites", () => {
  const planningGate = job(desktop, "windows-route").match(
    /    if: >-\r?\n([\s\S]*?)    runs-on:/,
  )?.[1];
  const packageGate = job(desktop, "package").match(/    if: >-\r?\n([\s\S]*?)    strategy:/)?.[1];
  assert.equal(planningGate, packageGate);
  assert.match(
    packageGate,
    /inputs\.channel == 'stable' && github\.event_name == 'push' && startsWith\(github\.ref, 'refs\/tags\/v'\)/,
  );
  assert.match(
    packageGate,
    /inputs\.channel != 'stable' && \(github\.event_name == 'workflow_dispatch' \|\| github\.event_name == 'schedule'\)/,
  );
  const heavy = job(desktop, "package");
  assert.match(heavy, /ref: \$\{\{ inputs\.expected-sha \}\}/);
  assert.match(heavy, /ref: \$\{\{ inputs\.tooling-sha \|\| github\.workflow_sha \}\}/);
  assert.match(heavy, /assert\.equal\(candidate\.sha,process\.env\.EXPECTED_SHA\)/);
  assert.match(heavy, /prepare-candidate\.mjs --verify/);
  assert.match(heavy, /cargo_target=\(--cargo-target-dir "\$CARGO_TARGET_DIR"\)/);
  assert.match(
    heavy,
    /if: inputs\.channel == 'stable'[\s\S]*TAURI_SIGNING_PRIVATE_KEY: \$\{\{ secrets\.TAURI_SIGNING_PRIVATE_KEY \}\}/,
  );
  assert.match(heavy, /if: inputs\.channel != 'stable'\r?\n\s+run: pnpm exec tauri build/);
  assert(heavy.indexOf("package-smoke.mjs") < heavy.indexOf("package-manifest.mjs attach-smoke"));
  assert(
    heavy.indexOf("package-manifest.mjs attach-smoke") <
      heavy.indexOf("uses: actions/upload-artifact@"),
  );
  assert.match(heavy, /\.json\.evidence\/\*\*/);
});
