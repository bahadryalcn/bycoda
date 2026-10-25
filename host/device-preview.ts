import { randomUUID } from "node:crypto";
import type { DeviceHost } from "./device-host";
import type { DeviceFrame } from "../src/features/devices/types";
import { expoManifest, expoPreviewUrl } from "./expo-go";
import { scrubRuntimeLogText } from "./runtime-logs";

type PreviewInput = {
  requestId: string;
  deviceId: string;
  url: string;
  installExpoGo?: boolean;
  expectedText?: string;
};
type Stage = {
  name: string;
  state: "running" | "done" | "blocked";
  code?: string;
  message?: string;
};
type Preview = {
  id: string;
  requestId: string;
  deviceId: string;
  state: "queued" | "running" | "ready" | "blocked";
  stages: Stage[];
  verification: "launch-only" | "expected-text";
  updatedAt: string;
  frame?: DeviceFrame;
  deviceName?: string;
};
const OPEN_LABELS = ["Open", "Aç", "Öffnen", "Ouvrir", "Abrir", "打开", "開く"];

/** Bounded, observable setup jobs. Request IDs prevent duplicate launch/install attempts. */
export class DevicePreviews {
  private jobs = new Map<string, Preview>();
  private disposed = false;
  private stopping = false;
  private owners = new Map<string, string>();
  private authorizations = new Map<string, () => boolean | Promise<boolean>>();
  private work = new Set<Promise<void>>();
  constructor(
    private host: DeviceHost,
    private manifest = expoManifest,
    private readonly outsideScope: <T>(action: () => T) => T = (action) => action(),
  ) {}
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
    // Keep outcomes for request deduplication; only screenshots need large memory.
    if (this.jobs.size >= 128)
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
    this.inputs.set(job.id, { ...input });
    this.owners.set(job.id, owner);
    this.authorizations.set(job.id, authorized);
    this.outsideScope(() => {
      const running = this.run(job, input);
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
    const { frame, ...summary } = job;
    return structuredClone({ ...summary, ...(includeFrame && frame ? { frame } : {}) });
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
    const stage = async (name: string, work: () => Promise<void>) => {
      const item: Stage = { name, state: "running" };
      job.stages.push(item);
      job.updatedAt = new Date().toISOString();
      if (this.disposed)
        throw new Error("PREVIEW_HOST_STOPPED: The device host stopped during preparation.");
      if (!(await this.authorizations.get(job.id)?.()))
        throw new Error(
          "PREVIEW_AUTHORITY_REVOKED: Preview authority expired; no further steps will run.",
        );
      if (this.disposed)
        throw new Error("PREVIEW_HOST_STOPPED: The device host stopped during preparation.");
      await work();
      item.state = "done";
      job.updatedAt = new Date().toISOString();
    };
    try {
      let platform: "ios" | "android" = "ios",
        sdk = "",
        app = "";
      await stage("preflight", async () => {
        const check = await this.host.preflight(input.deviceId);
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
        if (!(await this.host.status()).running) await this.host.start();
      });
      await stage("boot", async () => {
        const check = await this.host.preflight(input.deviceId);
        if (!check.device?.booted) {
          if (check.device?.physical)
            throw new Error("DEVICE_OFFLINE: Connect and unlock this physical device.");
          const booted = await this.host.boot(input.deviceId);
          job.deviceId = booted.id;
        }
      });
      await stage("server", async () => {
        sdk = (await this.manifest(input.url, platform)).sdkVersion;
      });
      await stage("expo-go", async () => {
        app = (await this.host.prepareExpo(job.deviceId, sdk, input.installExpoGo === true)).app;
      });
      await stage("open-app", async () => {
        await this.host.action(job.deviceId, { type: "openApp", app });
        await this.host.openExpo(job.deviceId, input.url);
        if (platform === "ios") {
          const snapshot = JSON.parse(await this.host.action(job.deviceId, { type: "snapshot" }));
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
            await this.host.action(job.deviceId, { type: "pressElement", label: buttons[0].label });
          }
        }
      });
      if (input.expectedText)
        await stage("app-content", async () => {
          await this.host.action(job.deviceId, {
            type: "waitForText",
            text: input.expectedText!,
            timeoutMs: 120_000,
          });
        });
      await stage("screen", async () => {
        if (platform === "ios") {
          const snapshot = JSON.parse(await this.host.action(job.deviceId, { type: "snapshot" }));
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
            await this.host.action(job.deviceId, { type: "pressElement", label: "Close" });
        }
        for (const older of this.jobs.values()) older.frame = undefined;
        job.frame = await this.host.capture(job.deviceId);
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
      this.authorizations.delete(job.id);
    }
  }
}
