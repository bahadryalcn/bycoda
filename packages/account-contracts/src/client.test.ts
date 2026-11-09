import { describe, expect, it } from "vitest";
import { emptyMinutes, encodeMinutes, setMinute } from "./activity.ts";
import { ACCOUNT_API, buildPath } from "./api.ts";
import { createAccountClient } from "./client.ts";
import { AccountApiError } from "./errors.ts";
import { createMockAccountServer } from "./mock/index.ts";
import { NOTIFICATION_EVENTS, defaultNotificationSettings } from "./notifications.ts";
import { CONTRACT_HEADER, CONTRACT_VERSION } from "./version.ts";

const NOW = new Date("2026-11-08T12:00:00.000Z");

function setup(token: string | null = "mock-token") {
  const server = createMockAccountServer({ now: () => NOW });
  const client = createAccountClient({
    baseUrl: "https://api.example.test/",
    getAccessToken: () => token,
    fetch: server.fetch,
  });
  return { server, client };
}

const registration = {
  name: "Work laptop",
  platform: "macos",
  osVersion: "macOS 15",
  appVersion: "1.2.3",
  channel: "preview",
  kind: "desktop",
} as const;

function day(date: string, deviceId: string, ...minutes: number[]) {
  const map = emptyMinutes();
  for (const minute of minutes) setMinute(map, minute);
  return { date, timeZone: "Europe/Istanbul", deviceId, minutes: encodeMinutes(map) };
}

async function failure(promise: Promise<unknown>): Promise<AccountApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AccountApiError);
    return error as AccountApiError;
  }
  throw new Error("expected a rejection");
}

describe("route table", () => {
  it("keeps every path under /v1/ and documents auth", () => {
    for (const route of Object.values(ACCOUNT_API)) {
      expect(route.path.startsWith("/v1/")).toBe(true);
    }
    const open = Object.values(ACCOUNT_API).filter((route) => route.auth === "none");
    expect(open.map((route) => route.path)).toEqual([
      "/v1/feedback/anonymous",
      "/v1/diagnostics/reports/anonymous",
      "/v1/anonymous/ping",
    ]);
  });

  it("builds and encodes paths", () => {
    expect(buildPath(ACCOUNT_API.revokeDevice, { id: "a/b" })).toBe("/v1/devices/a%2Fb");
    expect(buildPath("/v1/me")).toBe("/v1/me");
    expect(() => buildPath(ACCOUNT_API.revokeDevice)).toThrow("Missing path parameter: id");
  });
});

describe("account client against the mock", () => {
  it("returns the account context with an empty organizations list", async () => {
    const { client } = setup();
    const me = await client.getMe();
    expect(me.user.email).toBe("mock@example.com");
    expect(me.entitlements.planTier).toBe("individual");
    expect(me.organizations).toEqual([]);
  });

  it("sends the contract header and bearer token", async () => {
    const seen: Request[] = [];
    const server = createMockAccountServer();
    const client = createAccountClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "mock-abc",
      fetch: (input, init) => {
        const request = new Request(input, init);
        seen.push(request);
        return server.fetch(request);
      },
    });
    await client.getMe();
    expect(seen[0]?.headers.get(CONTRACT_HEADER)).toBe(CONTRACT_VERSION);
    expect(seen[0]?.headers.get("Authorization")).toBe("Bearer mock-abc");
  });

  it("updates the profile and rejects unknown fields", async () => {
    const { client, server } = setup();
    const updated = await client.updateProfile({
      body: { displayName: "Ada", timeZone: "Europe/Berlin" },
    });
    expect(updated.displayName).toBe("Ada");
    expect((await client.getMe()).user.timeZone).toBe("Europe/Berlin");

    const bad = await failure(
      client.updateProfile({ body: { displayName: "x", project: "secret" } as never }),
    );
    expect(bad.code).toBe("validation_failed");

    // The server side rejects the same field when the client check is bypassed.
    const raw = await server.fetch("https://api.example.test/v1/me/profile", {
      method: "PATCH",
      headers: { Authorization: "Bearer mock-x", "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "x", prompt: "hello" }),
    });
    expect(raw.status).toBe(400);
    expect(((await raw.json()) as { error: { code: string } }).error.code).toBe(
      "validation_failed",
    );
  });

  it("registers, renames, lists and revokes devices", async () => {
    const { client } = setup();
    const device = await client.registerDevice({ body: registration });
    expect(device.current).toBe(true);
    expect(device.revokedAt).toBeNull();

    const again = await client.registerDevice({
      body: { ...registration, deviceId: device.id, appVersion: "2.0.0" },
    });
    expect(again.id).toBe(device.id);
    expect(again.createdAt).toBe(device.createdAt);

    const renamed = await client.renameDevice({
      params: { id: device.id },
      body: { name: "Home" },
    });
    expect(renamed.name).toBe("Home");

    const list = await client.listDevices();
    expect(list.items.map((item) => item.current)).toContain(true);
    expect(list.items.length).toBe(2);

    await client.revokeDevice({ params: { id: device.id } });
    expect((await client.listDevices()).items.length).toBe(1);
    expect((await failure(client.revokeDevice({ params: { id: device.id } }))).code).toBe(
      "not_found",
    );
    expect(
      (await failure(client.registerDevice({ body: { ...registration, deviceId: device.id } })))
        .code,
    ).toBe("device_revoked");
  });

  it("signs out every other device and keeps the current one", async () => {
    const { client } = setup();
    const device = await client.registerDevice({ body: registration });
    const before = (await client.listDevices()).items.length;
    expect(before).toBeGreaterThan(1);
    expect(await client.revokeOtherDevices()).toEqual({ revoked: before - 1 });
    expect((await client.listDevices()).items.map((item) => item.id)).toEqual([device.id]);
    expect(await client.revokeOtherDevices()).toEqual({ revoked: 0 });
  });

  it("stores a push token only for a known device", async () => {
    const { client, server } = setup();
    const device = await client.registerDevice({ body: registration });
    await client.setPushToken({
      params: { id: device.id },
      body: { provider: "expo", token: "ExponentPushToken[x]" },
    });
    expect(server.state.pushTokens.get(device.id)).toBe("ExponentPushToken[x]");
    const missing = await failure(
      client.setPushToken({ params: { id: "nope" }, body: { provider: "expo", token: "t" } }),
    );
    expect(missing.status).toBe(404);
  });

  it("merges activity uploads idempotently across devices and summarizes", async () => {
    const { client } = setup();
    const a = await client.registerDevice({ body: registration });
    const b = await client.registerDevice({
      body: { ...registration, name: "Phone", platform: "ios", kind: "mobile" },
    });
    const query = { timeZone: "Europe/Istanbul", date: "2026-11-08" };

    const upload = { days: [day("2026-11-08", a.id, 1, 2, 3), day("2026-11-08", b.id, 3, 4)] };
    expect((await client.uploadActivityDays({ body: upload })).accepted).toBe(2);
    await client.uploadActivityDays({ body: upload });
    await client.uploadActivityDays({ body: { days: [day("2026-11-08", a.id, 2)] } });

    const summary = await client.getActivitySummary({ query });
    // The seed adds 60 minutes (09:00-09:59) on the sample laptop; minutes 1-4 are ours.
    expect(summary.today).toBe(64);
    expect(summary.week).toBe(64);
    expect(summary.last7Days.at(-1)).toEqual({ date: "2026-11-08", minutes: 64 });
    const perDevice = Object.fromEntries(
      (summary.perDevice ?? []).map((d) => [d.deviceId, d.today]),
    );
    expect(perDevice[a.id]).toBe(3);
    expect(perDevice[b.id]).toBe(2);
  });

  it("rejects activity for unknown devices and malformed days", async () => {
    const { client } = setup();
    expect(
      (
        await failure(
          client.uploadActivityDays({ body: { days: [day("2026-11-08", "ghost", 1)] } }),
        )
      ).code,
    ).toBe("not_found");
    const badDay = { ...day("2026-11-08", "d", 1), minutes: "AAAA" };
    expect((await failure(client.uploadActivityDays({ body: { days: [badDay] } }))).code).toBe(
      "validation_failed",
    );
  });

  it("round-trips notification settings and refuses to disable mandatory events", async () => {
    const { client } = setup();
    const settings = await client.getNotificationSettings();
    expect(settings).toEqual(defaultNotificationSettings());

    const quiet = {
      ...settings,
      quietHours: { start: "22:00", end: "07:00", timeZone: "Europe/Istanbul" },
      pushShowDetails: true,
    };
    expect(await client.putNotificationSettings({ body: quiet })).toEqual(quiet);
    expect(await client.getNotificationSettings()).toEqual(quiet);

    const mandatory = NOTIFICATION_EVENTS.find((event) => event.mandatory)!;
    const disabled = {
      ...settings,
      preferences: settings.preferences.map((p) =>
        p.event === mandatory.key ? { ...p, enabled: false } : p,
      ),
    };
    expect((await failure(client.putNotificationSettings({ body: disabled }))).code).toBe(
      "validation_failed",
    );
  });

  it("pages the feed and marks items read", async () => {
    const { client, server } = setup();
    for (let i = 0; i < 5; i++) {
      server.state.notifications.push({
        id: `ntf_extra_${i}`,
        event: "agent.finished",
        title: "Done",
        body: "",
        createdAt: new Date(NOW.getTime() + i * 1000).toISOString(),
        readAt: null,
        dedupeKey: `k${i}`,
      });
    }
    const first = await client.listNotifications({ query: { limit: 4 } });
    expect(first.items).toHaveLength(4);
    expect(first.nextCursor).toBe("4");
    const second = await client.listNotifications({
      query: { limit: 4, cursor: first.nextCursor! },
    });
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();

    await client.markNotificationsRead({ body: { ids: [first.items[0]!.id] } });
    const refreshed = await client.listNotifications({ query: { limit: 100 } });
    expect(refreshed.items.find((i) => i.id === first.items[0]!.id)?.readAt).toBe(
      NOW.toISOString(),
    );
  });

  it("lists announcements and creates support tickets", async () => {
    const { client } = setup();
    expect((await client.listAnnouncements()).items.length).toBeGreaterThan(0);
    const ticket = await client.createSupportTicket({
      body: { subject: "Help", body: "It broke", category: "bug" },
    });
    expect(ticket.id).toMatch(/^tkt_/);
    const bad = await failure(
      client.createSupportTicket({
        body: { subject: "x", body: "y", category: "bug", sessionId: "s1" } as never,
      }),
    );
    expect(bad.code).toBe("validation_failed");
  });

  it("exports data asynchronously", async () => {
    const { client } = setup();
    const created = await client.requestExport({ body: {} });
    expect(created.status).toBe("pending");
    const ready = await client.getExport({ params: { id: created.id } });
    expect(ready.status).toBe("ready");
    expect(ready.downloadUrl).toContain(created.id);
    expect((await failure(client.getExport({ params: { id: "nope" } }))).code).toBe("not_found");
    const file = await client.downloadExport(created.id);
    expect(JSON.parse(await file.text())).toMatchObject({ exportId: created.id });
    await expect(client.downloadExport("nope")).rejects.toMatchObject({ code: "not_found" });
  });

  it("schedules deletion for 14 days and allows cancelling", async () => {
    const { client } = setup();
    const result = await client.requestDeletion({ body: {} });
    expect(Date.parse(result.purgeAfter) - Date.parse(result.requestedAt)).toBe(14 * 86_400_000);
    expect((await client.getMe()).user.deletion).toEqual(result);
    expect((await failure(client.requestDeletion({ body: {} }))).code).toBe("conflict");

    await client.cancelDeletion();
    expect((await client.getMe()).user.deletion).toBeNull();
    expect((await failure(client.cancelDeletion())).code).toBe("conflict");
  });

  it("deactivates, gates routes with account_deactivated and reactivates", async () => {
    const { client } = setup();
    const done = await client.deactivateAccount({ body: { reason: "break" } });
    expect(done).toMatchObject({ status: "deactivated", purgeAfter: null });
    expect(done.deactivatedAt).toBe(NOW.toISOString());
    expect((await client.getMe()).user).toMatchObject({ status: "deactivated" });
    expect((await failure(client.listDevices())).code).toBe("account_deactivated");
    expect(
      (await failure(client.getActivitySummary({ query: { timeZone: "UTC", date: "2026-11-08" } })))
        .code,
    ).toBe("account_deactivated");
    expect((await client.getDataSummary()).devices.active).toBe(0);
    expect(await client.requestExport({ body: {} })).toMatchObject({ status: "pending" });
    expect(await client.reactivateAccount()).toEqual({
      status: "active",
      deactivatedAt: null,
      purgeAfter: null,
    });
    expect((await client.listDevices()).items).toEqual([]);
  });

  it("rejects extras in the deactivation body and refuses it during a scheduled deletion", async () => {
    const { client } = setup();
    expect(
      (await failure(client.deactivateAccount({ body: { reason: "x".repeat(501) } }))).code,
    ).toBe("validation_failed");
    expect((await failure(client.deactivateAccount({ body: { note: "x" } as never }))).code).toBe(
      "validation_failed",
    );
    await client.requestDeletion({ body: {} });
    expect((await failure(client.deactivateAccount({ body: {} }))).code).toBe(
      "account_pending_deletion",
    );
  });

  it("summarizes the stored data with counts, dates and retention keys only", async () => {
    const { client } = setup();
    const device = await client.registerDevice({ body: registration });
    await client.uploadActivityDays({
      body: { days: [day("2026-11-07", device.id, 1, 2), day("2026-11-08", device.id, 5)] },
    });
    const summary = await client.getDataSummary();
    expect(summary.profile.email).toBe("mock@example.com");
    expect(summary.devices).toEqual({ total: 2, active: 2, revoked: 0 });
    expect(summary.activity).toMatchObject({ firstDate: "2026-11-07", lastDate: "2026-11-08" });
    expect(summary.activity.totalMinutes).toBeGreaterThanOrEqual(3);
    expect(summary.consents).toEqual({});
    expect(summary.retention.exports).toContain("expires_7_days_after_request");
  });

  it("lists security activity and rejects unknown query fields", async () => {
    const { client } = setup();
    const page = await client.getSecurityActivity({ query: {} });
    expect(page.nextCursor).toBeNull();
    expect(
      page.items.every((item) => item.kind === "device_registered" && item.country === null),
    ).toBe(true);
    expect(
      (await failure(client.getSecurityActivity({ query: { ip: "1.2.3.4" } as never }))).code,
    ).toBe("validation_failed");
  });

  it("accepts the anonymous ping without a token and rejects extras", async () => {
    const { client, server } = setup(null);
    const ping = {
      installId: "3f2b8a52-9b0e-4d57-8a43-6d3c1f6b7a10",
      appVersion: "1.0.0",
      platform: "linux",
      osVersion: "Ubuntu 24.04",
      channel: "stable",
      date: "2026-11-08",
    } as const;
    await client.anonymousPing({ body: ping });
    expect(server.state.pings).toHaveLength(1);
    expect(
      (await failure(client.anonymousPing({ body: { ...ping, cwd: "/home/me" } as never }))).code,
    ).toBe("validation_failed");
  });
});

describe("auth and error handling", () => {
  it("throws unauthorized locally when signed out", async () => {
    const { client } = setup(null);
    const error = await failure(client.getMe());
    expect(error.code).toBe("unauthorized");
    expect(error.status).toBe(401);
  });

  it("maps server errors to AccountApiError with a request id", async () => {
    const { client } = setup("not-a-mock-token");
    const error = await failure(client.getMe());
    expect(error.code).toBe("unauthorized");
    expect(error.requestId).toMatch(/^req_mock_/);
  });

  it("reports a revoked device", async () => {
    const { client } = setup("mock-revoked");
    expect((await failure(client.getMe())).code).toBe("device_revoked");
  });

  it("rejects an unsupported contract major", async () => {
    const server = createMockAccountServer();
    const response = await server.fetch("https://x.test/v1/me", {
      headers: { Authorization: "Bearer mock-a", [CONTRACT_HEADER]: "9.0.0" },
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "contract_version_unsupported",
    );
  });

  it("answers unknown routes with not_found", async () => {
    const server = createMockAccountServer();
    expect((await server.fetch("https://x.test/v1/nothing")).status).toBe(404);
  });

  it("throws internal when the response violates the contract", async () => {
    const client = createAccountClient({
      baseUrl: "https://x.test",
      getAccessToken: () => "mock-a",
      fetch: async () => new Response(JSON.stringify({ nope: true }), { status: 200 }),
    });
    expect((await failure(client.getMe())).code).toBe("internal");
  });

  it("throws internal for a non-envelope error body", async () => {
    const client = createAccountClient({
      baseUrl: "https://x.test",
      getAccessToken: () => "mock-a",
      fetch: async () => new Response("bad gateway", { status: 502 }),
    });
    const error = await failure(client.getMe());
    expect(error.status).toBe(502);
    expect(error.code).toBe("internal");
  });
});

describe("feedback (0.7.0)", () => {
  it("accepts feedback with and without an account and rejects extra fields", async () => {
    const { FeedbackCreate } = await import("./models.ts");
    expect(
      FeedbackCreate.safeParse({ kind: "idea", message: "Dark mode for the rail" }).success,
    ).toBe(true);
    expect(FeedbackCreate.safeParse({ kind: "idea", message: " " }).success).toBe(false);
    expect(FeedbackCreate.safeParse({ kind: "praise", message: "ok", rating: 6 }).success).toBe(
      false,
    );
    expect(
      FeedbackCreate.safeParse({ kind: "problem", message: "x", sessionText: "secret" }).success,
    ).toBe(false);
    const { ACCOUNT_API } = await import("./api.ts");
    expect(ACCOUNT_API.sendFeedback.auth).toBe("user");
    expect(ACCOUNT_API.sendAnonymousFeedback.auth).toBe("none");
  });
});

describe("account connect (0.8.0)", () => {
  const key = "A".repeat(43);
  it("validates routes", async () => {
    const { ConnectInfoUpdate } = await import("./models.ts");
    const ok = (routes: unknown[]) =>
      ConnectInfoUpdate.safeParse({ environmentId: "env", routes }).success;
    expect(ok([{ endpoint: "https://pc.tailnet.ts.net" }])).toBe(true);
    expect(ok([{ endpoint: "http://192.168.1.5:3773", lanKey: "a".repeat(64) }])).toBe(true);
    expect(ok([{ endpoint: "http://192.168.1.5:3773" }])).toBe(false);
    expect(ok([{ endpoint: "http://8.8.8.8:3773", lanKey: "a".repeat(64) }])).toBe(false);
    expect(ok([{ endpoint: "https://u:p@pc.example" }])).toBe(false);
    expect(ok([{ endpoint: "https://pc.example/path?x=1" }])).toBe(false);
    expect(ok(Array.from({ length: 5 }, () => ({ endpoint: "https://pc.example" })))).toBe(false);
  });
  it("runs the pair request flow on the mock", async () => {
    const { createMockAccountServer } = await import("./mock/index.ts");
    const server = createMockAccountServer();
    const call = async (method: string, path: string, body?: unknown) =>
      server.fetch(`https://mock.bycoda.invalid${path}`, {
        method,
        headers: {
          Authorization: "Bearer mock-t",
          [CONTRACT_HEADER]: CONTRACT_VERSION,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const device = (name: string, kind: string, platform: string) =>
      call("POST", "/v1/devices", {
        name,
        platform,
        osVersion: "1",
        appVersion: "1",
        channel: "stable",
        kind,
      }).then((r) => r.json() as Promise<{ id: string }>);
    const desktop = await device("Desk", "desktop", "windows");
    expect(
      (
        await call("PUT", `/v1/devices/${desktop.id}/connect`, {
          environmentId: "env",
          routes: [{ endpoint: "https://pc.example" }],
        })
      ).status,
    ).toBe(204);
    const phone = await device("Pixel", "mobile", "android");
    const computers = (await (await call("GET", "/v1/computers")).json()) as {
      items: { deviceId: string }[];
    };
    expect(computers.items.map((c) => c.deviceId)).toEqual([desktop.id]);
    const created = (await (
      await call("POST", `/v1/computers/${desktop.id}/pair-requests`, {
        phonePublicKey: key,
      })
    ).json()) as { id: string };
    server.state.currentDeviceId = desktop.id;
    const pending = (await (await call("GET", "/v1/pair-requests")).json()) as {
      items: { id: string }[];
    };
    expect(pending.items.map((r) => r.id)).toEqual([created.id]);
    expect(
      (
        await call("PUT", `/v1/pair-requests/${created.id}/ticket`, {
          desktopPublicKey: key,
          sealed: "abc",
        })
      ).status,
    ).toBe(204);
    server.state.currentDeviceId = phone.id;
    const first = (await (await call("GET", `/v1/pair-requests/${created.id}`)).json()) as {
      state: string;
      sealed?: string;
    };
    expect(first).toMatchObject({ state: "sealed", sealed: "abc" });
    expect(
      (await (await call("GET", `/v1/pair-requests/${created.id}`)).json()) as {
        state: string;
        sealed?: string;
      },
    ).toEqual({ state: "delivered" });
  });
});
