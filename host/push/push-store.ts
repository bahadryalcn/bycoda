import type { StoreDatabase } from "../store-db";
import { PUSH_EVENT_KINDS, type PushEventKind } from "./push-events";

export type PushPlatform = "ios" | "android";

/**
 * What a phone registered. Text is localized and chosen by the phone, so the
 * Host never needs a language and never puts project or session names into a
 * message that passes through Expo, Apple or Google.
 */
export type PushRegistration = {
  pushToken: string;
  platform: PushPlatform;
  title: string;
  texts: Record<PushEventKind, string>;
  events: Record<PushEventKind, boolean>;
};

export type PushRecipient = PushRegistration & { deviceHash: string };

const TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,256}\]$/;
const TEXT_MAX = 120;

export function pushText(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`Invalid push ${field}`);
  // Control characters would render as boxes in a notification banner.
  // eslint-disable-next-line no-control-regex -- strips control characters from phone-supplied text
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (!clean || [...clean].length > TEXT_MAX) throw new Error(`Invalid push ${field}`);
  return clean;
}

/** Validates a phone's registration at the RPC boundary. */
export function parsePushRegistration(input: unknown): PushRegistration {
  const value =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  if (typeof value.pushToken !== "string" || !TOKEN.test(value.pushToken))
    throw new Error("Invalid push token");
  if (value.platform !== "ios" && value.platform !== "android")
    throw new Error("Invalid push platform");
  const texts = (value.texts ?? {}) as Record<string, unknown>;
  const events = (value.events ?? {}) as Record<string, unknown>;
  return {
    pushToken: value.pushToken,
    platform: value.platform,
    title: pushText(value.title, "title"),
    texts: Object.fromEntries(
      PUSH_EVENT_KINDS.map((kind) => [kind, pushText(texts[kind], "text")]),
    ) as Record<PushEventKind, string>,
    events: Object.fromEntries(
      PUSH_EVENT_KINDS.map((kind) => [kind, events[kind] === true]),
    ) as Record<PushEventKind, boolean>,
  };
}

/**
 * One row per paired phone credential. Recipients are joined with `devices`,
 * so revoking a phone's pairing stops its notifications without a second step.
 */
export class PushDeviceStore {
  private ready: Promise<void> | undefined;

  constructor(private readonly db: StoreDatabase) {}

  private init(): Promise<void> {
    this.ready ??= this.db.exec(
      `CREATE TABLE IF NOT EXISTS push_devices (
        device_hash TEXT PRIMARY KEY,
        push_token TEXT NOT NULL,
        settings TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    );
    return this.ready;
  }

  async register(deviceHash: string, registration: PushRegistration): Promise<void> {
    await this.init();
    const { pushToken, ...settings } = registration;
    // A phone paired again keeps its push token; the old credential's row would double-send.
    await this.db
      .prepare("DELETE FROM push_devices WHERE push_token=? AND device_hash<>?")
      .run(pushToken, deviceHash);
    await this.db
      .prepare(
        `INSERT INTO push_devices (device_hash, push_token, settings, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(device_hash) DO UPDATE SET push_token=excluded.push_token,
           settings=excluded.settings, updated_at=excluded.updated_at`,
      )
      .run(deviceHash, pushToken, JSON.stringify(settings), Date.now());
  }

  async unregister(deviceHash: string): Promise<boolean> {
    await this.init();
    const result = await this.db
      .prepare("DELETE FROM push_devices WHERE device_hash=?")
      .run(deviceHash);
    return Number(result.changes) > 0;
  }

  /** Expo reported the app uninstalled or the token rotated. */
  async forgetToken(pushToken: string): Promise<void> {
    await this.init();
    await this.db.prepare("DELETE FROM push_devices WHERE push_token=?").run(pushToken);
  }

  async recipients(deviceHash?: string): Promise<PushRecipient[]> {
    await this.init();
    const rows = await this.db
      .prepare(
        `SELECT p.device_hash, p.push_token, p.settings FROM push_devices p
         JOIN devices d ON d.hash = p.device_hash
         WHERE ? IS NULL OR p.device_hash = ?`,
      )
      .all(deviceHash ?? null, deviceHash ?? null);
    const recipients: PushRecipient[] = [];
    for (const row of rows) {
      try {
        const settings = JSON.parse(String(row.settings)) as Omit<PushRegistration, "pushToken">;
        recipients.push(
          Object.assign(parsePushRegistration({ ...settings, pushToken: String(row.push_token) }), {
            deviceHash: String(row.device_hash),
          }),
        );
      } catch {
        // A row this version cannot read is skipped; the phone rewrites it on its next registration.
      }
    }
    return recipients;
  }
}
