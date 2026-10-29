// @vitest-environment happy-dom
import { beforeEach, expect, it } from "vitest";
import {
  pendingRemoteCommand,
  pendingRemoteFollowup,
  savePendingRemoteCommand,
} from "./connections";
import type { HostCommand } from "./protocol";
import {
  markRemoteCommandStopped,
  remoteCommandWasStopped,
  pendingRemoteAttachmentIds,
  pendingRemoteEnvironmentAttachmentIds,
} from "./remoteOutbox";

beforeEach(() => localStorage.clear());

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
