// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  archiveRemoteOutboxIssue,
  pendingRemoteCommand,
  pendingRemoteFollowup,
  remoteOutboxIssues,
  savePendingRemoteCommand,
} from "./remoteOutbox";
import type { HostCommand } from "./protocol";

const prefix = 'bycoda.remote-command.v1:["project","env"]:';
const create: HostCommand = {
  type: "create",
  commandId: "good",
  projectId: "p",
  harness: "codex",
  model: "test",
  runtimeMode: "supervised",
};
beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

it("retains an atomic first turn through durable outbox recovery", () => {
  const atomic = {
    ...create,
    firstTurn: { type: "send" as const, commandId: "first", sessionId: "", text: "hello" },
  };
  savePendingRemoteCommand("project", "env", atomic, "shell");
  expect(pendingRemoteCommand("project", "env", null, "shell")).toEqual(atomic);
  expect(pendingRemoteFollowup("project", "env", "good")).toBeUndefined();
});
afterEach(() => vi.unstubAllGlobals());

it.each(["{bad json", "null", "[]", '{"command":null}', '{"v":2,"command":{}}'])(
  "isolates unreadable entry %s without hiding a valid request",
  (invalid) => {
    localStorage.setItem(`${prefix}bad`, invalid);
    localStorage.setItem(`${prefix}good`, JSON.stringify(create));
    expect(pendingRemoteCommand("project", "env")).toEqual(create);
    expect(pendingRemoteFollowup("project", "env", "bad")).toBeUndefined();
    expect(remoteOutboxIssues()).toEqual([
      { key: `${prefix}bad`, project: "project", environment: "env" },
    ]);
    expect(localStorage.getItem(`${prefix}bad`)).toBe(invalid);
    expect(() => savePendingRemoteCommand("project", "env", create)).toThrow("needs recovery");
  },
);

it("does not retry unknown commands, invalid attachments or mismatched command IDs", () => {
  const invalid = [
    { type: "new-future-command", commandId: "bad", sessionId: "s" },
    {
      type: "send",
      commandId: "bad",
      sessionId: "s",
      text: "x",
      attachments: [{ id: "a", size: -1 }],
    },
    { ...create, commandId: "different" },
  ];
  for (const command of invalid) {
    localStorage.setItem(`${prefix}bad`, JSON.stringify({ v: 1, command }));
    expect(pendingRemoteCommand("project", "env")).toBeUndefined();
    expect(remoteOutboxIssues()).toHaveLength(1);
  }
});

it.each(["send", "draft"] as const)(
  "accepts legacy and versioned envelopes and a create's empty-session %s followup",
  (type) => {
    const followup: HostCommand = {
      type,
      commandId: "send",
      sessionId: "",
      text: "Hello",
    };
    localStorage.setItem(
      `${prefix}good`,
      JSON.stringify({ command: create, shellId: "tab", followup }),
    );
    expect(remoteOutboxIssues()).toEqual([]);
    savePendingRemoteCommand("project", "env", create, "tab");
    expect(JSON.parse(localStorage.getItem(`${prefix}good`)!)).toMatchObject({
      v: 1,
      followup,
    });
    expect(pendingRemoteFollowup("project", "env", "good")).toEqual(followup);
  },
);

it("preserves the original bytes in quarantine before releasing sending", () => {
  const original = '{"command":null,"text":"keep me"}';
  localStorage.setItem(`${prefix}bad`, original);
  archiveRemoteOutboxIssue(`${prefix}bad`);
  expect(localStorage.getItem(`${prefix}bad`)).toBeNull();
  const archives = Object.keys(localStorage).filter((key) =>
    key.startsWith("bycoda.remote-command-quarantine.v1:"),
  );
  expect(archives).toHaveLength(1);
  expect(localStorage.getItem(archives[0])).toBe(original);
  expect(remoteOutboxIssues()).toEqual([]);
  expect(() => savePendingRemoteCommand("project", "env", create)).not.toThrow();
});

it("preserves distinct historical raw bytes and deduplicates identical recovery", () => {
  const key = `${prefix}bad`;
  const archiveKeys = () =>
    Object.keys(localStorage).filter((name) =>
      name.startsWith("bycoda.remote-command-quarantine.v1:"),
    );
  for (const raw of ["null", "{different", "null"]) {
    localStorage.setItem(key, raw);
    archiveRemoteOutboxIssue(key);
  }
  const archives = archiveKeys();
  expect(archives).toHaveLength(2);
  expect(archives.map((name) => localStorage.getItem(name)).sort()).toEqual(
    ["null", "{different"].sort(),
  );
});

it("counts quarantined bytes and records before admitting a new request", () => {
  for (let i = 0; i < 100; i++)
    localStorage.setItem(`bycoda.remote-command-quarantine.v1:fixture-${i}`, "retained");
  expect(() => savePendingRemoteCommand("project", "env", create)).toThrow("Remote outbox is full");
  expect(localStorage.getItem(`${prefix}good`)).toBeNull();
  expect(localStorage.getItem("bycoda.remote-command-quarantine.v1:fixture-0")).toBe("retained");
});

it("keeps an identical durable request idempotent when the archive budget is full", () => {
  savePendingRemoteCommand("project", "env", create, "shell");
  const before = localStorage.getItem(`${prefix}good`);
  for (let i = 0; i < 100; i++)
    localStorage.setItem(`bycoda.remote-command-quarantine.v1:fixture-${i}`, "retained");
  expect(() => savePendingRemoteCommand("project", "env", create, "shell")).not.toThrow();
  expect(localStorage.getItem(`${prefix}good`)).toBe(before);
  expect(pendingRemoteCommand("project", "env", null, "shell")).toEqual(create);
});

it("retains a request changed during archival while keeping the earlier evidence", () => {
  const key = `${prefix}bad`;
  const store = localStorage;
  store.setItem(key, "null");
  vi.stubGlobal("localStorage", {
    get length() {
      return store.length;
    },
    key: store.key.bind(store),
    getItem: store.getItem.bind(store),
    removeItem: store.removeItem.bind(store),
    setItem: (name: string, value: string) => {
      store.setItem(name, value);
      if (name.startsWith("bycoda.remote-command-quarantine.v1:")) store.setItem(key, "{newer");
    },
  });
  expect(() => archiveRemoteOutboxIssue(key)).toThrow("changed during recovery");
  expect(store.getItem(key)).toBe("{newer");
  const archive = Object.keys(store).find((name) =>
    name.startsWith("bycoda.remote-command-quarantine.v1:"),
  );
  expect(archive && store.getItem(archive)).toBe("null");
});

it("does not release an unreadable request when its archive cannot be saved", () => {
  localStorage.setItem(`${prefix}bad`, "null");
  const store = localStorage;
  vi.stubGlobal("localStorage", {
    get length() {
      return store.length;
    },
    key: store.key.bind(store),
    getItem: store.getItem.bind(store),
    removeItem: store.removeItem.bind(store),
    setItem: () => {
      throw new Error("storage full");
    },
  });
  expect(() => archiveRemoteOutboxIssue(`${prefix}bad`)).toThrow("storage full");
  expect(localStorage.getItem(`${prefix}bad`)).toBe("null");
  expect(remoteOutboxIssues()).toHaveLength(1);
});

it("handles colons and closing brackets inside project paths without mixing machines", () => {
  const project = "C:/work/]:folder";
  localStorage.setItem(`bycoda.remote-command.v1:${JSON.stringify([project, "env"])}:bad`, "null");
  expect(remoteOutboxIssues(project, "env")).toHaveLength(1);
  expect(remoteOutboxIssues(project, "other")).toEqual([]);
  expect(remoteOutboxIssues("other", "env")).toEqual([]);
});
