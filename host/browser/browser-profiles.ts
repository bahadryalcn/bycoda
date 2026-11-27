import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { isBrowserDevelopmentAddress } from "../../src/shared/lib/browserProfile";
import { readStateFile, writeFileAtomic } from "../storage/atomic-write";
import { RECORDING_FPS_OPTIONS } from "./browser-recording";
import { importBrowserState, type PlaywrightLauncher } from "./browser-profile-import";
import { detectBrowserSources, publicSource, type BrowserSource } from "./browser-profile-sources";

const MAX_PROFILES = 12;
const isRecordingFps = (value: unknown): value is number =>
  RECORDING_FPS_OPTIONS.some((option) => option === value);
/** Frame rates the owner can pick for the live Browser panel stream. */
export const LIVE_FPS_OPTIONS = [10, 15, 30, 60] as const;
const isLiveFps = (value: unknown): value is number =>
  LIVE_FPS_OPTIONS.some((option) => option === value);
const MAX_IMPORT_BYTES = 256 * 1024;
const stateSchema = z.object({
  cookies: z
    .array(
      z.object({
        name: z.string(),
        value: z.string(),
        domain: z.string().min(1),
        path: z.string().startsWith("/"),
        expires: z.number().finite(),
        httpOnly: z.boolean(),
        secure: z.boolean(),
        sameSite: z.enum(["Strict", "Lax", "None"]),
        partitionKey: z.string().optional(),
      }),
    )
    .max(500),
  origins: z
    .array(
      z.object({
        origin: z.string().refine((value) => {
          const url = URL.parse(value);
          return url !== null && ["http:", "https:"].includes(url.protocol) && value === url.origin;
        }),
        localStorage: z.array(z.object({ name: z.string(), value: z.string() })).max(500),
      }),
    )
    .max(100),
});
export type BrowserProfileStorage = z.infer<typeof stateSchema>;
const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[^\p{C}]+$/u);
const profileSchema = z.object({
  id: z.string().uuid(),
  name: nameSchema,
  agents: z.boolean(),
  storage: stateSchema,
});
const settingsSchema = z.object({
  agentAccess: z.boolean(),
  claudeChrome: z.boolean(),
  autoShow: z.boolean().default(true),
  // A stored rate outside the offered set reads as the default.
  recordingFps: z.number().refine(isRecordingFps).default(4).catch(4),
  liveFps: z.number().refine(isLiveFps).default(60).catch(60),
  defaultProfileId: z.string().uuid().nullable(),
  developmentProfileId: z.string().uuid().nullable().default(null),
  profiles: z.array(profileSchema).max(MAX_PROFILES),
});
type Settings = z.infer<typeof settingsSchema>;
const initial: Settings = {
  agentAccess: true,
  claudeChrome: false,
  autoShow: true,
  recordingFps: 4,
  liveFps: 60,
  defaultProfileId: null,
  developmentProfileId: null,
  profiles: [],
};
type StoredProfile = Settings["profiles"][number];
const keyOf = (name: string) => name.normalize("NFKC").toLowerCase();
/** "Chrome – Personal": the short browser name and the profile's own name, without control characters. */
function importedName({ browserName, profileName }: BrowserSource) {
  const browser = browserName.replace(/^(Google|Microsoft|Mozilla) /, "");
  const profile = profileName.replace(/\p{C}/gu, "").trim();
  return `${browser}${profile && profile !== browser ? ` – ${profile}` : ""}`.slice(0, 60).trim();
}
const summary = ({ id, name, agents }: StoredProfile) => ({ id, name, agents });

export class BrowserProfiles {
  private readonly file: string;
  private pending: Promise<unknown> = Promise.resolve();
  private current?: Promise<Settings>;

  constructor(
    directory: string,
    private readonly browserImport: {
      detect?: typeof detectBrowserSources;
      load?: PlaywrightLauncher;
    } = {},
  ) {
    this.file = join(directory, "browser-profiles.json");
  }

  private read() {
    return (this.current ??= readStateFile(
      this.file,
      (raw) => settingsSchema.parse(JSON.parse(raw)),
      { quarantine: false },
    )
      .then((result) => {
        if (result.status === "corrupt")
          throw new Error("Browser profile settings could not be read.");
        return result.value ?? initial;
      })
      .catch((error: unknown) => {
        this.current = undefined;
        throw error;
      }));
  }

  private change(edit: (current: Settings) => Settings) {
    const changed = this.pending.then(async () => {
      const next = edit(await this.read());
      await writeFileAtomic(this.file, JSON.stringify(next));
      this.current = Promise.resolve(next);
      return this.describe(next);
    });
    this.pending = changed.catch(() => undefined);
    return changed;
  }

  private describe(settings: Settings) {
    return {
      agentAccess: settings.agentAccess,
      claudeChrome: settings.claudeChrome,
      autoShow: settings.autoShow,
      recordingFps: settings.recordingFps,
      liveFps: settings.liveFps,
      defaultProfileId: settings.defaultProfileId,
      developmentProfileId: settings.developmentProfileId,
      profiles: settings.profiles.map(summary),
    };
  }

  async list() {
    return this.describe(await this.read());
  }

  /** Installed browsers whose profiles can be imported, the OS default browser first. */
  async sources() {
    const { defaultBrowser, sources } = await (this.browserImport.detect ?? detectBrowserSources)();
    return { defaultBrowser, sources: sources.map(publicSource) };
  }

  /** Imports one detected browser profile; the client names it by id, never by path. */
  private async importBrowser(value: unknown) {
    const { sourceId } = z.object({ sourceId: z.string().max(120) }).parse(value);
    const { sources } = await (this.browserImport.detect ?? detectBrowserSources)();
    const source = sources.find(({ id }) => id === sourceId);
    if (!source) throw new Error("This browser profile is no longer available.");
    if (!this.browserImport.load) throw new Error("The browser runtime is unavailable.");
    const storage = stateSchema.parse(await importBrowserState(source, this.browserImport.load));
    return this.addProfile(importedName(source), storage, true);
  }

  private addProfile(name: string, storage: BrowserProfileStorage, unique = false) {
    return this.change((settings) => {
      if (settings.profiles.length >= MAX_PROFILES)
        throw new Error("Browser profile limit reached.");
      const taken = (candidate: string) =>
        keyOf(candidate) === "isolated" ||
        settings.profiles.some((profile) => keyOf(profile.name) === keyOf(candidate));
      let unused = name;
      for (let number = 2; unique && taken(unused); number++) {
        const suffix = ` ${number}`;
        unused = `${name.slice(0, 60 - suffix.length).trimEnd()}${suffix}`;
      }
      if (taken(unused)) throw new Error("Choose a unique browser profile name.");
      return {
        ...settings,
        profiles: [
          ...settings.profiles,
          { id: randomUUID(), name: unused, storage, agents: false },
        ],
      };
    });
  }

  async chromeEnabled() {
    const settings = await this.read();
    return settings.agentAccess && settings.claudeChrome;
  }

  async agentProfiles() {
    const settings = await this.read();
    if (!settings.agentAccess) throw new Error("The owner turned off agent browser access.");
    return settings.profiles.filter(({ agents }) => agents).map(summary);
  }

  async resolve(selector: unknown, owner: boolean, active?: string, address?: string) {
    const settings = await this.read();
    if (!owner && !settings.agentAccess)
      throw new Error("The owner turned off agent browser access.");
    const automaticOpen = selector === undefined && address !== undefined;
    const configured = automaticOpen
      ? isBrowserDevelopmentAddress(address)
        ? settings.developmentProfileId
        : settings.defaultProfileId
      : undefined;
    const target = selector === undefined ? (active ?? configured) : selector;
    if (target == null || target === "isolated") return undefined;
    if (typeof target !== "string" || target.length > 60)
      throw new Error("Invalid browser profile.");
    const profile = settings.profiles.find(
      ({ id, name }) => id === target || keyOf(name) === keyOf(target.trim()),
    );
    if (profile && (owner || profile.agents)) return profile;
    if (automaticOpen) return undefined;
    throw new Error("This browser profile is unavailable or has not been granted to agents.");
  }

  update(action: unknown, value: unknown) {
    if (action === "import") {
      const input = z.object({ name: nameSchema, json: z.string() }).safeParse(value);
      if (!input.success || Buffer.byteLength(input.data.json) > MAX_IMPORT_BYTES)
        throw new Error("Choose a named Playwright browser state JSON file up to 256 KB.");
      const { name, json } = input.data;
      let storage: BrowserProfileStorage;
      try {
        storage = stateSchema.parse(JSON.parse(json));
      } catch {
        throw new Error("Invalid Playwright browser state JSON.");
      }
      return this.addProfile(name, storage);
    }
    if (action === "importBrowser") return this.importBrowser(value);
    if (action === "recordingFps") {
      if (!isRecordingFps(value)) throw new Error("Choose a recording frame rate from the list.");
      const recordingFps = value;
      return this.change((settings) => ({ ...settings, recordingFps }));
    }
    if (action === "liveFps") {
      if (!isLiveFps(value)) throw new Error("Choose a live view frame rate from the list.");
      const liveFps = value;
      return this.change((settings) => ({ ...settings, liveFps }));
    }
    if (action === "agentAccess" || action === "claudeChrome" || action === "autoShow") {
      if (typeof value !== "boolean") throw new Error("Invalid browser access setting.");
      return this.change((settings) => ({ ...settings, [action]: value }));
    }
    if (action === "grant") {
      const grant = z.object({ id: z.string().uuid(), agents: z.boolean() }).parse(value);
      return this.change((settings) => {
        if (!settings.profiles.some(({ id }) => id === grant.id))
          throw new Error("Browser profile is unavailable.");
        return {
          ...settings,
          profiles: settings.profiles.map((profile) =>
            profile.id === grant.id ? { ...profile, agents: grant.agents } : profile,
          ),
        };
      });
    }
    return this.change((settings) => {
      if (action === "default" || action === "development") {
        if (value !== null && !settings.profiles.some(({ id }) => id === value))
          throw new Error("Browser profile is unavailable.");
        const field = action === "default" ? "defaultProfileId" : "developmentProfileId";
        return { ...settings, [field]: value as string | null };
      }
      if (!settings.profiles.some(({ id }) => id === value))
        throw new Error("Browser profile is unavailable.");
      if (action === "remove")
        return {
          ...settings,
          defaultProfileId: settings.defaultProfileId === value ? null : settings.defaultProfileId,
          developmentProfileId:
            settings.developmentProfileId === value ? null : settings.developmentProfileId,
          profiles: settings.profiles.filter(({ id }) => id !== value),
        };
      throw new Error("Invalid browser profile action.");
    });
  }
}
