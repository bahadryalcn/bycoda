import { beforeEach, expect, it, vi } from "vitest";
import type { Session } from "../../sessions/model/session";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), request: vi.fn(), resolve: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../connections/public/connections", () => ({ remoteRequest: mocks.request }));
vi.mock("../../model-routing/public/choice", () => ({ resolveModelRouting: mocks.resolve }));
import { voiceReplyModel } from "./voiceReplyModel";
import { voiceModelSettings } from "./voiceConversation";
const session: Session = {
  id: "voice-session",
  runtimeMode: "auto",
  title: "Voice",
  cwd: "/voice",
  blocks: [],
  harness: "codex",
  providerAccountId: "session-account",
  model: "profile-model",
  modelSettings: { effort: "high" },
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.invoke.mockResolvedValue([
    { id: "local", localHost: true, endpoint: "http://127.0.0.1:1234" },
  ]);
  mocks.request.mockResolvedValue({ capabilities: ["models.routing.v1"] });
});
it("resolves voice.reply on the local Host and retains account and low effort", async () => {
  const target = {
    harness: "claude",
    providerAccountId: "voice-account",
    model: "reply",
    modelSettings: { effort: "max", thinking: "true" },
  };
  mocks.resolve.mockResolvedValue({ ok: true, target });
  const picked = await voiceReplyModel(session);
  expect(picked).toEqual(target);
  expect(mocks.resolve).toHaveBeenCalledWith("local", { role: "voice.reply" });
  expect(voiceModelSettings(picked.modelSettings)).toEqual({ effort: "low" });
  expect(session.modelSettings).toEqual({ effort: "high" });
});
it.each(["notConfigured", "unsupported", "offline", "missingHost"])(
  "keeps focused identity on %s",
  async (condition) => {
    if (condition === "notConfigured")
      mocks.resolve.mockResolvedValue({ ok: false, reason: "notConfigured", skipped: [] });
    if (condition === "unsupported") mocks.request.mockResolvedValue({ capabilities: [] });
    if (condition === "offline") mocks.request.mockRejectedValue(new Error("offline"));
    if (condition === "missingHost") mocks.invoke.mockResolvedValue([]);
    expect(await voiceReplyModel(session)).toEqual({
      harness: "codex",
      providerAccountId: "session-account",
      model: "profile-model",
      modelSettings: { effort: "high" },
    });
  },
);
it("never falls through to the focused model on noEligibleEntry", async () => {
  mocks.resolve.mockResolvedValue({
    ok: false,
    reason: "noEligibleEntry",
    skipped: [],
    nextResetAt: 9000,
  });
  await expect(voiceReplyModel(session)).rejects.toThrow("No eligible model");
});
