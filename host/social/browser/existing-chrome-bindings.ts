import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { Cdp, type BrowserSession } from "../social-browser";
import { readStateFile, writeFileAtomic } from "../../storage/atomic-write";
import type { SocialPlatform } from "../../../src/features/social/model/social";
import { discoverChromeEndpoint } from "./existing-chrome-discovery";
import { attachExistingChrome } from "./existing-chrome-session";
import { withTimeout } from "../../../src/shared/lib/withTimeout";

export type ChromeBinding = { platform: SocialPlatform; targetId: string };
export type ChromeTab = { id: string; title: string; site: string };
const HOSTS: Partial<Record<SocialPlatform, readonly string[]>> = {
  x: ["x.com", "twitter.com"],
  instagram: ["www.instagram.com", "instagram.com"],
  facebook: ["www.facebook.com", "facebook.com"],
  linkedin: ["www.linkedin.com"],
  youtube: ["www.youtube.com", "studio.youtube.com"],
  tiktok: ["www.tiktok.com"],
  snapchat: ["web.snapchat.com", "www.snapchat.com", "profile.snapchat.com", "my.snapchat.com"],
  whatsapp: ["web.whatsapp.com"],
  telegram: ["web.telegram.org"],
};
const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(value);

function hosts(platform: SocialPlatform): readonly string[] {
  const result = HOSTS[platform];
  if (!result) throw new Error("Existing Chrome sessions are not supported for this platform.");
  return result;
}

async function connectChrome(): Promise<Cdp> {
  return Cdp.connect(await discoverChromeEndpoint());
}

/** Account-bound attachment metadata only. Authentication remains in the owner's Chrome. */
export class ExistingChromeBindings {
  private stopped = false;
  private sessions = new Set<BrowserSession>();
  constructor(
    private directory: string,
    private connect: () => Promise<Cdp> = connectChrome,
  ) {}

  private file(accountId: string): string {
    if (!validId(accountId)) throw new Error("Invalid Chrome account selection.");
    return join(this.directory, "chrome-bindings", `${accountId}.json`);
  }
  async get(accountId: string): Promise<ChromeBinding | undefined> {
    const state = await readStateFile(this.file(accountId), (text) => {
      const binding = JSON.parse(text) as ChromeBinding;
      if (!validId(binding.targetId) || !HOSTS[binding.platform])
        throw new Error("Saved Chrome selection is invalid. Select the tab again.");
      return binding;
    });
    if (state.status === "corrupt")
      throw new Error("Saved Chrome selection is invalid. Select the tab again.");
    return state.value;
  }
  async set(accountId: string, binding: ChromeBinding | undefined): Promise<void> {
    const file = this.file(accountId);
    if (!binding) {
      await rm(file, { force: true });
      return;
    }
    if (!validId(binding.targetId)) throw new Error("Invalid Chrome tab selection.");
    hosts(binding.platform);
    await mkdir(join(this.directory, "chrome-bindings"), { recursive: true });
    await writeFileAtomic(file, JSON.stringify(binding));
  }
  private async connection(): Promise<Cdp> {
    if (this.stopped) throw new Error("The Chrome connection is stopping.");
    let cdp: Cdp | undefined;
    let timedOut = false;
    try {
      const connecting = this.connect().then((connection) => {
        if (timedOut || this.stopped) {
          connection.close();
          throw new Error("Chrome connection cancelled.");
        }
        return connection;
      });
      cdp = await withTimeout(connecting, 15_000, "Chrome connection");
      const version = await cdp.send<{ product: string }>("Browser.getVersion");
      if (Number(/^Chrome\/(\d+)/.exec(version.product)?.[1] ?? 0) < 144)
        throw new Error("Chrome 144 or newer is required for an existing session.");
      if (this.stopped) throw new Error("The Chrome connection is stopping.");
      return cdp;
    } catch (error) {
      timedOut = true;
      cdp?.close();
      if (error instanceof Error && error.message.startsWith("Chrome 144")) throw error;
      throw new Error(
        "Chrome connection unavailable or permission denied. Enable remote debugging in chrome://inspect/#remote-debugging, approve Chrome's dialog, then try again.",
      );
    }
  }
  async list(platform: SocialPlatform): Promise<ChromeTab[]> {
    const allowed = hosts(platform);
    const cdp = await this.connection();
    try {
      const { targetInfos } = await cdp.send<{
        targetInfos: { targetId: string; type: string; url: string; title?: string }[];
      }>("Target.getTargets");
      return targetInfos
        .filter((target) => {
          try {
            const url = new URL(target.url);
            return (
              target.type === "page" &&
              validId(target.targetId) &&
              url.protocol === "https:" &&
              allowed.includes(url.hostname)
            );
          } catch {
            return false;
          }
        })
        .slice(0, 100)
        .map((target) => ({
          id: target.targetId,
          title: (target.title ?? "").slice(0, 160),
          site: new URL(target.url).hostname,
        }));
    } finally {
      cdp.close();
    }
  }
  async openSelection(binding: ChromeBinding): Promise<BrowserSession> {
    const allowed = hosts(binding.platform);
    if (!validId(binding.targetId)) throw new Error("Invalid Chrome tab selection.");
    const cdp = await this.connection();
    try {
      const original = await attachExistingChrome(cdp, binding.targetId, allowed);
      let session: BrowserSession;
      session = {
        ...original,
        close: async () => {
          this.sessions.delete(session);
          await original.close();
        },
      };
      if (this.stopped) {
        await session.close();
        throw new Error("The Chrome connection is stopping.");
      }
      this.sessions.add(session);
      return session;
    } catch {
      cdp.close();
      throw new Error(
        "The selected Chrome tab is unavailable. Reopen the platform in Chrome and select its tab again.",
      );
    }
  }
  async open(accountId: string): Promise<BrowserSession | undefined> {
    if (this.stopped) throw new Error("The Chrome connection is stopping.");
    const binding = await this.get(accountId);
    return binding ? this.openSelection(binding) : undefined;
  }
  async stop(): Promise<void> {
    this.stopped = true;
    await Promise.allSettled([...this.sessions].map((session) => session.close()));
  }
}
