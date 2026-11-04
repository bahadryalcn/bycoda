// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
afterEach(() => vi.unstubAllGlobals());
it("closes decoded bitmap and temporary canvas when image preparation fails", async () => {
  vi.resetModules();
  const scope = { postMessage: vi.fn(), onmessage: null as null | ((event: MessageEvent) => void) };
  const decoded = { width: 20, height: 20, close: vi.fn() };
  const canvas = { width: 20, height: 20, getContext: () => null };
  vi.stubGlobal("self", scope);
  vi.stubGlobal("createImageBitmap", vi.fn(async () => decoded));
  vi.stubGlobal("OffscreenCanvas", vi.fn(function () { return canvas; }));
  await import("./newThreadBackgroundEffects.worker");
  scope.onmessage!({ data: { kind: "load", id: 1, sourceKey: "original", bytes: new ArrayBuffer(4) } } as MessageEvent);
  await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalledOnce());
  expect(decoded.close).toHaveBeenCalledOnce();
  expect(canvas.width).toBe(0);
  expect(canvas.height).toBe(0);
  expect(scope.postMessage.mock.calls[0][0].error).toContain("Unable to prepare");
});
it("keeps pending decodes single-flight even when multiple messages arrive", async () => {
  vi.resetModules();
  const scope = { postMessage: vi.fn(), onmessage: null as null | ((event: MessageEvent) => void) };
  let release!: (value: { width: number; height: number; close: () => void }) => void;
  const first = new Promise<{ width: number; height: number; close: () => void }>((resolve) => { release = resolve; });
  const decode = vi.fn().mockReturnValueOnce(first).mockResolvedValue({ width: 2, height: 2, close: vi.fn() });
  vi.stubGlobal("self", scope);
  vi.stubGlobal("createImageBitmap", decode);
  vi.stubGlobal("OffscreenCanvas", vi.fn(function () {
    return { width: 2, height: 2, getContext: () => ({ drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(16) }) }) };
  }));
  await import("./newThreadBackgroundEffects.worker");
  for (const id of [1, 2]) scope.onmessage!({ data: { kind: "load", id, sourceKey: String(id), bytes: new ArrayBuffer(4) } } as MessageEvent);
  await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce());
  release({ width: 2, height: 2, close: vi.fn() });
  await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalledTimes(2));
  expect(decode).toHaveBeenCalledTimes(2);
});
