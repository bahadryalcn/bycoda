import { describe, expect, it, vi } from "vitest";
import {
  ConversationDesktopControlTools,
  desktopConversationPrincipal,
  type ConversationDesktopControlPorts,
} from "./conversation-desktop-control-tools";
import { conversationToolCatalog, validateConversationTool } from "./conversation-tools";
import { createManagedToolCatalog } from "../tool-management";
import type { RuntimeLogPrincipal, RuntimeLogSubjectPrincipal } from "../runtime-log-tools";
import type { DesktopControlResponse } from "../../src/shared/model/host-contracts/desktop-control";
import { voiceThreadToolAllowed } from "../../src/shared/model/voiceToolScope";

const session: RuntimeLogPrincipal = {
  kind: "session",
  sessionId: "real-session",
  projectId: "project",
  provider: "codex",
  assistantThreadId: "thread",
};
const thread: RuntimeLogSubjectPrincipal = {
  kind: "assistant-thread",
  threadId: "thread",
  projectId: "project",
  provider: "assistant",
};
const act = {
  requestId: "operation-one",
  snapshotId: "snapshot-one",
  ref: "@snapshot-one:1",
  action: "set-value",
  text: "Owner exact text",
};
function fixture() {
  let now = 0;
  const presence = vi
    .fn<ConversationDesktopControlPorts["presence"]>()
    .mockResolvedValue({ supported: true, locked: false, ownerPresent: true });
  const approved = vi.fn<NonNullable<ConversationDesktopControlPorts["approveOperation"]>>(
    async (input) => ({ approved: true, operationHash: input.operationHash }),
  );
  const request = vi.fn<ConversationDesktopControlPorts["desktop"]["request"]>(
    async (input, _principal, authorized) => {
      if (authorized && !(await authorized()))
        throw new Error("Captured authority denied inside queue.");
      const value = input as { op: string };
      if (value.op === "snapshot")
        return {
          snapshot: {
            snapshotId: "snapshot-one",
            app: "Editor",
            windowId: "window-one",
            complete: true,
            treeJson: '{"ref_id":"@snapshot-one:1"}',
          },
        };
      if (value.op === "status")
        return {
          configuration: {
            enabled: true,
            binaryPath: "private/path",
            binarySha256: "secret-hash",
            allowedApps: ["Editor"],
            allowPhysicalInput: false,
            version: 1,
          },
          status: {
            enabled: true,
            installed: true,
            verified: true,
            stopped: false,
            active: false,
            upstreamRef: "pinned",
            protocol: "2.5",
            message: "Private helper path from filesystem error: private/path",
          },
        };
      return {
        operation: {
          requestId: act.requestId,
          state: "settled",
          ok: true,
          delivery: "delivered_unverified",
          retry: "unsafe",
        },
      } satisfies DesktopControlResponse;
    },
  );
  const tools = new ConversationDesktopControlTools({
    environmentId: "host",
    desktop: { request },
    presence,
    approveOperation: approved,
    now: () => now,
  });
  const call = (
    action: string,
    input: unknown,
    principal = session as RuntimeLogSubjectPrincipal,
    authorized = async () => true,
  ) => tools.call(action, input, principal, "G:/project", authorized);
  const observe = (principal = session as RuntimeLogSubjectPrincipal) =>
    call("desktop.snapshot", { app: "Editor" }, principal);
  return {
    call,
    observe,
    request,
    presence,
    approved,
    setNow(value: number) {
      now = value;
    },
  };
}

describe("desktop conversation tool authority", () => {
  it("launches with exact typed app approval without invented snapshot/window/ref identifiers", async () => {
    const f = fixture();
    await f.call("desktop.launch", { requestId: "launch-one", app: "Notepad" });
    expect(f.approved.mock.calls[0][0].operation).toEqual({
      kind: "launch",
      requestId: "launch-one",
      app: "Notepad",
    });
    expect(f.approved.mock.calls[0][0].operationHash).toBe(
      "f13425b74660e9303b9f74aa4957d4fdf0d73d52d781814f7994ad9f108259d4",
    );
    expect(f.request.mock.calls[0][0]).toEqual({
      op: "launch",
      requestId: "launch-one",
      app: "Notepad",
    });
    expect(await f.request.mock.calls[0][3]!()).toBe(false);
    expect(await f.request.mock.calls[0][4]!()).toBe(false);
    const managed = createManagedToolCatalog(
      "conversation",
      conversationToolCatalog().filter((tool) =>
        ["desktop.launch", "desktop.clipboard"].includes(tool.action),
      ),
    );
    expect(managed).toHaveLength(2);
    expect(
      managed.every(
        (tool) =>
          tool.supported &&
          tool.retry.mode === "same-request" &&
          tool.authorization.legacyScope === "write",
      ),
    ).toBe(true);
  });
  it("permits headless allowlisted launch on certified-away policy without pretending a focused owner approval", async () => {
    const f = fixture();
    f.presence.mockResolvedValue({ supported: true, locked: false, ownerPresent: false });
    await f.call("desktop.launch", { requestId: "away", app: "Editor" }, thread);
    expect(f.approved).not.toHaveBeenCalled();
    expect(await f.request.mock.calls[0][2]!()).toBe(true);
    f.presence.mockResolvedValue({ supported: true, locked: false, ownerPresent: undefined });
    expect(await f.request.mock.calls[0][2]!()).toBe(false);
  });
  it.each(["get", "set", "clear"])(
    "requires present owner and exact native review for thread clipboard %s",
    async (action) => {
      const input = { requestId: action, action, ...(action === "set" ? { text: "exact" } : {}) };
      for (const ownerPresent of [false, undefined]) {
        const f = fixture();
        f.presence.mockResolvedValue({ supported: true, locked: false, ownerPresent });
        await expect(f.call("desktop.clipboard", input)).rejects.toThrow("owner to be present");
        expect(f.approved).not.toHaveBeenCalled();
        expect(f.request).not.toHaveBeenCalled();
      }
      const f = fixture();
      await f.call("desktop.clipboard", input, thread);
      expect(f.approved).toHaveBeenCalledOnce();
      expect(f.approved.mock.calls[0][0].principal).toEqual(thread);
      expect(f.request).toHaveBeenCalledOnce();
      expect(await f.request.mock.calls[0][4]!()).toBe(true);
      const denied = fixture();
      denied.approved.mockResolvedValue({ approved: false });
      await expect(denied.call("desktop.clipboard", input, thread)).rejects.toThrow("not approved");
      expect(denied.request).not.toHaveBeenCalled();
    },
  );
  it("binds clipboard text/hash/global target and grants only internal sensitive authority for this request", async () => {
    const f = fixture();
    await f.call("desktop.clipboard", {
      requestId: "clipboard-one",
      action: "set",
      text: 'Ayşe: "tam metin"\nikinci satır',
    });
    expect(f.approved.mock.calls[0][0].operation).toEqual({
      kind: "clipboard",
      requestId: "clipboard-one",
      target: "global-clipboard",
      action: "set",
      text: 'Ayşe: "tam metin"\nikinci satır',
    });
    expect(f.approved.mock.calls[0][0].operationHash).toBe(
      "606539e22b382156f830663a0aedd7b3e08d7c078a6f472f392dbab940c7b423",
    );
    expect(await f.request.mock.calls[0][3]!()).toBe(false);
    expect(await f.request.mock.calls[0][4]!()).toBe(true);
    f.presence.mockResolvedValue({ supported: true, locked: false, ownerPresent: false });
    expect(await f.request.mock.calls[0][4]!()).toBe(false);
    await expect(
      f.call("desktop.clipboard", { requestId: "next", action: "get" }),
    ).rejects.toThrow();
  });
  it("never accepts model clipboard approval, alternate channels or a changed payload after real review", async () => {
    const f = fixture();
    for (const input of [
      { requestId: "get", action: "get", approved: true },
      { requestId: "get", action: "get", text: "extra" },
      { requestId: "set", action: "set" },
      { requestId: "file", action: "set", text: "x", file: "private" },
      { requestId: "launch", app: "Editor", args: ["unsafe"] },
    ])
      await expect(
        f.call("app" in input ? "desktop.launch" : "desktop.clipboard", input),
      ).rejects.toThrow();
    expect(f.approved).not.toHaveBeenCalled();
    const input = { requestId: "immutable", action: "set", text: "captured" };
    f.approved.mockImplementationOnce(async (approval) => {
      input.text = "mutated";
      return { approved: true, operationHash: approval.operationHash };
    });
    await f.call("desktop.clipboard", input);
    expect(f.request.mock.calls[0][0]).toMatchObject({ text: "captured" });
  });
  it("does not reuse denied/revoked clipboard approval across queued work", async () => {
    const f = fixture();
    f.approved.mockResolvedValueOnce({ approved: false });
    await expect(
      f.call("desktop.clipboard", { requestId: "denied", action: "get" }),
    ).rejects.toThrow("not approved");
    expect(f.request).not.toHaveBeenCalled();
    let active = true;
    f.approved.mockImplementationOnce(async (approval) => {
      active = false;
      return { approved: true, operationHash: approval.operationHash };
    });
    await expect(
      f.call(
        "desktop.clipboard",
        { requestId: "revoked", action: "get" },
        session,
        async () => active,
      ),
    ).rejects.toThrow("revoked");
    expect(f.request).not.toHaveBeenCalled();
  });
  it("routes named ref commands through the same exact native approval without model action overrides", async () => {
    const f = fixture();
    await f.observe();
    await f.call("desktop.setValue", {
      requestId: "named-value",
      snapshotId: act.snapshotId,
      ref: act.ref,
      text: "reviewed text",
    });
    expect(f.approved.mock.calls[0][0].operation).toMatchObject({
      action: "set-value",
      text: "reviewed text",
      snapshotId: act.snapshotId,
      ref: act.ref,
      headed: false,
    });
    expect(f.request.mock.calls[1][0]).toEqual({
      op: "act",
      action: "set-value",
      requestId: "named-value",
      snapshotId: act.snapshotId,
      ref: act.ref,
      text: "reviewed text",
    });
    await expect(
      f.call("desktop.click", {
        requestId: "override",
        snapshotId: act.snapshotId,
        ref: act.ref,
        action: "press",
      }),
    ).rejects.toThrow("override");
    expect(() =>
      validateConversationTool("desktop.press", {
        requestId: "press",
        snapshotId: act.snapshotId,
        ref: act.ref,
        text: "Ctrl+S",
        headed: false,
      }),
    ).toThrow();
    expect(voiceThreadToolAllowed("conversation", "desktop.click")).toBe(true);
  });
  it("discovers only strict bounded tools, with observations marked read-only", () => {
    for (const action of [
      "desktop.status",
      "desktop.snapshot",
      "desktop.windows.list",
      "desktop.find",
      "desktop.screenshot",
      "desktop.wait",
      "desktop.act",
    ]) {
      const item = conversationToolCatalog().find((tool) => tool.action === action)!;
      expect(item).toBeDefined();
      expect(item.annotations.readOnlyHint).toBe(action !== "desktop.act");
    }
    validateConversationTool("desktop.act", act);
    expect(() => validateConversationTool("desktop.act", { ...act, approved: true })).toThrow();
    expect(() =>
      validateConversationTool("desktop.act", { ...act, text: "x".repeat(10001) }),
    ).toThrow();
    expect(voiceThreadToolAllowed("conversation", "desktop.snapshot")).toBe(true);
    expect(voiceThreadToolAllowed("conversation", "desktop.act")).toBe(true);
    expect(voiceThreadToolAllowed("conversation", "desktop.wait")).toBe(true);
    const managed = createManagedToolCatalog(
      "conversation",
      conversationToolCatalog().filter((tool) => tool.action.startsWith("desktop.")),
    );
    expect(managed.every((tool) => tool.supported)).toBe(true);
    expect(managed.find((tool) => tool.action === "desktop.screenshot")).toMatchObject({
      effects: ["read", "presentation"],
      presentation: "image",
      authorization: { legacyScope: "read" },
    });
    const effect = managed.find((tool) => tool.action === "desktop.act")!;
    expect(effect.effects).toEqual(["presentation", "execution", "external-write"]);
    expect(effect.authorization).toEqual({
      legacyScope: "write",
      requirement: "existing-host-gates",
    });
    expect(effect.retry).toMatchObject({
      mode: "same-request",
      persistence: "operation-contract",
      identityFields: ["requestId"],
    });
    expect(effect.readback).toEqual([
      "conversation:desktop.snapshot",
      "conversation:desktop.status",
    ]);
    expect(effect.cancellation).toEqual([]); // Stop is direct-owner only, never a model tool.
  });
  it("uses stable thread identity across fresh request grants and actual focused sessions", () => {
    expect(desktopConversationPrincipal("host", session)).toEqual(
      desktopConversationPrincipal("host", thread),
    );
    expect(
      desktopConversationPrincipal("host", { ...session, sessionId: "different-focus" }),
    ).toEqual(desktopConversationPrincipal("host", thread));
    expect(desktopConversationPrincipal("other-host", thread)).not.toEqual(
      desktopConversationPrincipal("host", thread),
    );
    expect(
      desktopConversationPrincipal("host", { ...thread, projectId: "different-project" }),
    ).not.toEqual(desktopConversationPrincipal("host", thread));
    expect(
      desktopConversationPrincipal("host", { ...session, assistantThreadId: undefined }),
    ).not.toEqual(desktopConversationPrincipal("host", thread));
  });
  it("returns readiness and allowlist without leaking owner configuration", async () => {
    const f = fixture();
    const result = await f.call("desktop.status", {}, thread);
    expect(result).toMatchObject({ allowedApps: ["Editor"], status: { verified: true } });
    expect(result).not.toHaveProperty("configuration");
    expect(JSON.stringify(result)).not.toContain("private/path");
    expect(f.presence).not.toHaveBeenCalled();
    expect(f.approved).not.toHaveBeenCalled();
  });
  it("rejects revoked snapshot reads before any native dispatch", async () => {
    const f = fixture();
    await expect(
      f.call("desktop.snapshot", { app: "Editor" }, thread, async () => false),
    ).rejects.toThrow("revoked");
    expect(f.request).not.toHaveBeenCalled();
  });
  it.each(["desktop.configure", "desktop.stop", "desktop.resume"])(
    "rejects owner-only %s before adapter dispatch",
    async (action) => {
      const f = fixture();
      await expect(f.call(action, {})).rejects.toThrow("Unknown desktop");
      expect(f.request).not.toHaveBeenCalled();
    },
  );
  it.each([
    { ...act, approved: true },
    { ...act, op: "configure" },
    { ...act, app: "Injected" },
    { ...act, principal: { kind: "owner" } },
  ])("rejects injected authority or target fields", async (args) => {
    const f = fixture();
    await expect(f.call("desktop.act", args)).rejects.toThrow();
    expect(f.request).not.toHaveBeenCalled();
  });
  it("binds approval to trusted observed target and canonical exact operation", async () => {
    const f = fixture();
    await f.observe(thread);
    await f.call("desktop.act", act);
    const input = f.approved.mock.calls[0][0];
    expect(input).toMatchObject({
      principal: session,
      cwd: "G:/project",
      operation: { ...act, app: "Editor", windowId: "window-one", headed: false },
    });
    expect(input.operationHash).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.keys(input.operation)).toEqual([
      "requestId",
      "snapshotId",
      "app",
      "windowId",
      "ref",
      "action",
      "text",
      "headed",
    ]);
    expect(f.request.mock.calls[0][1]).toEqual(f.request.mock.calls[1][1]);
    expect(f.request.mock.calls[1][1].kind).toBe("assistant");
    expect(f.request.mock.calls[1][0]).toEqual({ op: "act", ...act });
  });
  it.each([{ approved: false }, { approved: true, operationHash: "wrong" }, null])(
    "refuses missing/denied/changed native approval",
    async (result) => {
      const f = fixture();
      await f.observe();
      f.approved.mockResolvedValue(result);
      await expect(f.call("desktop.act", act)).rejects.toThrow("not approved");
      expect(f.request).toHaveBeenCalledTimes(1);
    },
  );
  it("requires exact native approval for owner-present thread input without fabricating a session", async () => {
    const f = fixture();
    await f.observe(thread);
    await f.call("desktop.act", act, thread);
    expect(f.approved).toHaveBeenCalledOnce();
    expect(f.approved.mock.calls[0][0].principal).toEqual(thread);
    expect(f.request).toHaveBeenCalledTimes(2);
  });
  it("allows away headless thread input under adapter allowlist/ref/presence checks", async () => {
    const f = fixture();
    await f.observe(thread);
    f.presence.mockResolvedValue({ supported: true, locked: false, ownerPresent: false });
    await f.call("desktop.act", act, thread);
    expect(f.approved).not.toHaveBeenCalled();
    expect(f.request).toHaveBeenCalledTimes(2);
    expect(f.request.mock.calls[1][1]).toEqual(desktopConversationPrincipal("host", thread));
  });
  it("does not treat unknown presence as unattended authorization", async () => {
    const f = fixture();
    await f.observe(thread);
    f.presence.mockResolvedValue({ supported: true, locked: false, ownerPresent: undefined });
    await f.call("desktop.act", act, thread);
    expect(f.approved).toHaveBeenCalledOnce();
    expect(f.approved.mock.calls[0][0].principal).toEqual(thread);
  });
  it.each([
    { supported: false, locked: false, ownerPresent: false },
    { supported: true, locked: true, ownerPresent: false },
  ])("rejects locked/unsupported presence before approval or input", async (presence) => {
    const f = fixture();
    await f.observe();
    f.presence.mockResolvedValue(presence);
    await expect(f.call("desktop.act", act)).rejects.toThrow("locked or unknown");
    expect(f.approved).not.toHaveBeenCalled();
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it("keeps physical input separately gated even when away", async () => {
    const f = fixture();
    await f.observe(thread);
    f.presence.mockResolvedValue({ supported: true, locked: false, ownerPresent: false });
    await expect(f.call("desktop.act", { ...act, headed: true }, thread)).rejects.toThrow(
      "owner to be present",
    );
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it("passes physical input authority only for the exact approved headed operation", async () => {
    const f = fixture();
    await f.observe();
    await f.call("desktop.act", { ...act, headed: true });
    const physicalAuthorized = f.request.mock.calls[1][3]!;
    expect(await physicalAuthorized()).toBe(true);
    f.presence.mockResolvedValue({ supported: true, locked: false, ownerPresent: false });
    expect(await physicalAuthorized()).toBe(false);
    expect(f.approved.mock.calls[0][0].operation.headed).toBe(true);
  });
  it("never grants physical authority for a headless action with owner approval", async () => {
    const f = fixture();
    await f.observe();
    await f.call("desktop.act", act);
    expect(await f.request.mock.calls[1][3]!()).toBe(false);
  });
  it("rejects expired and different-conversation observations", async () => {
    const f = fixture();
    await f.observe();
    await expect(
      f.call("desktop.act", act, { ...thread, threadId: "other-thread" }),
    ).rejects.toThrow("fresh desktop snapshot");
    f.setNow(300001);
    await expect(f.call("desktop.act", act)).rejects.toThrow("fresh desktop snapshot");
    expect(f.approved).not.toHaveBeenCalled();
  });
  it("checks revocation after approval and does not dispatch the input", async () => {
    const f = fixture();
    await f.observe();
    let active = true;
    f.approved.mockImplementation(async (input) => {
      active = false;
      return { approved: true, operationHash: input.operationHash };
    });
    await expect(f.call("desktop.act", act, session, async () => active)).rejects.toThrow(
      "revoked",
    );
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it("passes a live authority check into queued native dispatch", async () => {
    const f = fixture();
    await f.observe(thread);
    f.presence.mockResolvedValue({ supported: true, locked: false, ownerPresent: false });
    let active = true;
    f.request.mockImplementationOnce(async (_input, _principal, authorized) => {
      active = false;
      expect(await authorized!()).toBe(false);
      throw new Error("Queued authority revoked");
    });
    await expect(f.call("desktop.act", act, thread, async () => active)).rejects.toThrow(
      "Queued authority revoked",
    );
  });
  it("refuses unattended input if the owner returns before dispatch", async () => {
    const f = fixture();
    await f.observe(thread);
    f.presence.mockResolvedValueOnce({ supported: true, locked: false, ownerPresent: false });
    await expect(f.call("desktop.act", act, thread)).rejects.toThrow("Owner presence changed");
    expect(f.request).toHaveBeenCalledTimes(1);
  });
});
