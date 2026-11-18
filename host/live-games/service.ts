import { randomBytes } from "node:crypto";
import { join } from "node:path";
import {
  DEFAULT_HALAY_CONFIG,
  displayName,
  emptyHalayState,
  halaySnapshot,
  isBlocked,
  reduceHalay,
  type HalayConfig,
  type HalayCue,
  type HalayState,
} from "../../src/features/live-games/model/halayGame";
import {
  normalizeChannel,
  type LiveConnectionState,
  type LiveEvent,
  type LivePlatform,
} from "../../src/features/live-games/model/liveEvents";
import {
  LiveGamesConfigPatchSchema,
  LiveGamesRulesSchema,
  type LiveGamesLiveStartParams,
  type LiveGamesObsSetupOptions,
  type LiveGamesReport,
  type LiveGamesStatus,
} from "../../src/shared/model/host-contracts/live-games";
import type { SecretValueStore } from "../secrets/secret-store";
import type { SocialLiveService } from "../social/core/social-live";
import type { SocialPrincipal } from "../social/social";
import { readStateFile, writeFileAtomic } from "../storage/atomic-write";
import { AvatarCache } from "./avatars";
import { connectDemo } from "./connectors/demo";
import { connectTikTok, tiktokConnectionError } from "./connectors/tiktok";
import { LiveGamesObs } from "./obs";
import { LiveGamesSocialBroadcast, type ApprovedLiveTarget } from "./social-broadcast";

const EULER_KEY = "live-games-euler-api";
type Session = Pick<LiveGamesReport, "channel" | "platform" | "startedAt" | "endedAt">;
type Saved = {
  version: 1;
  token: string;
  config: HalayConfig;
  game: HalayState;
  session?: Session;
  obs?: LiveGamesObsSetupOptions;
};
type Authority = () => Promise<boolean>;
type GameListener = (
  snapshot: LiveGamesStatus["snapshot"],
  cues: HalayCue[],
  active: boolean,
) => void;
type Dependencies = {
  directory: string;
  secrets: SecretValueStore;
  port: () => number;
  tiktok?: typeof connectTikTok;
  social?: () => SocialLiveService;
};

function readSaved(text: string): Saved {
  const state = JSON.parse(text) as Saved;
  if (
    state.version !== 1 ||
    !/^[A-Za-z0-9_-]{43}$/.test(state.token) ||
    !state.game ||
    !Array.isArray(state.game.dancers) ||
    !Array.isArray(state.game.seen) ||
    !Array.isArray(state.game.feed) ||
    !state.game.gifters ||
    !state.game.totals
  )
    throw new Error("Invalid Live games state.");
  const { giftRules, ...patch } = state.config;
  state.config = {
    ...DEFAULT_HALAY_CONFIG,
    ...LiveGamesConfigPatchSchema.parse(patch),
    giftRules: LiveGamesRulesSchema.parse(giftRules),
  };
  return state;
}

async function check(authorize?: Authority) {
  if (authorize && !(await authorize()))
    throw new Error("Live games permission is no longer available.");
}

export class LiveGamesService {
  private readonly file: string;
  private readonly obs: LiveGamesObs;
  private readonly socialBroadcast: LiveGamesSocialBroadcast;
  private readonly avatars = new AvatarCache();
  private readonly listeners = new Set<GameListener>();
  private readonly closer = new Set<() => void>();
  private state: Saved = {
    version: 1,
    token: randomBytes(32).toString("base64url"),
    config: DEFAULT_HALAY_CONFIG,
    game: emptyHalayState(Date.now()),
  };
  private connection: LiveConnectionState = {
    platform: "demo",
    channel: "",
    status: "idle",
    attempts: 0,
  };
  private feed: LiveEvent[] = [];
  private cues: HalayCue[] = [];
  private initialized?: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private retry?: ReturnType<typeof setTimeout>;
  private disconnect?: () => void;
  private generation = 0;
  private currentAttempt = 0;
  private dirty = false;
  private pendingSave = false;
  private closing = false;
  private persistenceError?: string;

  constructor(private readonly dependencies: Dependencies) {
    this.file = join(dependencies.directory, "live-games.json");
    this.obs = new LiveGamesObs(dependencies.secrets);
    this.socialBroadcast = new LiveGamesSocialBroadcast(
      dependencies.directory,
      this.obs,
      dependencies.social,
    );
  }

  private ready() {
    this.initialized ??= this.load();
    return this.initialized;
  }

  private async load() {
    const saved = await readStateFile(this.file, readSaved);
    if (saved.status === "corrupt")
      throw new Error("Live games state is damaged. Restore a backup to continue.");
    if (saved.value) {
      this.state = saved.value;
      if (this.state.session) {
        const { channel, platform, endedAt } = this.state.session;
        this.connection = { platform, channel, status: "idle", attempts: 0 };
        if (!endedAt)
          this.state.session.endedAt = Math.max(
            this.state.session.startedAt,
            this.state.game.updatedAt,
          );
      }
      this.obs.configureView(this.state.obs);
    }
    await this.save();
    if (this.closing) return;
    let cycle = 0;
    this.timer = setInterval(() => {
      this.broadcast();
      if (++cycle % 8 === 0 && this.dirty && !this.pendingSave) {
        this.pendingSave = true;
        void this.serial(() => this.save())
          .catch(() => {})
          .finally(() => {
            this.pendingSave = false;
          });
      }
    }, 250);
    this.timer.unref();
  }

  private async save(next = this.state) {
    this.dirty = false;
    try {
      await writeFileAtomic(this.file, JSON.stringify(next));
      this.persistenceError = undefined;
    } catch {
      this.dirty = true;
      this.persistenceError = "Live games could not save its state.";
      throw new Error(this.persistenceError);
    }
  }

  private serial<T>(run: () => Promise<T>, authorize?: Authority): Promise<T> {
    const operation = this.queue.then(async () => {
      if (this.closing) throw new Error("Live games is shutting down.");
      await this.ready();
      await check(authorize);
      return run();
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  private overlayUrl() {
    return `http://127.0.0.1:${this.dependencies.port()}/live-games/${this.state.token}/`;
  }

  async token() {
    await this.ready();
    return this.state.token;
  }

  avatar(key: string) {
    return this.avatars.read(key);
  }

  private snapshot(absolute: boolean) {
    const snapshot = halaySnapshot(this.state.game, this.state.config, Date.now());
    for (const viewer of [...snapshot.dancers, ...snapshot.topGifters]) {
      const avatar = this.avatars.get(viewer.id, viewer.avatarUrl);
      viewer.avatarUrl = avatar
        ? `${absolute ? this.overlayUrl() : ""}avatar/${avatar}`
        : undefined;
    }
    return snapshot;
  }

  subscribe(listener: GameListener, close: () => void) {
    this.listeners.add(listener);
    this.closer.add(close);
    listener(this.snapshot(false), [], this.connection.status === "connected");
    return () => {
      this.listeners.delete(listener);
      this.closer.delete(close);
    };
  }

  private broadcast() {
    const cues = this.cues;
    this.cues = [];
    if (!this.listeners.size) return;
    const snapshot = this.snapshot(false);
    const active = this.connection.status === "connected";
    for (const listener of this.listeners) listener(snapshot, cues, active);
  }

  private events(): LiveGamesStatus["events"] {
    const { config } = this.state;
    const result: LiveGamesStatus["events"] = [];
    for (const event of this.feed) {
      if ("viewer" in event && isBlocked(config, event.viewer)) continue;
      result.push({
        id: event.id,
        at: event.at,
        kind: event.kind,
        name: "viewer" in event ? displayName(event.viewer.name, config.shortNames) : undefined,
        text:
          event.kind === "gift"
            ? event.giftName
            : event.kind === "comment"
              ? event.text
              : undefined,
        count: "count" in event ? event.count : undefined,
      });
    }
    return result;
  }

  async status(authorize?: Authority): Promise<LiveGamesStatus> {
    await this.ready();
    await check(authorize);
    const eulerKeyConfigured = await this.hasEulerKey();
    await check(authorize);
    return {
      connection: { ...this.connection, detail: this.persistenceError ?? this.connection.detail },
      config: this.state.config,
      snapshot: this.snapshot(true),
      overlayUrl: this.overlayUrl(),
      obs: this.obs.view(),
      eulerKeyConfigured,
      events: this.events(),
    };
  }

  async report(authorize?: Authority): Promise<LiveGamesReport | null> {
    await this.ready();
    await check(authorize);
    if (!this.state.session) return null;
    const { totals, topGifters } = this.snapshot(true);
    return { ...this.state.session, totals, topGifters };
  }

  private stopConnector() {
    this.generation++;
    clearTimeout(this.retry);
    this.disconnect?.();
    this.disconnect = undefined;
  }

  private accept(event: LiveEvent) {
    const { state, cues } = reduceHalay(this.state.game, event, this.state.config, event.at);
    if (state === this.state.game) return;
    this.state.game = state;
    this.dirty = true;
    if ("viewer" in event && isBlocked(this.state.config, event.viewer)) return;
    this.feed = [...this.feed.slice(-39), event];
    this.cues.push(...cues.slice(0, Math.max(0, 80 - this.cues.length)));
  }

  private connect(generation: number, key: string | undefined) {
    const attempt = ++this.currentAttempt;
    const active = () => this.generation === generation && this.currentAttempt === attempt;
    const fail = (error?: unknown) => {
      if (!active()) return;
      this.currentAttempt++;
      const failure = error
        ? tiktokConnectionError(error)
        : {
            offline: false,
            detail: "TikTok LIVE disconnected. Reconnecting shortly.",
          };
      const attempts = this.connection.attempts + 1;
      this.connection = {
        ...this.connection,
        attempts,
        roomId: undefined,
        connectedAt: undefined,
        detail: failure.detail,
        status: failure.offline ? "offline" : "reconnecting",
      };
      this.retry = setTimeout(
        () => this.connect(generation, key),
        Math.min(60_000, 2_000 * 2 ** Math.min(attempts - 1, 5)),
      );
      this.retry.unref();
    };
    try {
      this.disconnect = (this.dependencies.tiktok ?? connectTikTok)(this.connection.channel, key, {
        event: (event) => {
          if (active()) this.accept(event);
        },
        connected: (roomId) => {
          if (!active()) return;
          this.connection = {
            ...this.connection,
            status: "connected",
            attempts: 0,
            detail: undefined,
            roomId,
            connectedAt: Date.now(),
          };
        },
        disconnected: fail,
      });
    } catch (error) {
      fail(error);
    }
  }

  private begin(platform: LivePlatform, channel: string, authorize?: Authority) {
    return this.serial(async () => {
      if (
        this.connection.status !== "idle" &&
        this.connection.platform === platform &&
        this.connection.channel === channel
      )
        return this.status(authorize);
      const key =
        platform === "tiktok" ? await this.dependencies.secrets.get(EULER_KEY) : undefined;
      const startedAt = Date.now();
      await check(authorize);
      const next: Saved = {
        ...this.state,
        game: emptyHalayState(startedAt),
        session: { channel, platform, startedAt },
      };
      await this.save(next);
      this.stopConnector();
      this.state = next;
      this.dirty = false;
      this.feed = [];
      this.cues = [];
      this.connection = {
        channel,
        platform,
        attempts: 0,
        status: platform === "demo" ? "connected" : "connecting",
      };
      if (platform === "demo") {
        this.connection.connectedAt = Date.now();
        this.disconnect = connectDemo(
          (event) => this.accept(event),
          this.state.config.joinKeywords[0] ?? "HALAY",
        );
      } else {
        this.connect(this.generation, key);
      }
      this.broadcast();
      return this.status(authorize);
    }, authorize);
  }

  start(channel: string, authorize?: Authority) {
    const handle = normalizeChannel(channel).toLowerCase();
    if (!/^[a-z0-9_.]{1,32}$/.test(handle))
      throw new Error("Enter a TikTok handle or profile link.");
    return this.begin("tiktok", handle, authorize);
  }

  demo(authorize?: Authority) {
    return this.begin("demo", "demo", authorize);
  }

  stop(authorize?: Authority) {
    return this.serial(async () => {
      this.stopConnector();
      this.connection = {
        platform: this.connection.platform,
        channel: this.connection.channel,
        status: "idle",
        attempts: 0,
      };
      if (this.state.session && !this.state.session.endedAt)
        this.state.session.endedAt = Date.now();
      this.cues = [];
      this.broadcast();
      await this.save();
      return this.status(authorize);
    }, authorize);
  }

  setRules(rules: HalayConfig["giftRules"], authorize?: Authority) {
    return this.updateConfig({ giftRules: LiveGamesRulesSchema.parse(rules) }, authorize);
  }

  setConfig(patch: Omit<Partial<HalayConfig>, "giftRules">, authorize?: Authority) {
    return this.updateConfig(LiveGamesConfigPatchSchema.parse(patch), authorize);
  }

  private updateConfig(patch: Partial<HalayConfig>, authorize?: Authority) {
    return this.serial(async () => {
      const config = { ...this.state.config, ...patch };
      await this.save({ ...this.state, config });
      this.state.config = config;
      this.cues = [];
      this.broadcast();
      return this.status(authorize);
    }, authorize);
  }

  eulerKey(key: string) {
    return this.serial(async () => {
      key = key.trim();
      if (key) await this.dependencies.secrets.set(EULER_KEY, key);
      else await this.dependencies.secrets.delete(EULER_KEY);
      this.eulerKeyState = Promise.resolve(Boolean(key));
      if (this.connection.platform === "tiktok" && this.connection.status !== "idle") {
        this.stopConnector();
        this.connection = {
          platform: "tiktok",
          channel: this.connection.channel,
          status: "connecting",
          attempts: 0,
        };
        this.connect(this.generation, key || undefined);
      }
      return this.status();
    });
  }

  private eulerKeyState?: Promise<boolean>;

  private hasEulerKey() {
    this.eulerKeyState ??= this.dependencies.secrets.get(EULER_KEY).then(Boolean, () => {
      this.eulerKeyState = undefined;
      return false;
    });
    return this.eulerKeyState;
  }

  obsSetup(options: LiveGamesObsSetupOptions = {}, authorize?: Authority) {
    return this.serial(async () => {
      await this.socialBroadcast.assertManual("setup");
      const selected = {
        aspect: "9:16",
        ...this.state.obs,
        ...options,
      } as LiveGamesObsSetupOptions;
      await this.obs.setup(this.overlayUrl(), selected, () => check(authorize));
      this.state.obs = selected;
      await this.save();
      return this.status(authorize);
    }, authorize);
  }

  obsStream(action: "start" | "stop", authorize?: Authority) {
    return this.serial(async () => {
      await this.socialBroadcast.assertManual(action);
      await this.obs.stream(action, () => check(authorize));
      return this.status(authorize);
    }, authorize);
  }

  obsScene(authorize?: Authority) {
    return this.serial(async () => {
      await this.socialBroadcast.assertManual("scene");
      await this.obs.switchScene(() => check(authorize));
      return this.status(authorize);
    }, authorize);
  }

  obsCredentials(server: string, key: string) {
    return this.serial(async () => {
      await this.socialBroadcast.assertManual("credentials");
      await this.obs.credentials(server, key);
      await this.socialBroadcast.manualDestinationSaved();
      return this.status();
    });
  }

  liveAccounts(principal?: SocialPrincipal) {
    return this.socialBroadcast.accounts(principal);
  }

  liveAccount(accountId: string, principal?: SocialPrincipal) {
    return this.socialBroadcast.approvalTarget(accountId, principal);
  }

  async liveStatus(principal?: SocialPrincipal) {
    await this.ready();
    return this.socialBroadcast.status(principal);
  }

  liveStart(
    params: LiveGamesLiveStartParams,
    principal: SocialPrincipal | undefined,
    authorize: Authority,
    approvedAccount?: ApprovedLiveTarget,
  ) {
    return this.serial(() =>
      this.socialBroadcast.start(
        params,
        principal,
        async () => !this.closing && authorize(),
        approvedAccount,
      ),
    );
  }

  async liveStop(principal?: SocialPrincipal, authorize?: Authority, platformEnded?: boolean) {
    if (!platformEnded) await this.socialBroadcast.cancel(principal, authorize);
    return this.serial(
      () => this.socialBroadcast.stop(principal, authorize, platformEnded),
      authorize,
    );
  }

  async close() {
    this.closing = true;
    this.stopConnector();
    clearInterval(this.timer);
    for (const close of this.closer) close();
    await this.queue;
    this.stopConnector();
    if (
      this.initialized &&
      (await this.initialized.then(
        () => true,
        () => false,
      ))
    ) {
      if (this.state.session && !this.state.session.endedAt)
        this.state.session.endedAt = Date.now();
      await this.save();
    }
  }
}
