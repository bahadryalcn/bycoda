import { describe, expect, it } from "vitest";
import {
  VOICE_WORK_UPDATE_MAX_AGE_MS,
  voiceAnnouncementsOpen,
  voiceWorkEnded,
  voiceWorkEndedUpdate,
  VoiceWorkUpdates,
} from "./voiceWorkAnnouncements";
import type { VoiceWorkEntry } from "./voiceWorkLedger";

const entry = (overrides: Partial<VoiceWorkEntry> = {}): VoiceWorkEntry => ({
  id: "w1",
  tool: "app_tool_call",
  action: "workspace.sessions.create",
  request: "build a game",
  startedAt: 1,
  status: "done",
  progress: "finished",
  sessionIds: ["s1"],
  jobIds: [],
  title: "Snake game",
  ...overrides,
});
const open = {
  status: "live",
  presence: "active",
  muted: false,
  speakerMuted: false,
  holdAnnouncements: false,
  phase: "listening",
  playback: false,
};

describe("voiceAnnouncementsOpen", () => {
  it("opens only for a present, listening, unmuted live call that is not held", () => {
    expect(voiceAnnouncementsOpen(open)).toBe(true);
    expect(voiceAnnouncementsOpen({ ...open, playback: undefined })).toBe(true);
    for (const closed of [
      { status: "reconnecting" },
      { presence: "idle" },
      { muted: true },
      { speakerMuted: true },
      { holdAnnouncements: true },
      { phase: "replying" },
      { playback: true },
    ])
      expect(voiceAnnouncementsOpen({ ...open, ...closed })).toBe(false);
  });
});

describe("updates", () => {
  it("quote the work as data with its ids and outcome", () => {
    const text = voiceWorkEndedUpdate(entry());
    expect(text).toMatch(/one short sentence/);
    expect(text).toContain('"work":"Snake game"');
    expect(text).toContain('"result":"finished"');
    expect(text).toContain('"sessionIds":["s1"]');
    expect(voiceWorkEndedUpdate(entry({ progress: "failed" }))).toContain('"result":"failed"');
  });

  it("use the action when there is no title", () => {
    expect(voiceWorkEnded(entry({ title: undefined })).data).toContain(
      '"work":"workspace.sessions.create"',
    );
  });
});

describe("VoiceWorkUpdates", () => {
  const update = (id: string) => ({ id, data: id, speech: id });

  it("holds updates until taken, replacing repeats and keeping the newest four", () => {
    const queue = new VoiceWorkUpdates(() => 0);
    queue.add([update("a"), update("b")]);
    queue.add([update("a")]);
    expect(queue.take().map((item) => item.id)).toEqual(["b", "a"]);
    expect(queue.size).toBe(0);
    queue.add(["1", "2", "3", "4", "5"].map(update));
    expect(queue.take().map((item) => item.id)).toEqual(["2", "3", "4", "5"]);
  });

  it("drops stale news instead of speaking it late", () => {
    let now = 0;
    const queue = new VoiceWorkUpdates(() => now);
    queue.add([update("old")]);
    now = VOICE_WORK_UPDATE_MAX_AGE_MS + 1;
    queue.add([update("new")]);
    expect(queue.take().map((item) => item.id)).toEqual(["new"]);
  });

  it("puts back undelivered updates ahead of newer ones", () => {
    const queue = new VoiceWorkUpdates(() => 0);
    queue.add([update("later")]);
    queue.restore([update("first")]);
    expect(queue.take().map((item) => item.id)).toEqual(["first", "later"]);
  });
});
