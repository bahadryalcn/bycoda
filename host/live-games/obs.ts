import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import OBSWebSocket from "obs-websocket-js";
import { z } from "zod";
import { LIVE_GAMES_DEFAULT_SCENE } from "../../src/shared/model/host-contracts/live-games";
import type {
  LiveGamesObsSetupOptions,
  LiveGamesStatus,
} from "../../src/shared/model/host-contracts/live-games";
import type { SecretValueStore } from "../secrets/secret-store";
import { readStateFile, writeFileAtomic } from "../storage/atomic-write";

export const HALAY_SCENE = LIVE_GAMES_DEFAULT_SCENE;
const SOURCE = "Bycoda Halay Overlay";
const PASSWORD = "live-games-obs-websocket";
const STREAM_KEY = "live-games-obs-stream-key";
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
export class LiveGamesObs {
  private observed: LiveGamesStatus["obs"] = { configured: false };
  private nextProbe = 0;
  private pendingProbe?: Promise<unknown>;

  constructor(private readonly secrets: SecretValueStore) {}

  configureView(options?: LiveGamesObsSetupOptions) {
    this.observed = { configured: options !== undefined, ...options };
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
      if (error instanceof LiveGamesObsActionError) throw error;
      throw new Error(
        "OBS did not complete the request. Open OBS and check its WebSocket settings.",
      );
    } finally {
      expired = true;
      controller.abort();
      void client.disconnect().catch(() => {});
    }
  }

  async setup(overlayUrl: string, options: LiveGamesObsSetupOptions, authorize: Authorize) {
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

    const url = new URL(overlayUrl);
    if (options.aspect === "16:9") url.searchParams.set("aspect", "16:9");
    if (options.clean) url.searchParams.set("clean", "");
    if (options.mute) url.searchParams.set("mute", "");
    const landscape = options.aspect === "16:9";
    const settings = {
      url: url.href,
      width: landscape ? 1920 : 1080,
      height: landscape ? 1080 : 1920,
      is_local_file: false,
      reroute_audio: true,
      shutdown: false,
    };
    await this.withObs(async (client) => {
      await authorize();
      const { scenes } = await client.call("GetSceneList");
      if (!scenes.some((scene) => scene.sceneName === HALAY_SCENE))
        await client.call("CreateScene", { sceneName: HALAY_SCENE });
      const { inputs } = await client.call("GetInputList");
      const source = inputs.find((input) => input.inputName === SOURCE);
      if (!source) {
        await client.call("CreateInput", {
          sceneName: HALAY_SCENE,
          inputName: SOURCE,
          inputKind: "browser_source",
          inputSettings: settings,
          sceneItemEnabled: true,
        });
      } else {
        if (source.inputKind !== "browser_source")
          throw new LiveGamesObsActionError(
            `An OBS source named "${SOURCE}" already uses a different input type.`,
          );
        await client.call("SetInputSettings", {
          inputName: SOURCE,
          inputSettings: settings,
          overlay: true,
        });
        const { sceneItems } = await client.call("GetSceneItemList", { sceneName: HALAY_SCENE });
        if (!sceneItems.some((item) => item.sourceName === SOURCE))
          await client.call("CreateSceneItem", {
            sceneName: HALAY_SCENE,
            sourceName: SOURCE,
            sceneItemEnabled: true,
          });
      }
      this.configureView(options);
      await this.readBack(client);
    });
  }

  async switchScene(authorize: Authorize) {
    await this.withObs(async (client) => {
      await authorize();
      await client.call("SetCurrentProgramScene", { sceneName: HALAY_SCENE });
      await this.readBack(client);
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
        throw new LiveGamesObsActionError("Stop streaming before changing the stream destination.");
      await this.secrets.set(STREAM_KEY, key);
      await this.setDestination(client, server, key);
      await this.readBack(client);
    });
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
      throw new LiveGamesObsActionError("OBS_ALREADY_STREAMING");
    const { scenes } = await client.call("GetSceneList");
    if (!scenes.some((entry) => entry.sceneName === scene))
      throw new LiveGamesObsActionError("SCENE_NOT_FOUND");
  }

  async socialPreflight(scene: string) {
    if (!this.observed.configured) throw new LiveGamesObsActionError("OBS_NOT_CONFIGURED");
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

export class LiveGamesObsActionError extends Error {}
