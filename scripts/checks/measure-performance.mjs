#!/usr/bin/env node
// Read-only process sampling. Never starts/stops an application, provider or service.
import { execFile } from "node:child_process";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { cpus, hostname, homedir, platform, release } from "node:os";
import { resolve, dirname, basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { parseProcessJson } from "../../host/parse-process-json.mjs";

const exec = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = fileURLToPath(new URL("../../", import.meta.url));
const samplerSha256 = createHash("sha256")
  .update(await readFile(fileURLToPath(import.meta.url)))
  .digest("hex");
const roles = ["host", "app", "webview", "provider", "mcp", "other"];
const finite = (v) => (Number.isFinite(v) ? v : null);
const unavailable = (reason) => ({ status: "unavailable", valueMs: null, reason });

export function argumentsFor(argv) {
  const options = {
    seconds: 15,
    intervalMs: 1000,
    phase: "observed",
    label: "snapshot",
    roots: [],
    sessions: [],
    mcps: [],
    watchStartupMs: 0,
    dataDir: join(homedir(), ".bycoda-host"),
  };
  const names = new Map([
    ["--seconds", "seconds"],
    ["--interval-ms", "intervalMs"],
    ["--phase", "phase"],
    ["--label", "label"],
    ["--output", "output"],
    ["--compare", "compare"],
    ["--watch-startup-ms", "watchStartupMs"],
    ["--data-dir", "dataDir"],
    ["--cdp-url", "cdpUrl"],
    ["--page-url", "pageUrl"],
  ]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help") return { help: true };
    const value = argv[++i];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    if (arg === "--root" || arg === "--session") {
      const match = /^(.*):(\d+)$/.exec(value);
      if (!match || !match[1] || Number(match[2]) < 1) throw new Error(`Expected ${arg} name:pid`);
      if (arg === "--root" && !roles.includes(match[1])) throw new Error("Unknown root role");
      options[arg === "--root" ? "roots" : "sessions"].push({
        name: match[1],
        pid: Number(match[2]),
      });
    } else if (arg === "--mcp") {
      if (!/^\d+$/.test(value) || Number(value) < 1) throw new Error("Invalid MCP PID");
      options.mcps.push(Number(value));
    } else if (names.has(arg)) options[names.get(arg)] = value;
    else throw new Error(`Unknown option ${arg}`);
  }
  for (const key of ["seconds", "intervalMs", "watchStartupMs"])
    options[key] = Number(options[key]);
  if (
    !(options.seconds > 0 && options.seconds <= 3600) ||
    !(options.intervalMs >= 100 && options.intervalMs <= 60000) ||
    !(options.watchStartupMs >= 0 && options.watchStartupMs <= 3600000)
  )
    throw new Error("Invalid sampling duration/interval");
  if (!["observed", "idle", "active"].includes(options.phase))
    throw new Error("phase must be observed, idle or active");
  options.output ??= `temp/verification/2026-10-15-perf-j3/${new Date().toISOString().replaceAll(":", "-")}-${options.phase}.json`;
  return options;
}

// Inspect only executable/script positions. Provider configs can contain entire host commands.
export function commandRole(p) {
  const tokens = [...(p.command ?? "").matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(
    (m) => m[1] ?? m[2] ?? m[3],
  );
  const name = basename(p.name.replaceAll("\\", "/")).toLowerCase();
  const script = basename((tokens[1] ?? "").replaceAll("\\", "/")).toLowerCase();
  const verb = tokens[2];
  if (/^(bycoda|monocode)(\.exe)?$/.test(name)) return "app";
  if (/^(node|nodejs|bun)(\.exe)?$/.test(name)) {
    if (/^(host|bycoda-host)\.mjs$/.test(script)) {
      if (verb === "serve") return "host";
      if (/^(social|runtime-logs|conversation)-mcp$/.test(verb ?? "")) return "mcp";
    }
    if (
      script === "provider-guard.mjs" ||
      /^(codex|claude|gemini|opencode|copilot)(\.[cm]?js)?$/.test(script)
    )
      return "provider";
    if (/mcp/i.test(script)) return "mcp";
  }
  if (/^(codex|claude|gemini|opencode|copilot)(\.exe)?$/.test(name)) return "provider";
  if (/msedgewebview2|webkit(web|network|gpu)process|com\.apple\.webkit/i.test(name))
    return "webview";
  if (/mcp/i.test(name)) return "mcp";
  return "other";
}

async function run(file, args) {
  const { stdout } = await exec(file, args, {
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    encoding: "utf8",
  });
  return stdout.trim().replace(/^\uFEFF/, "");
}

// WorkingSetPrivate is resident private RAM, NOT PrivatePageCount (commit bytes).
const windowsQuery = String.raw`
$ErrorActionPreference = 'Stop'
$counters = @{}
Get-CimInstance Win32_PerfRawData_PerfProc_Process | ForEach-Object { $counters[[int]$_.IDProcess] = $_ }
$rows = @(Get-CimInstance Win32_Process | ForEach-Object {
  $counter = $counters[[int]$_.ProcessId]
  [pscustomobject]@{
    pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId; name = $_.Name; command = $_.CommandLine
    startedAt = $(if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { $null })
    cpuMs = $(if ($null -ne $_.UserModeTime -and $null -ne $_.KernelModeTime) { ([double]$_.UserModeTime + [double]$_.KernelModeTime) / 10000 } else { $null })
    memoryBytes = $(if ($null -ne $counter -and $null -ne $counter.WorkingSetPrivate) { [double]$counter.WorkingSetPrivate } else { $null })
  }
})
ConvertTo-Json -InputObject $rows -Compress
`;

export function linuxStat(text, ticks, bootMs) {
  const end = text.lastIndexOf(")");
  const f = text
    .slice(end + 2)
    .trim()
    .split(/\s+/);
  return {
    ppid: Number(f[1]),
    cpuMs: ((Number(f[11]) + Number(f[12])) * 1000) / ticks,
    startedAt: new Date(bootMs + (Number(f[19]) * 1000) / ticks).toISOString(),
  };
}

let linuxClock;
export async function snapshot() {
  const started = performance.now();
  let processes;
  if (platform() === "win32") {
    processes = parseProcessJson(
      await run("powershell.exe", [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        windowsQuery,
      ]),
    );
  } else if (platform() === "linux") {
    if (!linuxClock) {
      const [stat, ticks] = await Promise.all([
        readFile("/proc/stat", "utf8"),
        run("getconf", ["CLK_TCK"]),
      ]);
      linuxClock = {
        bootMs: Number(/^btime (\d+)$/m.exec(stat)?.[1]) * 1000,
        ticks: Number(ticks),
      };
      if (!linuxClock.bootMs || !linuxClock.ticks)
        throw new Error("Cannot determine Linux process clock");
    }
    const pids = (await readdir("/proc")).filter((p) => /^\d+$/.test(p));
    processes = (
      await Promise.all(
        pids.map(async (pid) => {
          try {
            const [stat, cmd, comm] = await Promise.all([
              readFile(`/proc/${pid}/stat`, "utf8"),
              readFile(`/proc/${pid}/cmdline`, "utf8"),
              readFile(`/proc/${pid}/comm`, "utf8"),
            ]);
            let memoryBytes = null;
            try {
              memoryBytes =
                Number(
                  /^Pss:\s+(\d+) kB$/m.exec(
                    await readFile(`/proc/${pid}/smaps_rollup`, "utf8"),
                  )?.[1],
                ) * 1024;
            } catch {
              /* permissions / exit */
            }
            // Preserve argument boundaries for script detection without retaining argv in output.
            const command = cmd
              .split("\0")
              .filter(Boolean)
              .map((v) => `"${v.replaceAll('"', "")}"`)
              .join(" ");
            return {
              pid: Number(pid),
              name: comm.trim(),
              command,
              ...linuxStat(stat, linuxClock.ticks, linuxClock.bootMs),
              memoryBytes: finite(memoryBytes),
            };
          } catch {
            return null;
          }
        }),
      )
    ).filter(Boolean);
  } else if (platform() === "darwin") {
    const text = await run("ps", ["-axo", "pid=,ppid=,lstart=,time=,comm="]);
    processes = text
      .split("\n")
      .map((line) => {
        const m = /^\s*(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+[\d:]+\s+\d+)\s+(\S+)\s+(.*)$/.exec(line);
        if (!m) return null;
        const t = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(m[4]);
        return {
          pid: Number(m[1]),
          ppid: Number(m[2]),
          startedAt: new Date(m[3]).toISOString(),
          cpuMs: t
            ? (((Number(t[1] ?? 0) * 24 + Number(t[2] ?? 0)) * 60 + Number(t[3])) * 60 +
                Number(t[4])) *
              1000
            : null,
          name: basename(m[5]),
          command: "",
          memoryBytes: null,
        };
      })
      .filter(Boolean);
    // Read argv separately: never include arguments or tokens in saved JSON.
    const args = await run("ps", ["-axo", "pid=,args="]);
    const commands = new Map(
      args
        .split("\n")
        .map((line) => /^\s*(\d+)\s+(.*)$/.exec(line))
        .filter(Boolean)
        .map((m) => [Number(m[1]), m[2]]),
    );
    for (const p of processes) p.command = commands.get(p.pid) ?? "";
  } else throw new Error("Supported operating systems: Windows, Linux, macOS");
  return {
    at: new Date().toISOString(),
    monotonicMs: performance.now(),
    collectionMs: performance.now() - started,
    processes,
  };
}

function ancestors(p, byPid) {
  const result = [],
    seen = new Set([p.pid]);
  while ((p = byPid.get(p.ppid)) && !seen.has(p.pid)) {
    seen.add(p.pid);
    result.push(p);
  }
  return result;
}
export const identity = (p) => `${p.pid}@${p.startedAt}`;

export function attribute(processes, options, pinned = new Map()) {
  const byPid = new Map(processes.map((p) => [p.pid, p]));
  const kinds = new Map(processes.map((p) => [p.pid, commandRole(p)]));
  const explicit = new Map(options.roots.map((p) => [p.pid, p.name]));
  const explicitSessions = new Map(options.sessions.map((p) => [p.pid, p.name]));
  const explicitMcps = new Set(options.mcps);
  for (const pid of [...explicit.keys(), ...explicitSessions.keys(), ...options.mcps]) {
    const p = byPid.get(pid);
    if (p && !pinned.has(pid)) pinned.set(pid, identity(p));
    if (p && pinned.get(pid) !== identity(p)) {
      explicit.delete(pid);
      explicitSessions.delete(pid);
      explicitMcps.delete(pid);
    }
  }
  for (const [pid, role] of explicit) kinds.set(pid, role);
  for (const pid of explicitSessions.keys()) kinds.set(pid, "provider");
  for (const pid of explicitMcps) if (byPid.has(pid)) kinds.set(pid, "mcp");
  const excluded = (p) =>
    p.pid === process.pid || ancestors(p, byPid).some((a) => a.pid === process.pid);
  const included = (p) =>
    !excluded(p) &&
    (["host", "app"].includes(kinds.get(p.pid)) ||
      explicit.has(p.pid) ||
      explicitSessions.has(p.pid) ||
      explicitMcps.has(p.pid) ||
      ancestors(p, byPid).some(
        (a) =>
          ["host", "app"].includes(kinds.get(a.pid)) ||
          explicit.has(a.pid) ||
          explicitSessions.has(a.pid) ||
          explicitMcps.has(a.pid),
      ));
  const selected = processes.filter(included);
  const selectedPids = new Set(selected.map((p) => p.pid));
  const sessionRoots = new Set(
    selected
      .filter(
        (p) =>
          kinds.get(p.pid) === "provider" &&
          !ancestors(p, byPid).some(
            (a) => selectedPids.has(a.pid) && kinds.get(a.pid) === "provider",
          ),
      )
      .map((p) => p.pid),
  );
  return selected.map((p) => {
    const chain = [p, ...ancestors(p, byPid)];
    const session = chain.find((a) => sessionRoots.has(a.pid));
    let role = kinds.get(p.pid);
    // A whole MCP subtree belongs to MCP, even when a child executable has no MCP name.
    if (chain.some((a) => kinds.get(a.pid) === "mcp")) role = "mcp";
    return {
      pid: p.pid,
      ppid: p.ppid,
      name: p.name,
      startedAt: p.startedAt,
      cpuMs: p.cpuMs,
      memoryBytes: p.memoryBytes,
      role,
      session: session
        ? (explicitSessions.get(session.pid) ?? `process-tree:${identity(session)}`)
        : null,
    };
  });
}

export function aggregate(processes, previous, elapsedMs, logicalCpus, previousAt) {
  const prior = new Map((previous ?? []).map((p) => [identity(p), p]));
  const memoryMissing = processes.filter((p) => p.memoryBytes === null).length;
  let cpuMissing = 0,
    cpuMs = 0;
  for (const p of processes) {
    const prev = prior.get(identity(p));
    if (
      !prev &&
      p.cpuMs !== null &&
      previousAt &&
      Date.parse(p.startedAt) >= Date.parse(previousAt)
    ) {
      cpuMs += p.cpuMs;
      continue;
    }
    if (!prev || p.cpuMs === null || prev.cpuMs === null || p.cpuMs < prev.cpuMs) {
      cpuMissing++;
      continue;
    }
    cpuMs += p.cpuMs - prev.cpuMs;
  }
  const measuredBytes = processes.reduce((s, p) => s + (p.memoryBytes ?? 0), 0);
  const oneCorePercent = elapsedMs > 0 && !cpuMissing ? (cpuMs / elapsedMs) * 100 : null;
  const measuredOneCorePercent = elapsedMs > 0 ? (cpuMs / elapsedMs) * 100 : null;
  return {
    processCount: processes.length,
    memory: {
      bytes: memoryMissing ? null : measuredBytes,
      measuredBytes,
      missingProcessCount: memoryMissing,
    },
    cpu: {
      oneCorePercent,
      machinePercent: oneCorePercent === null ? null : oneCorePercent / logicalCpus,
      measuredOneCorePercent,
      measuredMachinePercent:
        measuredOneCorePercent === null ? null : measuredOneCorePercent / logicalCpus,
      missingProcessCount: cpuMissing,
    },
  };
}

export function summarize(samples) {
  const stats = (values) => {
    const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
    return {
      validSamples: valid.length,
      mean: valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null,
      min: valid[0] ?? null,
      max: valid.at(-1) ?? null,
      p95: valid.length ? valid[Math.ceil(valid.length * 0.95) - 1] : null,
    };
  };
  const groups = (getter) => ({
    memoryBytes: stats(samples.map((s) => getter(s)?.memory.bytes)),
    measuredMemoryBytes: stats(samples.map((s) => getter(s)?.memory.measuredBytes)),
    cpuOneCorePercent: stats(samples.map((s) => getter(s)?.cpu.oneCorePercent)),
    cpuMachinePercent: stats(samples.map((s) => getter(s)?.cpu.machinePercent)),
    measuredCpuMachinePercent: stats(samples.map((s) => getter(s)?.cpu.measuredMachinePercent)),
  });
  const sessionIds = [...new Set(samples.flatMap((s) => Object.keys(s.sessions)))];
  return {
    total: groups((s) => s.total),
    byRole: Object.fromEntries(roles.map((role) => [role, groups((s) => s.byRole[role])])),
    sessions: Object.fromEntries(
      sessionIds.map((id) => [
        id,
        {
          total: groups((s) => s.sessions[id]?.total),
          provider: groups((s) => s.sessions[id]?.provider),
          mcp: groups((s) => s.sessions[id]?.mcp),
          other: groups((s) => s.sessions[id]?.other),
        },
      ]),
    ),
  };
}

async function runningState(dataDir) {
  try {
    const s = JSON.parse(await readFile(join(dataDir, "running.json"), "utf8"));
    return Number.isInteger(s.pid) ? { pid: s.pid } : null;
  } catch {
    return null;
  }
}
export async function watchStartup(options) {
  if (!options.watchStartupMs)
    return unavailable(
      "No natural host launch observed; use --watch-startup-ms before the next owner-controlled launch.",
    );
  const original = await runningState(options.dataDir);
  const watchStartedAt = Date.now();
  let lastPollAt = watchStartedAt;
  const deadline = performance.now() + options.watchStartupMs;
  while (performance.now() < deadline) {
    const current = await runningState(options.dataDir),
      detectedAt = Date.now();
    if (current && current.pid !== original?.pid) {
      const s = await snapshot();
      const p = s.processes.find((p) => p.pid === current.pid && commandRole(p) === "host");
      const birth = Date.parse(p?.startedAt);
      if (Number.isFinite(birth) && birth >= watchStartedAt && birth <= detectedAt)
        return {
          status: "measured",
          valueMs: detectedAt - birth,
          pid: p.pid,
          lowerBoundMs: Math.max(0, lastPollAt - birth),
          upperBoundMs: detectedAt - birth,
          method: "OS process creation to observation of new running.json published after listen()",
          cacheState: "uncontrolled; process-cold observation, not filesystem-cache cold",
          readiness: "descriptor publication; not provider readiness or first frame",
        };
    }
    lastPollAt = detectedAt;
    await sleep(20);
  }
  return unavailable(
    "Timed out waiting for a new natural host launch; no process was started or stopped.",
  );
}

async function browserPaint(options) {
  if (!options.cdpUrl)
    return unavailable(
      "No attached renderer timing source; an already open application cannot establish launch-to-first-frame.",
    );
  if (!options.pageUrl)
    throw new Error("--cdp-url requires --page-url to select the exact bycoda renderer");
  const endpoint = new URL(options.cdpUrl);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname))
    throw new Error("CDP must be local");
  let browser;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.connectOverCDP(options.cdpUrl, { timeout: 5000 });
    const pages = browser
      .contexts()
      .flatMap((c) => c.pages())
      .filter((p) => p.url() === options.pageUrl);
    if (pages.length !== 1) return unavailable("Exact renderer URL did not identify one page.");
    const paint = await pages[0].evaluate(() => ({
      origin: performance.timeOrigin,
      paint:
        performance.getEntriesByType("paint").find((p) => p.name === "first-paint")?.startTime ??
        null,
    }));
    if (paint.paint === null) return unavailable("Renderer has no first-paint entry.");
    return {
      status: "measured",
      valueMs: paint.paint,
      method: "WebView navigation-to-first-paint (PerformancePaintTiming)",
      launchToFirstFrame: false,
      reason:
        "Browser paint proxy only; compositor presentation and native app launch are not instrumented.",
    };
  } catch {
    return unavailable(
      "Could not read local CDP paint timing; no renderer was launched or changed.",
    );
  } finally {
    if (browser)
      await browser.close(); /* connected browser: disconnects CDP, does not close the application */
  }
}

export function compareReports(before, after) {
  const compatible =
    before.schemaVersion === after.schemaVersion &&
    before.environment.platform === after.environment.platform &&
    before.environment.hostname === after.environment.hostname &&
    before.environment.logicalCpus === after.environment.logicalCpus &&
    before.memoryMetric === after.memoryMetric &&
    before.phase === after.phase;
  const delta = (a, b) =>
    Number.isFinite(a) && Number.isFinite(b)
      ? { before: a, after: b, absolute: b - a, percent: a === 0 ? null : ((b - a) / a) * 100 }
      : null;
  return {
    compatible,
    caveat:
      "Match workload, roots, process identities/counts, duration, build and machine before interpreting deltas. No causal performance claim.",
    totalMemoryBytes: compatible
      ? delta(before.summary.total.memoryBytes.mean, after.summary.total.memoryBytes.mean)
      : null,
    cpuMachinePercent: compatible
      ? delta(
          before.summary.total.cpuMachinePercent.mean,
          after.summary.total.cpuMachinePercent.mean,
        )
      : null,
    sessionTreeCounts: {
      before: Object.keys(before.summary.sessions).length,
      after: Object.keys(after.summary.sessions).length,
    },
  };
}

export async function measure(options) {
  const hostColdStart = await watchStartup(options);
  const samples = [],
    pinned = new Map();
  let previous;
  const end = performance.now() + options.seconds * 1000;
  do {
    const raw = await snapshot();
    const processes = attribute(raw.processes, options, pinned);
    const elapsedMs = previous ? raw.monotonicMs - previous.monotonicMs : null;
    const group = (rows) =>
      aggregate(rows, previous?.processes, elapsedMs, cpus().length, previous?.at);
    const sessionIds = [...new Set(processes.map((p) => p.session).filter(Boolean))];
    const sample = {
      at: raw.at,
      collectionMs: raw.collectionMs,
      intervalMs: elapsedMs,
      processes,
      total: group(processes),
      byRole: Object.fromEntries(
        roles.map((role) => [role, group(processes.filter((p) => p.role === role))]),
      ),
      sessions: Object.fromEntries(
        sessionIds.map((id) => {
          const rows = processes.filter((p) => p.session === id);
          return [
            id,
            {
              total: group(rows),
              provider: group(rows.filter((p) => p.role === "provider")),
              mcp: group(rows.filter((p) => p.role === "mcp")),
              other: group(rows.filter((p) => !["provider", "mcp"].includes(p.role))),
            },
          ];
        }),
      ),
    };
    samples.push(sample);
    previous = { at: raw.at, monotonicMs: raw.monotonicMs, processes };
    if (performance.now() >= end) break;
    await sleep(Math.min(options.intervalMs, Math.max(0, end - performance.now())));
  } while (true);
  const git = async (args) => {
    try {
      return await run("git", args);
    } catch {
      return null;
    }
  };
  const report = {
    schemaVersion: 1,
    samplerSha256,
    label: options.label,
    phase: options.phase,
    createdAt: new Date().toISOString(),
    scopeStatus: samples.some((s) => s.processes.length) ? "observed" : "no-recognized-processes",
    environment: {
      platform: platform(),
      release: release(),
      hostname: hostname(),
      logicalCpus: cpus().length,
      node: process.version,
      sourceRevision: await git(["-C", root, "rev-parse", "HEAD"]),
      sourceDirty: Boolean(await git(["-C", root, "status", "--porcelain"])),
      sourceVersion: JSON.parse(await readFile(join(root, "package.json"), "utf8")).version,
      sourceIsRunningBuild: false,
    },
    memoryMetric: platform() === "win32" ? "private-working-set" : "pss",
    configuration: {
      seconds: options.seconds,
      intervalMs: options.intervalMs,
      roots: options.roots,
      sessions: options.sessions,
      mcpPids: options.mcps,
    },
    hostColdStart,
    firstFrame: unavailable(
      "Native compositor first-frame timing is not exposed; no application restart or product instrumentation was performed.",
    ),
    browserPaint: await browserPaint(options),
    limitations: [
      "Only processes visible to this OS account are measurable. No argv, environment, auth files, prompts or tokens are saved.",
      "Automatic scope: recognized host/app roots and descendants. Detached or unrecognized processes require --root role:pid or --mcp pid.",
      "Sessions are outermost provider process trees, not a count of saved conversations. Shared provider servers need explicit external attribution; shared MCP is counted once outside sessions.",
      "Provider/MCP discovery is heuristic; inspect PID/PPID/name/role and use explicit mappings for unfamiliar providers or MCP launchers.",
      "CPU uses cumulative process-time deltas; 100% oneCore is one logical core. First interval, new/reused PIDs and missing counters produce null, not zero.",
      "Exited processes between snapshots are not recoverable; totals can undercount short-lived work. Sampling overhead perturbs observed CPU.",
      "Memory null indicates incomplete coverage; measuredBytes is a lower bound. Windows resident private RAM excludes shared pages and differs from Linux PSS.",
      "Idle/active labels are supplied by the operator, not inferred from CPU. This tool never sends work or idles/stops sessions.",
      ...(platform() === "darwin"
        ? [
            "macOS does not expose Linux-style PSS through ps/vmmap. PSS is unavailable (null); RSS/physical footprint is deliberately not substituted. CPU/process trees remain measurable.",
          ]
        : []),
    ],
    jcodeReference: {
      source: "https://github.com/1jehuang/jcode#performance--resource-efficiency",
      attribution: "Author-published measurements; not independently reproduced here.",
      sessionMemoryMB: 27.8,
      memoryMetric: "PSS",
      configuration: "1 active session; local embedding disabled",
      firstFrameMs: 14,
      comparable: false,
      reason:
        "Different OS memory semantics, workloads, feature scope and terminal/native UI; no valid speedup ratio.",
    },
    samples,
    summary: summarize(samples),
  };
  if (options.compare)
    report.comparison = compareReports(
      JSON.parse(await readFile(resolve(options.compare), "utf8")),
      report,
    );
  const path = resolve(options.output);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return { path, report };
}

const help = `Read-only bycoda resource sampler (Node 22+; no dependencies for OS sampling).
Usage: node scripts/checks/measure-performance.mjs [options]
  --output path                JSON output; refuses to overwrite
  --seconds 15 --interval-ms 1000
  --phase observed|idle|active  Operator-labelled workload; never triggers work
  --label baseline             Run/build/workload description
  --root host:PID              Extra root (host/app/webview/provider/mcp/other)
  --session conversation-id:PID Explicit provider root attribution (repeatable)
  --mcp PID                    Extra MCP subtree (repeatable)
  --compare before.json        Compatible-run total deltas
  --watch-startup-ms 60000      Observe next natural host launch, never restart
  --data-dir path              Host descriptor directory (default ~/.bycoda-host)
  --cdp-url http://127.0.0.1:9222 --page-url exact-renderer-url
                               Optional read-only browser paint proxy
See docs/reference/performance-measurement.md for scope and platform limitations.`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = argumentsFor(process.argv.slice(2));
    if (options.help) console.log(help);
    else {
      const { path, report } = await measure(options);
      console.log(
        JSON.stringify(
          {
            output: path,
            samples: report.samples.length,
            sessionTrees: Object.keys(report.summary.sessions).length,
            total: report.summary.total,
            hostColdStart: report.hostColdStart,
            firstFrame: report.firstFrame,
          },
          null,
          2,
        ),
      );
    }
  } catch (error) {
    console.error(`Measurement failed: ${error.message}`);
    process.exitCode = 1;
  }
}
