import {
  CROSS_ADVISOR_KEY,
  CROSS_SUBAGENTS_KEY,
  encodeAdvisor,
  encodeSubagents,
} from "./host-contracts/delegation";
import type { HarnessId } from "./harnessIdentity";
type AgentModel = {
  id: string;
  nativeId?: string;
  aliasTarget?: string;
  name?: string;
  harness: HarnessId;
};
type ProviderSessionDefaults = { extras?: Record<string, string> };

const candidates: Partial<Record<HarnessId, { main: string[]; sub?: string[] }>> = {
  claude: {
    main: ["claude:opus-5-5", "claude-opus-5-5", "claude:opus", "opus"],
    sub: ["claude:sonnet-5-5", "claude-sonnet-5-5", "claude:sonnet", "sonnet"],
  },
  codex: {
    main: ["codex:gpt-6.1-sol", "gpt-6.1-sol"],
    sub: ["codex:gpt-6.1-terra", "gpt-6.1-terra"],
  },
  grok: { main: ["grok:grok-4.7", "grok-4.7"] },
  cursor: { main: ["cursor:composer-2.5", "composer-2.5"] },
  opencode: {
    main: ["opencode:opencode/glm-5.3", "opencode/glm-5.3"],
    sub: ["opencode:opencode/glm-5.3-flash", "opencode/glm-5.3-flash"],
  },
  antigravity: {
    main: ["antigravity:gemini-3.8-flash-high", "gemini-3.8-flash-high"],
    sub: ["antigravity:gemini-3.8-flash-medium", "gemini-3.8-flash-medium"],
  },
  pi: { main: ["pi:default"] },
  omp: { main: ["omp:default"] },
  hermes: { main: ["hermes:default"] },
  fx: { main: ["fx:zai/glm-5.2-fast", "zai/glm-5.2-fast"] },
};

/** Resolves only models present in the caller's enabled catalog; never writes preferences. */
export function productProviderDefaults(
  harness: HarnessId,
  models: readonly AgentModel[],
  accountId?: string,
): ProviderSessionDefaults & { model?: string } {
  const available = models.filter((model) => model.harness === harness);
  const find = (ids: readonly string[]) =>
    ids
      .map((id) => available.find((model) => model.id === id || model.nativeId === id))
      .find(Boolean);
  const preference = candidates[harness];
  const claudeAlias = (family: "opus" | "sonnet") =>
    available.find((model) => {
      if (model.id !== `claude:${family}` && model.nativeId !== family) return false;
      const version = model.aliasTarget ?? model.name ?? "";
      return new RegExp(`${family}[- .]5[- .]5(?:\\D|$)`, "i").test(version);
    });
  const preferred = (ids: readonly string[], family: "opus" | "sonnet") =>
    harness === "claude"
      ? (find(ids.slice(0, 2)) ?? claudeAlias(family) ?? find(ids.slice(2)))
      : find(ids);
  const main = preferred(preference?.main ?? [], "opus") ?? available[0];
  if (!main) return {};
  const sub = preferred(preference?.sub ?? [], "sonnet") ?? main;
  const ref = (model: AgentModel) => ({
    harness,
    model: model.id,
    ...(accountId ? { providerAccountId: accountId } : {}),
  });
  return {
    model: main.id,
    extras: {
      [CROSS_SUBAGENTS_KEY]: encodeSubagents([ref(sub)])!,
      [CROSS_ADVISOR_KEY]: encodeAdvisor(ref(main))!,
    },
  };
}
