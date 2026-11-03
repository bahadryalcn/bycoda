// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../../sessions/model/session";
import {
  acknowledgeHostSessionBinding,
  acknowledgedHostSessionBinding,
  hostSessionBinding,
  saveHostSessionBinding,
  type HostSessionBinding,
} from "./sessionExecutionBinding";

const KEY_PREFIX = "bycoda.host-session-binding.v1:";

function binding(overrides: Partial<HostSessionBinding> = {}): HostSessionBinding {
  return {
    kind: "local-host",
    machineId: "machine-1",
    environmentId: "env-1",
    projectId: "project-1",
    sessionId: "host-session-1",
    authorityGeneration: null,
    created: false,
    ...overrides,
  };
}

/** Counting storage: spying on happy-dom's Storage is unreliable across restores. */
function installCountingStorage() {
  const data = new Map<string, string>();
  const writes: string[] = [];
  const removals: string[] = [];
  vi.stubGlobal("localStorage", {
    get length() {
      return data.size;
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      writes.push(key);
      data.set(key, String(value));
    },
    removeItem: (key: string) => {
      removals.push(key);
      data.delete(key);
    },
    clear: () => data.clear(),
  });
  return { data, writes, removals };
}

function shell(hostBinding?: HostSessionBinding): Session {
  return { id: "shell-1", cwd: "/work", title: "t", blocks: [], hostBinding } as unknown as Session;
}

describe("acknowledgedHostSessionBinding", () => {
  let storage: ReturnType<typeof installCountingStorage>;

  beforeEach(() => {
    storage = installCountingStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function expectNoWrites() {
    expect(storage.writes).toEqual([]);
    expect(storage.removals).toEqual([]);
  }

  it("returns undefined without writing when the shell has no Host binding", () => {
    expect(acknowledgedHostSessionBinding(shell(), "host-session-1", 1)).toBeUndefined();
    expectNoWrites();
  });

  it("returns the acknowledged binding without any storage write for a matching owner", () => {
    const fresh = binding();
    const result = acknowledgedHostSessionBinding(shell(fresh), "host-session-1", 3);

    expect(result).toEqual({ ...fresh, created: true, authorityGeneration: 3 });
    expect(fresh.created).toBe(false);
    expectNoWrites();
  });

  it("keeps canonical absence of authority generation for an unfenced receipt", () => {
    const result = acknowledgedHostSessionBinding(shell(binding()), "host-session-1", undefined);

    expect(result).toMatchObject({ created: true, authorityGeneration: null });
    expectNoWrites();
  });

  it("is repeatable for the same inputs", () => {
    const owner = shell(binding({ authorityGeneration: 2 }));

    const first = acknowledgedHostSessionBinding(owner, "host-session-1", 2);
    const second = acknowledgedHostSessionBinding(owner, "host-session-1", 2);

    expect(second).toEqual(first);
    expectNoWrites();
  });

  it("throws and does not write when the stored owner differs from the shell owner", () => {
    const stored = binding({ projectId: "project-stored" });
    saveHostSessionBinding(shell(stored), stored);
    expect(storage.writes).toHaveLength(1); // control: the counter observes real writes
    storage.writes.length = 0;

    expect(() =>
      acknowledgedHostSessionBinding(
        shell(binding({ projectId: "project-expected" })),
        "host-session-1",
        1,
      ),
    ).toThrow("The session owner changed while the request was in flight.");
    expectNoWrites();
  });

  it("throws and does not write when the Host returned a different session", () => {
    expect(() => acknowledgedHostSessionBinding(shell(binding()), "other-session", 1)).toThrow(
      "The Host returned a different session owner.",
    );
    expectNoWrites();
  });

  it("throws and does not write for an older authority generation", () => {
    const fenced = shell(binding({ authorityGeneration: 5, created: true }));

    expect(() => acknowledgedHostSessionBinding(fenced, "host-session-1", 4)).toThrow(
      "The Host returned a different session owner.",
    );
    expectNoWrites();
  });

  it("throws and does not write when a fenced binding gets a receipt without generation", () => {
    const fenced = shell(binding({ authorityGeneration: 5 }));

    expect(() => acknowledgedHostSessionBinding(fenced, "host-session-1", undefined)).toThrow(
      "The Host returned a different session owner.",
    );
    expectNoWrites();
  });

  it.each([0, -1, 1.5, Number.NaN])("rejects invalid generation %s without writing", (value) => {
    expect(() => acknowledgedHostSessionBinding(shell(binding()), "host-session-1", value)).toThrow(
      "The Host returned a different session owner.",
    );
    expectNoWrites();
  });

  it("accepts an equal or newer generation without writing", () => {
    const fenced = shell(binding({ authorityGeneration: 5 }));

    expect(acknowledgedHostSessionBinding(fenced, "host-session-1", 5)?.authorityGeneration).toBe(
      5,
    );
    expect(acknowledgedHostSessionBinding(fenced, "host-session-1", 6)?.authorityGeneration).toBe(
      6,
    );
    expectNoWrites();
  });
});

describe("acknowledgeHostSessionBinding", () => {
  let storage: ReturnType<typeof installCountingStorage>;

  beforeEach(() => {
    storage = installCountingStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes exactly once and persists the acknowledged binding", () => {
    const owner = shell(binding());

    acknowledgeHostSessionBinding(owner, "host-session-1", 2);

    expect(storage.writes).toEqual([`${KEY_PREFIX}shell-1`]);
    expect(hostSessionBinding(owner)).toMatchObject({ created: true, authorityGeneration: 2 });
  });

  it("does not write when the receipt is rejected", () => {
    expect(() => acknowledgeHostSessionBinding(shell(binding()), "other-session", 1)).toThrow();

    expect(storage.writes).toEqual([]);
    expect(storage.data.size).toBe(0);
  });

  it("does not write when the shell has no Host binding", () => {
    acknowledgeHostSessionBinding(shell(), "host-session-1", 1);

    expect(storage.writes).toEqual([]);
  });
});
