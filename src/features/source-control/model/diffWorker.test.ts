import { afterEach, expect, it, vi } from "vitest";
import { runDiffWorker } from "./diffWorker";
afterEach(() => vi.unstubAllGlobals());
it("falls back when Worker is absent", async () => {
  vi.stubGlobal("Worker", undefined);
  const fallback = vi.fn(() => "local");
  expect(await runDiffWorker(() => Promise.resolve("worker"), fallback)).toBe("local");
  expect(fallback).toHaveBeenCalledOnce();
});
it("falls back if WebView/CSP rejects worker construction", async () => {
  vi.stubGlobal(
    "Worker",
    class {
      constructor() {
        throw new Error("blocked");
      }
    },
  );
  expect(
    await runDiffWorker(
      () => Promise.resolve("worker"),
      () => "local",
    ),
  ).toBe("local");
});
