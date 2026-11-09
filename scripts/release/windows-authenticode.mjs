/** Optional Windows application/installer signing; updater signatures are separate. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function windowsSigningOptions(env = process.env) {
  const certificate = env.BYCODA_WINDOWS_SIGNING_CERT_SHA1?.trim();
  if (!certificate) return null;
  const store = env.BYCODA_WINDOWS_SIGNING_STORE?.trim() || "CurrentUser";
  if (!/^[a-fA-F0-9]{40}$/.test(certificate))
    throw new Error("BYCODA_WINDOWS_SIGNING_CERT_SHA1 must identify one signing certificate.");
  if (!["CurrentUser", "LocalMachine"].includes(store))
    throw new Error("BYCODA_WINDOWS_SIGNING_STORE must be CurrentUser or LocalMachine.");
  return { certificate, store };
}

export function applyWindowsSigningConfig(config, options, node = process.execPath) {
  if (!options) return config;
  return {
    ...config,
    bundle: {
      ...config.bundle,
      windows: {
        ...config.bundle?.windows,
        signCommand: {
          cmd: node,
          args: [
            fileURLToPath(import.meta.url),
            "--sign",
            "%1",
            "--certificate",
            options.certificate,
            "--store",
            options.store,
          ],
        },
      },
    },
  };
}

export async function signWindowsBinary(binaryPath, { certificate, store }) {
  const file = resolve(binaryPath);
  if (!(await lstat(file)).isFile()) throw new Error("Signing input must be a regular file.");
  const hash = createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
  const result = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      fileURLToPath(new URL("./sign-desktop-helper.ps1", import.meta.url)),
      "-BinaryPath",
      file,
      "-ExpectedSha256",
      hash,
      "-CertificateThumbprint",
      certificate,
      "-StoreLocation",
      store,
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 64_000,
      env: Object.fromEntries(
        Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PSMODULEPATH"),
      ),
    },
  );
  const receipt = JSON.parse(result.trim());
  const signedHash = createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
  if (
    receipt.status !== "Valid" ||
    receipt.signerThumbprint?.toUpperCase() !== certificate.toUpperCase() ||
    receipt.timestamped !== true ||
    receipt.sha256 !== signedHash
  )
    throw new Error("Windows Authenticode verification did not match the selected certificate.");
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length === 2 && args[0] === "--config") {
    const config = JSON.parse(await readFile(args[1], "utf8"));
    await writeFile(
      args[1],
      JSON.stringify(applyWindowsSigningConfig(config, windowsSigningOptions())) + "\n",
    );
  } else if (
    args.length === 6 &&
    args[0] === "--sign" &&
    args[2] === "--certificate" &&
    args[4] === "--store"
  ) {
    const options = windowsSigningOptions({
      BYCODA_WINDOWS_SIGNING_CERT_SHA1: args[3],
      BYCODA_WINDOWS_SIGNING_STORE: args[5],
    });
    if (!options) throw new Error("A signing certificate is required.");
    console.log(JSON.stringify(await signWindowsBinary(args[1], options)));
  } else
    throw new Error(
      "Expected --config <file> or --sign <file> --certificate <SHA1> --store <store>.",
    );
}
