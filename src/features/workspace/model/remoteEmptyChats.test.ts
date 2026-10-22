import { describe, expect, it } from "vitest";
import type { Session } from "../../sessions/model/session";
import { isUnsentRemoteChat, isUnsentRemoteShell } from "./remoteEmptyChats";

const remote = "remote://machine-1/work/alpha";
const local = "/work/alpha";
const unsent = { bound: false, pending: false, hasDraft: false };

function chat(patch: Partial<Session> = {}): Session {
  return { id: "shell-1", cwd: remote, blocks: [], ...patch } as unknown as Session;
}

describe("isUnsentRemoteShell", () => {
  const shell = { id: "shell-1", cwd: remote };

  it("treats an unbound, idle remote shell as unsent", () => {
    expect(isUnsentRemoteShell(shell, unsent)).toBe(true);
  });

  it.each([
    ["bound to a host session", { ...unsent, bound: true }],
    ["with a create or send queued", { ...unsent, pending: true }],
    ["with an unsent draft", { ...unsent, hasDraft: true }],
  ])("keeps a shell %s", (_label, state) => {
    expect(isUnsentRemoteShell(shell, state)).toBe(false);
  });

  it("keeps a shell that already has a provider conversation", () => {
    expect(isUnsentRemoteShell({ ...shell, providerSessionId: "p-1" }, unsent)).toBe(false);
  });

  it("never claims a local project", () => {
    expect(isUnsentRemoteShell({ id: "shell-1", cwd: local }, unsent)).toBe(false);
  });
});

describe("isUnsentRemoteChat", () => {
  it("accepts an empty, unbound remote chat", () => {
    expect(isUnsentRemoteChat(chat(), unsent)).toBe(true);
  });

  it("keeps a remote chat that holds a user turn", () => {
    const withTurn = chat({
      blocks: [{ id: "u", role: "user", text: "hi" }] as unknown as Session["blocks"],
    });
    expect(isUnsentRemoteChat(withTurn, unsent)).toBe(false);
  });

  it("keeps a remote chat whose transcript is still loading", () => {
    expect(isUnsentRemoteChat(chat({ historyLoading: true }), unsent)).toBe(false);
  });

  it("keeps a bound remote chat even when its local transcript is empty", () => {
    expect(isUnsentRemoteChat(chat(), { ...unsent, bound: true })).toBe(false);
  });
});
