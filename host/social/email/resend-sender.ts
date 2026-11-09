import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import { EMAIL_HTTP_TIMEOUT_MS, providerFailure } from "./email-http";
import type { EmailMessage, EmailSendResult } from "./email-types";

const RESEND_API = "https://api.resend.com";

export async function sendResend(
  apiKey: string,
  message: EmailMessage,
  fetcher: typeof fetch = fetch,
): Promise<EmailSendResult> {
  let response: Response;
  try {
    response = await fetcher(`${RESEND_API}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(message.idempotencyKey ? { "Idempotency-Key": message.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: message.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers: message.headers,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(EMAIL_HTTP_TIMEOUT_MS),
    });
  } catch {
    // No answer: the message may or may not have been accepted, so it is not resent.
    throw new SocialPlatformError("unknown");
  }
  if (!response.ok) throw await providerFailure("Resend", response);
  const json = (await response.json().catch(() => ({}))) as { id?: unknown };
  return typeof json.id === "string" ? { messageId: json.id } : {};
}

export async function verifyResend(apiKey: string, fetcher: typeof fetch = fetch): Promise<void> {
  let response: Response;
  try {
    response = await fetcher(`${RESEND_API}/domains`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      redirect: "error",
      signal: AbortSignal.timeout(EMAIL_HTTP_TIMEOUT_MS),
    });
  } catch {
    throw new SocialPlatformError("unknown");
  }
  if (!response.ok) throw await providerFailure("Resend", response);
}
