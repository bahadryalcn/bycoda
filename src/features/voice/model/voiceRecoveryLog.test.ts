import { expect, it, vi } from "vitest";
import { VOICE_RECONNECT_DELAYS } from "./voiceReconnect";
import { logVoiceDiagnostic, VoiceRecoveryLog, voiceSeededWorkCount } from "./voiceRecoveryLog";
import { VOICE_WORK_SEED_HEADER } from "./voiceWorkLedger";

const drop = {
  provider: "xai",
  rotation: false,
  code: "socket-closed",
  speechLost: false,
  unansweredTurn: true,
};

it("persists every diagnostic kind as a warning with metadata fields", () => {
  const log = vi.fn();
  logVoiceDiagnostic("openai", { kind: "ready", connectMs: 420, seededItems: 3 }, log);
  expect(log).toHaveBeenCalledWith("warn", "voice.connection", "ready", {
    provider: "openai",
    kind: "ready",
    connectMs: 420,
    seededItems: 3,
  });
});

it("logs attempt numbers and delays like the reconnect scheduler, then the recovery time", () => {
  let now = 1_000;
  const log = vi.fn();
  const recovery = new VoiceRecoveryLog(() => now, log);
  recovery.recovering(drop);
  expect(log).toHaveBeenLastCalledWith(
    "warn",
    "voice.recovery",
    "realtime recovering",
    expect.objectContaining({
      attempt: 1,
      delayMs: VOICE_RECONNECT_DELAYS[0],
      code: "socket-closed",
    }),
  );
  now += 2_000;
  recovery.recovering(drop);
  expect(log.mock.lastCall?.[3]).toMatchObject({ attempt: 2, delayMs: VOICE_RECONNECT_DELAYS[1] });
  now += 1_500;
  recovery.live({ provider: "xai", reconnecting: true, seededWork: 2 });
  expect(log).toHaveBeenLastCalledWith(
    "warn",
    "voice.recovery",
    "realtime recovered",
    expect.objectContaining({ recoveryMs: 3_500, seededWork: 2, attempt: 2 }),
  );
  // A drop soon after does not restart the attempt budget; a stable connection does.
  recovery.recovering(drop);
  expect(log.mock.lastCall?.[3]).toMatchObject({ attempt: 3 });
  recovery.reset();
  recovery.recovering(drop);
  expect(log.mock.lastCall?.[3]).toMatchObject({ attempt: 1 });
});

it("spends no attempt on a rotation or a drop that ends in sleep", () => {
  const log = vi.fn();
  const recovery = new VoiceRecoveryLog(() => 0, log);
  recovery.recovering({ ...drop, rotation: true });
  expect(log.mock.lastCall?.[3]).toMatchObject({ attempt: 0, delayMs: 0 });
  recovery.recovering(drop, false);
  expect(log.mock.lastCall?.[3]).toMatchObject({
    attempt: 0,
    scheduled: false,
    delayMs: undefined,
  });
});

it("counts seeded ledger entries", () => {
  expect(voiceSeededWorkCount("")).toBe(0);
  expect(voiceSeededWorkCount(`${VOICE_WORK_SEED_HEADER}\n- done | a\n- running | b`)).toBe(2);
});
