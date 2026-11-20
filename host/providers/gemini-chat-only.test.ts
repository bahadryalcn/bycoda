import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SendTurnInput } from "../../src/integrations/harness/core/types";
import {
  cancelGeminiChatOnly,
  geminiChatOnlyAvailable,
  sendGeminiChatOnly,
} from "./gemini-chat-only";

function input(overrides: Partial<SendTurnInput> = {}): SendTurnInput {
  return {
    sessionId: "session",
    cwd: "/repo",
    model: "antigravity:gemini-3.8-flash",
    runtimeMode: "supervised",
    text: "Question",
    onEvent: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubEnv("BYCODA_GEMINI_CHAT_ONLY_API", "1");
  vi.stubEnv("GEMINI_API_KEY", "secret-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Gemini API chat-only", () => {
  it("requires explicit opt-in, default account and exact supported model", () => {
    expect(geminiChatOnlyAvailable({ model: "antigravity:gemini-3.8-flash" })).toBe(true);
    expect(geminiChatOnlyAvailable({ model: "antigravity:gemini-3.8-flash-high" })).toBe(true);
    expect(geminiChatOnlyAvailable({ model: "antigravity:gemini-3.8-flash-other" })).toBe(false);
    expect(geminiChatOnlyAvailable({ model: "gemini-3.8-flash", providerAccountId: "other" })).toBe(
      false,
    );
    vi.stubEnv("BYCODA_GEMINI_CHAT_ONLY_API", "0");
    expect(geminiChatOnlyAvailable({ model: "gemini-3.8-flash" })).toBe(false);
    vi.stubEnv("BYCODA_GEMINI_CHAT_ONLY_API", "1");
    vi.stubEnv("GEMINI_API_KEY", " ");
    expect(geminiChatOnlyAvailable({ model: "gemini-3.8-flash" })).toBe(false);
  });

  it("sends only text and bounded history to the fixed API with no tools", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        candidates: [{ finishReason: "STOP", content: { parts: [{ text: "Answer" }] } }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const turn = input({ chatOnlyHistory: "Earlier exchange", onAccepted: vi.fn() });
    await sendGeminiChatOnly(turn);
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
    );
    expect(options.headers).toMatchObject({ "x-goog-api-key": "secret-key" });
    expect(options.redirect).toBe("error");
    expect(JSON.parse(String(options.body))).toEqual({
      contents: [{ role: "user", parts: [{ text: "Earlier exchange\n\nQuestion" }] }],
    });
    expect(turn.onAccepted).toHaveBeenCalledOnce();
    expect(turn.onEvent).toHaveBeenCalledWith({ type: "message.delta", text: "Answer" });
    expect(turn.onEvent).toHaveBeenCalledWith({ type: "message.completed" });
  });

  it("refuses attachments and redacts provider or network errors", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("secret-key in url");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      sendGeminiChatOnly(input({ attachments: [{ id: "a" } as never] })),
    ).rejects.toThrow("does not support attachments");
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(sendGeminiChatOnly(input())).rejects.toThrow(/^Gemini request failed\.$/);
  });

  it("preserves supported effort and rejects settings without an exact API equivalent", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        candidates: [{ finishReason: "STOP", content: { parts: [{ text: "OK" }] } }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await sendGeminiChatOnly(input({ model: "antigravity:gemini-3.8-flash-low" }));
    expect(
      JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))
        .generationConfig,
    ).toEqual({ thinkingConfig: { thinkingLevel: "LOW" } });
    await expect(sendGeminiChatOnly(input({ modelSettings: { effort: "xhigh" } }))).rejects.toThrow(
      "cannot honor",
    );
    await expect(
      sendGeminiChatOnly(input({ model: "gemini-2.5-flash", modelSettings: { effort: "low" } })),
    ).rejects.toThrow("cannot honor");
    await expect(
      sendGeminiChatOnly(
        input({ model: "antigravity:gemini-3.8-flash-low", modelSettings: { effort: "high" } }),
      ),
    ).rejects.toThrow("effort conflicts");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses partial, tool-shaped and oversized responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "partial" }] } }],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          candidates: [
            { finishReason: "STOP", content: { parts: [{ functionCall: { name: "tool" } }] } },
          ],
        }),
      )
      .mockResolvedValueOnce(new Response("x".repeat(4 * 1024 * 1024 + 1)));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendGeminiChatOnly(input())).rejects.toThrow("did not complete");
    await expect(sendGeminiChatOnly(input())).rejects.toThrow("unsupported response");
    await expect(sendGeminiChatOnly(input())).rejects.toThrow("could not be read");
  });

  it("cancels only the matching operation and ignores late output", async () => {
    const operation = {};
    const fetchMock = vi.fn(
      (_url: string, options: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const turn = input({ operationContext: { operation } });
    const pending = sendGeminiChatOnly(turn);
    expect(cancelGeminiChatOnly("session", { operation: {} })).toBe(false);
    expect((fetchMock.mock.calls[0][1].signal as AbortSignal).aborted).toBe(false);
    expect(cancelGeminiChatOnly("session", { operation })).toBe(true);
    await expect(pending).rejects.toThrow("cancelled");
    expect(turn.onEvent).not.toHaveBeenCalled();
  });

  it("times out without returning provider details or emitting an answer", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, options: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            options.signal?.addEventListener("abort", () =>
              reject(new Error("private network detail")),
            );
          }),
      ),
    );
    const turn = input();
    const pending = sendGeminiChatOnly(turn);
    const assertion = expect(pending).rejects.toThrow("Gemini request timed out.");
    await vi.advanceTimersByTimeAsync(120_000);
    await assertion;
    expect(turn.onEvent).not.toHaveBeenCalled();
  });
});
