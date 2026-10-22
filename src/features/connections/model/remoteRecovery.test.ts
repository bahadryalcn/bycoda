import { describe, expect, it } from "vitest";
import {
  remoteTurnInterrupted,
  remoteTurnRecovery,
  shouldAutoContinueRemote,
} from "./remoteRecovery";
import { unwatchRun, watchKey, watchRun, watchedRun } from "./remoteTurnWatch";

describe("remoteTurnRecovery", () => {
  it("reads the host's status through the same decision local chats use", () => {
    expect(remoteTurnRecovery("running")).toEqual({ state: "running", certain: true });
    expect(remoteTurnRecovery("idle")).toEqual({ state: "finished", certain: true });
    expect(remoteTurnRecovery("interrupted")).toEqual({ state: "interrupted", certain: true });
  });
});

describe("remoteTurnInterrupted", () => {
  it("offers Continue for a lost turn on a chat with a provider thread that is idle", () => {
    expect(
      remoteTurnInterrupted({ status: "interrupted", providerSessionId: "p", busy: false }),
    ).toBe(true);
    expect(
      remoteTurnInterrupted({ status: "interrupted", providerSessionId: "p", busy: true }),
    ).toBe(false);
    expect(remoteTurnInterrupted({ status: "interrupted", busy: false })).toBe(false);
    expect(remoteTurnInterrupted({ status: "idle", providerSessionId: "p", busy: false })).toBe(
      false,
    );
    expect(remoteTurnInterrupted({ status: "running", providerSessionId: "p", busy: true })).toBe(
      false,
    );
    expect(remoteTurnInterrupted({ providerSessionId: "p", busy: false })).toBe(false);
  });
});

describe("shouldAutoContinueRemote", () => {
  const lost = {
    status: "interrupted" as const,
    runId: "run-1",
    watchedRunId: "run-1",
    providerSessionId: "p",
    enabled: true,
    queuedCount: 0,
  };

  it("continues a run this app saw working that the host lost, once the setting is on", () => {
    expect(shouldAutoContinueRemote(lost)).toBe(true);
  });

  it("does nothing with the setting off, or with messages queued", () => {
    expect(shouldAutoContinueRemote({ ...lost, enabled: false })).toBe(false);
    expect(shouldAutoContinueRemote({ ...lost, queuedCount: 1 })).toBe(false);
  });

  it("never continues a turn that was not watched, or a different run, or one without a thread", () => {
    expect(shouldAutoContinueRemote({ ...lost, watchedRunId: undefined })).toBe(false);
    expect(shouldAutoContinueRemote({ ...lost, watchedRunId: "run-0" })).toBe(false);
    expect(shouldAutoContinueRemote({ ...lost, providerSessionId: undefined })).toBe(false);
  });

  it("never continues a turn that is running or finished", () => {
    expect(shouldAutoContinueRemote({ ...lost, status: "running" })).toBe(false);
    expect(shouldAutoContinueRemote({ ...lost, status: "idle" })).toBe(false);
  });
});

describe("remoteTurnWatch", () => {
  const memory = () => {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
  };

  it("remembers the run last seen working until it is dealt with", () => {
    const storage = memory();
    const key = watchKey("env", "s1");
    expect(watchedRun(key, storage)).toBeUndefined();
    watchRun(key, "run-1", storage);
    expect(watchedRun(key, storage)).toBe("run-1");
    watchRun(key, "run-2", storage);
    expect(watchedRun(key, storage)).toBe("run-2");
    unwatchRun(key, storage);
    expect(watchedRun(key, storage)).toBeUndefined();
  });

  it("keeps conversations apart and caps what it keeps", () => {
    const storage = memory();
    for (let index = 0; index < 120; index += 1)
      watchRun(watchKey("env", `s${index}`), `r${index}`, storage);
    expect(watchedRun(watchKey("env", "s0"), storage)).toBeUndefined();
    expect(watchedRun(watchKey("env", "s119"), storage)).toBe("r119");
    expect(watchedRun(watchKey("other", "s119"), storage)).toBeUndefined();
  });

  it("survives unreadable storage", () => {
    const broken = {
      getItem: () => "{not json",
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(watchedRun("k", broken)).toBeUndefined();
    expect(() => watchRun("k", "r", broken)).not.toThrow();
    expect(() => unwatchRun("k", broken)).not.toThrow();
    expect(watchedRun("k", undefined)).toBeUndefined();
  });
});
