import { afterEach, expect, it, vi } from "vitest";
import { createDevelopmentRuntime } from "./development";

type Dependencies = Parameters<typeof createDevelopmentRuntime>[0];

function setup(refresh: () => Promise<void>) {
  const dependencies = {
    engine: {
      store: {
        projects: async () => [{ id: "p1", name: "App", cwd: "/app" }],
      },
    },
    devServers: { refreshLogSources: () => refresh() },
    server: { address: () => undefined },
  };
  return createDevelopmentRuntime(dependencies as unknown as Dependencies);
}

afterEach(() => {
  vi.useRealTimers();
});

it("a log read does not get past the source refresh it triggers", async () => {
  let finish!: () => void;
  const runtime = setup(() => new Promise<void>((resolve) => (finish = resolve)));
  let done = false;
  const read = runtime.refreshLogSources().then(() => {
    done = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(done).toBe(false);
  finish();
  await read;
  expect(done).toBe(true);
});

it("a stuck source refresh cannot hold a log read past its bound", async () => {
  vi.useFakeTimers();
  const runtime = setup(() => new Promise<void>(() => undefined));
  const read = runtime.refreshLogSources();
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(1_500);
  await expect(read).resolves.toBeUndefined();
});

it("a failed source refresh is logged, not thrown into the log read", async () => {
  const runtime = setup(() => Promise.reject(new Error("discovery failed at /secret/path")));
  await expect(runtime.refreshLogSources()).resolves.toBeUndefined();
});
