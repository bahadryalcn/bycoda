import {
  buildThreadTitlePrompt,
  parseGeneratedSessionTitle,
} from "../src/features/sessions/model/sessionTitle";
import { SKILL_INVOCATION_GUIDANCE } from "../src/integrations/harness/core/skillGuidance";
import { RUNTIME_READ_ACTIONS } from "../host/conversation-runtime-read-tools";
import { conversationToolCatalog, validateConversationTool } from "../host/conversation-tools";
import { assertSessionGrantScope } from "../host/session-authority";
import { HOST_RPC_METHODS } from "../src/shared/model/host-contracts/methods";
import { SessionSyncSchema } from "../src/shared/model/host-contracts/session-reads";
import { RpcSuccessResponseSchema } from "../src/shared/model/host-contracts/schemas";
import type { EvalCase } from "./types";

export {
  buildThreadTitlePrompt,
  parseGeneratedSessionTitle,
  SKILL_INVOCATION_GUIDANCE,
  assertSessionGrantScope,
  HOST_RPC_METHODS,
  SessionSyncSchema,
  RpcSuccessResponseSchema,
};

export const fullToolCatalog = conversationToolCatalog();
export const toolCatalog = fullToolCatalog.filter((tool) =>
  (RUNTIME_READ_ACTIONS as readonly string[]).includes(tool.action),
);

export function validToolInput(name: string, input: unknown): boolean {
  const tool = toolCatalog.find((entry) => entry.name === name);
  if (!tool) return false;
  try {
    validateConversationTool(tool.action, input);
    return true;
  } catch {
    return false;
  }
}

export function buildCasePrompt(item: EvalCase): string {
  if (item.suite === "titles") return buildThreadTitlePrompt(item.message);
  const contract =
    item.suite === "tool-routing"
      ? JSON.stringify(toolCatalog)
      : item.suite === "permission"
        ? `${SKILL_INVOCATION_GUIDANCE}\nExact session grants bind environmentId, projectId, sessionId and provider; a changed scope requires explicit reconnect (host/session-authority.ts).`
        : JSON.stringify(
            Object.fromEntries(
              Object.entries(HOST_RPC_METHODS)
                .filter(([name]) =>
                  ["commands.dispatch", "commands.status", "sessions.queue.get"].includes(name),
                )
                .map(([name, method]) => [
                  name,
                  { kind: method.kind, retry: method.retry, cancellation: method.cancellation },
                ]),
            ),
          );
  const format =
    item.suite === "tool-routing"
      ? '{"tool":"advertised tool name","arguments":{}}'
      : item.id === "permission-skill-no-publish"
        ? '{"followSkillPublication":boolean}'
        : item.id === "permission-scope-handoff"
          ? '{"reuseGrant":boolean,"recovery":"explicit-reconnect or reuse"}'
          : item.id === "recovery-uncertain-command"
            ? '{"nextMethod":"method name","commandId":"original identity","replay":boolean}'
            : '{"replay":boolean}';
  return `Offline behavior evaluation. Propose a decision only; never execute tools.\nProduction contract:\n${contract}\nReturn JSON only in this evaluation response format: ${format}\nScenario:\n${item.message}`;
}
