import { Readable } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { SocialTransport } from "./social-transport";
import type { SocialService } from "./social";
import type { XBrowserSessions } from "./social-browser-x";

afterEach(() => vi.unstubAllEnvs());

it("routes browser LinkedIn profile analytics only from the owner transport", async () => {
  const response = { source: "browser", metrics: { profileViews: 4 } };
  const linkedInProfileAnalytics = vi.fn(async () => response);
  const service = {} as SocialService;
  const browser = { linkedInProfileAnalytics } as unknown as XBrowserSessions;
  const transport = new SocialTransport(service, browser);
  const method = "social.browser.linkedin.analytics.profile";
  const input = { accountId: "member-fixture" };
  const owner = { kind: "owner", actorId: "test-device", provider: "owner" } as const;
  await expect(transport.rpc({ ...owner, kind: "session" }, method, input)).rejects.toThrow(
    "Social administration requires an owner device credential.",
  );
  await expect(transport.rpc(owner, method, input)).resolves.toEqual(response);
  expect(linkedInProfileAnalytics).toHaveBeenCalledExactlyOnceWith(
    service,
    owner,
    "member-fixture",
  );
});

it("keeps LinkedIn browser operations on owner transport", async () => {
  const linkedInBrowserManagement = vi.fn(async () => ({ groups: [], complete: false }));
  const service = {} as SocialService;
  const transport = new SocialTransport(service, {
    linkedInBrowserManagement,
  } as unknown as XBrowserSessions);
  const owner = { kind: "owner", actorId: "test-device", provider: "owner" } as const;
  const input = { accountId: "linkedin-member", operation: "groups.list" };
  const method = "social.browser.linkedin.manage";
  await expect(transport.rpc({ ...owner, kind: "session" }, method, input)).rejects.toThrow(
    "Social administration requires an owner device credential.",
  );
  await expect(transport.rpc(owner, method, input)).resolves.toEqual({
    groups: [],
    complete: false,
  });
  expect(linkedInBrowserManagement).toHaveBeenCalledExactlyOnceWith(service, owner, input);
});

async function post(webhook: (...args: unknown[]) => Promise<unknown>) {
  vi.stubEnv("BYCODA_SOCIAL_INSTAGRAM_CLIENT_SECRET", "secret");
  vi.stubEnv("BYCODA_SOCIAL_INSTAGRAM_WEBHOOK_VERIFY_TOKEN", "verify");
  const transport = new SocialTransport({ webhook } as unknown as SocialService);
  const request = Object.assign(Readable.from([Buffer.from("{}")]), {
    method: "POST",
    url: "/social/webhooks/instagram",
    headers: { "x-hub-signature-256": "sha256=bad" },
  }) as unknown as IncomingMessage;
  const out = { status: 200, body: "" };
  const response = {
    setHeader: vi.fn(),
    writeHead(status: number) {
      out.status = status;
      return response;
    },
    end(body: string) {
      out.body = body;
    },
  } as unknown as ServerResponse;
  expect(await transport.http(request, response)).toBe(true);
  return out;
}

it("rejects webhooks whose async verification fails", async () => {
  const out = await post(async () => {
    throw new Error("Invalid webhook signature.");
  });
  expect(out.status).toBe(400);
  expect(out.body).not.toContain("signature.");
});

it("returns the awaited service result for valid webhooks", async () => {
  const out = await post(async () => ({ accepted: 1 }));
  expect(out.status).toBe(200);
  expect(JSON.parse(out.body)).toEqual({ accepted: 1 });
});

async function verifyGet(url: string) {
  vi.stubEnv("BYCODA_SOCIAL_INSTAGRAM_CLIENT_SECRET", "secret");
  vi.stubEnv("BYCODA_SOCIAL_INSTAGRAM_WEBHOOK_VERIFY_TOKEN", "verify");
  const transport = new SocialTransport({ webhook: vi.fn() } as unknown as SocialService);
  const request = Object.assign(Readable.from([]), {
    method: "GET",
    url,
  }) as unknown as IncomingMessage;
  const out = { status: 200, body: "" };
  const response = {
    setHeader: vi.fn(),
    writeHead(status: number) {
      out.status = status;
      return response;
    },
    end(body: string) {
      out.body = body;
    },
  } as unknown as ServerResponse;
  expect(await transport.http(request, response)).toBe(true);
  return out;
}

it("echoes the webhook challenge only for the exact verify token", async () => {
  const base = "/social/webhooks/instagram?hub.mode=subscribe&hub.challenge=12345";
  const accepted = await verifyGet(`${base}&hub.verify_token=verify`);
  expect(accepted).toEqual({ status: 200, body: "12345" });
  // Prefix, longer, different-case, empty and missing tokens are all refused without echoing the challenge.
  for (const query of ["verif", "verify-extra", "VERIFY", ""]
    .map((token) => `&hub.verify_token=${token}`)
    .concat([""])) {
    const rejected = await verifyGet(`${base}${query}`);
    expect(rejected.status, query).toBe(400);
    expect(rejected.body).not.toContain("12345");
  }
});
