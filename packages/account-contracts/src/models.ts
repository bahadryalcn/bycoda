/**
 * Client-visible account models.
 *
 * PRIVACY CONTRACT: no endpoint of this API accepts session content, prompts, code, file
 * paths or project names. Every request schema is `.strict()`, so such fields are rejected
 * with `validation_failed` rather than silently stored. Do not add them.
 */
import { z } from "zod";
import { EntityId, IanaTimeZone, IsoDateTime, LocalDate } from "./common.ts";

export const PlanTier = z.enum(["individual", "team", "enterprise"]);
export type PlanTier = z.infer<typeof PlanTier>;

export const SignInMethod = z.enum(["google", "facebook", "apple", "github", "email_code"]);
export type SignInMethod = z.infer<typeof SignInMethod>;

/** Lifecycle of the account itself. Staff suspension is separate and answers `forbidden`. */
export const AccountLifecycleStatus = z.enum(["active", "deactivated", "pending_deletion"]);
export type AccountLifecycleStatus = z.infer<typeof AccountLifecycleStatus>;

export const User = z.object({
  id: EntityId,
  email: z.email(),
  displayName: z.string().max(120),
  avatarUrl: z.url().nullable(),
  locale: z.string().max(35),
  timeZone: IanaTimeZone,
  createdAt: IsoDateTime,
  signInMethods: z.array(SignInMethod),
  deletion: z.object({ requestedAt: IsoDateTime, purgeAfter: IsoDateTime }).nullable(),
  /** Added in 0.4.0; older servers omit both fields (treat as `active` / `null`). */
  status: AccountLifecycleStatus.optional(),
  deactivatedAt: IsoDateTime.nullable().optional(),
});
export type User = z.infer<typeof User>;

export const ProfileUpdate = z.strictObject({
  displayName: z.string().trim().min(1).max(120).optional(),
  locale: z.string().max(35).optional(),
  timeZone: IanaTimeZone.optional(),
});
export type ProfileUpdate = z.infer<typeof ProfileUpdate>;

/** Summary only. The rules that produce it live on the server. */
export const EntitlementsSummary = z.object({
  planTier: PlanTier,
  features: z.record(z.string(), z.union([z.boolean(), z.number()])),
});
export type EntitlementsSummary = z.infer<typeof EntitlementsSummary>;

/** Extension point: organizations are not offered yet, `AccountContext.organizations` is `[]`. */
export const OrganizationRef = z.object({
  id: EntityId,
  name: z.string(),
  role: z.string(),
});
export type OrganizationRef = z.infer<typeof OrganizationRef>;

/** `GET /v1/me` */
export const AccountContext = z.object({
  user: User,
  entitlements: EntitlementsSummary,
  organizations: z.array(OrganizationRef),
});
export type AccountContext = z.infer<typeof AccountContext>;

export const DevicePlatform = z.enum(["windows", "macos", "linux", "ios", "android", "web"]);
export type DevicePlatform = z.infer<typeof DevicePlatform>;
export const DeviceChannel = z.enum(["stable", "preview", "dev"]);
export type DeviceChannel = z.infer<typeof DeviceChannel>;
export const DeviceKind = z.enum(["desktop", "mobile"]);
export type DeviceKind = z.infer<typeof DeviceKind>;

/**
 * Registers or refreshes the calling device. `deviceId` is the id the server issued earlier
 * (stored by the client); omit it on first registration.
 */
export const DeviceRegistration = z.strictObject({
  deviceId: EntityId.optional(),
  name: z.string().trim().min(1).max(80),
  platform: DevicePlatform,
  osVersion: z.string().max(64),
  appVersion: z.string().max(32),
  channel: DeviceChannel,
  kind: DeviceKind,
});
export type DeviceRegistration = z.infer<typeof DeviceRegistration>;

export const Device = z.object({
  id: EntityId,
  name: z.string(),
  platform: DevicePlatform,
  osVersion: z.string(),
  appVersion: z.string(),
  channel: DeviceChannel,
  kind: DeviceKind,
  createdAt: IsoDateTime,
  lastSeenAt: IsoDateTime,
  revokedAt: IsoDateTime.nullable(),
  current: z.boolean().optional(),
});
export type Device = z.infer<typeof Device>;
export const DeviceList = z.object({ items: z.array(Device) });
export type DeviceList = z.infer<typeof DeviceList>;

/** Result of "sign out of all other devices". */
export const DevicesRevoked = z.object({ revoked: z.number().int().min(0) });
export type DevicesRevoked = z.infer<typeof DevicesRevoked>;

export const DeviceRename = z.strictObject({ name: z.string().trim().min(1).max(80) });
export type DeviceRename = z.infer<typeof DeviceRename>;

export const PushTokenRegistration = z.strictObject({
  provider: z.literal("expo"),
  token: z.string().min(1).max(256),
});
export type PushTokenRegistration = z.infer<typeof PushTokenRegistration>;

export const Announcement = z.object({
  id: EntityId,
  title: z.string(),
  body: z.string(),
  severity: z.enum(["info", "warning", "critical"]),
  publishedAt: IsoDateTime,
  url: z.url().optional(),
});
export type Announcement = z.infer<typeof Announcement>;
export const AnnouncementList = z.object({ items: z.array(Announcement) });
export type AnnouncementList = z.infer<typeof AnnouncementList>;

/** Written by the user. The app never attaches session content, logs or paths automatically. */
export const SupportTicketCreate = z.strictObject({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
  category: z.enum(["bug", "feature", "account", "privacy", "other"]),
});
export type SupportTicketCreate = z.infer<typeof SupportTicketCreate>;
export const SupportTicketReceipt = z.object({ id: EntityId, createdAt: IsoDateTime });
export type SupportTicketReceipt = z.infer<typeof SupportTicketReceipt>;

/**
 * Added in 0.7.0. Product feedback in the user's own words. `context` is sent only when the user
 * ticks "include app version and system"; nothing else is attached.
 */
export const FEEDBACK_KINDS = ["idea", "problem", "praise", "other"] as const;
export const FeedbackKind = z.enum(FEEDBACK_KINDS);
export type FeedbackKind = z.infer<typeof FeedbackKind>;
export const FeedbackContext = z.strictObject({
  appVersion: z.string().max(32),
  platform: DevicePlatform,
  osVersion: z.string().max(64),
  channel: DeviceChannel,
});
export type FeedbackContext = z.infer<typeof FeedbackContext>;
export const FeedbackCreate = z.strictObject({
  kind: FeedbackKind,
  message: z.string().trim().min(1).max(2000),
  /** 1 (bad) to 5 (great); optional. */
  rating: z.number().int().min(1).max(5).optional(),
  context: FeedbackContext.optional(),
});
export type FeedbackCreate = z.infer<typeof FeedbackCreate>;
export const FeedbackReceipt = z.object({ id: EntityId, createdAt: IsoDateTime });
export type FeedbackReceipt = z.infer<typeof FeedbackReceipt>;

/** Optional anonymous daily signal (default off). No account, no content. */
export const AnonymousPing = z.strictObject({
  installId: z.uuid(),
  appVersion: z.string().max(32),
  platform: DevicePlatform,
  osVersion: z.string().max(64),
  channel: DeviceChannel,
  date: LocalDate,
});
export type AnonymousPing = z.infer<typeof AnonymousPing>;

export const DataExportRequest = z.strictObject({ format: z.literal("json").default("json") });
export type DataExportRequest = z.input<typeof DataExportRequest>;
export const DataExport = z.object({
  id: EntityId,
  status: z.enum(["pending", "ready", "failed", "expired"]),
  requestedAt: IsoDateTime,
  readyAt: IsoDateTime.nullable(),
  expiresAt: IsoDateTime.nullable(),
  downloadUrl: z.url().nullable(),
});
export type DataExport = z.infer<typeof DataExport>;

/** Request body for `POST /v1/me/deletion`. */
export const DeletionRequest = z.strictObject({ reason: z.string().max(500).optional() });
export type DeletionRequest = z.infer<typeof DeletionRequest>;
/** Result: the account is scheduled; `purgeAfter` is requestedAt + 14 days. */
export const DeletionResult = z.object({ requestedAt: IsoDateTime, purgeAfter: IsoDateTime });
export type DeletionResult = z.infer<typeof DeletionResult>;
/** Result of `DELETE /v1/me/deletion`. */
export const DeletionCancel = z.object({ cancelledAt: IsoDateTime });
export type DeletionCancel = z.infer<typeof DeletionCancel>;

export const DELETION_GRACE_DAYS = 14;

/** Request body for `POST /v1/me/deactivation`. */
export const DeactivationRequest = z.strictObject({ reason: z.string().max(500).optional() });
export type DeactivationRequest = z.infer<typeof DeactivationRequest>;

/**
 * Result of deactivating and reactivating. A deactivated account keeps all its data, every device
 * is signed out and nothing is sent. `purgeAfter` is set only while a deletion is scheduled.
 */
export const AccountStatus = z.object({
  status: AccountLifecycleStatus,
  deactivatedAt: IsoDateTime.nullable(),
  purgeAfter: IsoDateTime.nullable(),
});
export type AccountStatus = z.infer<typeof AccountStatus>;

/** How long a category of server-side data is kept. Clients map each key to their own text. */
export const RETENTION_KEYS = [
  "account_lifetime",
  "deleted_14_days_after_request",
  "backups_30_days",
  "expires_7_days_after_request",
] as const;
export const RetentionKey = z.enum(RETENTION_KEYS);
export type RetentionKey = z.infer<typeof RetentionKey>;

export const DATA_CATEGORIES = [
  "profile",
  "devices",
  "activity",
  "notifications",
  "support",
  "exports",
] as const;
export const DataCategory = z.enum(DATA_CATEGORIES);
export type DataCategory = z.infer<typeof DataCategory>;

/**
 * `GET /v1/me/data-summary`: what the server stores about the caller, as counts and dates only.
 * It lists nothing else because nothing else exists: no session content, prompts, code or paths.
 */
export const DataSummary = z.object({
  profile: z.object({
    email: z.email(),
    displayName: z.string(),
    createdAt: IsoDateTime,
    signInMethods: z.array(SignInMethod),
  }),
  devices: z.object({
    total: z.number().int(),
    active: z.number().int(),
    revoked: z.number().int(),
  }),
  activity: z.object({
    days: z.number().int(),
    firstDate: LocalDate.nullable(),
    lastDate: LocalDate.nullable(),
    totalMinutes: z.number().int(),
  }),
  notifications: z.object({
    feedItems: z.number().int(),
    preferencesCustomized: z.boolean(),
  }),
  support: z.object({ tickets: z.number().int() }),
  exports: z.object({ ready: z.number().int() }),
  /** Reserved. Optional anonymous statistics are a device setting, never stored per account. */
  consents: z.object({}),
  retention: z.object({
    profile: z.array(RetentionKey),
    devices: z.array(RetentionKey),
    activity: z.array(RetentionKey),
    notifications: z.array(RetentionKey),
    support: z.array(RetentionKey),
    exports: z.array(RetentionKey),
  }),
});
export type DataSummary = z.infer<typeof DataSummary>;

export const SECURITY_ACTIVITY_KINDS = [
  "session_started",
  "device_registered",
  "device_revoked",
  "account_deactivated",
  "account_reactivated",
  "export_requested",
  "deletion_requested",
  "deletion_cancelled",
] as const;
export const SecurityActivityKind = z.enum(SECURITY_ACTIVITY_KINDS);
export type SecurityActivityKind = z.infer<typeof SecurityActivityKind>;

export const SIGN_IN_CLIENTS = ["desktop", "mobile", "portal", "admin"] as const;
export const SignInClient = z.enum(SIGN_IN_CLIENTS);
export type SignInClient = z.infer<typeof SignInClient>;

/** ISO 3166-1 alpha-2 country code derived at the edge from the connection. The IP address is never stored. */
export const CountryCode = z.string().regex(/^[A-Z]{2}$/);
export type CountryCode = z.infer<typeof CountryCode>;

/** One entry of the user's own security activity (last 90 days). Never carries staff internals or addresses. */
export const SecurityActivityItem = z.object({
  at: IsoDateTime,
  kind: SecurityActivityKind,
  device: z.object({ id: z.string(), name: z.string() }).nullable(),
  country: CountryCode.nullable(),
  client: SignInClient.nullable(),
});
export type SecurityActivityItem = z.infer<typeof SecurityActivityItem>;

export const SecurityActivityQuery = z.strictObject({
  cursor: z.string().max(256).optional(),
});
export type SecurityActivityQuery = z.infer<typeof SecurityActivityQuery>;

export const SecurityActivityPage = z.object({
  items: z.array(SecurityActivityItem),
  nextCursor: z.string().nullable(),
});
export type SecurityActivityPage = z.infer<typeof SecurityActivityPage>;
