import { randomUUID } from "node:crypto";
import type { DeviceEffectContext, DeviceHost } from "./device-host";
import type {
  DevicePreviewInput as PreviewInput,
  DevicePreviewStage as Stage,
  DevicePreviewSnapshot as Preview,
} from "../src/shared/model/host-contracts/native-devices";
import { expoManifest, expoPreviewUrl } from "./expo-go";
import { scrubRuntimeLogText } from "./runtime-logs";
import { elapsedSince, monotonicNow } from "../src/shared/lib/time/timestamps";

const OPEN_LABELS = ["Open", "Aç", "Öffnen", "Ouvrir", "Abrir", "打开", "開く"];
/** A finished preview (and its frame) is kept this long for request deduplication. */
export const PREVIEW_RETENTION_TTL_MS = 60 * 60 * 1000;
const PREVIEW_HISTORY_LIMIT = 128;

/** Bounded, observable setup jobs. Request IDs prevent duplicate launch/install attempts. */
export class DevicePreviews {
  private jobs = new Map<string, Preview>();
  private disposed = false;
  private stopping = false;
  private owners = new Map<string, string>();
  private authorizations = new Map<string, () => boolean | Promise<boolean>>();
  private resultAuthorizations = new Map<string, () => Promise<boolean>>();
  /** Monotonic readings: when a job finished, and when it was last read (LRU order). */
  private finishedAt = new Map<string, number>();
  private touchedAt = new Map<string, number>();
  private work = new Set<Promise<void>>();
  private readonly now: () => number;
  private readonly historyLimit: number;
  constructor(
    private host: DeviceHost,
    private manifest = expoManifest,
    private readonly outsideScope: <T>(action: () => T) => T = (action) => action(),
    options: { now?: () => number; historyLimit?: number } = {},
  ) {
    this.now = options.now ?? monotonicNow;
    this.historyLimit = options.historyLimit ?? PREVIEW_HISTORY_LIMIT;
  }
  start(
    input: PreviewInput,
    owner: string,
    authorized: () => boolean | Promise<boolean> = () => true,
  ) {
    expoPreviewUrl(input.url);
    const existing = [...this.jobs.values()].find(
      (job) => job.requestId === input.requestId && this.owners.get(job.id) === owner,
    );
    if (existing) {
      const prior = this.inputs.get(existing.id)!;
      const signature = (value: PreviewInput) =>
        JSON.stringify([
          value.deviceId,
          value.url,
          value.installExpoGo ?? false,
          value.expectedText ?? null,
        ]);
      if (signature(prior) !== signature(input))
        throw new Error(
          "PREVIEW_REQUEST_CONFLICT: This requestId belongs to different preview input.",
        );
      return this.status(existing.id, owner);
    }
    if (this.stopping)
      throw new Error("PREVIEW_HOST_STOPPING: Wait for the device service to finish stopping.");
    if (this.disposed) throw new Error("PREVIEW_HOST_STOPPED: The device host is stopping.");
    if ([...this.jobs.values()].some((job) => job.state === "queued" || job.state === "running"))
      throw new Error("PREVIEW_BUSY: Wait for the active device preview before starting another.");
    // Finished outcomes stay for request deduplication until their TTL passes; when
    // the history is still full, the least recently read finished job makes room.
    this.evictFinished();
    if (this.jobs.size >= this.historyLimit)
      throw new Error(
        "PREVIEW_HISTORY_FULL: Restart the idle host before starting additional previews.",
      );
    const job: Preview = {
      id: randomUUID(),
      requestId: input.requestId,
      deviceId: input.deviceId,
      state: "queued",
      stages: [],
      verification: input.expectedText ? "expected-text" : "launch-only",
      updatedAt: new Date().toISOString(),
    };
    this.jobs.set(job.id, job);
    this.touchedAt.set(job.id, this.now());
    const acceptedInput = Object.freeze({ ...input });
    this.inputs.set(job.id, acceptedInput);
    this.owners.set(job.id, owner);
    this.authorizations.set(job.id, authorized);
    this.resultAuthorizations.set(job.id, async () => {
      if (
        this.disposed ||
        this.jobs.get(job.id) !== job ||
        this.authorizations.get(job.id) !== authorized
      )
        return false;
      try {
        if (!(await authorized())) return false;
      } catch {
        return false;
      }
      return (
        !this.disposed &&
        this.jobs.get(job.id) === job &&
        this.authorizations.get(job.id) === authorized
      );
    });
    this.outsideScope(() => {
      const running = this.run(job, acceptedInput);
      this.work.add(running);
      void running.finally(() => this.work.delete(running)).catch(() => {});
    });
    return this.status(job.id, owner);
  }
  private inputs = new Map<string, PreviewInput>();
  status(id: string, owner: string, includeFrame = false) {
    const job = this.jobs.get(id);
    if (!job)
      throw new Error(
        "PREVIEW_NOT_FOUND: This preview is unknown or its host restarted. Inspect the device before starting a new request.",
      );
    if (this.owners.get(id) !== owner)
      throw new Error("PREVIEW_SCOPE_MISMATCH: This preview belongs to another conversation.");
    this.touchedAt.set(id, this.now());
    const { frame, ...summary } = job;
    return structuredClone({ ...summary, ...(includeFrame && frame ? { frame } : {}) });
  }
  /** Drop finished jobs past their TTL, then the least recently read ones while over the cap. */
  private evictFinished(): void {
    const now = this.now();
    for (const [id, finished] of this.finishedAt)
      if (elapsedSince(finished, now) >= PREVIEW_RETENTION_TTL_MS) this.drop(id);
    while (this.jobs.size >= this.historyLimit) {
      let victim: string | undefined;
      for (const id of this.finishedAt.keys())
        if (
          victim === undefined ||
          (this.touchedAt.get(id) ?? 0) < (this.touchedAt.get(victim) ?? 0)
        )
          victim = id;
      if (victim === undefined) break;
      this.drop(victim);
    }
  }
  /** Retire a finished job with its frame data and every authority that disclosed it. */
  private drop(id: string): void {
    this.jobs.delete(id);
    this.owners.delete(id);
    this.inputs.delete(id);
    this.authorizations.delete(id);
    this.resultAuthorizations.delete(id);
    this.finishedAt.delete(id);
    this.touchedAt.delete(id);
  }
  /** Stable original-job disclosure capability; invoking it never copies a frame. */
  resultAuthority(id: string, owner: string): () => Promise<boolean> {
    this.status(id, owner);
    const authority = this.resultAuthorizations.get(id);
    if (!authority)
      throw new Error("PREVIEW_NOT_FOUND: The original preview is no longer available.");
    return authority;
  }
  /** A new request cannot replace the authority that originally admitted a job. */
  async authorizedStatus(
    id: string,
    owner: string,
    includeFrame = false,
    currentAuthorized: () => boolean | Promise<boolean> = () => true,
  ) {
    this.status(id, owner); // Validate ownership before awaiting either callback.
    const job = this.jobs.get(id)!;
    const original = this.resultAuthority(id, owner);
    if (!(await currentAuthorized()) || !(await original()))
      throw new Error(
        "PREVIEW_AUTHORITY_REVOKED: Preview authority expired; no frame or status was disclosed.",
      );
    if (this.jobs.get(id) !== job || this.resultAuthorizations.get(id) !== original)
      throw new Error("PREVIEW_NOT_FOUND: The original preview is no longer available.");
    return this.status(id, owner, includeFrame);
  }
  mobileStatus(owner: string, query: { id?: string; requestId?: string }, includeFrame = false) {
    if (
      !owner ||
      typeof owner !== "string" ||
      owner.length > 256 ||
      (typeof query.id !== "string" && typeof query.requestId !== "string") ||
      (query.id !== undefined && (!query.id || query.id.length > 128)) ||
      (query.requestId !== undefined && (!query.requestId || query.requestId.length > 128))
    )
      throw new Error("PREVIEW_INVALID_QUERY: Choose an exact preview ID or request ID.");
    const job = query.id
      ? this.jobs.get(query.id)
      : [...this.jobs.values()].find(
          (row) => row.requestId === query.requestId && this.owners.get(row.id) === owner,
        );
    if (
      !job ||
      this.owners.get(job.id) !== owner ||
      (query.requestId !== undefined && job.requestId !== query.requestId)
    )
      throw new Error(
        "PREVIEW_NOT_FOUND: This preview is unknown or its host restarted. Inspect the device before starting a new request.",
      );
    return this.status(job.id, owner, includeFrame);
  }
  stopImpact(owner: string) {
    const active = [...this.jobs.values()].filter(
      (row) => row.state === "queued" || row.state === "running",
    );
    const owned = active
      .filter((row) => this.owners.get(row.id) === owner)
      .map(({ id, deviceId, state }) => ({ id, deviceId, state }));
    return { activeCount: active.length, owned, otherActiveCount: active.length - owned.length };
  }
  /** Acquire before awaiting the service stop, so a new preview cannot cross it. */
  async stopIdle<T>(work: () => Promise<T>): Promise<T> {
    if (this.stopping)
      throw new Error("PREVIEW_HOST_STOPPING: The device service is already stopping.");
    if (this.stopImpact("").activeCount)
      throw new Error("PREVIEW_BUSY: Wait for active device previews before stopping the service.");
    this.stopping = true;
    try {
      return await work();
    } finally {
      this.stopping = false;
    }
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    await Promise.allSettled([...this.work]);
  }
  private async run(job: Preview, input: PreviewInput) {
    job.state = "running";
    const authorize = async () => {
      if (this.disposed)
        throw new Error("PREVIEW_HOST_STOPPED: The device host stopped during preparation.");
      if (!(await this.authorizations.get(job.id)?.()))
        throw new Error(
          "PREVIEW_AUTHORITY_REVOKED: Preview authority expired; no further steps will run.",
        );
      if (this.disposed)
        throw new Error("PREVIEW_HOST_STOPPED: The device host stopped during preparation.");
    };
    const effect: DeviceEffectContext = {
      authorized: async () => {
        await authorize();
        return true;
      },
    };
    const stage = async (name: string, work: () => Promise<void>) => {
      const item: Stage = { name, state: "running" };
      job.stages.push(item);
      job.updatedAt = new Date().toISOString();
      await authorize();
      await work();
      await authorize();
      item.state = "done";
      job.updatedAt = new Date().toISOString();
    };
    try {
      let platform: "ios" | "android" = "ios",
        sdk = "",
        app = "";
      await stage("preflight", async () => {
        const check = await this.host.preflight(input.deviceId, effect);
        if (!check.device)
          throw new Error(
            "DEVICE_NOT_FOUND: Discover devices on the selected machine and choose its exact deviceId.",
          );
        if (!check.checks.sdk)
          throw new Error(
            "DEVICE_SDK_MISSING: Configure Xcode or the Android SDK on the selected machine.",
          );
        if (!check.checks.tools || !check.checks.agentControl)
          throw new Error(
            "DEVICE_SETUP_REQUIRED: Device tools and agent control must already be enabled by the owner.",
          );
        platform = check.device.platform;
        job.deviceName = check.device.name;
      });
      await stage("device-host", async () => {
        if (!(await this.host.status(effect)).running) await this.host.start(effect);
      });
      await stage("boot", async () => {
        const check = await this.host.preflight(input.deviceId, effect);
        if (!check.device?.booted) {
          if (check.device?.physical)
            throw new Error("DEVICE_OFFLINE: Connect and unlock this physical device.");
          const booted = await this.host.boot(input.deviceId, effect);
          job.deviceId = booted.id;
        }
      });
      await stage("server", async () => {
        sdk = (await this.manifest(input.url, platform)).sdkVersion;
      });
      await stage("expo-go", async () => {
        app = (await this.host.prepareExpo(job.deviceId, sdk, input.installExpoGo === true, effect))
          .app;
      });
      await stage("open-app", async () => {
        await this.host.action(job.deviceId, { type: "openApp", app }, effect);
        await this.host.openExpo(job.deviceId, input.url, effect);
        if (platform === "ios") {
          const snapshot = JSON.parse(
            await this.host.action(job.deviceId, { type: "snapshot" }, effect),
          );
          const nodes = snapshot.data?.nodes ?? snapshot.data?.snapshot?.nodes ?? [];
          if (
            nodes.some((node: any) => node.type === "Alert" && /Expo\s?Go/i.test(node.label ?? ""))
          ) {
            const buttons = nodes.filter(
              (node: any) =>
                node.type === "Button" && node.hittable && OPEN_LABELS.includes(node.label),
            );
            if (buttons.length !== 1)
              throw new Error(
                "EXPO_CONFIRMATION_REQUIRED: Confirm opening Expo Go on the selected simulator.",
              );
            await this.host.action(
              job.deviceId,
              { type: "pressElement", label: buttons[0].label },
              effect,
            );
          }
        }
      });
      if (input.expectedText)
        await stage("app-content", async () => {
          await this.host.action(
            job.deviceId,
            {
              type: "waitForText",
              text: input.expectedText!,
              timeoutMs: 120_000,
            },
            effect,
          );
        });
      await stage("screen", async () => {
        if (platform === "ios") {
          const snapshot = JSON.parse(
            await this.host.action(job.deviceId, { type: "snapshot" }, effect),
          );
          const nodes = snapshot.data?.nodes ?? snapshot.data?.snapshot?.nodes ?? [];
          if (
            nodes.some((node: any) => node.type === "Alert" && /Expo\s?Go/i.test(node.label ?? ""))
          )
            throw new Error(
              "EXPO_CONFIRMATION_REQUIRED: The Expo Go confirmation is still visible. Inspect the simulator before repeating the launch.",
            );
          if (
            nodes.some((node: any) => /^SDK version:/.test(node.label ?? "")) &&
            nodes.some(
              (node: any) =>
                node.type === "Button" &&
                node.identifier === "xmark" &&
                node.label === "Close" &&
                node.hittable,
            )
          )
            await this.host.action(job.deviceId, { type: "pressElement", label: "Close" }, effect);
        }
        for (const older of this.jobs.values()) older.frame = undefined;
        const frame = await this.host.capture(job.deviceId, effect);
        await authorize();
        job.frame = frame;
      });
      job.state = "ready";
    } catch (cause) {
      const message = scrubRuntimeLogText(
        cause instanceof Error ? cause.message : "Preview preparation failed.",
        1000,
      );
      const item: Stage = job.stages.at(-1) ?? { name: "preflight", state: "running" };
      item.state = "blocked";
      item.code = message.match(/^([A-Z][A-Z0-9_]+):/)?.[1] ?? "PREVIEW_FAILED";
      item.message = message;
      if (!job.stages.includes(item)) job.stages.push(item);
      job.state = "blocked";
    } finally {
      job.updatedAt = new Date().toISOString();
      // Retain the original callback with the bounded outcome history. A fresh
      // caller/re-enrollment must not resurrect disclosure of this old job.
      if (this.jobs.get(job.id) === job) this.finishedAt.set(job.id, this.now());
    }
  }
}
