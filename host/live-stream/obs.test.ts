import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LiveStreamObs } from "./obs";

const calls: { request: string; data?: unknown }[] = [];
let settings: Record<string, unknown> = {};
let streaming = false;

vi.mock("obs-websocket-js", () => ({
  default: class {
    connect = async () => ({});
    disconnect = async () => {};
    call = async (request: string, data?: unknown) => {
      calls.push({ request, data });
      switch (request) {
        case "GetStreamStatus":
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
  settings = owner;
  streaming = false;
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

it("keeps the owner's OBS stream service only in the credential store and restores it", async () => {
  const { obs, store } = create();
  await obs.startSocial("rtmps://ingest.example/live", "managed-key", "Studio", noop, noop);
  expect(settings).toEqual({
    streamServiceType: "rtmp_custom",
    streamServiceSettings: { server: "rtmps://ingest.example/live", key: "managed-key" },
  });
  expect(store.get("live-stream-obs-previous-destination")).toContain("owner-private-key");

  // A retry while the managed key is in OBS must not replace the owner's original.
  await obs
    .startSocial("rtmps://ingest.example/live", "second-key", "Studio", noop, noop)
    .catch(() => {});
  expect(store.get("live-stream-obs-previous-destination")).toContain("owner-private-key");

  expect(await obs.restoreDestination()).toBe(false);
  expect(settings.streamServiceType).toBe("rtmp_custom");
  streaming = false;
  expect(await obs.restoreDestination()).toBe(true);
  expect(settings).toEqual(owner);
  expect(store.has("live-stream-obs-previous-destination")).toBe(false);
  expect(await obs.restoreDestination()).toBe(true);
});

it("drops the snapshot when the owner saves a manual destination", async () => {
  const { obs, store } = create();
  await obs.startSocial("rtmps://ingest.example/live", "managed-key", "Studio", noop, noop);
  streaming = false;
  await obs.credentials("rtmps://manual.example/live", "manual-key");
  expect(store.has("live-stream-obs-previous-destination")).toBe(false);
  expect(await obs.restoreDestination()).toBe(true);
  expect(settings.streamServiceSettings).toMatchObject({ key: "manual-key" });
});
