import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import OBSWebSocket from "obs-websocket-js";
import { z } from "zod";
import type { LiveStreamStatus } from "../../src/shared/model/host-contracts/live-stream";
import type { SecretValueStore } from "../secrets/secret-store";
import { readStateFile, writeFileAtomic } from "../storage/atomic-write";

const PASSWORD = "live-stream-obs-websocket";
const STREAM_KEY = "live-stream-obs-stream-key";
const PREVIOUS_DESTINATION = "live-stream-obs-previous-destination";
const previousDestinationSchema = z.object({
  streamServiceType: z.string().min(1),
  streamServiceSettings: z.record(z.string(), z.json()),
});
const exec = promisify(execFile);
const configSchema = z.looseObject({
  server_port: z.number().int().min(1).max(65535).default(4455),
  server_enabled: z.boolean().optional(),
  auth_required: z.boolean().optional(),
  server_password: z.string().optional(),
});
type Authorize = () => Promise<void>;

async function obsPath() {
  if (process.platform !== "win32" || !process.env.APPDATA)
    throw new Error("Automatic OBS setup is available on Windows.");
  for (const root of new Set([process.env.ProgramFiles, process.env["ProgramW6432"]])) {
    if (!root) continue;
    const executable = join(root, "obs-studio", "bin", "64bit", "obs64.exe");
    if (
      await access(executable).then(
        () => true,
        () => false,
      )
    )
      return executable;
  }
  throw new Error("OBS Studio was not found. Install OBS Studio and try setup again.");
}

async function isObsRunning() {
  const { stdout } = await exec(
    "tasklist.exe",
    ["/FI", "IMAGENAME eq obs64.exe", "/FO", "CSV", "/NH"],
    {
      windowsHide: true,
      timeout: 4_000,
    },
  );
  return /^"obs64\.exe",/im.test(stdout);
}

/** Each connection owns only local OBS and closes even when a request times out. */
export class LiveStreamObs {
  private observed: LiveStreamStatus["obs"] = { configured: false };
  private nextProbe = 0;
  private pendingProbe?: Promise<unknown>;

  constructor(private readonly secrets: SecretValueStore) {}

  configureView(configured: boolean) {
    this.observed = { configured };
  }

  view() {
    if (this.observed.configured && this.nextProbe <= Date.now() && !this.pendingProbe) {
      this.nextProbe = Date.now() + 5_000;
      this.pendingProbe = this.withObs(this.readBack.bind(this))
        .catch(() => {
          this.observed = { ...this.observed, streaming: undefined, scene: undefined };
        })
        .finally(() => {
          this.pendingProbe = undefined;
        });
    }
    return this.observed;
  }

  private configPath() {
    if (!process.env.APPDATA) throw new Error("OBS WebSocket settings are unavailable.");
    return join(process.env.APPDATA, "obs-studio", "plugin_config", "obs-websocket", "config.json");
  }

  private async config() {
    const state = await readStateFile(
      this.configPath(),
      (raw) => configSchema.parse(JSON.parse(raw)),
      {
        quarantine: false,
      },
    );
    if (state.status === "corrupt") throw new Error("OBS WebSocket settings could not be read.");
    return state.value ?? configSchema.parse({});
  }

  private async withObs<T>(
    run: (client: OBSWebSocket, assertConnected: () => void) => Promise<T>,
    timeout = 7_000,
  ): Promise<T> {
    const config = await this.config();
    const password = await this.secrets.get(PASSWORD);
    if (!config.server_enabled || !config.auth_required || !password)
      throw new Error("Run OBS setup to enable authenticated local control.");
    const client = new OBSWebSocket();
    const controller = new AbortController();
    let expired = false;
    try {
      return await Promise.race([
        client.connect(`ws://127.0.0.1:${config.server_port}`, password).then(async () => {
          if (expired) {
            await client.disconnect();
            throw new Error("OBS did not respond in time.");
          }
          return run(client, () => {
            if (expired) throw new Error("OBS request expired.");
          });
        }),
        delay(timeout, undefined, { signal: controller.signal }).then(() => {
          expired = true;
          throw new Error("OBS did not respond in time.");
        }),
      ]);
    } catch (error) {
      if (error instanceof LiveStreamObsActionError) throw error;
      throw new Error(
        "OBS did not complete the request. Open OBS and check its WebSocket settings.",
      );
    } finally {
      expired = true;
      controller.abort();
      void client.disconnect().catch(() => {});
    }
  }

  /** Enables OBS's authenticated local WebSocket control, launching OBS when it is closed. */
  async setup(authorize: Authorize) {
    const executable = await obsPath();
    const config = await this.config();
    const running = await isObsRunning();
    await authorize();
    if (running) {
      if (!config.server_enabled || !config.auth_required || !config.server_password)
        throw new Error(
          "Close OBS before enabling its authenticated WebSocket server, then run setup again.",
        );
      await this.secrets.set(PASSWORD, config.server_password);
    } else {
      const password =
        config.server_enabled && config.auth_required && config.server_password
          ? config.server_password
          : randomBytes(30).toString("base64url");
      await this.secrets.set(PASSWORD, password);
      const path = this.configPath();
      await mkdir(dirname(path), { recursive: true });
      await authorize();
      if (await isObsRunning())
        throw new Error("OBS opened during setup. Close it and run setup again.");
      await writeFileAtomic(
        path,
        JSON.stringify(
          {
            ...config,
            first_load: false,
            server_enabled: true,
            auth_required: true,
            server_password: password,
          },
          null,
          2,
        ),
      );
      const child = spawn(executable, [], {
        cwd: dirname(executable),
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", () => reject(new Error("OBS Studio could not be launched.")));
      });
      child.unref();
      for (let attempt = 0; attempt < 12; attempt++) {
        await delay(750);
        if (await this.withObs(async () => true, 1_000).catch(() => false)) break;
      }
    }

    await this.withObs(async (client) => {
      await authorize();
      this.configureView(true);
      await this.readBack(client);
    });
  }

  /** Name of the scene OBS currently shows on program. */
  async currentScene() {
    return this.withObs(async (client) => {
      const { currentProgramSceneName } = await client.call("GetCurrentProgramScene");
      return currentProgramSceneName;
    });
  }

  async stream(action: "start" | "stop", authorize: Authorize) {
    await this.withObs(async (client) => {
      const { outputActive } = await client.call("GetStreamStatus");
      if (outputActive !== (action === "start")) {
        await authorize();
        await client.call(action === "start" ? "StartStream" : "StopStream");
      }
      await this.readBack(client);
    });
  }

  async credentials(server: string, key: string) {
    this.validateDestination(server);
    await this.withObs(async (client) => {
      const { outputActive } = await client.call("GetStreamStatus");
      if (outputActive)
        throw new LiveStreamObsActionError(
          "Stop streaming before changing the stream destination.",
        );
      await this.secrets.set(STREAM_KEY, key);
      await this.setDestination(client, server, key);
      // The owner chose this destination, so the pre-Social snapshot is obsolete.
      await this.secrets.delete(PREVIOUS_DESTINATION);
      await this.readBack(client);
    });
  }

  /** Keeps the owner's own OBS stream service, key included, in the credential store only. */
  private async snapshotDestination(client: OBSWebSocket) {
    // An existing snapshot is the owner's original: a retry must not replace it with a managed key.
    if (await this.secrets.get(PREVIOUS_DESTINATION)) return;
    const current = await client.call("GetStreamServiceSettings");
    await this.secrets.set(PREVIOUS_DESTINATION, JSON.stringify(current));
  }

  /** Puts the owner's previous OBS stream service back. False when it could not be restored. */
  async restoreDestination() {
    const raw = await this.secrets.get(PREVIOUS_DESTINATION);
    if (!raw) return true;
    const previous = previousDestinationSchema.safeParse(
      (() => {
        try {
          return JSON.parse(raw);
        } catch {
          return undefined;
        }
      })(),
    );
    if (!previous.success) {
      await this.secrets.delete(PREVIOUS_DESTINATION);
      return true;
    }
    return this.withObs(async (client) => {
      const { outputActive, outputReconnecting } = await client.call("GetStreamStatus");
      if (outputActive || outputReconnecting) return false;
      await client.call("SetStreamServiceSettings", previous.data);
      await this.secrets.delete(PREVIOUS_DESTINATION);
      return true;
    }).catch(() => false);
  }

  private validateDestination(server: string) {
    const url = URL.parse(server);
    if (
      !url ||
      !["rtmp:", "rtmps:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new Error("Enter a valid RTMP or RTMPS server URL.");
  }

  private async setDestination(client: OBSWebSocket, server: string, key: string) {
    this.validateDestination(server);
    await client.call("SetStreamServiceSettings", {
      streamServiceType: "rtmp_custom",
      streamServiceSettings: { server, key },
    });
  }

  private async checkSocialScene(client: OBSWebSocket, scene: string) {
    const { outputActive, outputReconnecting } = await client.call("GetStreamStatus");
    if (outputActive || outputReconnecting)
      throw new LiveStreamObsActionError("OBS_ALREADY_STREAMING");
    const { scenes } = await client.call("GetSceneList");
    if (!scenes.some((entry) => entry.sceneName === scene))
      throw new LiveStreamObsActionError("SCENE_NOT_FOUND");
  }

  async socialPreflight(scene: string) {
    if (!this.observed.configured) throw new LiveStreamObsActionError("OBS_NOT_CONFIGURED");
    await this.withObs((client) => this.checkSocialScene(client, scene));
  }

  async startSocial(
    server: string,
    key: string,
    scene: string,
    beforeSettings: Authorize,
    beforeStart: Authorize,
  ) {
    return this.withObs(async (client, assertConnected) => {
      await this.checkSocialScene(client, scene);
      await beforeSettings();
      assertConnected();
      await this.snapshotDestination(client);
      assertConnected();
      await this.setDestination(client, server, key);
      assertConnected();
      await client.call("SetCurrentProgramScene", { sceneName: scene });
      await beforeStart();
      assertConnected();
      await client.call("StartStream");
      for (let probe = 0; probe < 6; probe++) {
        const { outputActive } = await client.call("GetStreamStatus");
        if (outputActive) break;
        await delay(250);
        assertConnected();
      }
      await this.readBack(client);
      return this.observed.streaming === true;
    });
  }

  async socialStreamStatus() {
    return this.withObs(async (client) => {
      const { outputActive, outputReconnecting } = await client.call("GetStreamStatus");
      return outputActive || outputReconnecting;
    });
  }

  async stopSocial(authorize: Authorize) {
    return this.withObs(async (client, assertConnected) => {
      const status = await client.call("GetStreamStatus");
      if (status.outputActive || status.outputReconnecting) {
        await authorize();
        assertConnected();
        await client.call("StopStream");
      }
      const { outputActive, outputReconnecting } = await client.call("GetStreamStatus");
      return !outputActive && !outputReconnecting;
    });
  }

  private async readBack(client: OBSWebSocket) {
    const [stream, scene] = await Promise.all([
      client.call("GetStreamStatus"),
      client.call("GetCurrentProgramScene"),
    ]);
    this.observed = {
      ...this.observed,
      streaming: stream.outputActive,
      scene: scene.currentProgramSceneName,
    };
    this.nextProbe = Date.now() + 5_000;
  }
}

export class LiveStreamObsActionError extends Error {}
