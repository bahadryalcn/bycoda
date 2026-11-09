import {
  summarize,
  countMinutes,
  decodeMinutes,
  encodeMinutes,
  mergeMinutes,
} from "../activity.ts";
import type { ActivityDay } from "../activity-schema.ts";
import { ACCOUNT_API, type RouteDefinition, type RouteName } from "../api.ts";
import type { ErrorCode } from "../errors.ts";
import { DELETION_GRACE_DAYS, type AccountStatus, type Device } from "../models.ts";
import { CONTRACT_HEADER, CONTRACT_VERSION } from "../version.ts";
import { createMockState, type MockPairRequest, type MockSeed, type MockState } from "./state.ts";

const ORIGIN = "https://mock.bycoda.invalid";
const DAY_MS = 86_400_000;
const PAIR_REQUEST_TTL_MS = 120_000;

class MockHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

interface Context {
  state: MockState;
  now: Date;
  params: Record<string, string>;
  query: Record<string, any>; // eslint-disable-line -- parsed by the route schema
  body: any; // eslint-disable-line -- parsed by the route schema
}

type Handler = (context: Context) => unknown;

const compiled = (Object.keys(ACCOUNT_API) as RouteName[]).map((name) => {
  const definition: RouteDefinition = ACCOUNT_API[name];
  const names: string[] = [];
  const pattern = definition.path.replace(/:([A-Za-z]+)/g, (_, param: string) => {
    names.push(param);
    return "([^/]+)";
  });
  return { name, definition, names, regex: new RegExp(`^${pattern}$`) };
});

function findDevice(state: MockState, id: string | undefined): Device {
  const device = id ? state.devices.get(id) : undefined;
  if (!device || device.revokedAt) throw new MockHttpError(404, "not_found", "Device not found");
  return device;
}

function livePair(request: MockPairRequest, now: Date): MockPairRequest["state"] {
  if (request.state === "pending" && Date.parse(request.expiresAt) <= now.getTime()) {
    request.state = "expired";
  }
  return request.state;
}

function targetPairRequest(state: MockState, id: string | undefined, now: Date): MockPairRequest {
  const request = state.pairRequests.get(id ?? "");
  if (!request || request.computerDeviceId !== state.currentDeviceId)
    throw new MockHttpError(404, "not_found", "Pair request not found");
  if (livePair(request, now) !== "pending")
    throw new MockHttpError(409, "conflict", "Pair request is no longer pending");
  return request;
}

function allDays(state: MockState): ActivityDay[] {
  return [...state.activity.values()].map((entry) => ({
    date: entry.date,
    timeZone: entry.timeZone,
    deviceId: entry.deviceId,
    minutes: encodeMinutes(entry.minutes),
  }));
}

function accountStatus(state: MockState): AccountStatus {
  const { user } = state;
  return {
    status: user.deletion ? "pending_deletion" : user.deactivatedAt ? "deactivated" : "active",
    deactivatedAt: user.deactivatedAt ?? null,
    purgeAfter: user.deletion?.purgeAfter ?? null,
  };
}

const handlers: Record<RouteName, Handler> = {
  getMe: ({ state }) => ({ user: state.user, entitlements: state.entitlements, organizations: [] }),
  updateProfile: ({ state, body }) => {
    state.user = { ...state.user, ...body };
    return state.user;
  },
  listDevices: ({ state }) => ({
    items: [...state.devices.values()]
      .filter((device) => !device.revokedAt)
      .map((device) => ({ ...device, current: device.id === state.currentDeviceId })),
  }),
  registerDevice: ({ state, body, now }) => {
    const { deviceId, ...fields } = body;
    const existing = deviceId ? state.devices.get(deviceId) : undefined;
    if (existing?.revokedAt)
      throw new MockHttpError(401, "device_revoked", "Device was signed out");
    const device: Device = {
      ...fields,
      id: existing?.id ?? `dev_mock_${state.nextId++}`,
      createdAt: existing?.createdAt ?? now.toISOString(),
      lastSeenAt: now.toISOString(),
      revokedAt: null,
    };
    state.devices.set(device.id, device);
    state.currentDeviceId = device.id;
    return { ...device, current: true };
  },
  renameDevice: ({ state, params, body }) => {
    const device = { ...findDevice(state, params.id), name: body.name };
    state.devices.set(device.id, device);
    return { ...device, current: device.id === state.currentDeviceId };
  },
  revokeDevice: ({ state, params, now }) => {
    const device = findDevice(state, params.id);
    state.devices.set(device.id, { ...device, revokedAt: now.toISOString() });
    state.pushTokens.delete(device.id);
    if (state.currentDeviceId === device.id) state.currentDeviceId = null;
  },
  revokeOtherDevices: ({ state, now }) => {
    let revoked = 0;
    for (const [id, device] of state.devices) {
      if (device.revokedAt || id === state.currentDeviceId) continue;
      state.devices.set(id, { ...device, revokedAt: now.toISOString() });
      state.pushTokens.delete(id);
      revoked += 1;
    }
    return { revoked };
  },
  setPushToken: ({ state, params, body }) => {
    state.pushTokens.set(findDevice(state, params.id).id, body.token);
  },
  uploadActivityDays: ({ state, body }) => {
    for (const day of body.days as ActivityDay[]) {
      if (!state.devices.has(day.deviceId) || state.devices.get(day.deviceId)?.revokedAt) {
        throw new MockHttpError(404, "not_found", `Unknown device: ${day.deviceId}`);
      }
    }
    for (const day of body.days as ActivityDay[]) {
      const key = `${day.deviceId}|${day.date}`;
      const incoming = decodeMinutes(day.minutes);
      const existing = state.activity.get(key);
      state.activity.set(key, {
        deviceId: day.deviceId,
        date: day.date,
        timeZone: day.timeZone,
        minutes: existing ? mergeMinutes(existing.minutes, incoming) : incoming,
      });
    }
    return { accepted: body.days.length };
  },
  getActivitySummary: ({ state, query }) =>
    summarize(allDays(state), { today: query.date, timeZone: query.timeZone, perDevice: true }),
  getNotificationSettings: ({ state }) => state.settings,
  putNotificationSettings: ({ state, body }) => {
    state.settings = body;
    return state.settings;
  },
  listNotifications: ({ state, query }) => {
    const start = query.cursor ? Number(query.cursor) || 0 : 0;
    const limit = query.limit ?? 20;
    const ordered = [...state.notifications].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const items = ordered.slice(start, start + limit);
    return { items, nextCursor: start + limit < ordered.length ? String(start + limit) : null };
  },
  markNotificationsRead: ({ state, body, now }) => {
    const ids = new Set<string>(body.ids);
    state.notifications = state.notifications.map((item) =>
      ids.has(item.id) && !item.readAt ? { ...item, readAt: now.toISOString() } : item,
    );
  },
  reportNotificationEvent: () => undefined,
  listAnnouncements: ({ state }) => ({ items: state.announcements }),
  createSupportTicket: ({ state, now }) => {
    const ticket = { id: `tkt_mock_${state.nextId++}`, createdAt: now.toISOString() };
    state.tickets.push(ticket);
    return ticket;
  },
  sendFeedback: ({ state, now }) => {
    const item = { id: `fbk_mock_${state.nextId++}`, createdAt: now.toISOString() };
    state.feedback.push({ ...item, signedIn: true });
    return item;
  },
  sendAnonymousFeedback: ({ state, now }) => {
    const item = { id: `fbk_mock_${state.nextId++}`, createdAt: now.toISOString() };
    state.feedback.push({ ...item, signedIn: false });
    return item;
  },
  sendDiagnosticReport: ({ state, now, body }) => {
    const item = { id: `dgr_mock_${state.nextId++}`, createdAt: now.toISOString() };
    state.diagnostics.push({ ...item, signedIn: true, trigger: body.trigger });
    return item;
  },
  sendAnonymousDiagnosticReport: ({ state, now, body }) => {
    const item = { id: `dgr_mock_${state.nextId++}`, createdAt: now.toISOString() };
    state.diagnostics.push({ ...item, signedIn: false, trigger: body.trigger });
    return item;
  },
  requestExport: ({ state, now }) => {
    const created = {
      id: `exp_mock_${state.nextId++}`,
      status: "pending" as const,
      requestedAt: now.toISOString(),
      readyAt: null,
      expiresAt: null,
      downloadUrl: null,
    };
    state.exports.set(created.id, created);
    return created;
  },
  getExport: ({ state, params, now }) => {
    const found = state.exports.get(params.id ?? "");
    if (!found) throw new MockHttpError(404, "not_found", "Export not found");
    // The mock finishes an export the first time it is polled.
    if (found.status === "pending") {
      const ready = {
        ...found,
        status: "ready" as const,
        readyAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + DAY_MS).toISOString(),
        downloadUrl: `${ORIGIN}/exports/${found.id}.json`,
      };
      state.exports.set(found.id, ready);
      return ready;
    }
    return found;
  },
  exportDownload: ({ state, params }) => {
    const found = state.exports.get(params.id ?? "");
    if (!found || found.status !== "ready")
      throw new MockHttpError(404, "not_found", "Export not found");
    return JSON.stringify({ exportId: found.id, mock: true });
  },
  requestDeletion: ({ state, now }) => {
    if (state.user.deletion) throw new MockHttpError(409, "conflict", "Deletion already scheduled");
    const deletion = {
      requestedAt: now.toISOString(),
      purgeAfter: new Date(now.getTime() + DELETION_GRACE_DAYS * DAY_MS).toISOString(),
    };
    state.user = { ...state.user, deletion };
    return deletion;
  },
  cancelDeletion: ({ state, now }) => {
    if (!state.user.deletion) throw new MockHttpError(409, "conflict", "No deletion is scheduled");
    state.user = { ...state.user, deletion: null };
    return { cancelledAt: now.toISOString() };
  },
  deactivateAccount: ({ state, now }) => {
    if (state.user.deletion)
      throw new MockHttpError(403, "account_pending_deletion", "Deletion is scheduled");
    if (!state.user.deactivatedAt) {
      const deactivatedAt = now.toISOString();
      state.user = { ...state.user, status: "deactivated", deactivatedAt };
      for (const [id, device] of state.devices) {
        if (!device.revokedAt) state.devices.set(id, { ...device, revokedAt: deactivatedAt });
      }
      state.pushTokens.clear();
      state.currentDeviceId = null;
    }
    return accountStatus(state);
  },
  reactivateAccount: ({ state }) => {
    state.user = { ...state.user, status: "active", deactivatedAt: null };
    return accountStatus(state);
  },
  getDataSummary: ({ state }) => {
    const days = [...state.activity.values()];
    const dates = [...new Set(days.map((entry) => entry.date))].sort();
    const devices = [...state.devices.values()];
    return {
      profile: {
        email: state.user.email,
        displayName: state.user.displayName,
        createdAt: state.user.createdAt,
        signInMethods: state.user.signInMethods,
      },
      devices: {
        total: devices.length,
        active: devices.filter((device) => !device.revokedAt).length,
        revoked: devices.filter((device) => device.revokedAt).length,
      },
      activity: {
        days: dates.length,
        firstDate: dates[0] ?? null,
        lastDate: dates[dates.length - 1] ?? null,
        totalMinutes: days.reduce((sum, entry) => sum + countMinutes(entry.minutes), 0),
      },
      notifications: { feedItems: state.notifications.length, preferencesCustomized: false },
      support: { tickets: state.tickets.length },
      exports: {
        ready: [...state.exports.values()].filter((item) => item.status === "ready").length,
      },
      consents: {},
      retention: {
        profile: ["account_lifetime", "deleted_14_days_after_request", "backups_30_days"],
        devices: ["account_lifetime", "deleted_14_days_after_request", "backups_30_days"],
        activity: ["account_lifetime", "deleted_14_days_after_request", "backups_30_days"],
        notifications: ["account_lifetime", "deleted_14_days_after_request", "backups_30_days"],
        support: ["account_lifetime", "deleted_14_days_after_request", "backups_30_days"],
        exports: ["expires_7_days_after_request", "deleted_14_days_after_request"],
      },
    };
  },
  getSecurityActivity: ({ state, now }) => {
    // The mock keeps no sign-in history: it reports the registered devices.
    const items = [...state.devices.values()]
      .map((device) => ({
        at: device.createdAt,
        kind: "device_registered" as const,
        device: { id: device.id, name: device.name },
        country: null,
        client: device.kind,
      }))
      .filter((item) => now.getTime() - Date.parse(item.at) <= 90 * DAY_MS)
      .sort((a, b) => b.at.localeCompare(a.at));
    return { items, nextCursor: null };
  },
  putConnectInfo: ({ state, params, body, now }) => {
    const device = findDevice(state, params.id);
    if (device.kind !== "desktop" || device.id !== state.currentDeviceId)
      throw new MockHttpError(403, "forbidden", "Only the desktop itself can publish connect info");
    state.connectInfo.set(device.id, { ...body, updatedAt: now.toISOString() });
  },
  deleteConnectInfo: ({ state, params }) => {
    state.connectInfo.delete(findDevice(state, params.id).id);
  },
  listComputers: ({ state }) => ({
    items: [...state.connectInfo]
      .map(([id, info]) => ({ device: state.devices.get(id), info }))
      .filter(({ device }) => device && !device.revokedAt && device.kind === "desktop")
      .map(({ device, info }) => ({
        deviceId: device!.id,
        name: info.hostName ?? device!.name,
        platform: device!.platform,
        environmentId: info.environmentId,
        routes: info.routes,
        lastSeenAt: device!.lastSeenAt,
        updatedAt: info.updatedAt,
      })),
  }),
  createPairRequest: ({ state, params, body, now }) => {
    const computer = findDevice(state, params.deviceId);
    const phone = findDevice(state, state.currentDeviceId ?? undefined);
    if (
      phone.kind !== "mobile" ||
      computer.kind !== "desktop" ||
      !state.connectInfo.has(computer.id)
    )
      throw new MockHttpError(403, "forbidden", "Not a phone or not a connectable computer");
    const request: MockPairRequest = {
      id: `pr_mock_${state.nextId++}`,
      computerDeviceId: computer.id,
      phoneDeviceId: phone.id,
      phonePublicKey: body.phonePublicKey,
      state: "pending",
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + PAIR_REQUEST_TTL_MS).toISOString(),
    };
    state.pairRequests.set(request.id, request);
    return { id: request.id, expiresAt: request.expiresAt };
  },
  listPairRequests: ({ state, now }) => ({
    items: [...state.pairRequests.values()]
      .filter((r) => r.computerDeviceId === state.currentDeviceId && livePair(r, now) === "pending")
      .map((r) => {
        const phone = state.devices.get(r.phoneDeviceId);
        return {
          id: r.id,
          phoneDeviceId: r.phoneDeviceId,
          phoneName: phone?.name ?? "Phone",
          phonePlatform: phone?.platform ?? "android",
          phonePublicKey: r.phonePublicKey,
          createdAt: r.createdAt,
          expiresAt: r.expiresAt,
        };
      }),
  }),
  putPairTicket: ({ state, params, body, now }) => {
    const request = targetPairRequest(state, params.id, now);
    request.state = "sealed";
    request.desktopPublicKey = body.desktopPublicKey;
    request.sealed = body.sealed;
  },
  denyPairRequest: ({ state, params, now }) => {
    targetPairRequest(state, params.id, now).state = "denied";
  },
  getPairRequest: ({ state, params, now }) => {
    const request = state.pairRequests.get(params.id ?? "");
    if (!request || request.phoneDeviceId !== state.currentDeviceId)
      throw new MockHttpError(404, "not_found", "Pair request not found");
    const current = livePair(request, now);
    if (current !== "sealed") return { state: current === "delivered" ? "delivered" : current };
    const { desktopPublicKey, sealed } = request;
    request.state = "delivered";
    delete request.sealed;
    return { state: "sealed", desktopPublicKey, sealed };
  },
  anonymousPing: ({ state, body }) => {
    state.pings.push(body);
  },
};

/** Routes a deactivated account may still call (everything else answers `account_deactivated`). */
const DEACTIVATED_ALLOWED: ReadonlySet<RouteName> = new Set<RouteName>([
  "getMe",
  "reactivateAccount",
  "requestDeletion",
  "cancelDeletion",
  "requestExport",
  "getExport",
  "exportDownload",
  "getDataSummary",
  "getSecurityActivity",
]);

export interface MockAccountServer {
  /** Fetch-compatible entry point; pass as `createAccountClient({ fetch })`. */
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /** Live state, for assertions and for seeding more data in tests. */
  state: MockState;
}

/**
 * In-memory implementation of every `ACCOUNT_API` route so apps can develop without the
 * backend. Any bearer token starting with `mock-` is accepted; `mock-revoked` answers
 * `device_revoked`. Not a security boundary and not a model of server business rules.
 */
export function createMockAccountServer(seed: MockSeed = {}): MockAccountServer {
  const state = createMockState(seed);
  const clock = seed.now ?? (() => new Date());
  let requestCounter = 0;

  function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  function failure(requestId: string, error: MockHttpError): Response {
    return json(error.status, {
      error: { code: error.code, message: error.message, requestId },
    });
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const matched = compiled
      .filter((entry) => entry.definition.method === request.method)
      .map((entry) => ({ entry, match: entry.regex.exec(url.pathname) }))
      .find((candidate) => candidate.match);
    if (!matched?.match) throw new MockHttpError(404, "not_found", "Unknown route");
    const { entry, match } = matched;
    const { definition } = entry;

    const major = request.headers.get(CONTRACT_HEADER)?.split(".")[0];
    if (major !== undefined && major !== CONTRACT_VERSION.split(".")[0]) {
      throw new MockHttpError(400, "contract_version_unsupported", "Unsupported contract version");
    }
    if (definition.auth === "user") {
      const token = /^Bearer (mock-.+)$/.exec(request.headers.get("Authorization") ?? "")?.[1];
      if (!token) throw new MockHttpError(401, "unauthorized", "Missing or invalid token");
      if (token === "mock-revoked") {
        throw new MockHttpError(401, "device_revoked", "This device was signed out");
      }
    }

    if (
      state.user.deactivatedAt &&
      definition.auth === "user" &&
      !DEACTIVATED_ALLOWED.has(entry.name)
    ) {
      throw new MockHttpError(403, "account_deactivated", "This account is deactivated");
    }

    const params: Record<string, string> = {};
    entry.names.forEach((name, index) => {
      params[name] = decodeURIComponent(match[index + 1] as string);
    });

    let query: unknown = {};
    if (definition.query) {
      const parsed = definition.query.safeParse(Object.fromEntries(url.searchParams));
      if (!parsed.success) throw new MockHttpError(400, "validation_failed", parsed.error.message);
      query = parsed.data;
    }
    let body: unknown;
    if (definition.body) {
      let raw: unknown;
      try {
        raw = await request.json();
      } catch {
        throw new MockHttpError(400, "validation_failed", "Body must be JSON");
      }
      const parsed = definition.body.safeParse(raw);
      if (!parsed.success) throw new MockHttpError(400, "validation_failed", parsed.error.message);
      body = parsed.data;
    }

    const result = handlers[entry.name]({
      state,
      now: clock(),
      params,
      query: query as Context["query"],
      body,
    });
    if (definition.kind === "file") {
      return new Response(result as string, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": 'attachment; filename="bycoda-export.json"',
        },
      });
    }
    return definition.response ? json(200, result) : new Response(null, { status: 204 });
  }

  return {
    state,
    fetch: async (input, init) => {
      const requestId = `req_mock_${++requestCounter}`;
      try {
        return await handle(new Request(input, init));
      } catch (error) {
        if (error instanceof MockHttpError) return failure(requestId, error);
        throw error;
      }
    },
  };
}
