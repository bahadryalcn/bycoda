import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { commitServiceMode, readLifecycleMode, watchHostParent } from "./lifecycle-mode";

it("defaults fresh installs to app and preserves legacy service installs", async () => {
  const base = await mkdtemp(join(tmpdir(), "host-mode-"));
  try {
    expect(await readLifecycleMode(base)).toEqual({ mode: "app", persisted: false });
    await writeFile(join(base, "runtime-path"), "runtime");
    expect(await readLifecycleMode(base)).toEqual({ mode: "service", persisted: false });
    await expect(commitServiceMode(base, "app", async () => true)).rejects.toThrow();
    expect((await readLifecycleMode(base)).mode).toBe("service");
    await commitServiceMode(base, "app", async () => false);
    expect(await readLifecycleMode(base)).toEqual({ mode: "app", persisted: true });
    await expect(commitServiceMode(base, "service", async () => false)).rejects.toThrow();
    expect(await readLifecycleMode(base)).toEqual({ mode: "app", persisted: true });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

it("requests graceful shutdown once when the parent disappears", () => {
  vi.useFakeTimers();
  try {
    const alive = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    const stop = vi.fn();
    watchHostParent(123, stop, alive);
    expect(stop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3_000);
    expect(stop).toHaveBeenCalledExactlyOnceWith("parent-exit");
  } finally {
    vi.useRealTimers();
  }
});
