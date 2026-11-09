import assert from "node:assert/strict";
import test from "node:test";
import { applyWindowsSigningConfig, windowsSigningOptions } from "./windows-authenticode.mjs";

test("unsigned development retains its exact config and existing bundle settings", () => {
  const config = { build: { beforeBuildCommand: "verify" }, bundle: { windows: { nsis: {} } } };
  assert.equal(applyWindowsSigningConfig(config, windowsSigningOptions({})), config);
});

test("Windows signing preserves configuration and uses literal Tauri arguments for spaced paths", () => {
  const certificate = "a".repeat(40);
  const options = windowsSigningOptions({
    BYCODA_WINDOWS_SIGNING_CERT_SHA1: certificate,
    BYCODA_WINDOWS_SIGNING_STORE: "LocalMachine",
  });
  const config = {
    build: { beforeBuildCommand: "verify" },
    bundle: { windows: { nsis: { installMode: "currentUser" } } },
  };
  const signed = applyWindowsSigningConfig(config, options, "C:\\Program Files\\nodejs\\node.exe");
  assert.deepEqual(signed.build, config.build);
  assert.deepEqual(signed.bundle.windows.nsis, config.bundle.windows.nsis);
  assert.equal(signed.bundle.windows.signCommand.cmd, "C:\\Program Files\\nodejs\\node.exe");
  assert.deepEqual(signed.bundle.windows.signCommand.args.slice(1), [
    "--sign",
    "%1",
    "--certificate",
    certificate,
    "--store",
    "LocalMachine",
  ]);
  assert.equal(config.bundle.windows.signCommand, undefined);
});

test("malformed certificate and store cannot silently select a different signing identity", () => {
  assert.throws(
    () => windowsSigningOptions({ BYCODA_WINDOWS_SIGNING_CERT_SHA1: "bad" }),
    /certificate/,
  );
  assert.throws(
    () =>
      windowsSigningOptions({
        BYCODA_WINDOWS_SIGNING_CERT_SHA1: "a".repeat(40),
        BYCODA_WINDOWS_SIGNING_STORE: "Unknown",
      }),
    /STORE/,
  );
});
