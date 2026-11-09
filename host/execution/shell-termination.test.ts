import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runHostShell } from "./shell";
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("./shellProfiles", () => ({ resolveShellProfile: () => undefined }));
const child = () =>
  Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    pid: 42,
    kill: vi.fn(),
  });
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.mocked(spawn).mockReset();
});
describe.runIf(process.platform === "win32")("failed Windows command-tree retirement", () => {
  for (const failure of ["error", "nonzero", "timeout", "throw"] as const) {
    it(`reports ${failure} as logical completion without claiming physical retirement`, async () => {
      const original = child();
      const killer = child();
      const controller = new AbortController();
      vi.mocked(spawn).mockReturnValueOnce(original as never);
      if (failure === "throw")
        vi.mocked(spawn).mockImplementationOnce(() => {
          throw new Error("spawn denied");
        });
      else vi.mocked(spawn).mockReturnValueOnce(killer as never);
      const notice = vi.fn();
      const pending = runHostShell(
        "/repo",
        "long command",
        60_000,
        undefined,
        controller.signal,
        notice,
      );
      controller.abort();
      if (failure === "error") killer.emit("error", new Error("taskkill denied"));
      if (failure === "nonzero") killer.emit("close", 5);
      if (failure === "timeout") await vi.advanceTimersByTimeAsync(5_000);
      const result = await pending;
      expect(result.exitCode).toBeNull();
      expect(result.terminationFailed).toBeTruthy();
      expect(result.output).toContain(result.terminationFailed!);
      expect(notice).toHaveBeenCalledOnce();
      original.emit("close", 0);
      killer.emit("close", 0);
      expect((await pending).terminationFailed).toBe(result.terminationFailed);
      expect(notice).toHaveBeenCalledOnce();
    });
  }
  it("a command timeout and hung taskkill have a bounded failure result", async () => {
    const original = child(),
      killer = child();
    vi.mocked(spawn)
      .mockReturnValueOnce(original as never)
      .mockReturnValueOnce(killer as never);
    const pending = runHostShell("/repo", "long command", 100);
    await vi.advanceTimersByTimeAsync(5_100);
    expect(await pending).toMatchObject({
      exitCode: null,
      timedOut: true,
      terminationFailed: expect.stringContaining("termination timed out"),
    });
  });
  it("joins successful taskkill and child completion without a failure marker", async () => {
    const original = child(),
      killer = child(),
      controller = new AbortController();
    vi.mocked(spawn)
      .mockReturnValueOnce(original as never)
      .mockReturnValueOnce(killer as never);
    const pending = runHostShell("/repo", "long command", 60_000, undefined, controller.signal);
    controller.abort();
    original.emit("close", 0);
    killer.emit("close", 0);
    expect(await pending).toEqual({ output: "", exitCode: null, timedOut: false });
  });
  it("resolves an unexpected completion observer failure as retained physical uncertainty", async () => {
    const original = child();
    vi.mocked(spawn).mockReturnValueOnce(original as never);
    const pending = runHostShell("/repo", "command", 60_000);
    original.stdout.write("partial output");
    vi.spyOn(StringDecoder.prototype, "end").mockImplementationOnce(() => {
      throw new Error("decoder finalizer failed");
    });
    original.emit("close", 0);
    expect(await pending).toMatchObject({
      output: expect.stringContaining("partial output"),
      exitCode: null,
      timedOut: false,
      terminationFailed: "Command completion could not be confirmed; verification remains locked.",
      physicalIdentity: { pid: 42, hostPid: process.pid },
    });
  });

  it.each(["resolve", "reject"] as const)(
    "bounds a hung identity publication after taskkill failure and ignores its late %s",
    async (outcome) => {
      const original = child();
      const killer = Object.assign(child(), { pid: 43 });
      const controller = new AbortController();
      const publication = Promise.withResolvers<void>();
      const observe = vi.fn(() => publication.promise);
      vi.mocked(spawn)
        .mockReturnValueOnce(original as never)
        .mockReturnValueOnce(killer as never);
      const pending = runHostShell(
        "/repo",
        "command",
        60_000,
        undefined,
        controller.signal,
        undefined,
        observe,
      );
      let observedResult: Awaited<typeof pending> | undefined;
      const observed = pending.then((result) => {
        observedResult = result;
        return result;
      });
      controller.abort();
      killer.emit("close", 5);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(observedResult).toBeDefined();
      const result = await observed;
      expect(result).toMatchObject({
        exitCode: null,
        timedOut: false,
        terminationFailed: expect.stringContaining("termination failed (exit 5)"),
        physicalIdentity: { pid: 42, helperPid: 43, hostPid: process.pid },
      });
      expect(observe).toHaveBeenCalledOnce();
      if (outcome === "resolve") publication.resolve();
      else publication.reject(new Error("late identity publication rejection"));
      await vi.runAllTimersAsync();
      original.emit("close", 0);
      killer.emit("close", 0);
      expect(await pending).toBe(result);
      expect(result.terminationFailed).toContain("termination failed (exit 5)");
    },
  );

  it("does not turn a successful child exit into retirement proof while identity publication is unconfirmed", async () => {
    const original = child();
    const publication = Promise.withResolvers<void>();
    vi.mocked(spawn).mockReturnValueOnce(original as never);
    const pending = runHostShell(
      "/repo",
      "command",
      60_000,
      undefined,
      undefined,
      undefined,
      () => publication.promise,
    );
    let observedResult: Awaited<typeof pending> | undefined;
    const observed = pending.then((result) => {
      observedResult = result;
      return result;
    });
    original.emit("close", 0);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(observedResult).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(observedResult).toMatchObject({
      exitCode: null,
      timedOut: false,
      terminationFailed: expect.stringContaining("Process identity publication timed out"),
      physicalIdentity: { pid: 42, hostPid: process.pid },
    });
    const result = await observed;
    publication.resolve();
    await vi.runAllTimersAsync();
    expect(await pending).toBe(result);
  });

  it("also resolves if a rejected identity observer throws while its error is formatted", async () => {
    const original = child();
    vi.mocked(spawn).mockReturnValueOnce(original as never);
    const pending = runHostShell(
      "/repo",
      "command",
      60_000,
      undefined,
      undefined,
      undefined,
      async () => {
        throw {
          toString: () => {
            throw new Error("error conversion failed");
          },
        };
      },
    );
    original.emit("close", 0);
    expect(await pending).toMatchObject({
      exitCode: null,
      terminationFailed: "Command completion could not be confirmed; verification remains locked.",
      physicalIdentity: { pid: 42 },
    });
  });
});
