import { expect, it, vi } from "vitest";
import { DesktopSystemPermissions, normalizeDesktopError } from "./desktop-system-permissions";

const report = (data: unknown) => ({
  stdout: JSON.stringify({ version: "2.5", ok: true, command: "permissions", data }),
  exitCode: 0,
});
const grants = {
  accessibility: { state: "granted" },
  screen_recording: { state: "not_required" },
};

it("reads helper permissions without requests, caches concurrent polls, and clears stale grants", async () => {
  let now = 1000;
  const run = vi.fn().mockResolvedValue(report(grants));
  const probe = new DesktopSystemPermissions(run, () => now);
  const [first, second] = await Promise.all([
    probe.read("helper", "hash"),
    probe.read("helper", "hash"),
  ]);
  expect(first).toEqual(second);
  expect(first).toMatchObject({
    accessibility: "granted",
    screenRecording: "not-required",
    source: "agent-desktop",
  });
  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0][1]).toEqual(["permissions"]);
  expect(run.mock.calls[0][2]).toMatchObject({ timeoutMs: 5000, maxBuffer: 65536 });
  now += 4999;
  await probe.read("helper", "hash");
  expect(run).toHaveBeenCalledTimes(1);
  now += 1;
  run.mockRejectedValue(new Error("timeout"));
  expect(await probe.read("helper", "hash")).toEqual({
    accessibility: "unknown",
    screenRecording: "unknown",
    source: "unavailable",
    checkedAt: new Date(now).toISOString(),
  });
});

it.each([
  { ...grants, accessibility: { state: "denied" } },
  { accessibility: { state: "not_determined" }, screen_recording: { state: "restricted" } },
])("passes through denied and undetermined states", async (data) => {
  const probe = new DesktopSystemPermissions(async () => report(data));
  const result = await probe.read("helper", "hash");
  expect(result.accessibility).toBe(data.accessibility.state.replaceAll("_", "-"));
  expect(result.screenRecording).toBe(data.screen_recording.state.replaceAll("_", "-"));
  expect(result.elevated).toBeUndefined();
});

it.each([
  report({ accessibility: { state: "granted" } }),
  report({ ...grants, accessibility: { state: "surprise" } }),
  { stdout: "broken JSON", exitCode: 0 },
  { ...report(grants), exitCode: 1 },
  { stdout: JSON.stringify({ version: "2.5", ok: false, command: "permissions" }), exitCode: 0 },
])("fails closed for incomplete or failed probes", async (result) => {
  const probe = new DesktopSystemPermissions(async () => result);
  expect(await probe.read("helper", "hash")).toMatchObject({
    accessibility: "unknown",
    screenRecording: "unknown",
    source: "unavailable",
  });
});

it("invalidates cache when binary identity changes or verification fails", async () => {
  const run = vi.fn().mockResolvedValue(report(grants));
  const probe = new DesktopSystemPermissions(run);
  await probe.read("helper", "hash");
  await probe.read("helper", "new-hash");
  expect(run).toHaveBeenCalledTimes(2);
  expect(await probe.read()).toMatchObject({ source: "unavailable", accessibility: "unknown" });
  await probe.read("helper", "new-hash");
  expect(run).toHaveBeenCalledTimes(3);
});

it.each([
  "E_ACCESSDENIED",
  "COM HRESULT 0x80070005 (E_ACCESSDENIED: Access is denied)",
  "UIPI blocked input",
  "target has higher integrity",
])("normalizes Windows elevation evidence: %s", (detail) => {
  const error: { code: string; message?: string } = normalizeDesktopError(
    { code: "PERM_DENIED", platform_detail: detail },
    "win32",
  );
  expect(error.code).toBe("target-elevated");
  expect(error.message).toBe(
    "This window runs as administrator. Windows blocks other apps from controlling it unless bycoda also runs as administrator.",
  );
});

it("does not mislabel generic permission errors or macOS denials", () => {
  expect(
    normalizeDesktopError(
      { code: "PERM_DENIED", message: "private file DACL grants an untrusted principal" },
      "win32",
    ).code,
  ).toBe("PERM_DENIED");
  expect(
    normalizeDesktopError({ code: "PERM_DENIED", message: "E_ACCESSDENIED" }, "darwin").code,
  ).toBe("PERM_DENIED");
});
