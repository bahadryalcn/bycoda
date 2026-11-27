import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SendTurnInput } from "../../src/integrations/harness/core/types";
import { cancelGrokChatOnly, grokChatOnlyAvailable, sendGrokChatOnly } from "./grok-chat-only";

const events: unknown[] = [];
const input = (overrides: Partial<SendTurnInput> = {}): SendTurnInput => ({
  sessionId: "child",
  cwd: "/scratch",
  model: "grok:grok-4.6",
  runtimeMode: "supervised",
  text: "Question",
  onEvent: (event) => events.push(event),
  ...overrides,
});
const successful = () =>
  new Response(
    JSON.stringify({
      choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Answer" } }],
    }),
    { status: 200 },
  );

beforeEach(() => {
  vi.stubEnv("XAI_API_KEY", "fixture-key");
  vi.stubEnv("BYCODA_GROK_CHAT_ONLY_API", "1");
  events.length = 0;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Grok tool-free API", () => {
  it("requires explicit opt-in, a default account, and exact supported API model", () => {
    expect(grokChatOnlyAvailable({ model: "grok:grok-4.6" })).toBe(true);
    expect(grokChatOnlyAvailable({ model: "grok:grok-4.6", providerAccountId: "other" })).toBe(
      false,
    );
    expect(grokChatOnlyAvailable({ model: "grok:grok-4.6-fast" })).toBe(false);
    vi.stubEnv("BYCODA_GROK_CHAT_ONLY_API", "0");
    expect(grokChatOnlyAvailable({ model: "grok:grok-4.6" })).toBe(false);
  });

  it("sends bounded prior context and no tools to the fixed xAI endpoint", async () => {
    const fetchMock = vi.fn(async () => successful());
    vi.stubGlobal("fetch", fetchMock);
    const accepted = vi.fn();
    await sendGrokChatOnly(
      input({
        chatOnlyHistory: "Earlier reply",
        onAccepted: accepted,
        modelSettings: { effort: "high" },
      }),
    );
    const [url, request] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.x.ai/v1/chat/completions");
    expect(request.redirect).toBe("error");
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({
      model: "grok-4.6",
      stream: false,
      reasoning_effort: "high",
      messages: [
        { role: "system" },
        { role: "user", content: expect.stringContaining("Earlier reply") },
        { role: "user", content: "Question" },
      ],
    });
    expect(body).not.toHaveProperty("tools");
    expect(accepted).toHaveBeenCalledOnce();
    expect(events).toEqual([
      { type: "turn.started" },
      { type: "message.delta", text: "Answer" },
      { type: "message.completed" },
    ]);
  });

  it("refuses attachments and incomplete or tool-call responses", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              { finish_reason: "tool_calls", message: { role: "assistant", tool_calls: [{}] } },
            ],
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendGrokChatOnly(input({ attachments: [{} as never] }))).rejects.toThrow(
      "Invalid",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(sendGrokChatOnly(input())).rejects.toThrow("incomplete or unsupported");
    expect(events).not.toContainEqual(expect.objectContaining({ type: "message.delta" }));
  });

  it("rejects an unsupported effort before sending instead of ignoring the ceiling", async () => {
    const fetchMock = vi.fn(async () => successful());
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      sendGrokChatOnly(input({ model: "grok:grok-4.5", modelSettings: { effort: "xhigh" } })),
    ).rejects.toThrow("reasoning effort");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("bounds response bytes and never echoes provider errors", async () => {
    const fetchMock = vi.fn(async () => new Response("x".repeat(2 * 1024 * 1024 + 1)));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendGrokChatOnly(input())).rejects.toThrow("size limit");
    fetchMock.mockResolvedValueOnce(new Response("fixture secret", { status: 401 }));
    await expect(sendGrokChatOnly(input())).rejects.toThrow("HTTP 401");
  });

  it("cancels only the captured operation and never leaks transport errors", async () => {
    const operation = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, options: RequestInit) =>
          new Promise((_resolve, reject) =>
            options.signal!.addEventListener("abort", () => reject(new Error("secret"))),
          ),
      ),
    );
    const pending = sendGrokChatOnly(input({ operationContext: { operation } }));
    expect(cancelGrokChatOnly("child", { operation: {} })).toBe(false);
    expect(cancelGrokChatOnly("child", { operation })).toBe(true);
    await expect(pending).rejects.toThrow("cancelled or timed out");
    expect(cancelGrokChatOnly("child", { operation })).toBe(false);
  });
});
