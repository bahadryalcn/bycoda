import { parentPort } from "node:worker_threads";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Node source runs need extension resolution for the existing TS module graph.
// esbuild resolves and embeds these modules in the packaged .mjs worker.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && context.parentURL) {
      const candidate = new URL(specifier, context.parentURL);
      if (!/\.[a-z]+$/i.test(candidate.pathname) && candidate.protocol === "file:") {
        const typed = new URL(`${candidate.href}.ts`);
        if (existsSync(fileURLToPath(typed))) return nextResolve(typed.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});
const { HostNotes } = await import("./host-notes.ts");
const { DesktopSessions } = await import("./desktopSessions.ts");
let paths = [];
let desktop, desktopPlatform;
let currentId = 0,
  checkAuthorization = false;
const notes = new HostNotes(
  () => paths,
  Date.now,
  () => {
    if (!checkAuthorization) return true;
    const signal = new SharedArrayBuffer(4),
      status = new Int32Array(signal);
    parentPort.postMessage({ kind: "authorize", id: currentId, signal });
    // Only this database worker waits. The host checks authority without blocking
    // its event loop; no credential or callback crosses the worker boundary.
    Atomics.wait(status, 0, 0, 5000);
    return Atomics.load(status, 0) === 1;
  },
);
const methods = new Set([
  "list",
  "get",
  "save",
  "delete",
  "desktopList",
  "desktopStampRows",
  "desktopMetadata",
  "desktopSnapshot",
]);
parentPort.on("message", ({ id, method, args, paths: nextPaths, checkAuthorization: check }) => {
  try {
    if (
      !Number.isSafeInteger(id) ||
      !methods.has(method) ||
      !Array.isArray(args) ||
      !Array.isArray(nextPaths) ||
      nextPaths.some((path) => typeof path !== "string")
    )
      throw new Error("Invalid notes operation.");
    paths = nextPaths;
    currentId = id;
    checkAuthorization = check === true;
    let value;
    if (method.startsWith("desktop")) {
      const platform =
        method === "desktopList" ? args[3] : method === "desktopSnapshot" ? args[2] : args[1];
      if (
        ![
          "aix",
          "android",
          "darwin",
          "freebsd",
          "haiku",
          "linux",
          "openbsd",
          "sunos",
          "win32",
          "cygwin",
          "netbsd",
        ].includes(platform)
      )
        throw new Error("Invalid desktop platform.");
      if (!desktop || desktopPlatform !== platform) {
        desktop?.close();
        desktop = new DesktopSessions(() => paths, platform);
        desktopPlatform = platform;
      }
      try {
        if (method === "desktopList") {
          const [cwd, projectId, providers, , known] = args;
          if (
            typeof cwd !== "string" ||
            typeof projectId !== "string" ||
            !Array.isArray(providers) ||
            providers.some((provider) => typeof provider !== "string")
          )
            throw new Error("Invalid desktop metadata read.");
          value = desktop.readMetadataList(cwd, projectId, providers);
          if (known === value.fingerprint)
            value = {
              key: value.key,
              database: value.database,
              fingerprint: value.fingerprint,
              unchanged: true,
            };
        } else {
          const id = args[0];
          if (typeof id !== "string") throw new Error("Invalid desktop session ID.");
          if (method === "desktopStampRows") value = desktop.readStampRows(id);
          else if (method === "desktopMetadata") value = desktop.readMetadataRecord(id, true);
          else {
            const projectId = args[1],
              expectedProjectCwd = args[3];
            if (
              typeof projectId !== "string" ||
              (expectedProjectCwd !== undefined && typeof expectedProjectCwd !== "string")
            )
              throw new Error("Invalid desktop snapshot read.");
            value = desktop.readSnapshotRecord(id, projectId, expectedProjectCwd);
          }
        }
      } finally {
        desktop.releaseReadHandles();
      }
    } else value = notes[method](...args);
    parentPort.postMessage({ id, value, revision: notes.revision });
  } catch (error) {
    parentPort.postMessage({
      id,
      error: error instanceof Error ? error.message : "Notes operation failed.",
      revision: notes.revision,
    });
  }
});
