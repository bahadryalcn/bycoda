// @vitest-environment happy-dom
import { act, createElement, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useVoiceBriefing } from "./useVoiceBriefing";
import { previewBriefing } from "../model/voiceBriefingPlayback";

vi.mock("../model/voiceSettings", () => ({ loadVoiceSettings: () => ({}) }));
vi.mock("../model/voiceBriefing", () => ({
  mayDeliverVoiceBriefing: (input: { status: string }) => input.status === "ready",
}));
vi.mock("../model/voiceBriefingPlayback", () => ({ previewBriefing: vi.fn() }));

it("does not replay interrupted speech; retry starts one fresh attempt and rejects stale owner actions", async () => {
  localStorage.clear();
  const speak = vi.mocked(previewBriefing);
  speak
    .mockReset()
    .mockImplementation(
      (_settings, _language, _name, signal) =>
        new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        ),
    );
  const snapshot = {
    profile: { language: "en", name: "A" },
    memory: [],
    briefing: {
      id: "b",
      createdAt: Date.now(),
      text: "Briefing",
      voiceReceipt: { reason: "return", meaningful: true },
    },
  } as never;
  let owner = "owner-a",
    status = "ready",
    currentRetry: () => void = () => {};
  const container = document.createElement("div"),
    root = createRoot(container);
  function Panel() {
    const playback = useRef(false),
      pendingChoice = useRef(null),
      pendingJobs = useRef(null);
    const abort = useRef<AbortController | null>(null),
      generation = useRef(0);
    const [, setPlayback] = useState(false),
      [, setMessage] = useState(""),
      [, setError] = useState("");
    const briefing = useVoiceBriefing({
      snapshot,
      owner,
      session: "session-a",
      status,
      presence: "active",
      phase: "listening",
      muted: false,
      speakerMuted: false,
      hold: false,
      playback,
      pendingChoice,
      pendingJobs,
      abort,
      generation,
      setPlayback,
      setMessage,
      setError,
      formatError: String,
    });
    currentRetry = briefing.retry;
    return briefing.retryable
      ? createElement("button", { onClick: briefing.retry }, "Retry briefing")
      : null;
  }
  const render = async () => {
    await act(async () => {
      root.render(createElement(Panel));
    });
  };
  try {
    await render();
    expect(speak).toHaveBeenCalledTimes(1);
    status = "away";
    await render();
    status = "ready";
    await render();
    expect(speak).toHaveBeenCalledTimes(1);
    const stale = currentRetry;
    owner = "owner-b";
    await render();
    await act(async () => {
      stale();
    });
    expect(speak).toHaveBeenCalledTimes(1);
    owner = "owner-a";
    await render();
    await act(async () => {
      container.querySelector("button")!.click();
    });
    expect(speak).toHaveBeenCalledTimes(2);
    expect(speak.mock.calls[1][3]).not.toBe(speak.mock.calls[0][3]);
  } finally {
    await act(async () => root.unmount());
  }
});
