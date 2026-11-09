import { emptyMinutes, setMinute } from "../activity.ts";
import { defaultNotificationSettings } from "../notifications.ts";
import type {
  Announcement,
  ConnectInfoUpdate,
  DataExport,
  Device,
  EntitlementsSummary,
  User,
} from "../models.ts";
import type { NotificationItem, NotificationSettings } from "../notifications.ts";

export interface MockPairRequest {
  id: string;
  computerDeviceId: string;
  phoneDeviceId: string;
  phonePublicKey: string;
  state: "pending" | "sealed" | "delivered" | "denied" | "expired";
  desktopPublicKey?: string;
  sealed?: string;
  createdAt: string;
  expiresAt: string;
}

export interface MockState {
  user: User;
  entitlements: EntitlementsSummary;
  devices: Map<string, Device>;
  /** Device the mock treats as the caller, set by `POST /v1/devices`. */
  currentDeviceId: string | null;
  pushTokens: Map<string, string>;
  /** Desktop device id to published connect info. */
  connectInfo: Map<string, ConnectInfoUpdate & { updatedAt: string }>;
  pairRequests: Map<string, MockPairRequest>;
  /** `${deviceId}|${date}` to `{ timeZone, minutes }`. */
  activity: Map<string, { deviceId: string; date: string; timeZone: string; minutes: Uint8Array }>;
  settings: NotificationSettings;
  notifications: NotificationItem[];
  announcements: Announcement[];
  exports: Map<string, DataExport>;
  tickets: { id: string; createdAt: string }[];
  feedback: { id: string; createdAt: string; signedIn: boolean }[];
  diagnostics: { id: string; createdAt: string; signedIn: boolean; trigger: string }[];
  pings: unknown[];
  nextId: number;
}

export type MockSeed = Partial<Pick<MockState, "user" | "entitlements" | "announcements">> & {
  /** Fixed clock for deterministic tests. */
  now?: () => Date;
};

export function createMockState(seed: MockSeed = {}): MockState {
  const now = (seed.now ?? (() => new Date()))().toISOString();
  const earlier = new Date(Date.parse(now) - 3_600_000).toISOString();
  const sampleDevice: Device = {
    id: "dev_sample_laptop",
    name: "Sample laptop",
    platform: "windows",
    osVersion: "Windows 11",
    appVersion: "1.0.0",
    channel: "stable",
    kind: "desktop",
    createdAt: earlier,
    lastSeenAt: earlier,
    revokedAt: null,
  };
  const day = emptyMinutes();
  for (let minute = 9 * 60; minute < 10 * 60; minute++) setMinute(day, minute);
  const date = now.slice(0, 10);

  return {
    user: seed.user ?? {
      id: "usr_mock",
      email: "mock@example.com",
      displayName: "Mock User",
      avatarUrl: null,
      locale: "en",
      timeZone: "Europe/Istanbul",
      createdAt: earlier,
      signInMethods: ["google"],
      deletion: null,
      status: "active",
      deactivatedAt: null,
    },
    entitlements: seed.entitlements ?? {
      planTier: "individual",
      features: { activity_sync: true, devices_max: 10 },
    },
    devices: new Map([[sampleDevice.id, sampleDevice]]),
    currentDeviceId: null,
    pushTokens: new Map(),
    connectInfo: new Map(),
    pairRequests: new Map(),
    activity: new Map([
      [
        `${sampleDevice.id}|${date}`,
        { deviceId: sampleDevice.id, date, timeZone: "Europe/Istanbul", minutes: day },
      ],
    ]),
    settings: defaultNotificationSettings(),
    notifications: [
      {
        id: "ntf_1",
        event: "account.new_device_sign_in",
        title: "New sign-in",
        body: "Sample laptop signed in.",
        createdAt: earlier,
        readAt: null,
        dedupeKey: "new_device:dev_sample_laptop",
      },
    ],
    announcements: seed.announcements ?? [
      {
        id: "ann_1",
        title: "Welcome to bycoda accounts",
        body: "Accounts are optional and free.",
        severity: "info",
        publishedAt: earlier,
      },
    ],
    exports: new Map(),
    tickets: [],
    feedback: [],
    diagnostics: [],
    pings: [],
    nextId: 1,
  };
}
