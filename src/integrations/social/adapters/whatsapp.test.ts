import { describe, expect, it, vi } from "vitest";
import type { SocialAccount, SocialJob } from "../../../features/social/model/social";
import { SocialHttp } from "../adapter";
import {
  createWhatsAppAdapter,
  listWhatsAppTemplates,
  sendWhatsAppInteractive,
  sendWhatsAppTemplate,
} from "./whatsapp";

const VERSION = "v25.0";
const PHONE_ID = "123456789012";
const WABA_ID = "987654321098";
const RECIPIENT = "905551234567";

const account = {
  id: "account",
  platform: "whatsapp",
  platformId: PHONE_ID,
  name: "Synthetic Business",
  accountType: "business",
  scopes: ["whatsapp_business_messaging", "bycoda.webhook"],
  accessApproved: true,
  connected: true,
  paused: false,
  executorId: "host",
  grants: {},
  createdAt: 1,
} as SocialAccount;

const job = (overrides: Partial<SocialJob> = {}): SocialJob =>
  ({
    id: "job",
    operationId: "operation",
    dedupeKey: "dedupe",
    accountId: "account",
    projectIds: ["project"],
    provider: "owner",
    kind: "reply",
    payload: { text: "Reply", media: [], recipientId: RECIPIENT },
    status: "running",
    scheduledAt: 1,
    attempts: 1,
    createdAt: 1,
    actorId: "owner",
    ...overrides,
  }) as SocialJob;

const sent = () => Response.json({ messages: [{ id: "wamid.synthetic" }] });
const bodyOf = (fetcher: ReturnType<typeof vi.fn>, call = 0) =>
  JSON.parse(fetcher.mock.calls[call]![1]!.body as string);

describe("WhatsApp Business API adapter", () => {
  it("rejects a business-initiated free-form message before any network call", async () => {
    const fetcher = vi.fn(async (_url?: unknown, _options?: RequestInit) => sent());
    const adapter = createWhatsAppAdapter(new SocialHttp(fetcher), VERSION);
    await expect(
      adapter.send(account, job({ kind: "message" }), "secret", async () => new Uint8Array()),
    ).rejects.toMatchObject({
      code: "rejected",
      detail: { reasonCode: "whatsapp.window_closed_template_required" },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends an approved template with its language and components", async () => {
    const fetcher = vi.fn(async (_url?: unknown, _options?: RequestInit) => sent());
    const http = new SocialHttp(fetcher);
    const components = [{ type: "body", parameters: [{ type: "text", text: "Synthetic" }] }];
    await expect(
      sendWhatsAppTemplate(http, VERSION, account, "secret", RECIPIENT, {
        name: "order_update",
        language: "tr",
        components,
      }),
    ).resolves.toEqual({ platformId: "wamid.synthetic" });
    expect(fetcher.mock.calls[0]![0]).toBe(
      `https://graph.facebook.com/${VERSION}/${PHONE_ID}/messages`,
    );
    expect(bodyOf(fetcher)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: RECIPIENT,
      type: "template",
      template: { name: "order_update", language: { code: "tr" }, components },
    });
  });

  it("rejects an invalid template name, language or recipient before network I/O", async () => {
    const fetcher = vi.fn(async (_url?: unknown, _options?: RequestInit) => sent());
    const http = new SocialHttp(fetcher);
    await expect(
      sendWhatsAppTemplate(http, VERSION, account, "secret", RECIPIENT, {
        name: "Order Update",
        language: "tr",
      }),
    ).rejects.toMatchObject({ detail: { reasonCode: "whatsapp.template_invalid" } });
    await expect(
      sendWhatsAppTemplate(http, VERSION, account, "secret", RECIPIENT, {
        name: "order_update",
        language: "turkish!",
      }),
    ).rejects.toMatchObject({ detail: { reasonCode: "whatsapp.template_invalid" } });
    await expect(
      sendWhatsAppTemplate(http, VERSION, account, "secret", "not-a-number", {
        name: "order_update",
        language: "tr",
      }),
    ).rejects.toMatchObject({ code: "rejected" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends up to three reply buttons and refuses a fourth or an over-long title before I/O", async () => {
    const fetcher = vi.fn(async (_url?: unknown, _options?: RequestInit) => sent());
    const http = new SocialHttp(fetcher);
    const buttons = [
      { id: "yes", title: "Yes" },
      { id: "no", title: "No" },
    ];
    await sendWhatsAppInteractive(http, VERSION, account, "secret", RECIPIENT, {
      kind: "buttons",
      body: "Confirm the appointment?",
      buttons,
    });
    expect(bodyOf(fetcher).interactive).toEqual({
      type: "button",
      body: { text: "Confirm the appointment?" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "yes", title: "Yes" } },
          { type: "reply", reply: { id: "no", title: "No" } },
        ],
      },
    });
    const tooMany = {
      kind: "buttons" as const,
      body: "x",
      buttons: [...buttons, { id: "a", title: "A" }, { id: "b", title: "B" }],
    };
    await expect(
      sendWhatsAppInteractive(http, VERSION, account, "secret", RECIPIENT, tooMany),
    ).rejects.toMatchObject({ detail: { reasonCode: "whatsapp.interactive_invalid" } });
    const longTitle = {
      kind: "buttons" as const,
      body: "x",
      buttons: [{ id: "a", title: "a".repeat(21) }],
    };
    await expect(
      sendWhatsAppInteractive(http, VERSION, account, "secret", RECIPIENT, longTitle),
    ).rejects.toMatchObject({ detail: { reasonCode: "whatsapp.interactive_invalid" } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("sends a list with at most ten rows in total across sections", async () => {
    const fetcher = vi.fn(async (_url?: unknown, _options?: RequestInit) => sent());
    const http = new SocialHttp(fetcher);
    const rows = (count: number, prefix: string) =>
      Array.from({ length: count }, (_, index) => ({
        id: `${prefix}${index}`,
        title: `Row ${index}`,
      }));
    await sendWhatsAppInteractive(http, VERSION, account, "secret", RECIPIENT, {
      kind: "list",
      body: "Pick one",
      button: "Options",
      sections: [{ title: "First", rows: rows(4, "a") }, { rows: rows(6, "b") }],
    });
    expect(bodyOf(fetcher).interactive.type).toBe("list");
    expect(bodyOf(fetcher).interactive.action.sections[1]).toEqual({ rows: rows(6, "b") });
    await expect(
      sendWhatsAppInteractive(http, VERSION, account, "secret", RECIPIENT, {
        kind: "list",
        body: "Pick one",
        button: "Options",
        sections: [{ rows: rows(6, "a") }, { rows: rows(5, "b") }],
      }),
    ).rejects.toMatchObject({ detail: { reasonCode: "whatsapp.interactive_invalid" } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("lists template names and status from the Business Account, not the phone number", async () => {
    const fetcher = vi.fn(async (_url?: unknown, _options?: RequestInit) =>
      Response.json({
        data: [
          { name: "order_update", status: "APPROVED", language: "tr", category: "UTILITY" },
          { name: 5, status: "PENDING", language: "en_US" },
        ],
      }),
    );
    const result = await listWhatsAppTemplates(new SocialHttp(fetcher), VERSION, WABA_ID, "secret");
    expect(String(fetcher.mock.calls[0]![0])).toBe(
      `https://graph.facebook.com/${VERSION}/${WABA_ID}/message_templates?fields=name,status,language,category&limit=100`,
    );
    expect(result.templates).toEqual([
      { name: "order_update", status: "APPROVED", language: "tr", category: "UTILITY" },
    ]);
    await expect(
      listWhatsAppTemplates(new SocialHttp(fetcher), VERSION, "not-an-id", "secret"),
    ).rejects.toMatchObject({ detail: { reasonCode: "whatsapp.waba_id_invalid" } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("health check passes for the matching phone number and reports expired credentials", async () => {
    const matching = vi.fn(async (_url?: unknown, _options?: RequestInit) =>
      Response.json({ id: PHONE_ID }),
    );
    const adapter = createWhatsAppAdapter(new SocialHttp(matching), VERSION);
    await expect(adapter.healthCheck!(account, "secret")).resolves.toEqual({ ok: true });
    expect(String(matching.mock.calls[0]![0])).toBe(
      `https://graph.facebook.com/${VERSION}/${PHONE_ID}?fields=id`,
    );

    const other = vi.fn(async (_url?: unknown, _options?: RequestInit) =>
      Response.json({ id: "999999999999" }),
    );
    await expect(
      createWhatsAppAdapter(new SocialHttp(other), VERSION).healthCheck!(account, "secret"),
    ).resolves.toEqual({ ok: false, code: "rejected" });

    const expired = vi.fn(async (_url?: unknown, _options?: RequestInit) =>
      Response.json({ error: { code: 190 } }, { status: 401 }),
    );
    await expect(
      createWhatsAppAdapter(new SocialHttp(expired), VERSION).healthCheck!(account, "secret"),
    ).resolves.toEqual({ ok: false, code: "expired" });
  });

  it("keeps polling unsupported: the Cloud API has no historical inbox", async () => {
    const fetcher = vi.fn(async (_url?: unknown, _options?: RequestInit) => sent());
    await expect(
      createWhatsAppAdapter(new SocialHttp(fetcher), VERSION).poll(account, "secret", []),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
