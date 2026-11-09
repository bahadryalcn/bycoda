/** Explicit native Host build; ordinary host:build remains a JavaScript build. */
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
  toNamespacedPath,
} from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

export function validateAdmissionLoadPath(path) {
  if (process.platform === "win32" && Buffer.byteLength(toNamespacedPath(path), "utf8") > 260)
    throw new Error(
      "Windows Node/SQLite admission path exceeds 260 UTF-8 bytes; choose a shorter bundle directory",
    );
}

export async function validateAdmissionPackageDestination(output, target, artifact) {
  targetInfo(target);
  const canonicalOutput = await realpath(output);
  let directory = join(canonicalOutput, target);
  try {
    directory = await realpath(directory);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  validateAdmissionLoadPath(join(directory, artifact));
}

/** Exercise the packaged runtime and C entry in a separate disposable process. */
export async function smokeAdmissionBundle(executable, directory, target) {
  const bundle = await readAdmissionBundle(directory, target);
  validateAdmissionLoadPath(bundle.artifact);
  const fixture = await mkdtemp(join(tmpdir(), "bycoda-native-package-"));
  if (
    dirname(resolve(fixture)) !== resolve(tmpdir()) ||
    !basename(fixture).startsWith("bycoda-native-package-")
  )
    throw new Error("Unexpected owned native smoke directory");
  const source = `
    import assert from 'node:assert/strict';
    import {createRequire} from 'node:module';
    import {realpathSync} from 'node:fs';
    import {DatabaseSync} from 'node:sqlite';
    process.umask(0o077);
    const [artifact,path]=process.argv.slice(1),api=createRequire(import.meta.url)(artifact);
    assert.equal(api.mechanicalAbiVersion(),2);
    if(!api.connectionAttestationSupported()){console.log(JSON.stringify({abi:2,connectionAttested:false,reason:'platform-unsupported'}));process.exit(0);}
    const db=new DatabaseSync(path,{allowExtension:true});
    try {
      db.loadExtension(artifact,api.sqliteExtensionEntryPoint());
      const actual=JSON.parse(db.prepare('SELECT bycoda_connection_identity() AS identity').get().identity);
      db.enableLoadExtension(false);
      const canonical=realpathSync(path),bound=api.openRegistry(api.registryRootForDatabase(canonical)).bindFile(canonical),expected=bound.identity();
      assert.equal(actual.version,1);assert.equal(actual.links,1);assert.equal(expected.links,1n);assert.equal(actual.physicalFileId,expected.nativeFormat);
      console.log(JSON.stringify({abi:2,connectionAttested:true}));
    } finally { db.close(); }
  `;
  try {
    return JSON.parse(
      execFileSync(
        executable,
        ["--input-type=module", "--eval", source, bundle.artifact, join(fixture, "store.db")],
        { encoding: "utf8", windowsHide: true },
      ),
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}

export const admissionTargets = Object.freeze({
  "win32-x64": ["x86_64-pc-windows-msvc", "bycoda_physical_store_admission_node.dll"],
  "win32-arm64": ["aarch64-pc-windows-msvc", "bycoda_physical_store_admission_node.dll"],
  "darwin-x64": ["x86_64-apple-darwin", "libbycoda_physical_store_admission_node.dylib"],
  "darwin-arm64": ["aarch64-apple-darwin", "libbycoda_physical_store_admission_node.dylib"],
  "linux-x64": ["x86_64-unknown-linux-gnu", "libbycoda_physical_store_admission_node.so"],
  "linux-arm64": ["aarch64-unknown-linux-gnu", "libbycoda_physical_store_admission_node.so"],
});
const manifestName = "physical-store-admission.json";
const hex = /^[a-f0-9]{64}$/;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inside = (root, path) => {
  const suffix = relative(root, path);
  return !!suffix && !isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`);
};
function targetInfo(target) {
  if (!Object.hasOwn(admissionTargets, target))
    throw new Error(`Unsupported admission target: ${target}`);
  return admissionTargets[target];
}
async function boundedFile(path, limit) {
  const file = await open(path, "r");
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > limit)
      throw new Error("Admission input is not a bounded regular file");
    const bytes = Buffer.alloc(info.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await file.read(bytes, length, bytes.length - length, null);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length !== info.size) throw new Error("Admission input changed while reading");
    return bytes.subarray(0, length);
  } finally {
    await file.close();
  }
}

/** Header/architecture check, independent of whether this machine can execute it. */
export function validateAdmissionBinary(bytes, target) {
  targetInfo(target);
  let valid = false;
  if (target.startsWith("win32-") && bytes.length >= 64 && bytes.toString("ascii", 0, 2) === "MZ") {
    const pe = bytes.readUInt32LE(60);
    valid =
      pe <= bytes.length - 26 &&
      bytes.toString("ascii", pe, pe + 4) === "PE\0\0" &&
      bytes.readUInt16LE(pe + 4) === (target.endsWith("x64") ? 0x8664 : 0xaa64) &&
      (bytes.readUInt16LE(pe + 22) & 0x2000) !== 0 &&
      bytes.readUInt16LE(pe + 24) === 0x20b;
  } else if (target.startsWith("linux-") && bytes.length >= 64) {
    valid =
      bytes.subarray(0, 7).equals(Buffer.from([0x7f, 69, 76, 70, 2, 1, 1])) &&
      bytes.readUInt16LE(16) === 3 &&
      bytes.readUInt16LE(18) === (target.endsWith("x64") ? 62 : 183);
  } else if (target.startsWith("darwin-") && bytes.length >= 32) {
    valid =
      bytes.readUInt32LE(0) === 0xfeedfacf &&
      bytes.readUInt32LE(4) === (target.endsWith("x64") ? 0x01000007 : 0x0100000c) &&
      [6, 8].includes(bytes.readUInt32LE(12));
  }
  if (!valid) throw new Error(`Admission binary does not match ${target}`);
}

/** Native build inputs are separate from the ordinary esbuild cache. */
export async function admissionSourceFingerprint(root) {
  const inputs = ["Cargo.toml", "Cargo.lock", "scripts/build/physical-store-admission.mjs"];
  async function walk(directory) {
    for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
      if (["test", "tests", "target", "node_modules"].includes(entry.name)) continue;
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) inputs.push(path);
      else throw new Error(`Linked admission build input: ${path}`);
    }
  }
  for (const directory of [
    "packages/physical-store-admission",
    "packages/physical-store-admission-node",
    "vendor/sqlite-extension-abi",
  ])
    await walk(directory);
  const digest = createHash("sha256");
  for (const path of inputs.sort())
    digest.update(`${path}\0${hash(await readFile(join(root, path)))}\n`);
  return digest.digest("hex");
}

export async function readAdmissionBundle(directory, target) {
  targetInfo(target);
  const root = await realpath(directory);
  const manifest = JSON.parse((await boundedFile(join(root, manifestName), 8192)).toString("utf8"));
  if (
    manifest.schemaVersion !== 2 ||
    manifest.mechanicalAbiVersion !== 2 ||
    manifest.target !== target ||
    manifest.rustTarget !== targetInfo(target)[0] ||
    !hex.test(manifest.sha256) ||
    !hex.test(manifest.sourceFingerprint) ||
    manifest.artifact !== `admission-${manifest.sha256}.node`
  )
    throw new Error("Invalid admission bundle manifest or target");
  const artifact = await realpath(join(root, manifest.artifact));
  if (!inside(root, artifact) || !artifact.endsWith(".node"))
    throw new Error("Admission artifact escaped its bundle");
  const bytes = await boundedFile(artifact, 128 * 1024 * 1024);
  if (hash(bytes) !== manifest.sha256) throw new Error("Admission artifact checksum mismatch");
  validateAdmissionBinary(bytes, target);
  return { manifest, artifact, bytes };
}

/** Never overwrite an image which a running Node process may have loaded. */
export async function stageAdmissionBundle(
  directory,
  target,
  bytes,
  sourceFingerprint,
  validateImage = async () => {},
) {
  validateAdmissionBinary(bytes, target);
  if (!hex.test(sourceFingerprint)) throw new Error("Admission source fingerprint is required");
  await mkdir(directory, { recursive: true });
  const root = await realpath(directory);
  const sha256 = hash(bytes);
  // Keep the immutable name flat: Windows Node/SQLite bounds the UTF-8 load path.
  const artifact = `admission-${sha256}.node`;
  const destination = join(root, artifact);
  try {
    await writeFile(destination, bytes, { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const canonical = await realpath(destination);
  if (
    !inside(root, canonical) ||
    !canonical.endsWith(".node") ||
    hash(await boundedFile(canonical, 128 * 1024 * 1024)) !== sha256
  )
    throw new Error("Existing immutable admission artifact differs");
  await validateImage(canonical);
  const manifest = {
    schemaVersion: 2,
    mechanicalAbiVersion: 2,
    target,
    rustTarget: targetInfo(target)[0],
    artifact,
    sha256,
    sourceFingerprint,
  };
  const temporary = join(root, `.${manifestName}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(manifest)}\n`, { flag: "wx" });
    await rename(temporary, join(root, manifestName));
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  return manifest;
}

export async function copyAdmissionBundle(source, destination, target, expectedSourceFingerprint) {
  const bundle = await readAdmissionBundle(source, target);
  if (bundle.manifest.sourceFingerprint !== expectedSourceFingerprint)
    throw new Error("Admission artifact does not match the current native source inputs");
  return stageAdmissionBundle(destination, target, bundle.bytes, bundle.manifest.sourceFingerprint);
}

/** A package rebuild must never remove one of its verified native inputs. */
export async function assertAdmissionPackagingSeparation(
  sourceDirectory,
  outputDirectory,
  targets,
) {
  const output = await realpath(outputDirectory);
  const sources = await Promise.all(
    targets.map((target) => realpath(join(sourceDirectory, target))),
  );
  for (const target of targets) {
    targetInfo(target);
    let destination = join(output, target);
    try {
      destination = await realpath(destination);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (!inside(output, destination))
      throw new Error("Admission package output escaped its directory");
    for (const source of sources)
      if (source === destination || inside(source, destination) || inside(destination, source))
        throw new Error("Native admission source and package output overlap");
  }
}

export async function buildAdmissionBundle({
  root,
  target,
  output,
  targetDir,
  profile = "release",
}) {
  root = resolve(root);
  const [rustTarget, filename] = targetInfo(target);
  if (!["release", "debug"].includes(profile))
    throw new Error("Admission profile must be release or debug");
  const before = await admissionSourceFingerprint(root);
  const args = [
    "build",
    "--locked",
    "-p",
    "bycoda-physical-store-admission-node",
    "--lib",
    "--target",
    rustTarget,
    "--target-dir",
    resolve(targetDir),
  ];
  if (profile === "release") args.push("--release");
  const environment = { ...process.env };
  if (target.startsWith("win32-")) {
    // Keep a standalone Host independent of an installed MSVC redistributable.
    // Scope this to the child build; do not change the desktop Cargo lane/config.
    if (Object.hasOwn(environment, "CARGO_ENCODED_RUSTFLAGS"))
      environment.CARGO_ENCODED_RUSTFLAGS = [
        ...(environment.CARGO_ENCODED_RUSTFLAGS ? [environment.CARGO_ENCODED_RUSTFLAGS] : []),
        "-C",
        "target-feature=+crt-static",
      ].join("\u001f");
    else environment.RUSTFLAGS = `${environment.RUSTFLAGS ?? ""} -C target-feature=+crt-static`;
  }
  execFileSync("cargo", args, { cwd: root, stdio: "inherit", windowsHide: true, env: environment });
  if (before !== (await admissionSourceFingerprint(root)))
    throw new Error("Admission source changed during the build; no manifest published");
  const bytes = await boundedFile(
    join(resolve(targetDir), rustTarget, profile, filename),
    128 * 1024 * 1024,
  );
  validateAdmissionBinary(bytes, target);
  return stageAdmissionBundle(output, target, bytes, before, async (artifact) => {
    if (target === `${process.platform}-${process.arch}`) {
      validateAdmissionLoadPath(artifact);
      // A separate process validates the ABI without pinning the image in this tool.
      const loader = pathToFileURL(
        join(root, "packages/physical-store-admission-node/index.mjs"),
      ).href;
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `import {loadPhysicalStoreAdmission} from ${JSON.stringify(loader)}; if(loadPhysicalStoreAdmission(process.argv[1]).mechanicalAbiVersion()!==2)process.exit(1);`,
          artifact,
        ],
        { stdio: "inherit", windowsHide: true },
      );
    }
    if (before !== (await admissionSourceFingerprint(root)))
      throw new Error("Admission source changed before publication");
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (
      !["--target", "--output", "--target-dir", "--profile"].includes(args[i]) ||
      !args[i + 1] ||
      args[i + 1].startsWith("--") ||
      Object.hasOwn(options, args[i])
    )
      throw new Error(
        "Usage: physical-store-admission.mjs [--target platform-arch] [--output directory] [--target-dir directory] [--profile debug|release]",
      );
    options[args[i]] = args[i + 1];
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const target = options["--target"] ?? `${process.platform}-${process.arch}`;
  const manifest = await buildAdmissionBundle({
    root,
    target,
    output: resolve(options["--output"] ?? join(root, "build/host-native", target)),
    targetDir: resolve(
      options["--target-dir"] ?? join(root, "temp/build/physical-store-admission"),
    ),
    profile: options["--profile"] ?? "release",
  });
  console.log(JSON.stringify(manifest));
}
