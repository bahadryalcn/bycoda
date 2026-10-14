import { AcpClient } from "../../core/acp";
import {
  killChild,
  resolveGeminiBinary,
  spawnChild,
  unwatchChild,
  watchChild,
} from "../../core/child";
import { joinStreamText } from "../../core/streamText";
import type { TextPromptInput } from "../../core/registry";

/** Fresh text-only helper: no main-session history, social grant or client tools. */
export async function runGeminiTextPrompt(input: TextPromptInput): Promise<string> {
  input.signal?.throwIfAborted();
  const childId = `bycoda-gemini-text-${crypto.randomUUID()}`;
  let output = "";
  const acp = new AcpClient(childId, {
    onNotification(method, params) {
      if (method !== "session/update") return;
      const update = (
        params as {
          update?: {
            sessionUpdate?: string;
            content?: { type?: string; text?: string };
          };
        }
      )?.update;
      if (
        update?.sessionUpdate === "agent_message_chunk" &&
        update.content?.type === "text" &&
        typeof update.content.text === "string"
      ) {
        output = joinStreamText(output, update.content.text);
        if (output.length > 30_000) acp.close(new Error("Gemini text output is too large."));
      }
    },
    onRequest(id, method) {
      if (method === "session/request_permission")
        void acp.respond(id, { outcome: { outcome: "cancelled" } });
      else
        void acp.respondError(id, {
          code: -32601,
          message: "Text generation has no client tools.",
        });
    },
  });
  const abort = () => {
    acp.close(new Error("Gemini text generation cancelled."));
    void killChild(childId).catch(() => {});
  };
  const timer = setTimeout(abort, input.timeoutMs ?? 90_000);
  input.signal?.addEventListener("abort", abort, { once: true });
  watchChild(
    childId,
    (line) => acp.pushLine(line),
    () => acp.close(new Error("Gemini text helper exited.")),
  );
  try {
    const { path } = await resolveGeminiBinary();
    input.signal?.throwIfAborted();
    await spawnChild(
      childId,
      path,
      ["--acp", "--approval-mode=plan"],
      input.cwd,
      undefined,
      "gemini",
    );
    await acp.request(
      "initialize",
      {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
          session: { configOptions: { boolean: {} } },
        },
        clientInfo: { name: "bycoda-text", version: "0.1.0" },
      },
      30_000,
    );
    const setup = await acp.request<{ sessionId?: string }>(
      "session/new",
      { cwd: input.cwd, mcpServers: [] },
      20_000,
    );
    if (!setup.sessionId) throw new Error("Gemini text helper returned no session ID.");
    await acp.request("session/set_mode", { sessionId: setup.sessionId, modeId: "plan" }, 20_000);
    if (input.model)
      await acp.request(
        "session/set_model",
        { sessionId: setup.sessionId, modelId: input.model },
        20_000,
      );
    input.signal?.throwIfAborted();
    const result = await acp.request<{ stopReason?: string }>(
      "session/prompt",
      {
        sessionId: setup.sessionId,
        prompt: [{ type: "text", text: input.prompt }],
      },
      input.timeoutMs ?? 90_000,
    );
    if (result.stopReason && result.stopReason !== "end_turn")
      throw new Error("Gemini text helper did not finish normally.");
    if (!output.trim()) throw new Error("Gemini text helper returned no reply.");
    return output;
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", abort);
    acp.close();
    unwatchChild(childId);
    await killChild(childId).catch(() => {});
  }
}
