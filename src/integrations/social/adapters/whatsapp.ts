import type { SocialAdapter, SocialHttp, SocialAccount } from "../adapter";
import { SocialPlatformError } from "../adapter";
import { mediaFormat, messageText, messagingContentIssue } from "./messaging-shared";

const validWhatsAppMediaId = (value: unknown): value is string =>
  typeof value === "string" && /^\d{1,30}$/.test(value);
const graph = (version: string, path: string) => `https://graph.facebook.com/${version}/${path}`;
const reasonRejected = (reasonCode: string) =>
  new SocialPlatformError("rejected", undefined, { reasonCode });

/** Free-form business-initiated text is refused; a template is the only start path. */
export const WHATSAPP_WINDOW_REASON = "whatsapp.window_closed_template_required";
export const WHATSAPP_INTERACTIVE_REASON = "whatsapp.interactive_invalid";

function assertPhoneId(account: Pick<SocialAccount, "platformId">): void {
  if (!/^\d+$/.test(account.platformId)) throw new SocialPlatformError("rejected");
}

function assertRecipient(to: string): void {
  if (!/^\d{5,20}$/.test(to)) throw new SocialPlatformError("rejected");
}

/** Accepts only the documented Graph send response for exactly one recipient. */
function sendResult(value: Record<string, any>, recipient: string): { platformId: string } {
  const platformId = value.messages?.[0]?.id;
  if (
    typeof platformId !== "string" ||
    !platformId ||
    !Array.isArray(value.messages) ||
    value.messages.length !== 1 ||
    (value.contacts !== undefined &&
      (!Array.isArray(value.contacts) ||
        value.contacts.length !== 1 ||
        value.contacts[0]?.wa_id !== recipient))
  )
    throw new SocialPlatformError("unknown");
  return { platformId };
}

export type WhatsAppInteractive =
  | { kind: "buttons"; body: string; buttons: { id: string; title: string }[] }
  | {
      kind: "list";
      body: string;
      button: string;
      sections: {
        title?: string;
        rows: { id: string; title: string; description?: string }[];
      }[];
    };

const textWithin = (value: unknown, max: number, min = 1): value is string =>
  typeof value === "string" && value.length >= min && value.length <= max;

/** Limits from the Cloud API interactive message reference; UTF-16 lengths, checked before any I/O. */
function interactivePayload(message: WhatsAppInteractive): Record<string, unknown> {
  const invalid = () => reasonRejected(WHATSAPP_INTERACTIVE_REASON);
  if (!textWithin(message.body, 1024)) throw invalid();
  if (message.kind === "buttons") {
    if (
      message.buttons.length < 1 ||
      message.buttons.length > 3 ||
      message.buttons.some((item) => !textWithin(item.id, 256) || !textWithin(item.title, 20))
    )
      throw invalid();
    return {
      type: "button",
      body: { text: message.body },
      action: {
        buttons: message.buttons.map((item) => ({
          type: "reply",
          reply: { id: item.id, title: item.title },
        })),
      },
    };
  }
  const rows = message.sections.flatMap((section) => section.rows);
  if (
    !textWithin(message.button, 20) ||
    message.sections.length < 1 ||
    message.sections.length > 10 ||
    rows.length < 1 ||
    rows.length > 10 ||
    message.sections.some(
      (section) =>
        (section.title !== undefined && !textWithin(section.title, 24)) || section.rows.length < 1,
    ) ||
    rows.some(
      (row) =>
        !textWithin(row.id, 200) ||
        !textWithin(row.title, 24) ||
        (row.description !== undefined && !textWithin(row.description, 72, 0)),
    )
  )
    throw invalid();
  return {
    type: "list",
    body: { text: message.body },
    action: {
      button: message.button,
      sections: message.sections.map((section) => ({
        ...(section.title ? { title: section.title } : {}),
        rows: section.rows.map((row) => ({
          id: row.id,
          title: row.title,
          ...(row.description ? { description: row.description } : {}),
        })),
      })),
    },
  };
}

/** Reply buttons or a list inside the customer's 24-hour window. Not reachable from a job yet. */
export async function sendWhatsAppInteractive(
  http: SocialHttp,
  graphVersion: string,
  account: SocialAccount,
  token: string,
  to: string,
  message: WhatsAppInteractive,
  beforeSubmit?: () => Promise<void>,
): Promise<{ platformId: string }> {
  assertPhoneId(account);
  assertRecipient(to);
  const interactive = interactivePayload(message);
  await beforeSubmit?.();
  const { value } = await http.json(graph(graphVersion, `${account.platformId}/messages`), token, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive,
  });
  return sendResult(value, to);
}

export type WhatsAppTemplateMessage = {
  name: string;
  language: string;
  components?: unknown[];
};

/** Business-initiated message from an approved template. Not reachable from a job yet. */
export async function sendWhatsAppTemplate(
  http: SocialHttp,
  graphVersion: string,
  account: SocialAccount,
  token: string,
  to: string,
  template: WhatsAppTemplateMessage,
  beforeSubmit?: () => Promise<void>,
): Promise<{ platformId: string }> {
  assertPhoneId(account);
  assertRecipient(to);
  if (
    !/^[a-z0-9_]{1,512}$/.test(template.name) ||
    !/^[A-Za-z]{2,3}(?:_[A-Za-z0-9]{2,4})?$/.test(template.language) ||
    (template.components !== undefined && !Array.isArray(template.components))
  )
    throw reasonRejected("whatsapp.template_invalid");
  await beforeSubmit?.();
  const { value } = await http.json(graph(graphVersion, `${account.platformId}/messages`), token, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: template.name,
      language: { code: template.language },
      ...(template.components ? { components: template.components } : {}),
    },
  });
  return sendResult(value, to);
}

export type WhatsAppTemplateInfo = {
  name: string;
  language: string;
  category?: string;
  status: string;
};

/** Template names and approval status. Takes the Business Account ID, which is not the phone number ID. */
export async function listWhatsAppTemplates(
  http: SocialHttp,
  graphVersion: string,
  wabaId: string,
  token: string,
): Promise<{ templates: WhatsAppTemplateInfo[] }> {
  if (!/^\d{5,20}$/.test(wabaId)) throw reasonRejected("whatsapp.waba_id_invalid");
  // shortcut: first 100 templates only, no paging, until an account exceeds that count.
  const { value } = await http.request(
    graph(
      graphVersion,
      `${wabaId}/message_templates?fields=name,status,language,category&limit=100`,
    ),
    token,
  );
  const items: unknown[] = Array.isArray(value.data) ? value.data : [];
  const templates = items.flatMap((item): WhatsAppTemplateInfo[] => {
    const row = item as Record<string, unknown>;
    if (
      typeof row.name !== "string" ||
      typeof row.language !== "string" ||
      typeof row.status !== "string"
    )
      return [];
    return [
      {
        name: row.name,
        language: row.language,
        status: row.status,
        ...(typeof row.category === "string" ? { category: row.category } : {}),
      },
    ];
  });
  return { templates };
}

export function createWhatsAppAdapter(http: SocialHttp, graphVersion: string): SocialAdapter {
  return {
    async send(account, job, token, media, checkpoint, beforeSubmit) {
      // A business-initiated free-form message is outside the customer window; templates only.
      if (job.kind === "message") throw reasonRejected(WHATSAPP_WINDOW_REASON);
      if (messagingContentIssue(account, job)) throw new SocialPlatformError("unsupported");
      const recipient = job.payload.recipientId;
      if (!/^\d+$/.test(account.platformId) || !/^\d{5,20}$/.test(recipient ?? ""))
        throw new SocialPlatformError("rejected");
      const body = messageText(job);
      const item = job.payload.media[0];
      let message: Record<string, unknown> = {
        type: "text",
        text: { body, preview_url: false },
      };
      if (item) {
        let id = job.preparation?.mediaIds?.[0];
        if (
          job.preparation?.mediaIds &&
          (job.preparation.mediaIds.length !== 1 || !validWhatsAppMediaId(id))
        )
          throw new SocialPlatformError("rejected");
        if (!id) {
          const bytes = await media(item.uploadId!);
          const format = mediaFormat(item, bytes, "whatsapp");
          const form = new FormData();
          form.set("messaging_product", "whatsapp");
          form.set("type", format.mime);
          form.set("file", new Blob([new Uint8Array(bytes)], { type: format.mime }), format.name);
          const uploaded = await http.request(
            graph(graphVersion, `${account.platformId}/media`),
            token,
            { method: "POST", body: form },
          );
          id = uploaded.value.id;
          if (!validWhatsAppMediaId(id)) throw new SocialPlatformError("unknown");
          job.preparation = { ...job.preparation, mediaIds: [id] };
          await checkpoint?.(job.preparation);
        }
        message = {
          type: item.kind,
          [item.kind]: { id, ...(body ? { caption: body } : {}) },
        };
      }
      await beforeSubmit?.();
      const { value } = await http.json(
        graph(graphVersion, `${account.platformId}/messages`),
        token,
        {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: recipient,
          ...message,
        },
      );
      return sendResult(value, recipient!);
    },
    async poll() {
      throw new SocialPlatformError("unsupported");
    },
    /** Reads the phone number object only. A mismatched ID is reported as not ok. */
    async healthCheck(account, token) {
      try {
        assertPhoneId(account);
        const { value } = await http.request(
          graph(graphVersion, `${account.platformId}?fields=id`),
          token,
        );
        return value.id === account.platformId ? { ok: true } : { ok: false, code: "rejected" };
      } catch (error) {
        if (error instanceof SocialPlatformError) return { ok: false, code: error.code };
        throw error;
      }
    },
  };
}
