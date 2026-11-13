import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { registerBuiltinHarnesses } from "../../src/integrations/harness/core/register";
import { runHarnessTextPrompt } from "../../src/integrations/harness/core/registry";
import { defaultModelId, nativeModelId } from "../../src/features/sessions/model/models";
import { budgetWeightedTokens } from "../../src/features/usage/model/usageBudgets";
import type { HostStore } from "../store";
import { runAssistantHelper } from "../work/helper-adapter";
import { currentSocialTextInvocation, type SocialTextGenerator } from "./social-generation";
/** Existing provider helper contract; no workspace/private inbox data or social grants. */
export function socialAgentGenerator(directory: string, store?: HostStore): SocialTextGenerator {
  return async (agent, prompt, signal, metadata) => {
    const invocation = metadata ?? currentSocialTextInvocation();
    if (store && !invocation)
      throw new Error("Social text generation requires Host operation identity.");
    const helperId = `social:${createHash("sha256")
      .update(invocation?.actorScope ?? "standalone")
      .digest("hex")}`;
    const model = nativeModelId(agent.model || defaultModelId(agent.provider));
    if (!model) throw new Error("Choose an available text model in the Social settings first.");
    const execution = {
      harness: agent.provider,
      model,
      ...(agent.providerAccountId ? { providerAccountId: agent.providerAccountId } : {}),
      modelSettings: { ...agent.modelSettings },
    };
    const cwd = join(directory, "text-workspace");
    const run = async (
      helperSignal?: AbortSignal,
      retirement?: import("../../src/integrations/harness/core/providerRetirement").ProviderRetirementObserver,
    ) => {
      await mkdir(cwd, { recursive: true, mode: 0o700 });
      registerBuiltinHarnesses();
      let tokens: number | undefined;
      const text = await runHarnessTextPrompt({
        ...execution,
        ...retirement,
        cwd,
        prompt,
        intent: "plan",
        ephemeral: true,
        timeoutMs: 90_000,
        signal: helperSignal,
        onEvent: (event) => {
          if (
            event.type === "turn.metrics" &&
            Number.isSafeInteger(event.inputTokens) &&
            Number.isSafeInteger(event.outputTokens) &&
            event.inputTokens! >= 0 &&
            event.outputTokens! >= 0
          )
            tokens = Math.max(
              tokens ?? 0,
              budgetWeightedTokens({
                input: event.inputTokens!,
                output: event.outputTokens!,
                ...(event.cacheReadTokens !== undefined && event.cacheReadTokens >= 0
                  ? { cacheRead: event.cacheReadTokens }
                  : {}),
                ...(event.cacheWriteTokens !== undefined && event.cacheWriteTokens >= 0
                  ? { cacheWrite: event.cacheWriteTokens }
                  : {}),
                inputIncludesCacheRead: execution.harness === "codex",
              }),
            );
        },
      });
      return { text, ...(tokens === undefined ? {} : { tokens }) };
    };
    const result =
      store && invocation
        ? await runAssistantHelper(
            store,
            {
              role: helperId,
              operationId: invocation.operationId,
              source: {
                kind: "social.generation",
                id: helperId,
                occurrence: createHash("sha256").update(invocation.operationId).digest("hex"),
              },
              prompt,
              signal,
              target: {
                model: execution,
                runtimeMode: "supervised",
                permissionRevision: createHash("sha256")
                  .update(invocation.operationId)
                  .digest("hex"),
                execution: { kind: "helper", helperId },
              },
            },
            run,
          )
        : await run(signal);
    return result.text;
  };
}
