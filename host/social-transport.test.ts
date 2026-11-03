import { Readable } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { SocialTransport } from "./social-transport";
import type { SocialService } from "./social";

afterEach(() => vi.unstubAllEnvs());

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
