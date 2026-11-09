// @vitest-environment happy-dom
import { beforeEach, expect, it } from "vitest";
import type { HostCommand } from "./protocol";
import {
  pendingRemoteCommand,
  pendingRemoteFollowup,
  remoteIntentAuthority,
  remoteIntentAuthorityMatches,
  remoteOutboxIssues,
  savePendingRemoteCommand,
} from "./remoteOutbox";

beforeEach(() => localStorage.clear());
const send: HostCommand = {
  type: "send",
  commandId: "original-id",
  sessionId: "session",
  text: "keep my message",
};

it("binds a new intent to the displayed authority without changing it when a newer view arrives", () => {
  const displayed = { authorityGeneration: 3 };
  const intent = { ...send, ...remoteIntentAuthority(displayed) };
  savePendingRemoteCommand("project", "env", intent);
  displayed.authorityGeneration = 4;
  expect(remoteIntentAuthorityMatches(intent, displayed)).toBe(false);
  expect(pendingRemoteCommand("project", "env", "session")).toEqual({
    ...send,
    authorityGeneration: 3,
  });
});

it.each([undefined, 2])(
  "keeps persisted generation %s and rejects upgrading the original command ID",
  (generation) => {
    const original = {
      ...send,
      ...(generation === undefined ? {} : { authorityGeneration: generation }),
    };
    savePendingRemoteCommand("project", "env", original);
    const before = localStorage.getItem('bycoda.remote-command.v1:["project","env"]:original-id');
    expect(() =>
      savePendingRemoteCommand("project", "env", { ...original, authorityGeneration: 3 }),
    ).toThrow("pending request changed");
    expect(localStorage.getItem('bycoda.remote-command.v1:["project","env"]:original-id')).toBe(
      before,
    );
    expect(pendingRemoteCommand("project", "env", "session")).toEqual(original);
  },
);

it("preserves a retained create follow-up generation and payload instead of blessing it from a receipt/new view", () => {
  const create: HostCommand = {
    type: "create",
    commandId: "create",
    projectId: "project",
    harness: "codex",
    model: "fixture",
    runtimeMode: "supervised",
  };
  const followup = { ...send, sessionId: "", authorityGeneration: 2 };
  savePendingRemoteCommand("project", "env", create, "shell", followup);
  expect(() =>
    savePendingRemoteCommand("project", "env", create, "shell", {
      ...followup,
      authorityGeneration: 3,
    }),
  ).toThrow("pending request changed");
  expect(pendingRemoteFollowup("project", "env", "create")).toEqual(followup);
});

it("keeps equal payload retries and original identity even when property order differs", () => {
  savePendingRemoteCommand("project", "env", { ...send, authorityGeneration: 2 });
  savePendingRemoteCommand("project", "env", {
    authorityGeneration: 2,
    text: send.text,
    sessionId: "session",
    type: "send",
    commandId: "original-id",
  });
  expect(pendingRemoteCommand("project", "env", "session")).toEqual({
    ...send,
    authorityGeneration: 2,
  });
  expect(() =>
    savePendingRemoteCommand("project", "env", {
      ...send,
      authorityGeneration: 2,
      text: "different message",
    }),
  ).toThrow("pending request changed");
});

it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, "2", null])(
  "holds malformed authority metadata %s for recovery instead of dropping the field",
  (generation) => {
    const invalid = { ...send, authorityGeneration: generation };
    expect(() => remoteIntentAuthority(invalid as never)).toThrow("invalid remote request");
    expect(() => savePendingRemoteCommand("project", "env", invalid as never)).toThrow(
      "invalid remote request",
    );
    localStorage.setItem(
      'bycoda.remote-command.v1:["project","env"]:original-id',
      JSON.stringify(invalid),
    );
    expect(pendingRemoteCommand("project", "env", "session")).toBeUndefined();
    expect(remoteOutboxIssues("project", "env")).toHaveLength(1);
  },
);

it("rejects malformed atomic first-turn metadata independently of its create envelope", () => {
  const command = {
    type: "create",
    commandId: "create",
    projectId: "project",
    harness: "codex",
    model: "fixture",
    runtimeMode: "supervised",
    firstTurn: { ...send, sessionId: "", authorityGeneration: 0 },
  };
  expect(() => savePendingRemoteCommand("project", "env", command as HostCommand)).toThrow(
    "invalid remote request",
  );
});

it("keeps untouched legacy intent shapes and explicitly distinguishes missing provenance", () => {
  expect(remoteIntentAuthority(undefined)).toEqual({});
  expect(remoteIntentAuthorityMatches({}, {})).toBe(true);
  expect(remoteIntentAuthorityMatches({}, { authorityGeneration: 1 })).toBe(false);
  expect(remoteIntentAuthorityMatches({ authorityGeneration: 1 }, {})).toBe(false);
  savePendingRemoteCommand("project", "env", send);
  expect(pendingRemoteCommand("project", "env", "session")).toEqual(send);
  expect(pendingRemoteCommand("project", "env", "session")).not.toHaveProperty(
    "authorityGeneration",
  );
});
