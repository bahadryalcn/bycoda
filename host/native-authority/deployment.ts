import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants, fstatSync, lstatSync, type BigIntStats } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { protectWindowsDirectory, psQuote, runPowerShell } from "../windows";
import {
  NativeAuthorityHelperRuntime,
  NativeHelperClientError,
  type HelperWaitOptions,
  type NativeHelperSpawner,
} from "./helper-client";
import type { NativeSourceHelperProvider } from "./source-registry";

/** Local installation permission only. Neither a runtime identity nor an actor grant. */
export type NativeHelperDeploymentInput = {
  version: 1;
  platform: "win32" | "darwin" | "linux";
  canonicalHostDirectory: string;
  applicationIdentifier: string;
  canonicalNativeProfileDirectory: string;
  sourceProfileId: string;
  canonicalGUIExecutablePath: string;
  rawSha256: string;
  executableSize: number;
  helperProtocol: 1;
  sourceBuildMetadata?: { version?: string; sourceSha?: string; sourceFingerprint?: string };
};
export type NativeHelperDeployment = NativeHelperDeploymentInput & {
  generation: string;
  createdAt: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RECORD_BYTES = 8192;
const MAX_RUNTIMES = 4;
// At spawn: at most 64 lstat calls and one fstat. No subprocess, file read or hash.
const MAX_SPAWN_PATH_CHECKS = 64;
const inputKeys = [
  "version",
  "platform",
  "canonicalHostDirectory",
  "applicationIdentifier",
  "canonicalNativeProfileDirectory",
  "sourceProfileId",
  "canonicalGUIExecutablePath",
  "rawSha256",
  "executableSize",
  "helperProtocol",
  "sourceBuildMetadata",
];

export class NativeHelperDeploymentError extends Error {
  readonly code = "DEPLOYMENT_UNAVAILABLE";
  constructor() {
    super("Native helper deployment unavailable");
    this.name = "NativeHelperDeploymentError";
  }
}
function unavailable(): never {
  throw new NativeHelperDeploymentError();
}
function plain(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}
function text(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    !/[\u0000-\u001f]/.test(value)
  );
}
function pathValue(value: unknown): value is string {
  return (
    text(value, 2048) &&
    isAbsolute(value) &&
    (process.platform !== "win32" || !value.startsWith("\\\\"))
  );
}
function decode(
  value: unknown,
  stored: boolean,
): NativeHelperDeploymentInput | NativeHelperDeployment {
  const allowed = stored ? [...inputKeys, "generation", "createdAt"] : inputKeys;
  if (
    !plain(value) ||
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    value.version !== 1 ||
    value.helperProtocol !== 1 ||
    !["win32", "darwin", "linux"].includes(String(value.platform)) ||
    value.platform !== process.platform ||
    !pathValue(value.canonicalHostDirectory) ||
    !pathValue(value.canonicalNativeProfileDirectory) ||
    !pathValue(value.canonicalGUIExecutablePath) ||
    !text(value.applicationIdentifier, 128) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9.-]+$/.test(value.applicationIdentifier) ||
    typeof value.sourceProfileId !== "string" ||
    !UUID.test(value.sourceProfileId) ||
    typeof value.rawSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.rawSha256) ||
    !Number.isSafeInteger(value.executableSize) ||
    (value.executableSize as number) <= 0 ||
    (value.executableSize as number) > 512 * 1024 * 1024
  )
    unavailable();
  if (
    value.sourceBuildMetadata !== undefined &&
    (!plain(value.sourceBuildMetadata) ||
      Object.keys(value.sourceBuildMetadata).some(
        (key) => !["version", "sourceSha", "sourceFingerprint"].includes(key),
      ) ||
      Object.values(value.sourceBuildMetadata).some((entry) => !text(entry, 256)))
  )
    unavailable();
  if (
    stored &&
    (typeof value.generation !== "string" ||
      !UUID.test(value.generation) ||
      !Number.isSafeInteger(value.createdAt) ||
      (value.createdAt as number) <= 0)
  )
    unavailable();
  // Clone caller input before the first await. Build labels remain informational.
  const copy = JSON.parse(JSON.stringify(value)) as NativeHelperDeployment;
  copy.sourceProfileId = copy.sourceProfileId.toLowerCase();
  if (stored) copy.generation = copy.generation.toLowerCase();
  return copy;
}
function samePath(a: string, b: string): boolean {
  const key = (value: string) =>
    process.platform === "win32" ? normalize(value).toLowerCase() : normalize(value);
  return key(a) === key(b);
}
function ancestors(path: string): string[] {
  const result = [path];
  while (dirname(result.at(-1)!) !== result.at(-1)) {
    if (result.length >= MAX_SPAWN_PATH_CHECKS) unavailable();
    result.push(dirname(result.at(-1)!));
  }
  return result;
}
function privateWindowsScript(paths: string[], privatePaths: string[]): string {
  return `
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$allowed = @($sid, 'S-1-5-18', 'S-1-5-32-544')
foreach ($p in @(${[...new Set(paths.flatMap(ancestors))].map(psQuote).join(",")})) {
  $item = Get-Item -LiteralPath $p -Force -ErrorAction Stop
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Unavailable' }
}
foreach ($p in @(${privatePaths.map(psQuote).join(",")})) {
  $acl = Get-Acl -LiteralPath $p -ErrorAction Stop
  if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid) { throw 'Unavailable' }
  $hasUser = $false
  foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -eq 'Allow') {
      if ($allowed -notcontains $rule.IdentityReference.Value) { throw 'Unavailable' }
      if ($rule.IdentityReference.Value -eq $sid -and (($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::ReadAndExecute) -eq [Security.AccessControl.FileSystemRights]::ReadAndExecute)) { $hasUser = $true }
    }
  }
  if (-not $hasUser) { throw 'Unavailable' }
}
`;
}
async function assertCanonical(path: string, directory: boolean): Promise<string> {
  if (!pathValue(path)) unavailable();
  for (const part of ancestors(path)) if ((await lstat(part)).isSymbolicLink()) unavailable();
  const canonical = await realpath(path);
  if (!samePath(canonical, path) || (await lstat(canonical)).isDirectory() !== directory)
    unavailable();
  return canonical;
}
async function assertProtected(paths: string[], privatePaths: string[]): Promise<void> {
  if (process.platform === "win32") {
    await runPowerShell(privateWindowsScript(paths, privatePaths));
  } else {
    for (const path of privatePaths) {
      const stat = await lstat(path);
      if (stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) unavailable();
    }
  }
}
function identity(stat: BigIntStats): string {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.nlink].join(":");
}
function assertRegular(stat: BigIntStats): void {
  if (!stat.isFile() || stat.nlink !== 1n) unavailable();
}
type Fingerprint = { identity: string; rawSha256: string; size: number };
function checkExpected(value: Fingerprint, record: NativeHelperDeploymentInput): void {
  if (value.rawSha256 !== record.rawSha256 || value.size !== record.executableSize) unavailable();
}
async function fingerprint(path: string): Promise<Fingerprint> {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    return await fingerprintHandle(path, file);
  } finally {
    await file.close();
  }
}
async function fingerprintHandle(path: string, file: FileHandle): Promise<Fingerprint> {
  const before = await file.stat({ bigint: true });
  assertRegular(before);
  if (before.size > 512n * 1024n * 1024n) unavailable();
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(128 * 1024);
  const expected = Number(before.size);
  let total = 0;
  for (;;) {
    // Read at most the initially bounded size plus one growth-detection byte.
    const { bytesRead } = await file.read(
      buffer,
      0,
      Math.min(buffer.length, expected - total + 1),
      total,
    );
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > expected) unavailable();
    hash.update(buffer.subarray(0, bytesRead));
  }
  const after = await file.stat({ bigint: true });
  const current = await lstat(path, { bigint: true });
  if (
    total !== expected ||
    identity(before) !== identity(after) ||
    identity(after) !== identity(current)
  )
    unavailable();
  return { identity: identity(after), rawSha256: hash.digest("hex"), size: Number(after.size) };
}
async function boundedRecord(path: string): Promise<{ bytes: string; identity: string }> {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await file.stat({ bigint: true });
    assertRegular(before);
    if (before.size <= 0n || before.size > BigInt(MAX_RECORD_BYTES)) unavailable();
    const bytes = Buffer.alloc(MAX_RECORD_BYTES + 1);
    let size = 0;
    while (size < bytes.length) {
      const result = await file.read(bytes, size, bytes.length - size, null);
      if (result.bytesRead === 0) break;
      size += result.bytesRead;
    }
    if (
      size > MAX_RECORD_BYTES ||
      identity(before) !== identity(await file.stat({ bigint: true })) ||
      identity(before) !== identity(await lstat(path, { bigint: true }))
    )
      unavailable();
    return {
      bytes: new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)),
      identity: identity(before),
    };
  } finally {
    await file.close();
  }
}
function directories(directory: string) {
  return [
    directory,
    join(directory, "native-authority"),
    join(directory, "native-authority", "deployments"),
  ];
}
function sameDeployment(a: NativeHelperDeploymentInput, b: NativeHelperDeploymentInput): boolean {
  return (
    inputKeys
      .filter((key) => key !== "sourceBuildMetadata")
      .every(
        (key) =>
          a[key as keyof NativeHelperDeploymentInput] ===
          b[key as keyof NativeHelperDeploymentInput],
      ) &&
    ["version", "sourceSha", "sourceFingerprint"].every(
      (key) =>
        a.sourceBuildMetadata?.[
          key as keyof NonNullable<NativeHelperDeploymentInput["sourceBuildMetadata"]>
        ] ===
        b.sourceBuildMetadata?.[
          key as keyof NonNullable<NativeHelperDeploymentInput["sourceBuildMetadata"]>
        ],
    )
  );
}
async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700 });
}

/** Called solely by trusted local CLI installation, never by an HTTP/RPC handler. */
export async function writeNativeHelperDeployment(
  directory: string,
  input: unknown,
): Promise<NativeHelperDeployment> {
  let temporary: string | undefined;
  try {
    const value = decode(input, false) as NativeHelperDeploymentInput;
    const host = await assertCanonical(directory, true);
    if (!samePath(value.canonicalHostDirectory, host)) unavailable();
    const profile = await assertCanonical(value.canonicalNativeProfileDirectory, true);
    const executable = await assertCanonical(value.canonicalGUIExecutablePath, false);
    checkExpected(await fingerprint(executable), value);
    const privatePaths = directories(host);
    for (const path of privatePaths) {
      if (path !== host)
        await privateDirectory(path).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "EEXIST") throw error;
        });
      await assertCanonical(path, true);
      if (process.platform === "win32") await protectWindowsDirectory(path);
      else await chmod(path, 0o700);
    }
    await assertProtected([host, profile, executable, ...privatePaths], privatePaths);
    const record: NativeHelperDeployment = {
      ...value,
      canonicalHostDirectory: host,
      canonicalNativeProfileDirectory: profile,
      canonicalGUIExecutablePath: executable,
      generation: randomUUID(),
      createdAt: Date.now(),
    };
    const bytes = Buffer.from(JSON.stringify(record) + "\n");
    if (bytes.length > MAX_RECORD_BYTES) unavailable();
    const target = join(privatePaths[2], `${record.sourceProfileId}.json`);
    // Refuse replacing links/special files, including an existing hard-linked grant.
    await lstat(target, { bigint: true })
      .then(assertRegular)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    // Retrying a lost local-CLI acknowledgement keeps the existing generation.
    // A stale/invalid regular grant can be repaired only by this local writer.
    const previous = await load(host, record.sourceProfileId).catch(() => undefined);
    if (previous && sameDeployment(previous.record, record)) return previous.record;
    temporary = join(privatePaths[2], `.${record.sourceProfileId}.${randomUUID()}.tmp`);
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    // File and parent must still be the verified objects at publication.
    await assertProtected(
      [profile, executable, ...privatePaths, temporary],
      [...privatePaths, temporary],
    );
    checkExpected(await fingerprint(executable), record);
    await rename(temporary, target);
    temporary = undefined;
    if (process.platform !== "win32") {
      const parent = await open(privatePaths[2], "r");
      try {
        await parent.sync();
      } finally {
        await parent.close();
      }
    }
    return record;
  } catch {
    throw new NativeHelperDeploymentError();
  } finally {
    if (temporary) await unlink(temporary).catch(() => {});
  }
}

type Loaded = {
  record: NativeHelperDeployment;
  file: string;
  fileIdentity: string;
  executableIdentity: string;
  privatePaths: string[];
};
async function load(directory: string, deploymentId: string): Promise<Loaded> {
  if (!UUID.test(deploymentId)) unavailable();
  const host = await assertCanonical(directory, true);
  const privatePaths = directories(host);
  for (const path of privatePaths) await assertCanonical(path, true);
  const file = join(privatePaths[2], `${deploymentId.toLowerCase()}.json`);
  await assertCanonical(file, false);
  await assertProtected([...privatePaths, file], [...privatePaths, file]);
  const contents = await boundedRecord(file);
  const record = decode(JSON.parse(contents.bytes), true) as NativeHelperDeployment;
  if (
    !samePath(record.canonicalHostDirectory, host) ||
    record.sourceProfileId !== deploymentId.toLowerCase()
  )
    unavailable();
  await assertCanonical(record.canonicalNativeProfileDirectory, true);
  await assertCanonical(record.canonicalGUIExecutablePath, false);
  await assertProtected(
    [record.canonicalNativeProfileDirectory, record.canonicalGUIExecutablePath],
    [],
  );
  const executable = await fingerprint(record.canonicalGUIExecutablePath);
  checkExpected(executable, record);
  return {
    record,
    file,
    fileIdentity: contents.identity,
    executableIdentity: executable.identity,
    privatePaths,
  };
}
type PreparedSpawn = {
  executable: FileHandle;
  executableIdentity: string;
  paths: { path: string; stamp: string }[];
};
function pathStamp(stat: BigIntStats): string {
  // Normal writes inside a live Host/profile directory change its mtime/ctime.
  // Its object, type, owner and permission bits must retain their identity.
  return stat.isDirectory()
    ? [stat.dev, stat.ino, stat.mode, stat.uid, stat.gid].join(":")
    : identity(stat);
}
async function prepareSpawn(
  loaded: Loaded,
  beforeVerification?: () => Promise<void>,
): Promise<PreparedSpawn> {
  const { record, file, privatePaths } = loaded;
  const paths = [
    ...new Set(
      [
        ...privatePaths,
        file,
        record.canonicalNativeProfileDirectory,
        record.canonicalGUIExecutablePath,
      ].flatMap(ancestors),
    ),
  ];
  if (paths.length > MAX_SPAWN_PATH_CHECKS) unavailable();
  // This seam is trusted composition only and executes after initial async load.
  // Full Windows ACL/reparse inspection and hashing always remain asynchronous.
  await beforeVerification?.();
  await assertProtected(paths, [...privatePaths, file]);
  const executable = await open(
    record.canonicalGUIExecutablePath,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const checked = await fingerprintHandle(record.canonicalGUIExecutablePath, executable);
    checkExpected(checked, record);
    if (
      checked.identity !== loaded.executableIdentity ||
      identity(await lstat(file, { bigint: true })) !== loaded.fileIdentity
    )
      unavailable();
    const checks = await Promise.all(
      paths.map(async (path) => {
        const stat = await lstat(path, { bigint: true });
        if (stat.isSymbolicLink()) unavailable();
        if (
          (samePath(path, file) && identity(stat) !== loaded.fileIdentity) ||
          (samePath(path, record.canonicalGUIExecutablePath) && identity(stat) !== checked.identity)
        )
          unavailable();
        return { path, stamp: pathStamp(stat) };
      }),
    );
    return { executable, executableIdentity: checked.identity, paths: checks };
  } catch (error) {
    await executable.close();
    throw error;
  }
}
function verifyImmediatelyBeforeSpawn(prepared: PreparedSpawn): void {
  // Parent permissions and all Windows reparse attributes were checked async.
  // Same-user arbitrary code swapping and restoring an installation is outside
  // this local transport-permission boundary; this is not code/actor attestation.
  if (prepared.paths.length > MAX_SPAWN_PATH_CHECKS) unavailable();
  for (const { path, stamp } of prepared.paths) {
    const stat = lstatSync(path, { bigint: true });
    if (stat.isSymbolicLink() || pathStamp(stat) !== stamp) unavailable();
  }
  if (identity(fstatSync(prepared.executable.fd, { bigint: true })) !== prepared.executableIdentity)
    unavailable();
}

export type NativeSourceHelperProviderOptions = {
  directory: string;
  /** Trusted process-composition seam only; never populate from registration input. */
  spawn?: NativeHelperSpawner;
  /** Trusted async verification barrier for isolated instrumentation/tests only. */
  beforeSpawnVerification?: () => Promise<void>;
};

/** Registry owns this instance and its complete lifetime. No PATH/cwd/HTTP fallback. */
export function createNativeSourceHelperProvider(
  options: NativeSourceHelperProviderOptions,
): NativeSourceHelperProvider {
  const directory = options.directory;
  const beforeVerification = options.beforeSpawnVerification;
  const spawnNative: NativeHelperSpawner =
    options.spawn ?? ((file, args, launch) => spawn(file, [...args], launch));
  type Attempt = { prepared: PreparedSpawn; exit?: Promise<void>; selectionFailure?: boolean };
  type RuntimeEntry = { runtime: NativeAuthorityHelperRuntime; loaded: Loaded; attempt?: Attempt };
  const runtimes = new Map<string, RuntimeEntry>();
  const pending = new Set<Promise<unknown>>();
  let closing = false;
  let closePromise: Promise<unknown> | undefined;
  function check(signal?: AbortSignal): void {
    if (closing || signal?.aborted) unavailable();
  }
  async function openDeployment(
    deploymentId: string,
    address: string,
    wait: HelperWaitOptions = {},
  ) {
    let prepared: PreparedSpawn | undefined;
    try {
      check(wait.signal);
      if (process.platform !== "win32") unavailable();
      const loaded = await load(directory, deploymentId);
      check(wait.signal);
      prepared = await prepareSpawn(loaded, beforeVerification);
      check(wait.signal);
      const key = loaded.record.sourceProfileId + ":" + loaded.record.generation;
      let entry = runtimes.get(key);
      if (
        entry &&
        (!sameDeployment(entry.loaded.record, loaded.record) ||
          entry.loaded.record.createdAt !== loaded.record.createdAt)
      )
        unavailable();
      if (!entry) {
        for (const [oldKey, old] of runtimes) {
          if (runtimes.size < MAX_RUNTIMES) break;
          if (old.runtime.observation().activeHelpers === 0) {
            // Zero live leases: close is synchronous up to its already-resolved Promise.
            void old.runtime.close();
            runtimes.delete(oldKey);
          }
        }
        check(wait.signal);
        if (runtimes.size >= MAX_RUNTIMES) unavailable();
        const created = {} as RuntimeEntry;
        const runtime = new NativeAuthorityHelperRuntime({
          executablePath: loaded.record.canonicalGUIExecutablePath,
          spawn: (file, args, launch) => {
            try {
              check();
              if (!created.attempt) unavailable();
              verifyImmediatelyBeforeSpawn(created.attempt.prepared);
              check();
              if (
                [...runtimes.values()].reduce(
                  (count, value) => count + value.runtime.observation().activeHelpers,
                  0,
                ) > MAX_RUNTIMES
              )
                unavailable();
            } catch {
              if (created.attempt) created.attempt.selectionFailure = true;
              unavailable();
            }
            const child = spawnNative(file, args, launch);
            if (created.attempt)
              created.attempt.exit = new Promise<void>((resolve) => {
                const done = () => {
                  child.removeListener("exit", done);
                  child.removeListener("error", error);
                  resolve();
                };
                const error = () => {
                  if (!child.pid) done();
                };
                child.once("exit", done);
                child.on("error", error);
              });
            return child;
          },
        });
        entry = Object.assign(created, { runtime, loaded });
        runtimes.set(key, entry);
      }
      const attempt: Attempt = { prepared };
      entry.attempt = attempt;
      const opening = entry.runtime.open(address, wait);
      // The spawner executes synchronously inside runtime.open; capture per invocation.
      entry.attempt = undefined;
      const client = await opening.catch(async (error: unknown) => {
        // Rejection is not a new admission slot while its owned child is still alive.
        if (attempt.exit) await attempt.exit;
        if (attempt.selectionFailure) unavailable();
        throw error;
      });
      try {
        check(wait.signal);
        // Revalidate before exposing a process created while a local update ran.
        const after = await load(directory, deploymentId);
        check(wait.signal);
        if (
          after.record.generation !== loaded.record.generation ||
          after.fileIdentity !== loaded.fileIdentity ||
          after.executableIdentity !== loaded.executableIdentity
        )
          unavailable();
      } catch {
        await client.close({ timeoutMs: 1000 }).catch(() => {});
        await client.exited;
        unavailable();
      }
      return { client, expectedSourceProfileId: loaded.record.sourceProfileId };
    } catch (error) {
      // Transport errors keep their sent/unknown distinction; deployment failures expose no paths.
      if (error instanceof NativeHelperClientError) throw error;
      throw new NativeHelperDeploymentError();
    } finally {
      if (prepared) await prepared.executable.close();
    }
  }
  return {
    open(deploymentId, address, wait) {
      if (
        closing ||
        pending.size >= MAX_RUNTIMES ||
        [...runtimes.values()].reduce(
          (count, entry) => count + entry.runtime.observation().activeHelpers,
          0,
        ) >= MAX_RUNTIMES
      )
        return Promise.reject(new NativeHelperDeploymentError());
      const operation = openDeployment(deploymentId, address, wait);
      pending.add(operation);
      void operation.then(
        () => pending.delete(operation),
        () => pending.delete(operation),
      );
      return operation;
    },
    observation() {
      return {
        activeHelpers: [...runtimes.values()].reduce(
          (count, entry) => count + entry.runtime.observation().activeHelpers,
          0,
        ),
      };
    },
    close() {
      closing = true;
      closePromise ??= (async () => {
        await Promise.all([...runtimes.values()].map((entry) => entry.runtime.close()));
        await Promise.allSettled([...pending]);
        await Promise.all([...runtimes.values()].map((entry) => entry.runtime.close()));
      })();
      return closePromise;
    },
  };
}
