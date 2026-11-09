/**
 * Route table of the client-visible API. Paths are relative to the API base URL and always
 * start with `/v1/`. No route accepts session content, prompts, code, file paths or project
 * names; request schemas are strict so such fields fail with `validation_failed`.
 */
import { z } from "zod";
import {
  ActivityDaysUpload,
  ActivitySummary,
  ActivitySummaryQuery,
  ActivityUploadResult,
} from "./activity-schema.ts";
import {
  AccountContext,
  AccountStatus,
  DataSummary,
  DeactivationRequest,
  SecurityActivityPage,
  SecurityActivityQuery,
  AnnouncementList,
  AnonymousPing,
  DataExport,
  DataExportRequest,
  DeletionCancel,
  DeletionRequest,
  DeletionResult,
  Device,
  DeviceList,
  DevicesRevoked,
  DeviceRegistration,
  DeviceRename,
  ProfileUpdate,
  PushTokenRegistration,
  FeedbackCreate,
  FeedbackReceipt,
  SupportTicketCreate,
  SupportTicketReceipt,
  User,
} from "./models.ts";
import {
  MarkRead,
  NotificationFeed,
  NotificationEventReport,
  NotificationFeedQuery,
  NotificationSettings,
} from "./notifications.ts";

export interface RouteDefinition {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  auth: "user" | "none";
  /** JSON request body schema (strict). */
  body?: z.ZodType;
  /** Query string schema (values arrive as strings). */
  query?: z.ZodType;
  /** JSON response schema; `null` means an empty 204 response (or a raw file, see `kind`). */
  response: z.ZodType | null;
  /** Non-JSON routes: `"file"` answers raw bytes (`response` is `null`). Absent means JSON. */
  kind?: "file";
}

function route<const R extends RouteDefinition>(definition: R): R {
  return definition;
}

export const ACCOUNT_API = {
  getMe: route({ method: "GET", path: "/v1/me", auth: "user", response: AccountContext }),
  updateProfile: route({
    method: "PATCH",
    path: "/v1/me/profile",
    auth: "user",
    body: ProfileUpdate,
    response: User,
  }),
  listDevices: route({ method: "GET", path: "/v1/devices", auth: "user", response: DeviceList }),
  registerDevice: route({
    method: "POST",
    path: "/v1/devices",
    auth: "user",
    body: DeviceRegistration,
    response: Device,
  }),
  renameDevice: route({
    method: "PATCH",
    path: "/v1/devices/:id",
    auth: "user",
    body: DeviceRename,
    response: Device,
  }),
  /** Revoking a device is a remote sign-out. */
  revokeDevice: route({ method: "DELETE", path: "/v1/devices/:id", auth: "user", response: null }),
  /**
   * Signs out every OTHER device (contract 0.6.0, additive). A device client sends its device header and
   * keeps itself; a web session without a device header (the portal) signs out every registered device.
   * Revokes the bound Clerk sessions like a single revoke and returns how many devices were revoked.
   */
  revokeOtherDevices: route({
    method: "POST",
    path: "/v1/devices/revoke-others",
    auth: "user",
    response: DevicesRevoked,
  }),
  setPushToken: route({
    method: "PUT",
    path: "/v1/devices/:id/push-token",
    auth: "user",
    body: PushTokenRegistration,
    response: null,
  }),
  uploadActivityDays: route({
    method: "PUT",
    path: "/v1/activity/days",
    auth: "user",
    body: ActivityDaysUpload,
    response: ActivityUploadResult,
  }),
  getActivitySummary: route({
    method: "GET",
    path: "/v1/activity/summary",
    auth: "user",
    query: ActivitySummaryQuery,
    response: ActivitySummary,
  }),
  getNotificationSettings: route({
    method: "GET",
    path: "/v1/notifications/settings",
    auth: "user",
    response: NotificationSettings,
  }),
  putNotificationSettings: route({
    method: "PUT",
    path: "/v1/notifications/settings",
    auth: "user",
    body: NotificationSettings,
    response: NotificationSettings,
  }),
  listNotifications: route({
    method: "GET",
    path: "/v1/notifications",
    auth: "user",
    query: NotificationFeedQuery,
    response: NotificationFeed,
  }),
  markNotificationsRead: route({
    method: "POST",
    path: "/v1/notifications/read",
    auth: "user",
    body: MarkRead,
    response: null,
  }),
  reportNotificationEvent: route({
    method: "POST",
    path: "/v1/notifications/events",
    auth: "user",
    body: NotificationEventReport,
    response: null,
  }),
  listAnnouncements: route({
    method: "GET",
    path: "/v1/announcements",
    auth: "user",
    response: AnnouncementList,
  }),
  createSupportTicket: route({
    method: "POST",
    path: "/v1/support/tickets",
    auth: "user",
    body: SupportTicketCreate,
    response: SupportTicketReceipt,
  }),
  /** Added in 0.7.0. Feedback from a signed-in user, linked to the account. */
  sendFeedback: route({
    method: "POST",
    path: "/v1/feedback",
    auth: "user",
    body: FeedbackCreate,
    response: FeedbackReceipt,
  }),
  /** Added in 0.7.0. Feedback without an account; stored with no user, device or install id. */
  sendAnonymousFeedback: route({
    method: "POST",
    path: "/v1/feedback/anonymous",
    auth: "none",
    body: FeedbackCreate,
    response: FeedbackReceipt,
  }),
  requestExport: route({
    method: "POST",
    path: "/v1/me/export",
    auth: "user",
    body: DataExportRequest,
    response: DataExport,
  }),
  getExport: route({
    method: "GET",
    path: "/v1/me/export/:id",
    auth: "user",
    response: DataExport,
  }),
  /** Raw JSON file behind `DataExport.downloadUrl`; non-JSON, bearer-authenticated. */
  exportDownload: route({
    method: "GET",
    path: "/v1/me/export/:id/download",
    auth: "user",
    kind: "file",
    response: null,
  }),
  requestDeletion: route({
    method: "POST",
    path: "/v1/me/deletion",
    auth: "user",
    body: DeletionRequest,
    response: DeletionResult,
  }),
  cancelDeletion: route({
    method: "DELETE",
    path: "/v1/me/deletion",
    auth: "user",
    response: DeletionCancel,
  }),
  /** Added in 0.4.0. Keeps all data, signs every device out and silences notifications. */
  deactivateAccount: route({
    method: "POST",
    path: "/v1/me/deactivation",
    auth: "user",
    body: DeactivationRequest,
    response: AccountStatus,
  }),
  /** Added in 0.4.0. Restores normal use; devices register again on their next sign-in. */
  reactivateAccount: route({
    method: "DELETE",
    path: "/v1/me/deactivation",
    auth: "user",
    response: AccountStatus,
  }),
  /** Added in 0.4.0. Counts and dates of what the server stores about the caller. */
  getDataSummary: route({
    method: "GET",
    path: "/v1/me/data-summary",
    auth: "user",
    response: DataSummary,
  }),
  /** Added in 0.5.0. The caller's own sign-ins and account events of the last 90 days, newest first. */
  getSecurityActivity: route({
    method: "GET",
    path: "/v1/me/security-activity",
    auth: "user",
    query: SecurityActivityQuery,
    response: SecurityActivityPage,
  }),
  /** Opt-in, default off, no account. */
  anonymousPing: route({
    method: "POST",
    path: "/v1/anonymous/ping",
    auth: "none",
    body: AnonymousPing,
    response: null,
  }),
} as const;

export type AccountApi = typeof ACCOUNT_API;
export type RouteName = keyof AccountApi;
/** Routes that answer JSON (or 204); file routes are exposed through dedicated client methods. */
export type JsonRouteName = {
  [K in RouteName]: AccountApi[K] extends { kind: "file" } ? never : K;
}[RouteName];

export function buildPath(
  routeOrPath: Pick<RouteDefinition, "path"> | string,
  params: Record<string, string> = {},
): string {
  const path = typeof routeOrPath === "string" ? routeOrPath : routeOrPath.path;
  return path.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`Missing path parameter: ${name}`);
    return encodeURIComponent(value);
  });
}

type SchemaInput<S> = S extends z.ZodType ? z.input<S> : never;
type SchemaOutput<S> = S extends z.ZodType ? z.output<S> : void;

export type RouteBody<R extends RouteDefinition> = R extends { body: infer B }
  ? SchemaInput<B>
  : never;
export type RouteQuery<R extends RouteDefinition> = R extends { query: infer Q }
  ? SchemaInput<Q>
  : never;
export type RouteResponse<R extends RouteDefinition> = R extends { response: infer S }
  ? SchemaOutput<S>
  : never;
