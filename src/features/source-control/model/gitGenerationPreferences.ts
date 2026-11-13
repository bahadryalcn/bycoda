import { resolveHelperModel } from "../../model-routing/public/helpers";
import { mergeModelSettings, resolveModel } from "../../sessions/public/models";
import type { HarnessId } from "../../sessions/public/session";
import {
  automaticGitChoice,
  TEXT_HARNESSES,
  type GitGenerationChoice,
} from "./gitGenerationChoice";

export function parseGitGenerationChoice(raw: string | null): GitGenerationChoice | undefined {
  try {
    const value = JSON.parse(raw ?? "null");
    if (!value || !TEXT_HARNESSES.includes(value.harness) || typeof value.model !== "string")
      return;
    const model = resolveModel(value.harness, value.model);
    const settings = Object.fromEntries(
      Object.entries(value.modelSettings ?? {}).filter(([, v]) => typeof v === "string"),
    ) as Record<string, string>;
    return {
      harness: value.harness,
      providerAccountId:
        typeof value.providerAccountId === "string" ? value.providerAccountId : undefined,
      model: model.id,
      modelSettings: mergeModelSettings(model, settings),
    };
  } catch {
    return;
  }
}

export async function resolveGitGenerationChoice(
  fallback?: GitGenerationChoice,
  cwd?: string,
  preferred?: HarnessId,
) {
  return (
    (await resolveHelperModel("text.git", {
      cwd,
    })) ??
    fallback ??
    automaticGitChoice(preferred)
  );
}
