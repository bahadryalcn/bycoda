import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen, once: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
}));

import { listenVoiceTalk, VOICE_TALK_EVENT } from "./voiceTalkEvent";

beforeEach(() => mocks.listen.mockReset());

it("subscribes to the talk event on this window and passes only the payload", async () => {
  const release = vi.fn();
  mocks.listen.mockResolvedValue(release);
  const handler = vi.fn();
  const dispose = listenVoiceTalk(handler);
  expect(mocks.listen).toHaveBeenCalledWith(VOICE_TALK_EVENT, expect.any(Function), {
    target: "main",
  });
  const payload = { source: "global-shortcut", at: 5 };
  mocks.listen.mock.calls[0][1]({ payload });
  expect(handler).toHaveBeenCalledWith(payload);
  await vi.waitFor(() => expect(mocks.listen).toHaveResolved());
  dispose();
  expect(release).toHaveBeenCalledTimes(1);
});
