import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile, writeFile, rename, unlink, realpath } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { readDesktopHelperBundle } from "../setup/agent-desktop.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
function signNative({ binaryPath, expectedSha256, certificateThumbprint, storeLocation }) {
  const result = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      fileURLToPath(new URL("./sign-desktop-helper.ps1", import.meta.url)),
      "-BinaryPath",
      binaryPath,
      "-ExpectedSha256",
      expectedSha256,
      "-CertificateThumbprint",
      certificateThumbprint,
      "-StoreLocation",
      storeLocation,
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 64000,
      env: Object.fromEntries(
        Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PSMODULEPATH"),
      ),
    },
  );
  return JSON.parse(result.trim());
}

/** Stable code identity prefix; Accessibility and Screen Recording grants key on it. */
export const MACOS_HELPER_IDENTIFIER_PREFIX = "com.bycoda.desktop";
export const macosHelperIdentifier = (name) =>
  name === "agent-desktop"
    ? `${MACOS_HELPER_IDENTIFIER_PREFIX}.agent-desktop`
    : `${MACOS_HELPER_IDENTIFIER_PREFIX}.${name}`;

function codesign(args) {
  const result = spawnSync("codesign", args, { encoding: "utf8", timeout: 120000 });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`codesign failed: ${(result.stderr || result.stdout).trim().slice(0, 500)}`);
  return `${result.stderr ?? ""}${result.stdout ?? ""}`;
}
/** Sign one bare Mach-O executable, verify it strictly and read back its identity. */
function signMacosNative({ binaryPath, expectedSha256, identity, identifier, entitlements }) {
  if (sha256(readFileSync(binaryPath)) !== expectedSha256)
    throw new Error("Desktop helper checksum changed before signing.");
  codesign([
    "--force",
    "--timestamp",
    "--options",
    "runtime",
    "--identifier",
    identifier,
    ...(entitlements ? ["--entitlements", entitlements] : []),
    "--sign",
    identity,
    binaryPath,
  ]);
  codesign(["--verify", "--strict", "--verbose=2", binaryPath]);
  const details = codesign(["-dv", "--verbose=4", binaryPath]);
  const field = (name) => details.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim();
  return {
    status: "Valid",
    identifier: field("Identifier"),
    authority: [...details.matchAll(/^Authority=(.*)$/gm)].map((m) => m[1].trim()),
    teamIdentifier: field("TeamIdentifier"),
    hardenedRuntime: /flags=0x[0-9a-f]+\([^)]*runtime/i.test(details),
    timestamped: Boolean(field("Timestamp")),
    sha256: sha256(readFileSync(binaryPath)),
  };
}

async function writeManifest(bundleDir, manifestPath, manifest) {
  const temporary = join(bundleDir, "manifest.signing.tmp");
  await writeFile(temporary, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  try {
    await rename(temporary, manifestPath);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

/**
 * Sign every Mach-O executable of the verified package copy (inside out, no --deep:
 * the helper is a flat directory of bare executables, not an .app bundle).
 */
async function signMacosBundle(
  bundleDir,
  { identity, arch, platform, signer = signMacosNative, packageRoot, entitlements },
) {
  if (typeof identity !== "string" || !identity.trim())
    throw new Error(
      "Configure BYCODA_MACOS_SIGNING_IDENTITY (or APPLE_SIGNING_IDENTITY) with the signing identity.",
    );
  if (
    relative(await realpath(packageRoot), await realpath(bundleDir)) !==
    join(`darwin-${arch}`, "agent-desktop")
  )
    throw new Error("Only the selected Host package copy may be signed.");
  const original = await readDesktopHelperBundle(bundleDir, { platform, arch });
  if (!original) throw new Error("The pinned desktop helper package is missing.");
  if (original.manifest.signing)
    throw new Error(
      "The package copy already has a signing receipt; rebuild it before signing again.",
    );
  const executables = original.manifest.files.filter((file) => file.name !== "LICENSE");
  const signedFiles = new Map(),
    receipts = [];
  for (const file of executables) {
    const binaryPath = join(bundleDir, file.name),
      identifier = macosHelperIdentifier(file.name);
    const receipt = await signer({
      binaryPath,
      expectedSha256: file.sha256,
      identity,
      identifier,
      entitlements,
    });
    const bytes = await readFile(binaryPath),
      signedSha256 = sha256(bytes);
    const leaf = receipt?.authority?.[0] ?? "";
    if (
      receipt?.status !== "Valid" ||
      receipt.identifier !== identifier ||
      receipt.hardenedRuntime !== true ||
      receipt.timestamped !== true ||
      !leaf ||
      (!/^[a-fA-F0-9]{40}$/.test(identity) && !leaf.includes(identity)) ||
      receipt.sha256 !== signedSha256 ||
      signedSha256 === file.sha256
    )
      throw new Error(
        `The desktop helper ${file.name} lacks a matching verified, timestamped, hardened-runtime signature.`,
      );
    signedFiles.set(file.name, { size: bytes.length, sha256: signedSha256 });
    receipts.push({
      name: file.name,
      identifier,
      authority: receipt.authority,
      teamIdentifier: receipt.teamIdentifier ?? null,
      unsignedSha256: file.sha256,
      signedSha256,
    });
  }
  const manifest = {
    ...original.manifest,
    files: original.manifest.files.map((file) =>
      signedFiles.has(file.name) ? { ...file, ...signedFiles.get(file.name) } : file,
    ),
    signing: {
      kind: "macos-codesign",
      hardenedRuntime: true,
      timestamped: true,
      files: receipts,
      signedAt: new Date().toISOString(),
    },
  };
  await writeManifest(bundleDir, original.manifestPath, manifest);
  const signed = await readDesktopHelperBundle(bundleDir, { platform, arch });
  if (signed?.binarySha256 !== signedFiles.get(original.manifest.binary)?.sha256)
    throw new Error("The signed desktop helper changed before packaging.");
  return signed;
}

/** Sign the verified package copy; the pinned build cache is never modified. */
export async function signDesktopHelperBundle(
  bundleDir,
  {
    certificateThumbprint,
    identity,
    entitlements,
    storeLocation = "CurrentUser",
    arch = process.arch,
    platform = process.platform,
    signer = signNative,
    packageRoot = fileURLToPath(new URL("../../build/host-packages/", import.meta.url)),
  } = {},
) {
  if (platform === "darwin")
    return signMacosBundle(bundleDir, {
      identity,
      arch,
      platform,
      packageRoot,
      entitlements,
      ...(signer === signNative ? {} : { signer }),
    });
  if (platform !== "win32") throw new Error("Desktop helper signing requires Windows or macOS.");
  if (typeof certificateThumbprint !== "string" || !/^[a-fA-F0-9]{40}$/.test(certificateThumbprint))
    throw new Error(
      "Configure BYCODA_WINDOWS_SIGNING_CERT_SHA1 with the exact signing certificate thumbprint.",
    );
  if (!["CurrentUser", "LocalMachine"].includes(storeLocation))
    throw new Error("Invalid desktop helper signing certificate store.");
  if (
    relative(await realpath(packageRoot), await realpath(bundleDir)).toLowerCase() !==
    join(`win32-${arch}`, "agent-desktop").toLowerCase()
  )
    throw new Error("Only the selected Host package copy may be signed.");
  const original = await readDesktopHelperBundle(bundleDir, { platform, arch });
  if (!original) throw new Error("The pinned desktop helper package is missing.");
  if (original.manifest.signing)
    throw new Error(
      "The package copy already has a signing receipt; rebuild it before signing again.",
    );
  const receipt = await signer({
    binaryPath: original.binaryPath,
    expectedSha256: original.binarySha256,
    certificateThumbprint: certificateThumbprint.toUpperCase(),
    storeLocation,
  });
  const bytes = await readFile(original.binaryPath),
    signedSha256 = sha256(bytes);
  if (
    receipt?.status !== "Valid" ||
    receipt.signerThumbprint?.toUpperCase() !== certificateThumbprint.toUpperCase() ||
    receipt.timestamped !== true ||
    receipt.sha256 !== signedSha256 ||
    signedSha256 === original.binarySha256
  )
    throw new Error(
      "The desktop helper lacks a matching verified, timestamped Authenticode signature.",
    );
  const manifest = {
    ...original.manifest,
    files: original.manifest.files.map((file) =>
      file.name === original.manifest.binary
        ? { ...file, size: bytes.length, sha256: signedSha256 }
        : file,
    ),
    signing: {
      kind: "authenticode",
      certificateThumbprint: certificateThumbprint.toUpperCase(),
      unsignedSha256: original.binarySha256,
      signedSha256,
      timestamped: true,
      signedAt: new Date().toISOString(),
    },
  };
  const temporary = join(bundleDir, "manifest.signing.tmp");
  await writeFile(temporary, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  try {
    await rename(temporary, original.manifestPath);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  const signed = await readDesktopHelperBundle(bundleDir, { platform, arch });
  if (signed?.binarySha256 !== signedSha256)
    throw new Error("The signed desktop helper changed before packaging.");
  return signed;
}
