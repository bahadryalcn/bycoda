import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LiveStreamObs, LiveStreamObsActionError } from "./obs";

const calls: { request: string; data?: unknown }[] = [];
let settings: Record<string, unknown> = {};
let streaming = false;
/** Status reads after StopStream that still report active, like real OBS while it flushes. */
let stopLag = 0;
let pendingStop = 0;
/** Aitum Vertical: `missing` answers like OBS does without the plugin (code 600). */
const vertical = {
  missing: false,
  canvas: true,
  /** Aitum accepts start but has no output 0, so it never streams. */
  noOutput: false,
  streaming: false,
  server: "",
  key: "",
};
const vendorCalls: { requestType: string; requestData: Record<string, unknown> }[] = [];

vi.mock("obs-websocket-js", () => ({
  default: class {
    connect = async () => ({});
    disconnect = async () => {};
    call = async (request: string, data?: unknown) => {
      calls.push({ request, data });
      switch (request) {
        case "CallVendorRequest": {
          const { requestType, requestData } = data as {
            requestType: string;
            requestData: Record<string, unknown>;
          };
          vendorCalls.push({ requestType, requestData });
          if (vertical.missing)
            throw Object.assign(new Error("No vendor was found by that name."), { code: 600 });
          if (!vertical.canvas) return { responseData: { success: false } };
          if (requestType === "start_streaming") vertical.streaming = !vertical.noOutput;
          if (requestType === "stop_streaming") vertical.streaming = false;
          if (requestType === "update_stream_server")
            vertical.server = requestData.stream_server as string;
          if (requestType === "update_stream_key") vertical.key = requestData.stream_key as string;
          return { responseData: { success: true, streaming: vertical.streaming } };
        }
        case "StopStream":
          if (stopLag) pendingStop = stopLag;
          else streaming = false;
          return {};
        case "GetStreamStatus":
          if (pendingStop > 0 && --pendingStop === 0) streaming = false;
          return { outputActive: streaming, outputReconnecting: false };
        case "GetSceneList":
          return { scenes: [{ sceneName: "Studio" }] };
        case "GetCurrentProgramScene":
          return { currentProgramSceneName: "Studio" };
        case "GetStreamServiceSettings":
          return settings;
        case "SetStreamServiceSettings":
          settings = data as Record<string, unknown>;
          return {};
        case "StartStream":
          streaming = true;
          return {};
        default:
          return {};
      }
    };
  },
}));

let directory: string;
const owner = {
  streamServiceType: "rtmp_common",
  streamServiceSettings: { service: "Twitch", key: "owner-private-key" },
};

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "bycoda-live-obs-"));
  vi.stubEnv("APPDATA", directory);
  const path = join(directory, "obs-studio", "plugin_config", "obs-websocket");
  await mkdir(path, { recursive: true });
  await writeFile(
    join(path, "config.json"),
    JSON.stringify({ server_enabled: true, auth_required: true, server_port: 4455 }),
  );
  calls.length = 0;
  vendorCalls.length = 0;
  Object.assign(vertical, {
    missing: false,
    canvas: true,
    noOutput: false,
    streaming: false,
    server: "",
    key: "",
  });
  settings = owner;
  streaming = false;
  stopLag = 0;
  pendingStop = 0;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

function create() {
  const store = new Map<string, string>([["live-stream-obs-websocket", "password"]]);
  const obs = new LiveStreamObs({
    get: async (key) => store.get(key),
    set: async (key, value) => {
      store.set(key, value);
    },
    delete: async (key) => {
      store.delete(key);
    },
  });
  obs.configureView(true);
  return { obs, store };
}

const noop = async () => {};
const plan = (key: string) => ({
  scene: "Studio",
  horizontal: { server: "rtmps://ingest.example/live", key },
});
const both = { horizontal: true, vertical: true };

it("keeps the owner's OBS stream service only in the credential store and restores it", async () => {
  const { obs, store } = create();
  await obs.startSocial(plan("managed-key"), noop, noop);
  expect(settings).toEqual({
    streamServiceType: "rtmp_custom",
    streamServiceSettings: { server: "rtmps://ingest.example/live", key: "managed-key" },
  });
  expect(store.get("live-stream-obs-previous-destination")).toContain("owner-private-key");

  // A retry while the managed key is in OBS must not replace the owner's original.
  await obs.startSocial(plan("second-key"), noop, noop).catch(() => {});
  expect(store.get("live-stream-obs-previous-destination")).toContain("owner-private-key");

  expect(await obs.restoreDestination()).toBe(false);
  expect(settings.streamServiceType).toBe("rtmp_custom");
  streaming = false;
  expect(await obs.restoreDestination()).toBe(true);
  expect(settings).toEqual(owner);
  expect(store.has("live-stream-obs-previous-destination")).toBe(false);
  expect(await obs.restoreDestination()).toBe(true);
});

it("clears the managed key when the owner never set a stream service", async () => {
  // Real OBS 33 reports `{}` settings for an unset service and rejects them on write (403).
  settings = { streamServiceType: "rtmp_common", streamServiceSettings: {} };
  const { obs, store } = create();
  await obs.startSocial(plan("managed-key"), noop, noop);
  streaming = false;
  expect(await obs.restoreDestination()).toBe(true);
  expect(settings).toEqual({
    streamServiceType: "rtmp_custom",
    streamServiceSettings: { server: "", key: "" },
  });
  expect(store.has("live-stream-obs-previous-destination")).toBe(false);
});

it("drops the snapshot when the owner saves a manual destination", async () => {
  const { obs, store } = create();
  await obs.startSocial(plan("managed-key"), noop, noop);
  streaming = false;
  await obs.credentials("rtmps://manual.example/live", "manual-key");
  expect(store.has("live-stream-obs-previous-destination")).toBe(false);
  expect(await obs.restoreDestination()).toBe(true);
  expect(settings.streamServiceSettings).toMatchObject({ key: "manual-key" });
});

it("sends Aitum output 0 its destination, then starts, and only then reports streaming", async () => {
  const { obs } = create();
  const order: string[] = [];
  const active = await obs.startSocial(
    {
      scene: "Studio",
      horizontal: { server: "rtmp://127.0.0.1:19350/live", key: "relay-token" },
      vertical: { server: "rtmps://vertical.example/live", key: "vertical-key" },
    },
    async () => void order.push("settings"),
    async () => void order.push("start"),
  );
  expect(active).toEqual({ horizontal: true, vertical: true });
  expect(order).toEqual(["settings", "start"]);
  expect(vendorCalls.map((call) => call.requestType)).toEqual([
    "version",
    "status",
    "update_stream_server",
    "update_stream_key",
    "start_streaming",
    "status",
  ]);
  expect(vendorCalls[2]?.requestData).toEqual({
    stream_server: "rtmps://vertical.example/live",
    index: 0,
  });
  expect(vendorCalls[3]?.requestData).toEqual({ stream_key: "vertical-key", index: 0 });
  expect(settings).toMatchObject({
    streamServiceSettings: { server: "rtmp://127.0.0.1:19350/live", key: "relay-token" },
  });
  await expect(obs.socialStreamStatus(both)).resolves.toEqual({ horizontal: true, vertical: true });
});

it("leaves the main canvas alone for a vertical-only broadcast and parks Aitum afterwards", async () => {
  const { obs, store } = create();
  await obs.startSocial(
    { scene: "Studio", vertical: { server: "rtmps://vertical.example/live", key: "vertical-key" } },
    noop,
    noop,
  );
  expect(calls.map((call) => call.request)).not.toContain("StartStream");
  expect(calls.map((call) => call.request)).not.toContain("SetStreamServiceSettings");
  expect(store.has("live-stream-obs-previous-destination")).toBe(false);
  expect(await obs.clearVertical()).toBe(false);
  await expect(obs.stopSocial({ horizontal: false, vertical: true }, noop)).resolves.toBe(true);
  expect(vendorCalls.some((call) => call.requestType === "stop_streaming")).toBe(true);
  expect(await obs.clearVertical()).toBe(true);
  expect(vertical).toMatchObject({ server: "rtmp://127.0.0.1/off", key: "off" });
});

it("stops both canvases and confirms each one", async () => {
  const { obs } = create();
  await obs.startSocial(
    {
      ...plan("managed-key"),
      vertical: { server: "rtmps://vertical.example/live", key: "vertical-key" },
    },
    noop,
    noop,
  );
  await expect(obs.stopSocial(both, noop)).resolves.toBe(true);
  expect(streaming).toBe(false);
  expect(vertical.streaming).toBe(false);
});

it("waits for OBS to finish stopping before confirming the stop", async () => {
  const { obs } = create();
  await obs.startSocial(plan("managed-key"), noop, noop);
  stopLag = 3;
  await expect(obs.stopSocial({ horizontal: true, vertical: false }, noop)).resolves.toBe(true);
  expect(streaming).toBe(false);
});

it("reports a missing Aitum plugin before anything is changed", async () => {
  const { obs } = create();
  vertical.missing = true;
  await expect(obs.socialPreflight("Studio", both)).rejects.toThrow("VERTICAL_CANVAS_UNAVAILABLE");
  await expect(
    obs.startSocial({ ...plan("k"), vertical: plan("k").horizontal }, noop, noop),
  ).rejects.toBeInstanceOf(LiveStreamObsActionError);
  expect(calls.map((call) => call.request)).not.toContain("StartStream");
  // Horizontal-only broadcasts never ask Aitum.
  await expect(
    obs.socialPreflight("Studio", { horizontal: true, vertical: false }),
  ).resolves.toBeUndefined();
  vertical.missing = false;
  vertical.canvas = false;
  await expect(obs.socialPreflight("Studio", both)).rejects.toThrow("VERTICAL_CANVAS_UNAVAILABLE");
});

it("stops the main canvas again when the vertical output never comes up", async () => {
  const { obs } = create();
  vertical.noOutput = true;
  await expect(
    obs.startSocial(
      { ...plan("managed-key"), vertical: { server: "rtmps://v.example/l", key: "k" } },
      noop,
      noop,
    ),
  ).rejects.toThrow("VERTICAL_CANVAS_UNAVAILABLE");
  expect(streaming).toBe(false);
});

it("rejects a vertical preflight while Aitum already streams", async () => {
  const { obs } = create();
  vertical.streaming = true;
  await expect(obs.socialPreflight("Studio", both)).rejects.toThrow("OBS_ALREADY_STREAMING");
});
