import { expect, it, vi } from "vitest";
import { createVoiceClientSecret } from "./voice";
it("only returns temporary credential fields, never the provider response or main key", async () => {
  const request = vi.fn(async () =>
    Response.json({ value: "temporary", expires_at: 123, extra: "private" }),
  );
  expect(await createVoiceClientSecret("main-secret", request as typeof fetch)).toEqual({
    value: "temporary",
    expires_at: 123,
  });
  expect(request.mock.calls[0][0]).toBe("https://api.x.ai/v1/realtime/client_secrets");
});
it("does not echo upstream auth errors containing credentials", async () => {
  const request = vi.fn(
    async () => new Response("main-secret leaked by upstream", { status: 401 }),
  );
  await expect(createVoiceClientSecret("main-secret", request as typeof fetch)).rejects.toThrow(
    "Grok Voice authentication failed (401).",
  );
});
it("does not contact xAI without a configured key", async () => {
  const request = vi.fn();
  await expect(createVoiceClientSecret("", request)).rejects.toThrow("XAI_API_KEY");
  expect(request).not.toHaveBeenCalled();
});
