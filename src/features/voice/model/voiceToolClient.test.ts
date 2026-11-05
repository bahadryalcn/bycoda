import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());
const remoteId = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());
const captureHost = vi.hoisted(() => vi.fn());
const globalHost = vi.hoisted(() => vi.fn());
vi.mock("../../connections/model/connections", () => ({
  remoteSessionFor: remoteId,
  remoteRequest: rpc,
}));
vi.mock("../../connections/model/hostFeatureClient", () => ({
  hostFeatureRequest: request,
  featureHost: captureHost,
  captureVoiceToolHost: globalHost,
}));
import { callVoiceTool, discoverVoiceTools } from "./voiceToolClient";

const target = { cwd: "remote://paired/repo", sessionId: "voice-controller" };
const descriptor = {
  family: "conversation",
  action: "notes.create",
  name: "conversation_notes_create",
  description: "Create a project note.",
  inputSchema: { type: "object" },
};

describe("voice tool client", () => {
  beforeEach(() => {
    request.mockReset();
    remoteId.mockReset();
    rpc.mockReset();
    captureHost.mockReset();
    globalHost.mockReset();
    globalHost.mockResolvedValue({
      machine: { id: "local-host", environmentId: "host" },
      request: rpc,
    });
    captureHost.mockResolvedValue({
      machine: { id: "local-host", environmentId: "host" },
      projectId: "project",
    });
  });
  it("discovers global Room tools on its original Host without a project or coding session", async () => {
    rpc.mockResolvedValue({ tools: [descriptor] });
    await discoverVoiceTools({ cwd: "", threadId: "room", environmentId: "host" });
    expect(globalHost).toHaveBeenCalledWith("host");
    expect(rpc).toHaveBeenCalledWith("voice.tools.list", { threadId: "room" });
    expect(request).not.toHaveBeenCalled();
    expect(captureHost).not.toHaveBeenCalled();
  });
  it("accepts exact project-free provenance and rejects an injected project without replay", async () => {
    const receive = vi.fn();
    const source = {
      environmentId: "host",
      threadId: "room",
      family: "conversation" as const,
      action: "preferences.read",
    };
    const target = {
      cwd: "",
      threadId: "room",
      causalContext: { id: "context", environmentId: "host", receive },
    };
    const call = {
      family: "conversation" as const,
      action: "preferences.read",
      input: {},
      requestId: "read-once",
    };
    const disclosure = {
      id: "proof",
      contextId: "context",
      requestId: "read-once",
      verified: false,
      source,
    };
    rpc.mockResolvedValue({
      value: { available: true },
      voiceContext: {},
      voiceDisclosure: disclosure,
    });
    expect(await callVoiceTool(target, call)).toEqual({ available: true });
    expect(receive).toHaveBeenCalledWith({}, disclosure, "read-once", source);
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("projectId");
    rpc.mockResolvedValue({
      value: {},
      voiceContext: {},
      voiceDisclosure: { ...disclosure, source: { ...source, projectId: "injected" } },
    });
    await expect(callVoiceTool(target, call)).rejects.toThrow("could not be verified");
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(request).not.toHaveBeenCalled();
  });
  it("returns authenticated unscoped desktop data without retrying or inventing content provenance", async () => {
    const receive = vi.fn(),
      captured = {
        cwd: "C:/project",
        threadId: "thread",
        causalContext: { id: "context", receive },
      },
      call = {
        family: "conversation" as const,
        action: "desktop.launch",
        input: { app: "Chrome" },
        requestId: "launch-once",
      };
    const source = {
        environmentId: "host",
        projectId: "project",
        threadId: "thread",
        family: "conversation" as const,
        action: "desktop.launch",
      },
      disclosure = {
        id: "ticket",
        contextId: "context",
        requestId: call.requestId,
        verified: false,
        source,
      },
      value = { state: "unknown", retrySafe: false };
    rpc.mockResolvedValue({
      value,
      voiceContext: { id: "context", status: "unknown" },
      voiceDisclosure: disclosure,
    });
    expect(await callVoiceTool(captured, call)).toBe(value);
    expect(receive).toHaveBeenCalledWith(
      { id: "context", status: "unknown" },
      disclosure,
      call.requestId,
      source,
    );
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
  });
  it.each(["environmentId", "projectId", "threadId", "sessionId", "family", "action", "missing"])(
    "refuses an unscoped disclosure with mismatched %s without replaying its effect",
    async (field) => {
      const receive = vi.fn(),
        captured = {
          cwd: "C:/project",
          sessionId: "session",
          threadId: "thread",
          causalContext: { id: "context", receive },
        },
        call = {
          family: "conversation" as const,
          action: "desktop.act",
          input: {},
          requestId: "effect-once",
        };
      const source: Record<string, string> = {
        environmentId: "host",
        projectId: "project",
        threadId: "thread",
        sessionId: "session",
        family: "conversation",
        action: "desktop.act",
      };
      if (field !== "missing") source[field] = field === "family" ? "social" : "foreign";
      rpc.mockResolvedValue({
        value: { state: "completed" },
        voiceContext: { id: "context", status: "unknown" },
        voiceDisclosure: {
          id: "ticket",
          contextId: "context",
          requestId: call.requestId,
          verified: false,
          ...(field !== "missing" ? { source } : {}),
        },
      });
      await expect(callVoiceTool(captured, call)).rejects.toThrow("could not be verified");
      expect(receive).not.toHaveBeenCalled();
      expect(rpc).toHaveBeenCalledTimes(1);
    },
  );
  it("unwraps data only after the exact captured causal disclosure guard accepts every contributor", async () => {
    const receive = vi.fn(),
      captured = {
        cwd: "C:/project",
        threadId: "canonical-thread",
        causalContext: { id: "captured-context", receive },
      },
      call = {
        family: "conversation" as const,
        action: "notes.list",
        input: {},
        requestId: "exact-tool-request",
      };
    rpc.mockResolvedValue({
      value: { notes: ["canonical-data"] },
      voiceContext: { id: "captured-context" },
      voiceDisclosure: {
        id: "disclosure",
        contextId: "captured-context",
        requestId: "exact-tool-request",
        verified: true,
        projectIds: ["visible"],
      },
    });
    expect(await callVoiceTool(captured, call)).toEqual({ notes: ["canonical-data"] });
    expect(receive).toHaveBeenCalledWith(
      { id: "captured-context" },
      {
        id: "disclosure",
        contextId: "captured-context",
        requestId: "exact-tool-request",
        verified: true,
        projectIds: ["visible"],
      },
      "exact-tool-request",
      {
        environmentId: "host",
        projectId: "project",
        threadId: "canonical-thread",
        family: "conversation",
        action: "notes.list",
      },
    );
    expect(rpc.mock.calls[0][2]).toMatchObject({
      causalContextId: "captured-context",
      threadId: "canonical-thread",
      requestId: "exact-tool-request",
    });
    receive.mockImplementation(() => {
      throw new Error("private contributor");
    });
    await expect(callVoiceTool(captured, call)).rejects.toThrow("private contributor");
    rpc.mockResolvedValue({ notes: ["unwrapped legacy data"] });
    await expect(callVoiceTool(captured, call)).rejects.toThrow("could not be verified");
    request.mockClear();
    rpc.mockClear();
    await expect(callVoiceTool({ ...captured, cwd: target.cwd }, call)).rejects.toThrow();
    await expect(callVoiceTool(captured, { ...call, requestId: undefined })).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("resolves an adopted remote shell to its owning Host session", async () => {
    remoteId.mockReturnValue("actual-host-id");
    request.mockResolvedValue({ state: "completed" });
    await callVoiceTool(
      { cwd: target.cwd, sessionId: "desktop-shell" },
      { family: "conversation", action: "files.list", input: {} },
    );
    expect(request.mock.calls[0][3].sessionId).toBe("actual-host-id");
  });
  it("never forwards a local assistant thread to the remote Host", async () => {
    request.mockResolvedValue({ state: "completed" });
    remoteId.mockReturnValue("actual-host-id");
    await callVoiceTool(
      { cwd: target.cwd, sessionId: "adopted", threadId: "local-only" },
      { family: "conversation", action: "notes.read", input: { id: "n" } },
    );
    expect(request.mock.calls[0][3]).toMatchObject({ sessionId: "actual-host-id" });
    expect(request.mock.calls[0][3]).not.toHaveProperty("threadId");
    await expect(
      callVoiceTool(
        { cwd: target.cwd, threadId: "local-only" },
        { family: "conversation", action: "notes.read", input: { id: "n" } },
      ),
    ).rejects.toThrow("Open a session");
  });

  it("binds discovery to the captured project/session and does not reuse another authority's catalog", async () => {
    request.mockResolvedValue({ tools: [descriptor] });
    expect((await discoverVoiceTools(target, { query: "notes" })).tools).toEqual([descriptor]);
    await discoverVoiceTools({ cwd: "C:/other", sessionId: "other" });
    expect(request).toHaveBeenNthCalledWith(1, target.cwd, "voice.tools.v1", "voice.tools.list", {
      sessionId: target.sessionId,
    });
    expect(request).toHaveBeenNthCalledWith(2, "C:/other", "voice.tools.v1", "voice.tools.list", {
      sessionId: "other",
    });
  });

  it("keeps model input nested so it cannot replace the captured source identity", async () => {
    const result = { state: "queued", requestId: "same-request", ownerApprovalRequired: true };
    request.mockResolvedValue(result);
    const input = { sessionId: "operation-target", projectId: "untrusted-field", text: "hello" };
    expect(
      await callVoiceTool(target, {
        family: "conversation",
        action: "notes.create",
        input,
        requestId: "same-request",
      }),
    ).toBe(result);
    expect(request).toHaveBeenCalledWith(target.cwd, "voice.tools.v1", "voice.tools.call", {
      sessionId: "voice-controller",
      family: "conversation",
      action: "notes.create",
      input,
      requestId: "same-request",
    });
  });

  it("preserves uncertain results and never retries a failed mutation automatically", async () => {
    request.mockResolvedValueOnce({ state: "uncertain", requestId: "keep-me" });
    expect(
      await callVoiceTool(target, { family: "social", action: "messages.send", input: {} }),
    ).toEqual({ state: "uncertain", requestId: "keep-me" });
    request.mockRejectedValueOnce(new Error("Authority revoked."));
    await expect(
      callVoiceTool(target, { family: "conversation", action: "tasks.create", input: {} }),
    ).rejects.toThrow("Authority revoked");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not fall back to a local Host or invent tools when capability access fails", async () => {
    request.mockRejectedValue(new Error("Update bycoda Host"));
    await expect(discoverVoiceTools(target)).rejects.toThrow("Update bycoda Host");
    expect(request).toHaveBeenCalledTimes(1);
    await expect(discoverVoiceTools({ cwd: "" })).rejects.toThrow(
      "verified assistant conversation",
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("keeps remote history reads on the captured project and preserves a failed remote result", async () => {
    remoteId.mockReturnValue("captured-host-session");
    request.mockRejectedValue(new Error("Captured remote Host is unavailable."));
    await expect(
      callVoiceTool(target, {
        family: "conversation",
        action: "sessions.read",
        input: { id: "history-target" },
      }),
    ).rejects.toThrow("Captured remote Host is unavailable");
    expect(request).toHaveBeenCalledExactlyOnceWith(
      target.cwd,
      "voice.tools.v1",
      "voice.tools.call",
      {
        sessionId: "captured-host-session",
        family: "conversation",
        action: "sessions.read",
        input: { id: "history-target" },
      },
    );
  });

  it("rejects invalid envelopes before issuing a request", async () => {
    await expect(
      callVoiceTool(target, {
        family: "shell" as "conversation",
        action: "exec",
        input: {},
      }),
    ).rejects.toThrow("invalid");
    await expect(
      callVoiceTool(target, {
        family: "conversation",
        action: "notes.create",
        input: [] as unknown as Record<string, unknown>,
      }),
    ).rejects.toThrow("invalid");
    expect(request).not.toHaveBeenCalled();
  });
});

it("binds account-scoped social results to their exact unverified source", async () => {
  rpc.mockReset();
  globalHost.mockResolvedValue({
    machine: { id: "local-host", environmentId: "host" },
    request: rpc,
  });
  const receive = vi.fn();
  const target = {
    cwd: "",
    threadId: "room",
    causalContext: { id: "context", environmentId: "host", receive },
  };
  const call = {
    family: "social" as const,
    action: "thread.read",
    accountId: "account-a",
    input: { id: "thread" },
    requestId: "read",
  };
  const source = {
    environmentId: "host",
    threadId: "room",
    accountId: "account-a",
    family: "social" as const,
    action: "thread.read",
  };
  const disclosure = {
    id: "proof",
    contextId: "context",
    requestId: "read",
    verified: false,
    source,
  };
  rpc.mockResolvedValue({
    value: { id: "thread" },
    voiceContext: { status: "unknown" },
    voiceDisclosure: disclosure,
  });
  expect(await callVoiceTool(target, call)).toEqual({ id: "thread" });
  expect(rpc).toHaveBeenCalledWith(
    "voice.tools.call",
    expect.objectContaining({ accountId: "account-a", threadId: "room" }),
  );
  expect(receive).toHaveBeenCalledWith({ status: "unknown" }, disclosure, "read", source);
  rpc.mockResolvedValue({
    value: {},
    voiceContext: {},
    voiceDisclosure: { ...disclosure, source: { ...source, accountId: "account-b" } },
  });
  await expect(callVoiceTool(target, call)).rejects.toThrow("could not be verified");
  await expect(callVoiceTool({ cwd: "/a", threadId: "room" }, call)).rejects.toThrow("invalid");
});
