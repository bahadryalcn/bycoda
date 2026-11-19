import { join } from "node:path";
import {
  normalizeChannel,
  type LiveConnectionState,
  type LiveEvent,
  type LivePlatform,
} from "../../src/features/live-stream/model/liveEvents";
import {
  emptyLiveSession,
  liveSessionSnapshot,
  reduceLiveSession,
  type LiveSessionState,
} from "../../src/features/live-stream/model/liveSession";
import type {
  LiveStreamLiveStartParams,
  LiveStreamReport,
  LiveStreamStatus,
} from "../../src/shared/model/host-contracts/live-stream";
import type { SecretValueStore } from "../secrets/secret-store";
import type { SocialLiveService } from "../social/core/social-live";
import type { SocialPrincipal } from "../social/social";
import { readStateFile, writeFileAtomic } from "../storage/atomic-write";
import { connectDemo } from "./connectors/demo";
import { connectTikTok, tiktokConnectionError } from "./connectors/tiktok";
import { LiveStreamObs } from "./obs";
import { LiveStreamSocialBroadcast, type ApprovedLiveTarget } from "./social-broadcast";

const EULER_KEY = "live-stream-euler-api";
type Session = Pick<LiveStreamReport, "channel" | "platform" | "startedAt" | "endedAt">;
type Saved = {
  version: 1;
  updatedAt: number;
  session?: Session;
  live: LiveSessionState;
  obsConfigured?: boolean;
};
type Authority = () => Promise<boolean>;
type Dependencies = {
  directory: string;
  secrets: SecretValueStore;
  tiktok?: typeof connectTikTok;
  social?: () => SocialLiveService;
};

function readSaved(text: string): Saved {
  const state = JSON.parse(text) as Saved;
  if (
    state.version !== 1 ||
    !state.live ||
    !Array.isArray(state.live.seen) ||
    !state.live.gifters ||
    !state.live.totals
  )
    throw new Error("Invalid Live streaming state.");
  return state;
}

async function check(authorize?: Authority) {
  if (authorize && !(await authorize()))
    throw new Error("Live streaming permission is no longer available.");
}

export class LiveStreamService {
  private readonly file: string;
  private readonly obs: LiveStreamObs;
  private readonly socialBroadcast: LiveStreamSocialBroadcast;
  private state: Saved = { version: 1, updatedAt: Date.now(), live: emptyLiveSession() };
  private connection: LiveConnectionState = {
    platform: "demo",
    channel: "",
    status: "idle",
    attempts: 0,
  };
  private feed: LiveEvent[] = [];
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
    this.file = join(dependencies.directory, "live-stream.json");
    this.obs = new LiveStreamObs(dependencies.secrets);
    this.socialBroadcast = new LiveStreamSocialBroadcast(
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
      throw new Error("Live streaming state is damaged. Restore a backup to continue.");
    if (saved.value) {
      this.state = saved.value;
      if (this.state.session) {
        const { channel, platform, endedAt } = this.state.session;
        this.connection = { platform, channel, status: "idle", attempts: 0 };
        if (!endedAt)
          this.state.session.endedAt = Math.max(this.state.session.startedAt, this.state.updatedAt);
      }
      this.obs.configureView(this.state.obsConfigured === true);
    }
    await this.save();
    if (this.closing) return;
    this.timer = setInterval(() => {
      if (this.dirty && !this.pendingSave) {
        this.pendingSave = true;
        void this.serial(() => this.save())
          .catch(() => {})
          .finally(() => {
            this.pendingSave = false;
          });
      }
    }, 2_000);
    this.timer.unref();
  }

  private async save(next = this.state) {
    this.dirty = false;
    try {
      await writeFileAtomic(this.file, JSON.stringify({ ...next, updatedAt: Date.now() }));
      this.persistenceError = undefined;
    } catch {
      this.dirty = true;
      this.persistenceError = "Live streaming could not save its state.";
      throw new Error(this.persistenceError);
    }
  }

  private serial<T>(run: () => Promise<T>, authorize?: Authority): Promise<T> {
    const operation = this.queue.then(async () => {
      if (this.closing) throw new Error("Live streaming is shutting down.");
      await this.ready();
      await check(authorize);
      return run();
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  private events(): LiveStreamStatus["events"] {
    return this.feed.map((event) => ({
      id: event.id,
      at: event.at,
      kind: event.kind,
      name: "viewer" in event ? event.viewer.name : undefined,
      text:
        event.kind === "gift" ? event.giftName : event.kind === "comment" ? event.text : undefined,
      count: "count" in event ? event.count : undefined,
    }));
  }

  async status(authorize?: Authority): Promise<LiveStreamStatus> {
    await this.ready();
    await check(authorize);
    const eulerKeyConfigured = await this.hasEulerKey();
    await check(authorize);
    return {
      connection: { ...this.connection, detail: this.persistenceError ?? this.connection.detail },
      snapshot: liveSessionSnapshot(this.state.live),
      obs: this.obs.view(),
      eulerKeyConfigured,
      events: this.events(),
    };
  }

  async report(authorize?: Authority): Promise<LiveStreamReport | null> {
    await this.ready();
    await check(authorize);
    if (!this.state.session) return null;
    const { totals, topGifters } = liveSessionSnapshot(this.state.live);
    return { ...this.state.session, totals, topGifters };
  }

  private stopConnector() {
    this.generation++;
    clearTimeout(this.retry);
    this.disconnect?.();
    this.disconnect = undefined;
  }

  private accept(event: LiveEvent) {
    const live = reduceLiveSession(this.state.live, event);
    if (live === this.state.live) return;
    this.state.live = live;
    this.dirty = true;
    this.feed = [...this.feed.slice(-39), event];
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
      await check(authorize);
      const next: Saved = {
        ...this.state,
        live: emptyLiveSession(),
        session: { channel, platform, startedAt: Date.now() },
      };
      await this.save(next);
      this.stopConnector();
      this.state = next;
      this.dirty = false;
      this.feed = [];
      this.connection = {
        channel,
        platform,
        attempts: 0,
        status: platform === "demo" ? "connected" : "connecting",
      };
      if (platform === "demo") {
        this.connection.connectedAt = Date.now();
        this.disconnect = connectDemo((event) => this.accept(event));
      } else {
        this.connect(this.generation, key);
      }
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
      await this.save();
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

  obsSetup(authorize?: Authority) {
    return this.serial(async () => {
      await this.socialBroadcast.assertManual("setup");
      await this.obs.setup(() => check(authorize));
      this.state.obsConfigured = true;
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

  obsCredentials(server: string, key: string) {
    return this.serial(async () => {
      await this.socialBroadcast.assertManual("credentials");
      await this.obs.credentials(server, key);
      await this.socialBroadcast.manualDestinationSaved();
      return this.status();
    });
  }

  /** The scene to broadcast: the requested one, otherwise the scene OBS shows now. */
  async liveScene(scene?: string) {
    await this.ready();
    return scene ?? this.obs.currentScene();
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
    params: LiveStreamLiveStartParams & { scene: string },
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
