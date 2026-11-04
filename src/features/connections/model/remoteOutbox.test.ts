// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  pendingRemoteCommand,
  pendingRemoteFollowup,
  savePendingRemoteCommand,
} from "./connections";
import type { HostCommand } from "./protocol";
import {
  REMOTE_OUTBOX_BUDGET_BYTES,
  REMOTE_OUTBOX_QUARANTINE_TTL_MS,
  archiveRemoteOutboxIssue,
  markRemoteCommandStopped,
  remoteCommandWasStopped,
  pendingRemoteAttachmentIds,
  pendingRemoteEnvironmentAttachmentIds,
  sweepRemoteOutboxQuarantine,
} from "./remoteOutbox";

beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

it.each(["send", "draft"] as const)(
  "retains an atomic %s without inventing its nested session ID",
  (type) => {
    const command: Extract<HostCommand, { type: "create" }> = {
      type: "create",
      commandId: "atomic-create",
      projectId: "p",
      harness: "codex",
      model: "test",
      runtimeMode: "supervised",
      firstTurn: {
        type,
        commandId: "atomic-first",
        text: "Original prompt",
        attachments: [
          {
            id: "attachment-original",
            name: "file.txt",
            mimeType: "text/plain",
            kind: "file",
            size: 4,
          },
        ],
      },
    };
    savePendingRemoteCommand("project", "env", command, "first-tab");
    expect(pendingRemoteCommand("project", "env", null, "first-tab")).toEqual(command);
    expect(command.firstTurn).not.toHaveProperty("sessionId");
    expect(pendingRemoteAttachmentIds("project", "env", "first-tab")).toEqual([
      "attachment-original",
    ]);
    expect(pendingRemoteEnvironmentAttachmentIds("env")).toEqual(["attachment-original"]);
    expect(pendingRemoteCommand("project", "env", null, "first-tab")?.commandId).toBe(
      "atomic-create",
    );
  },
);
it("persists Stop across command saves without changing the original request or follow-up", () => {
  savePendingRemoteCommand("project", "env", create, "first-tab", followup);
  markRemoteCommandStopped("project", "env", create.commandId);
  savePendingRemoteCommand("project", "env", create, "first-tab");
  expect(remoteCommandWasStopped("project", "env", create.commandId)).toBe(true);
  expect(pendingRemoteCommand("project", "env", null, "first-tab")).toEqual(create);
  expect(pendingRemoteFollowup("project", "env", create.commandId)).toEqual(followup);
});
it("preserves the original turn identity when recovering a steering request", () => {
  const command: HostCommand = {
    type: "steer",
    commandId: "redirect-1",
    sessionId: "host-session",
    runId: "original-turn",
    text: "Change direction",
  };
  savePendingRemoteCommand("project", "env", command, "first-tab");
  expect(pendingRemoteCommand("project", "env", "host-session", "first-tab")).toEqual(command);
});
const create: HostCommand = {
  type: "create",
  commandId: "create-1",
  projectId: "p",
  harness: "codex",
  model: "test",
  runtimeMode: "supervised",
};
const followup: HostCommand = {
  type: "send",
  commandId: "send-1",
  sessionId: "",
  text: "First message",
};

it("isolates unfinished creates by tab and keeps their original first message on retry", () => {
  savePendingRemoteCommand("project", "env", create, "first-tab", followup);
  expect(pendingRemoteCommand("project", "env", null, "second-tab")).toBeUndefined();
  expect(pendingRemoteCommand("project", "env", null, "first-tab")).toEqual(create);
  savePendingRemoteCommand("project", "env", create, "first-tab");
  expect(pendingRemoteFollowup("project", "env", create.commandId)).toEqual(followup);
});

it("can recover commands saved by the earlier desktop", () => {
  localStorage.setItem(
    'bycoda.remote-command.v1:["project","env"]:create-1',
    JSON.stringify(create),
  );
  expect(pendingRemoteCommand("project", "env", null, "first-tab")).toEqual(create);
});

const QUARANTINE = "bycoda.remote-command-quarantine.v1:";
const INDEX = "bycoda.remote-command-quarantine-index.v1";

it("removes quarantined requests seven days after they were set aside", () => {
  const now = Date.parse("2026-11-03T12:00:00Z");
  vi.useFakeTimers({ now, toFake: ["Date"] });
  const key = 'bycoda.remote-command.v1:["project","env"]:bad';
  localStorage.setItem(key, "null");
  archiveRemoteOutboxIssue(key);
  expect(localStorage.getItem(`${QUARANTINE}${key}`)).toBe("null");
  expect(JSON.parse(localStorage.getItem(INDEX)!)).toEqual({ [`${QUARANTINE}${key}`]: now });
  vi.setSystemTime(now + REMOTE_OUTBOX_QUARANTINE_TTL_MS - 1);
  savePendingRemoteCommand("project", "env", create, "first-tab");
  expect(localStorage.getItem(`${QUARANTINE}${key}`)).toBe("null");
  vi.setSystemTime(now + REMOTE_OUTBOX_QUARANTINE_TTL_MS);
  savePendingRemoteCommand("project", "env", create, "first-tab");
  expect(localStorage.getItem(`${QUARANTINE}${key}`)).toBeNull();
  expect(JSON.parse(localStorage.getItem(INDEX)!)).toEqual({});
});

it("dates a quarantined request from before the index at first sight, not at once", () => {
  const now = Date.parse("2026-11-03T12:00:00Z");
  vi.useFakeTimers({ now, toFake: ["Date"] });
  const legacy = `${QUARANTINE}bycoda.remote-command.v1:["project","env"]:old`;
  localStorage.setItem(legacy, '{"command":null}');
  sweepRemoteOutboxQuarantine();
  expect(localStorage.getItem(legacy)).toBe('{"command":null}');
  expect(JSON.parse(localStorage.getItem(INDEX)!)).toEqual({ [legacy]: now });
  sweepRemoteOutboxQuarantine(now + REMOTE_OUTBOX_QUARANTINE_TTL_MS);
  expect(localStorage.getItem(legacy)).toBeNull();
});

it("caps the pending outbox at the 3 MB budget", () => {
  expect(REMOTE_OUTBOX_BUDGET_BYTES).toBe(3 * 1024 * 1024);
  // Two requests of another project already use ~2.9 MB (UTF-16 bytes).
  const filler = "x".repeat(Math.floor((1.45 * 1024 * 1024) / 2));
  localStorage.setItem('bycoda.remote-command.v1:["other","env"]:one', filler);
  localStorage.setItem('bycoda.remote-command.v1:["other","env"]:two', filler);
  const big: HostCommand = { ...create, commandId: "big", model: "m".repeat(200 * 1024) };
  expect(() => savePendingRemoteCommand("project", "env", big, "first-tab")).toThrow(
    "Remote outbox is full",
  );
  expect(() => savePendingRemoteCommand("project", "env", create, "first-tab")).not.toThrow();
});
