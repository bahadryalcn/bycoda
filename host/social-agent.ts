import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { registerBuiltinHarnesses } from "../src/integrations/harness/core/register";
import { runHarnessTextPrompt } from "../src/integrations/harness/core/registry";
import { nativeModelId } from "../src/features/sessions/model/models";
import type { SocialTextGenerator } from "./social-generation";
/** Existing provider helper contract; no workspace/private inbox data or social grants. */
export function socialAgentGenerator(directory: string): SocialTextGenerator {
  return async (agent, prompt, signal) => {
    const cwd = join(directory, "text-workspace");
    await mkdir(cwd, { recursive: true, mode: 0o700 });
    registerBuiltinHarnesses();
    return runHarnessTextPrompt({
      harness: agent.provider,
      cwd,
      model: agent.model ? nativeModelId(agent.model) : undefined,
      prompt,
      intent: "plan",
      ephemeral: true,
      timeoutMs: 90_000,
      signal,
    });
  };
}
