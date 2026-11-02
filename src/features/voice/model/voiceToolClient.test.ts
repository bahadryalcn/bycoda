import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());
const remoteId = vi.hoisted(() => vi.fn());
vi.mock("../../connections/model/connections", () => ({ remoteSessionFor: remoteId }));
vi.mock("../../connections/model/hostFeatureClient", () => ({ hostFeatureRequest: request }));
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
  });
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
    request.mockResolvedValue({
      value: { notes: ["canonical-data"] },
      voiceContext: { id: "captured-context" },
      voiceDisclosure: { projectIds: ["visible"] },
    });
    expect(await callVoiceTool(captured, call)).toEqual({ notes: ["canonical-data"] });
    expect(receive).toHaveBeenCalledWith(
      { id: "captured-context" },
      { projectIds: ["visible"] },
      "exact-tool-request",
    );
    expect(request.mock.calls[0][3]).toMatchObject({
      causalContextId: "captured-context",
      threadId: "canonical-thread",
      requestId: "exact-tool-request",
    });
    receive.mockImplementation(() => {
      throw new Error("private contributor");
    });
    await expect(callVoiceTool(captured, call)).rejects.toThrow("private contributor");
    request.mockResolvedValue({ notes: ["unwrapped legacy data"] });
    await expect(callVoiceTool(captured, call)).rejects.toThrow("could not be verified");
    request.mockClear();
    await expect(callVoiceTool({ ...captured, cwd: target.cwd }, call)).rejects.toThrow();
    await expect(callVoiceTool(captured, { ...call, requestId: undefined })).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
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
    await expect(discoverVoiceTools({ cwd: "" })).rejects.toThrow("Choose a project");
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
