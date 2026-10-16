# Read-only performance measurement

Run `node scripts/checks/measure-performance.mjs --help` with Node 22 or newer.
The maintained tool belongs to `scripts/checks/` under `.artifact`. It uses OS
queries, never starts or stops application/provider processes, never sends a turn,
and never reads the session database or saves process arguments/environment.
Windows collectors run with hidden windows. Run shell commands through ConPTY
(`tty=true`) in agent sessions.

## Baseline and subsequent measurements

```powershell
node scripts/checks/measure-performance.mjs --seconds 30 --phase active --label baseline --output temp/verification/2026-10-15-perf-j3/baseline.json
node scripts/checks/measure-performance.mjs --seconds 30 --phase active --label after --compare temp/verification/2026-10-15-perf-j3/baseline.json --output temp/verification/2026-10-15-perf-j3/after.json
```

Output paths are exclusive-create: use a new filename for every run. Do not
overwrite another session's evidence. Baseline is the state of installed/running
processes, which may differ from the source revision/version recorded for context.
Capture the installed build, workload and enabled features in `--label`.
The sampler includes all discovered bycoda instances on this machine, including
development instances. Use the saved PID tree to identify the measured scope.

For idle CPU, wait until the owner-controlled workload is idle and run the same
command with `--phase idle`. For active CPU, measure an existing real workload
with `--phase active`. `observed` is the default when state is uncertain. Labels
are assertions by the operator, not workload detection. Do not stop running
sessions to obtain idle data. CPU samples are cumulative process-time deltas;
100% `oneCorePercent` means one logical core, while `machinePercent` divides by
the reported logical CPU count. First samples and unaccounted new/reused PIDs yield null.
Processes born within an interval contribute their lifetime CPU time.
The sampling interval is a delay after collection; actual intervals and collector
cost are recorded. Use at least 15–30 seconds and the same settings on both runs.

`summary` contains mean/min/max/p95 and valid sample counts; `samples` preserves
the measured PID/PPID/name/start identity, group membership and counters. Total
memory counts each process once, with host/app/webview/provider/MCP/other roles.
Session totals include the provider CLI, its MCP subtrees and other descendants;
shared host MCPs remain outside sessions. Session values describe separate
outermost provider process trees, not saved conversations or marginal RAM per
additional session. The source tree and running build are separate evidence.

Auto-discovery recognizes direct host `serve` commands and native app roots.
Only executable/script argument positions classify processes; embedded host
commands in provider configuration do not make the provider a host. New providers,
unknown launchers and detached WebKit/MCP processes may require explicit roots:

```powershell
node scripts/checks/measure-performance.mjs --root host:1234 --session conversation-id:5678 --mcp 9012 --output temp/verification/2026-10-15-perf-j3/attributed.json
```

Mappings are pinned to PID and creation time during a run. Pass the outermost
provider wrapper PID to include wrapper overhead. A shared provider server cannot
be honestly split across conversations from OS counters alone. Explicit session
IDs are optional labels; do not put credentials in labels. Detached processes need
manual attribution; this tool cannot establish completeness across inaccessible
accounts. Review role assignments before comparing unfamiliar configurations.

## Memory semantics

- Windows: `Win32_PerfRawData_PerfProc_Process.WorkingSetPrivate`, resident private
  working set in bytes. Private commit (`PrivatePageCount`) is not substituted.
- Linux: `/proc/<pid>/smaps_rollup` PSS, kB converted to bytes. The process clock
  comes from `getconf CLK_TCK` and `/proc/stat`, rather than an assumed tick rate.
  Read permissions are required; unavailable counters remain null.
- macOS: native `ps`/`vmmap` do not expose Linux-style PSS. CPU and process trees
  are collected, but PSS is null with an explicit limitation. RSS or physical
  footprint is not equivalent and is not relabelled as PSS. macOS is not a
  verified PSS backend.

A group with any unavailable memory counter has `memory.bytes: null`;
`measuredBytes` is its known lower bound. Short-lived processes between snapshots
are missed. Sampling itself can affect CPU; the sampler and its child collectors
are excluded from totals. Shared memory makes Windows private working set and
Linux PSS unsuitable for direct ratios against one another.
`measuredMemoryBytes` and `measuredCpuMachinePercent` summaries retain known lower
bounds when counters are incomplete; use the strict values for ordinary comparisons.

## Host process cold start and first frame

Before a future owner-controlled natural launch, run:

```powershell
node scripts/checks/measure-performance.mjs --watch-startup-ms 60000 --data-dir C:/Users/example/.bycoda-host --output temp/verification/2026-10-15-perf-j3/startup.json
```

The observer waits for a new PID in `running.json`, verifies its OS creation time
and host role, and measures creation to descriptor observation. Host CLI publishes
that descriptor after `listen()`. The report includes polling bounds. This is a
process-cold readiness proxy: filesystem cache state is uncontrolled, and provider
readiness is a separate event. The descriptor secret is never emitted. The sampler
does not restart the current host, launch an isolated host, or flush caches. If no
new launch occurs, startup remains unavailable. Existing uptime is not startup
latency. Resource sampling begins after the startup observation window.

Native compositor first-frame timing is unavailable without platform tracing.
If the app already exposes local CDP, optional `--cdp-url` and exact `--page-url`
read existing PerformancePaintTiming through the repository's Playwright. This
does not enable debugging, navigate, reload, or launch a browser. The result is
`browserPaint` (navigation to first paint), not native launch-to-first-frame;
`firstFrame` remains unavailable. No guessed startup timing enters the comparison.

## jcode reference and interpretation

The [jcode author's published table](https://github.com/1jehuang/jcode#performance--resource-efficiency)
reports **27.8 MB PSS for one active session with local embedding disabled** and
**14.0 ms to the first terminal frame**. These are the author's own measurements,
not independently reproduced by this tool. The default embedding-enabled figure,
feature set and multi-session sharing differ. Keep the author's stated MB unit;
this sampler stores bytes and derived reports must label MB versus MiB explicitly.

Use a side-by-side table with these qualifications. A full native app, WebViews,
host, provider CLIs and MCPs are a broader scope than one terminal harness. Do not
compute a speedup ratio from Windows private working set versus jcode PSS or from
host readiness/browser paint versus terminal first frame. `--compare` only emits
total deltas when schema, OS, metric and phase match; matching workload, machine,
build and process population still require review. Idle and active need separate
baselines. Cross-platform validation and release acceptance remain separate from
local Windows evidence.

Focused checks: `node --test scripts/checks/measure-performance.test.mjs`.
