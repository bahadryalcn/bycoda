import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import { EMAIL_HTTP_TIMEOUT_MS, providerFailure } from "./email-http";
import type { EmailMessage, EmailSendResult } from "./email-types";

const POSTMARK_API = "https://api.postmarkapp.com";

export async function sendPostmark(
  serverToken: string,
  message: EmailMessage,
  fetcher: typeof fetch = fetch,
): Promise<EmailSendResult> {
  let response: Response;
  try {
    response = await fetcher(`${POSTMARK_API}/email`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": serverToken,
      },
      body: JSON.stringify({
        From: message.from,
        To: message.to,
        Subject: message.subject,
        TextBody: message.text,
        HtmlBody: message.html,
        Headers: Object.entries(message.headers).map(([Name, Value]) => ({ Name, Value })),
        MessageStream: "outbound",
      }),
      redirect: "error",
      signal: AbortSignal.timeout(EMAIL_HTTP_TIMEOUT_MS),
    });
  } catch {
    throw new SocialPlatformError("unknown");
  }
  if (!response.ok) throw await providerFailure("Postmark", response);
  const json = (await response.json().catch(() => ({}))) as { MessageID?: unknown };
  return typeof json.MessageID === "string" ? { messageId: json.MessageID } : {};
}

export async function verifyPostmark(
  serverToken: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  let response: Response;
  try {
    response = await fetcher(`${POSTMARK_API}/server`, {
      method: "GET",
      headers: { Accept: "application/json", "X-Postmark-Server-Token": serverToken },
      redirect: "error",
      signal: AbortSignal.timeout(EMAIL_HTTP_TIMEOUT_MS),
    });
  } catch {
    throw new SocialPlatformError("unknown");
  }
  if (!response.ok) throw await providerFailure("Postmark", response);
}
