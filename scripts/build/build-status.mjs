/**
 * Usage: pnpm build:status [--source <checkout>] [--host-dir <data>] [--state-dir <build-cache>]
 * Read-only, bounded identity inspection. No service start, installation or raw auth output.
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseBuildIdentity, readBuildIdentity, sourceIdentity } from "./build-info.mjs";

const unknown = "source identity unknown";
const readJson = async (path) => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
};
const safeId = (value) =>
  typeof value === "string" && /^[\w.-]{1,160}$/.test(value) ? value : undefined;
const states = new Set([
  "launching",
  "launch-unknown",
  "starting",
  "waiting",
  "waiting-host",
  "waiting-app",
  "installing",
  "installed",
  "failed",
  "interrupted",
]);

export function compareSource(source, identity) {
  if (!source || !identity) return "unknown";
  if (source.repositoryId !== identity.repositoryId) return "different";
  if (source.head === identity.head && source.sourceFingerprint === identity.sourceFingerprint)
    return "exact";
  if (
    source.dirtyPaths.length === 0 &&
    identity.includedSources.some(
      (entry) => entry.repositoryId === source.repositoryId && entry.sourceHead === source.head,
    )
  )
    return "included";
  return "different";
}

async function installedComponent(hostDir, component) {
  const receipt = await readJson(join(hostDir, "update-jobs", `${component}.json`));
  const state = states.has(receipt?.state) ? receipt.state : "unknown";
  const identity = parseBuildIdentity(receipt?.buildIdentity);
  if (
    state !== "installed" ||
    !identity ||
    typeof receipt.binaryPath !== "string" ||
    !/^[a-f0-9]{64}$/.test(receipt.binaryHash ?? "")
  )
    return { state, sourceIdentity: unknown, buildIdentity: null };
  try {
    let bytes = await readFile(receipt.binaryPath);
    if (receipt.binaryHashKind === "tauri-normalized-sha256") {
      const marker = Buffer.from("__TAURI_BUNDLE_TYPE_VAR_");
      const index = bytes.indexOf(marker);
      if (index < 0 || bytes.indexOf(marker, index + 1) !== -1)
        throw new Error("Unknown executable");
      const offset = index + marker.length;
      if (!["UNK", "NSS"].includes(bytes.subarray(offset, offset + 3).toString()))
        throw new Error("Unknown bundle");
      bytes = Buffer.from(bytes);
      bytes.write("UNK", offset);
    } else if (receipt.binaryHashKind !== "sha256") throw new Error("Unknown hash");
    if (createHash("sha256").update(bytes).digest("hex") !== receipt.binaryHash)
      throw new Error("Binary changed");
    return { state, sourceIdentity: "verified installed binary", buildIdentity: identity };
  } catch {
    return { state, sourceIdentity: unknown, buildIdentity: null };
  }
}

async function runningHost(hostDir, timeoutMs) {
  // The credential stays local to this function. No error includes response or state contents.
  const running = await readJson(join(hostDir, "running.json"));
  if (!running) return { state: "not running", sourceIdentity: unknown, buildIdentity: null };
  if (
    !Number.isInteger(running.port) ||
    running.port < 1 ||
    running.port > 65535 ||
    !Number.isInteger(running.pid) ||
    !/^[\w-]{43}$/.test(running.secret ?? "")
  )
    return { state: "unverified", sourceIdentity: unknown, buildIdentity: null };
  try {
    const response = await fetch(`http://127.0.0.1:${running.port}/lifecycle`, {
      method: "POST",
      headers: { Authorization: `Bearer ${running.secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "status" }),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
    if (!response.ok) throw new Error("Unresponsive");
    let text = "";
    for await (const chunk of response.body) {
      text += Buffer.from(chunk).toString();
      if (text.length > 512 * 1024) throw new Error("Oversized lifecycle response");
    }
    const body = JSON.parse(text);
    if (body.pid !== running.pid) throw new Error("Stale process");
    const identity = parseBuildIdentity(body.buildIdentity);
    return {
      state: "responsive",
      ...(typeof body.version === "string" && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(body.version)
        ? { version: body.version }
        : {}),
      sourceIdentity: identity ? "reported by running host" : unknown,
      buildIdentity: identity,
    };
  } catch {
    return { state: "unresponsive or stale", sourceIdentity: unknown, buildIdentity: null };
  }
}

export async function buildStatus({
  sourceRoot = process.cwd(),
  hostDir = process.env.BYCODA_HOST_DIR ?? join(homedir(), ".bycoda-host"),
  stateDir = join(homedir(), ".bycoda-build"),
  timeoutMs = 1200,
} = {}) {
  const started = Date.now();
  const inspection = new AbortController();
  const work = Promise.all([
    sourceIdentity(sourceRoot, { signal: inspection.signal }).catch(() => null),
    readBuildIdentity(join(sourceRoot, "build/build-info.json")),
    installedComponent(hostDir, "app"),
    installedComponent(hostDir, "host"),
    runningHost(hostDir, timeoutMs),
    Promise.all(
      ["app", "host"].map(async (component) => {
        const record = await readJson(join(hostDir, "update-jobs", `${component}.json`));
        if (!record || record.state === "installed" || record.state === "failed") return null;
        let state = states.has(record.state) ? record.state : "unknown";
        if (Number.isInteger(record.pid) && record.pid > 0) {
          try {
            process.kill(record.pid, 0);
          } catch (error) {
            if (error.code === "ESRCH") state = "interrupted";
          }
        }
        return {
          component,
          state,
          ...(safeId(record.id) ? { buildId: record.id } : {}),
        };
      }),
    ),
    readJson(join(stateDir, "coordinator-latest.json")),
  ]);
  let timer;
  try {
    const result = await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("deadline")), 4500);
        timer.unref();
      }),
    ]);
    const [source, workspace, app, installedHost, host, pending, latest] = result;
    for (const component of [app, installedHost, host])
      component.comparison = compareSource(source, component.buildIdentity);
    return {
      source: { workspace: resolve(sourceRoot), ...(source ?? { sourceIdentity: unknown }) },
      workspaceBuild: {
        buildIdentity: workspace,
        comparison: compareSource(source, workspace),
        sourceIdentity: workspace ? "frozen manifest; current bytes compared separately" : unknown,
      },
      installedApp: app,
      installedHost,
      runningHost: host,
      pendingInstalls: pending.filter(Boolean),
      latestFrozenBuild: parseBuildIdentity(latest?.buildIdentity),
      elapsedMs: Date.now() - started,
    };
  } catch {
    return {
      source: { workspace: resolve(sourceRoot), sourceIdentity: unknown },
      state: "inspection deadline reached",
      elapsedMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
    inspection.abort();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.includes("--help"))
    console.log(
      "pnpm build:status [--source <checkout>] [--host-dir <data>] [--state-dir <build-cache>]",
    );
  else {
    const options = {};
    const names = { "--source": "sourceRoot", "--host-dir": "hostDir", "--state-dir": "stateDir" };
    for (let i = 0; i < args.length; i += 2) {
      if (!names[args[i]] || !args[i + 1] || args[i + 1].startsWith("--"))
        throw new Error("Invalid build:status options; use --help");
      options[names[args[i]]] = resolve(args[i + 1]);
    }
    console.log(JSON.stringify(await buildStatus(options), null, 2));
  }
}
