import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { prepareProviderGuardian, type PreparedGuardian } from "./provider-guardian-deployment";
import type { NativeGuardianChild } from "./provider-guardian";

const owners = new Map<string, SocialBrowserLaunch>();
const held = () => new Error("Original browser cleanup is unconfirmed. Its profile remains reserved; review the original browser before retrying.");

async function observe<T>(work: Promise<T>, ms = 20_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(held()), ms);
      timer.unref?.();
    })]);
  } finally { clearTimeout(timer); }
}

export type SocialBrowserLaunchPorts = {
  inUse(profile: string): Promise<boolean>;
  prepare?: () => Promise<PreparedGuardian | undefined>;
  spawn?: typeof spawn;
};

/** One pre-effect original capsule per canonical profile, including failed starts.
 * Missing native containment keeps development usable, but cannot prove a failed
 * startup's handed-off tree retired merely because its launcher exited. */
export class SocialBrowserLaunch {
  readonly exit: Promise<void>;
  private finishExit!: () => void;
  private child?: ChildProcess | NativeGuardianChild;
  private guardian?: NativeGuardianChild;
  private prepared?: PreparedGuardian;
  private attempted = false;
  private notStarted = false;
  private established = false;
  private retirement?: Promise<void>;
  private release?: Promise<void>;
  private observedRelease?: Promise<void>;
  private observedRetirement?: Promise<void>;
  exited = false;
  failed = false;

  private constructor(readonly profile: string, private readonly ports: SocialBrowserLaunchPorts) {
    this.exit = new Promise<void>((resolve) => { this.finishExit = resolve; });
  }

  static async reserve(profile: string, ports: SocialBrowserLaunchPorts): Promise<SocialBrowserLaunch> {
    await mkdir(profile, { recursive: true });
    const canonical = await realpath(profile);
    const key = process.platform === "win32" ? canonical.toLowerCase() : canonical;
    const prior = owners.get(key);
    if (prior) {
      // Only an existing actual cleanup may finish; never synthesize a new owner.
      if (prior.release) await prior.waitForRelease();
      if (owners.get(key)) throw held();
    }
    const original = new SocialBrowserLaunch(canonical, ports);
    owners.set(key, original);
    try {
      if (await ports.inUse(canonical)) throw new Error("The browser profile is still in use.");
      original.prepared = await (ports.prepare ?? (async () => process.platform === "win32"
        ? prepareProviderGuardian(fileURLToPath(new URL("./", import.meta.url))) : undefined))();
      await original.assertOriginal();
      return original;
    } catch (error) {
      await original.prepared?.dispose();
      if (owners.get(key) === original) owners.delete(key);
      throw error;
    }
  }

  private key(): string {
    return process.platform === "win32" ? this.profile.toLowerCase() : this.profile;
  }

  private async assertOriginal(): Promise<void> {
    if (owners.get(this.key()) !== this || await realpath(this.profile) !== this.profile || await this.ports.inUse(this.profile))
      throw new Error("Browser profile ownership changed before startup.");
  }

  async start(executable: string, args: string[]): Promise<void> {
    await this.assertOriginal();
    const prepared = this.prepared;
    try {
      this.attempted = true;
      this.child = prepared
        ? this.guardian = prepared.spawn({ command: executable, args, cwd: this.profile, env: { ...process.env } },
            () => this.assertOriginal(), () => { if (owners.get(this.key()) !== this) throw held(); })
        : (this.ports.spawn ?? spawn)(executable, args, { stdio: "ignore", windowsHide: false, shell: false });
      this.guardian?.stdout.resume();
      this.guardian?.stderr.resume();
      const childEvents = this.child as { once(event: string, callback: () => void): unknown };
      let spawned = false;
      childEvents.once("spawn", () => { spawned = true; });
      childEvents.once(this.guardian ? "close" : "exit", () => {
        this.exited = true;
        this.finishExit();
      });
      childEvents.once("error", () => {
        this.failed = true;
        if (!this.guardian && !spawned && this.child?.pid === undefined) {
          this.notStarted = true;
          this.exited = true;
          this.finishExit();
        }
      });
    } finally {
      this.prepared = undefined;
      await prepared?.dispose();
    }
  }

  markEstablished(): void {
    if (owners.get(this.key()) !== this || (this.guardian && (this.exited || this.guardian.retirementVerified))) throw held();
    this.established = true;
  }

  private waitForRelease(): Promise<void> {
    return this.observedRelease ??= observe(this.release!);
  }

  private retireOriginal(): Promise<void> {
    if (this.retirement) return this.retirement;
    const guardian = this.guardian;
    this.retirement = (async () => {
      if (!this.attempted || this.notStarted) { this.exited = true; this.finishExit(); return; }
      if (!guardian) {
        // Original handle only: best effort, never a handed-off tree receipt.
        if (!this.exited) this.child?.kill();
        throw held();
      }
      const results = await Promise.allSettled([guardian.stop(), guardian.retirement]);
      if (results[1].status !== "fulfilled" || !guardian.retirementVerified) throw held();
    })();
    void this.retirement.catch(() => {});
    return this.retirement;
  }

  async stop(): Promise<void> {
    if (!this.guardian && this.established) {
      if (!this.exited) this.child?.kill();
      return; // Profile-specific admission proof is still required separately.
    }
    await (this.observedRetirement ??= observe(this.retireOriginal()));
  }

  releaseProfile(unlocked: () => Promise<void>, failedStartup = false): Promise<void> {
    if (!this.release) {
      this.release = (async () => {
        // Failed startup needs real tree/not-started proof. Established fallback
        // retains its legacy profile-unlock contract, without claiming tree proof.
        if (failedStartup || this.guardian || !this.established) await this.retireOriginal();
        await unlocked();
        if (owners.get(this.key()) === this) owners.delete(this.key());
      })();
      void this.release.catch(() => {});
    }
    return this.release;
  }

  async startupFailed(unlocked: () => Promise<void>): Promise<void> {
    this.releaseProfile(unlocked, true);
    try { await this.waitForRelease(); }
    finally { await this.prepared?.dispose(); this.prepared = undefined; }
  }
}
