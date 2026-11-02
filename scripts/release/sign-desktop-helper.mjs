import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
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

/** Sign the verified package copy; the pinned build cache is never modified. */
export async function signDesktopHelperBundle(
  bundleDir,
  {
    certificateThumbprint,
    storeLocation = "CurrentUser",
    arch = process.arch,
    platform = process.platform,
    signer = signNative,
    packageRoot = fileURLToPath(new URL("../../build/host-packages/", import.meta.url)),
  } = {},
) {
  if (platform !== "win32")
    throw new Error("Desktop helper Authenticode signing requires Windows.");
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
