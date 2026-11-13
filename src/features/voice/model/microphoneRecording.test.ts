// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { MicrophoneRecording } from "./microphoneRecording";
const access = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("./microphoneAccess", () => ({ openMicrophone: access.open }));
let controller: MicrophoneRecording | undefined;
afterEach(() => {
  controller?.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  access.open.mockReset();
});

it("releases a permission grant arriving after cancellation", async () => {
  vi.stubGlobal("MediaRecorder", class {});
  let grant!: (value: unknown) => void;
  access.open.mockReturnValue(
    new Promise((resolve) => {
      grant = resolve;
    }),
  );
  const changed = vi.fn();
  controller = new MicrophoneRecording(changed);
  const pending = controller.record("mic");
  controller.cancel();
  const stop = vi.fn();
  grant({ getTracks: () => [{ stop }] });
  await pending;
  expect(stop).toHaveBeenCalledOnce();
  expect(changed).not.toHaveBeenCalledWith("recording");
});

it("stops after ten seconds, retains only local playback and revokes audio on disposal", async () => {
  vi.useFakeTimers();
  const stopTrack = vi.fn();
  access.open.mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] });
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:local-test");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const pause = vi.fn();
  const play = vi.fn(async () => {});
  vi.stubGlobal(
    "Audio",
    class {
      pause = pause;
      play = play;
    },
  );
  vi.stubGlobal(
    "MediaRecorder",
    class {
      state = "inactive";
      mimeType = "audio/webm";
      ondataavailable?: (event: { data: Blob }) => void;
      onstop?: () => void;
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["audio"]) });
        this.onstop?.();
      }
    },
  );
  const changed = vi.fn();
  controller = new MicrophoneRecording(changed);
  await controller.record();
  expect(changed).toHaveBeenLastCalledWith("recording");
  await vi.advanceTimersByTimeAsync(10_000);
  expect(stopTrack).toHaveBeenCalledOnce();
  expect(create).toHaveBeenCalledOnce();
  expect(changed).toHaveBeenLastCalledWith("ready");
  await controller.play();
  expect(play).toHaveBeenCalledOnce();
  controller.dispose();
  expect(revoke).toHaveBeenCalledWith("blob:local-test");
  expect(pause).toHaveBeenCalled();
});

it("releases capture when recorder construction fails", async () => {
  const stop = vi.fn();
  access.open.mockResolvedValue({ getTracks: () => [{ stop }] });
  vi.stubGlobal(
    "MediaRecorder",
    class {
      constructor() {
        throw new Error("recorder unavailable");
      }
    },
  );
  const changed = vi.fn();
  controller = new MicrophoneRecording(changed);
  await controller.record();
  expect(stop).toHaveBeenCalledOnce();
  expect(changed).toHaveBeenLastCalledWith("idle", "recorder unavailable");
});
