import {
  bindAntigravitySession,
  cancelAntigravityTurn,
  forgetAntigravitySession,
  respondAntigravityApproval,
  sendAntigravityTurn,
  steerAntigravityTurn,
  stopAntigravitySession,
} from "./antigravity";
import { refreshAntigravityCatalog } from "./antigravityCatalog";
import { runAntigravityTextPrompt } from "./antigravityText";
import {
  bindAntigravityStreamSession,
  cancelAntigravityStreamTurn,
  forgetAntigravityStreamSession,
  sendAntigravityStreamTurn,
  stopAntigravityStreamSession,
} from "./antigravityStream";
import { resolveAntigravityBinary } from "../../core/child";
import type { SendTurnInput } from "../../core/types";
import { registerHarness, type HarnessAdapter } from "../../core/registry";

/**
 * Transport comes from the binary the host found, not the platform: ACP where
 * the ACP server exists, agy headless stream-json where only the CLI does.
 * A session only ever uses one, so lifecycle calls reach both safely.
 */
async function sendTurn(input: SendTurnInput): Promise<void> {
  const binary = await resolveAntigravityBinary();
  if (binary.transport === "stream-json") {
    return sendAntigravityStreamTurn(input, binary);
  }
  return sendAntigravityTurn(input);
}

export const antigravityAdapter: HarnessAdapter = {
  id: "antigravity",
  live: true,
  canSteer: false,
  sendTurn,
  steerTurn: steerAntigravityTurn,
  cancelTurn: async (sessionId) => {
    await Promise.all([cancelAntigravityTurn(sessionId), cancelAntigravityStreamTurn(sessionId)]);
  },
  respondApproval: respondAntigravityApproval,
  stopSession: async (sessionId) => {
    await Promise.all([stopAntigravitySession(sessionId), stopAntigravityStreamSession(sessionId)]);
  },
  forgetSession: async (sessionId) => {
    await Promise.all([
      forgetAntigravitySession(sessionId),
      forgetAntigravityStreamSession(sessionId),
    ]);
  },
  bindSession: (threadId, providerSessionId, cwd) => {
    bindAntigravitySession(threadId, providerSessionId, cwd);
    bindAntigravityStreamSession(threadId, providerSessionId, cwd);
  },
  refreshCatalog: refreshAntigravityCatalog,
  runTextPrompt: runAntigravityTextPrompt,
};

let registered = false;

export function ensureAntigravityRegistered(): void {
  if (registered) return;
  registerHarness(antigravityAdapter);
  registered = true;
}
