// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../../sessions/model/session";
import {
  HOST_SESSION_DELETED_TTL_MS,
  forgetHostSessionShell,
  hostSessionBinding,
  hostSessionShellSummaries,
  restoreHostSessionShell,
  saveHostSessionBinding,
  type HostSessionBinding,
} from "./sessionExecutionBinding";

const PREFIX = "bycoda.host-session-binding.v1:";
const QUARANTINE_PREFIX = "bycoda.host-session-binding.quarantine.v1:";
const NOW = Date.parse("2026-11-03T12:00:00Z");

function binding(overrides: Partial<HostSessionBinding> = {}): HostSessionBinding {
  return {
    kind: "local-host",
    machineId: "machine-1",
    environmentId: "env-1",
    projectId: "project-1",
    sessionId: "host-session-1",
    authorityGeneration: null,
    created: true,
    ...overrides,
  };
}

function shell(id: string): Session {
  return { id, cwd: "/work", title: `Shell ${id}`, blocks: [] } as unknown as Session;
}

function save(id: string) {
  return saveHostSessionBinding(shell(id), binding({ sessionId: `host-${id}` }));
}

describe("host session binding storage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("lists stored shells from the index without parsing unchanged records again", () => {
    for (const id of ["a", "b", "c"]) save(id);
    const parse = vi.spyOn(JSON, "parse");
    expect(hostSessionShellSummaries().map((entry) => entry.id).sort()).toEqual(["a", "b", "c"]);
    expect(hostSessionShellSummaries()).toHaveLength(3);
    expect(hostSessionBinding({ id: "b" })?.sessionId).toBe("host-b");
    expect(parse).not.toHaveBeenCalled();
    // A record another writer changed is parsed once more, the others are not.
    const raw = JSON.parse(localStorage.getItem(`${PREFIX}b`)!);
    localStorage.setItem(`${PREFIX}b`, JSON.stringify({ ...raw, pinned: true }));
    expect(hostSessionShellSummaries().find((entry) => entry.id === "b")?.pinned).toBe(true);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("sets an unreadable record aside once, keeps listing the others and never throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    save("good");
    localStorage.setItem(`${PREFIX}broken`, "{not json");
    localStorage.setItem(`${PREFIX}foreign`, JSON.stringify({ binding: binding(), shell: { id: "other" } }));
    expect(hostSessionShellSummaries().map((entry) => entry.id)).toEqual(["good"]);
    expect(hostSessionShellSummaries().map((entry) => entry.id)).toEqual(["good"]);
    expect(hostSessionBinding({ id: "broken" })).toBeUndefined();
    expect(restoreHostSessionShell("foreign")).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(`${PREFIX}broken`)).toBeNull();
    expect(localStorage.getItem(`${QUARANTINE_PREFIX}broken`)).toBe("{not json");
    expect(localStorage.getItem(`${QUARANTINE_PREFIX}foreign`)).toContain('"id":"other"');
  });

  it("picks up keys another window added or removed through storage events", () => {
    save("mine");
    expect(hostSessionShellSummaries()).toHaveLength(1);
    const theirs = JSON.stringify({
      binding: binding({ sessionId: "host-theirs" }),
      shell: shell("theirs"),
      createdAt: NOW,
      updatedAt: NOW,
    });
    localStorage.setItem(`${PREFIX}theirs`, theirs);
    window.dispatchEvent(new StorageEvent("storage", { key: `${PREFIX}theirs`, newValue: theirs }));
    expect(hostSessionShellSummaries().map((entry) => entry.id).sort()).toEqual(["mine", "theirs"]);
    localStorage.removeItem(`${PREFIX}theirs`);
    window.dispatchEvent(new StorageEvent("storage", { key: `${PREFIX}theirs`, newValue: null }));
    expect(hostSessionShellSummaries().map((entry) => entry.id)).toEqual(["mine"]);
  });

  it("keeps a deleted marker as a routing fence and removes it after 30 days", () => {
    save("gone");
    forgetHostSessionShell("gone");
    expect(hostSessionShellSummaries()).toEqual([]);
    expect(() => save("gone")).toThrow("This Host conversation was deleted.");
    vi.setSystemTime(NOW + HOST_SESSION_DELETED_TTL_MS - 1);
    hostSessionShellSummaries();
    expect(localStorage.getItem(`${PREFIX}gone`)).not.toBeNull();
    vi.setSystemTime(NOW + HOST_SESSION_DELETED_TTL_MS);
    hostSessionShellSummaries();
    expect(localStorage.getItem(`${PREFIX}gone`)).toBeNull();
    expect(() => save("gone")).not.toThrow();
  });

  it("expires legacy deleted markers that carry no deletion time by their update time", () => {
    localStorage.setItem(
      `${PREFIX}legacy`,
      JSON.stringify({
        binding: binding(),
        shell: shell("legacy"),
        createdAt: NOW - HOST_SESSION_DELETED_TTL_MS - 1,
        updatedAt: NOW - HOST_SESSION_DELETED_TTL_MS - 1,
        deleted: true,
      }),
    );
    hostSessionShellSummaries();
    expect(localStorage.getItem(`${PREFIX}legacy`)).toBeNull();
  });

  it("reports a clear error when browser storage is full", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });
    expect(() => save("new")).toThrow(/Browser storage is full/);
    expect(() => save("new")).not.toThrow(/quota has been exceeded/);
  });

  it("frees expired deleted markers and retries once when storage is full", () => {
    save("old");
    forgetHostSessionShell("old");
    vi.setSystemTime(NOW + HOST_SESSION_DELETED_TTL_MS + 1);
    const real = Storage.prototype.setItem;
    let failures = 0;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (localStorage.getItem(`${PREFIX}old`) !== null) {
        failures++;
        throw new DOMException("full", "QuotaExceededError");
      }
      real.call(this, key, value);
    });
    expect(() => save("new")).not.toThrow();
    expect(failures).toBe(1);
    expect(localStorage.getItem(`${PREFIX}old`)).toBeNull();
    expect(hostSessionShellSummaries().map((entry) => entry.id)).toEqual(["new"]);
  });

  it("wraps other write failures without hiding their reason", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("disk gone");
    });
    expect(() => save("new")).toThrow(/Could not save this Host conversation locally: disk gone/);
  });
});
