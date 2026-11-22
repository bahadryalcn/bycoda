import { afterEach, expect, it, vi } from "vitest";
import { bindNativeWorkspaceOwner, nativeUploadPlatform } from "./native-workspaces";

afterEach(() => {
  vi.useRealTimers();
});

it("binds every owner operation to the exact issued object without reconstructing authorization", async () => {
  const methods = {
    nativeTurns: ["begin", "end"],
    nativeActivity: ["start", "end"],
    nativeRewind: [
      "bindTurn",
      "plan",
      "prepare",
      "apply",
      "status",
      "lookup",
      "cancelPreparation",
      "ack",
    ],
    removal: ["apply"],
  };
  const runtime = Object.fromEntries(
    Object.entries(methods).map(([group, names]) => [
      group,
      Object.fromEntries(names.map((name) => [name, vi.fn(async () => ({ acknowledged: true }))])),
    ]),
  );
  const owner = Object.freeze({ ownerId: "issued-owner", authorizationId: "issued-scope" });
  const bound = bindNativeWorkspaceOwner(
    runtime as unknown as Parameters<typeof bindNativeWorkspaceOwner>[0],
    owner,
  );
  const request = Object.freeze({ fixture: "exact-request" });
  for (const [group, names] of Object.entries(methods)) {
    for (const name of names) {
      const action = (
        bound as unknown as Record<string, Record<string, (value: object) => Promise<unknown>>>
      )[group][name];
      await action(request);
      expect(runtime[group][name]).toHaveBeenCalledExactlyOnceWith(request, owner);
      expect(runtime[group][name].mock.calls[0][1]).toBe(owner);
    }
  }
});

it("supplies real SHA256/canonical base64 and fatal UTF8 decoding for exact Native service upload bytes", () => {
  const abc = new Uint8Array([97, 98, 99]);
  expect(nativeUploadPlatform.sha256(abc)).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  expect(nativeUploadPlatform.encodeBase64(abc)).toBe("YWJj");
  expect([...nativeUploadPlatform.decodeBase64("YWJj")]).toEqual([...abc]);
  const text = "Türkçe 😀";
  expect(nativeUploadPlatform.decodeUtf8Fatal(new TextEncoder().encode(text))).toBe(text);
  expect(() => nativeUploadPlatform.decodeUtf8Fatal(new Uint8Array([0xff]))).toThrow();
  expect(() => nativeUploadPlatform.decodeUtf8Fatal(new Uint8Array([0xf0, 0x9f, 0x98]))).toThrow();
});

it("disposes the actual platform sweep timer independently of domain state", () => {
  vi.useFakeTimers();
  const sweep = vi.fn(),
    dispose = nativeUploadPlatform.scheduleSweep(sweep, 30_000);
  vi.advanceTimersByTime(30_000);
  expect(sweep).toHaveBeenCalledTimes(1);
  dispose();
  vi.advanceTimersByTime(60_000);
  expect(sweep).toHaveBeenCalledTimes(1);
});
