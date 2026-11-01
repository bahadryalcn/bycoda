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

  it("resolves an adopted remote shell to its owning Host session", async () => {
    remoteId.mockReturnValue("actual-host-id");
    request.mockResolvedValue({ state: "completed" });
    await callVoiceTool(
      { cwd: target.cwd, sessionId: "desktop-shell" },
      { family: "conversation", action: "files.list", input: {} },
    );
    expect(request.mock.calls[0][3].sessionId).toBe("actual-host-id");
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
