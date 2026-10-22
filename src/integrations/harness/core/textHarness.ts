import type { HarnessId } from "../../../features/sessions/model/session";
import {
  nativeModelId,
  resolveModel,
  mergeModelSettings,
} from "../../../features/sessions/model/models";
import { defaultProviderAccountId } from "../../../features/providers/model/providerAccounts";
import { gitStagedContext, gitRangeContext } from "../../../platform/tauri/fs";
import {
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  parseCommitMessage,
  formatCommitMessage,
  parsePrContent,
} from "../../../features/source-control/model/gitText";
import { runHarnessTextPrompt } from "./registry";
import {
  pickTextHarness,
  automaticGitChoice,
  type GitGenerationChoice,
} from "../../../features/source-control/model/gitGenerationChoice";
export { pickTextHarness } from "../../../features/source-control/model/gitGenerationChoice";
import type { PrContent } from "../../../features/source-control/model/gitText";
import {
  generateHarnessCommitMessage,
  generateHarnessPrContent,
  warmupHarnessText,
} from "./registry";

async function selectedGitPrompt(
  cwd: string,
  choice: GitGenerationChoice,
  prompt: string,
  signal?: AbortSignal,
) {
  const model = resolveModel(choice.harness, choice.model);
  return runHarnessTextPrompt({
    cwd,
    harness: choice.harness,
    model: nativeModelId(model),
    modelSettings: mergeModelSettings(model, choice.modelSettings),
    providerAccountId:
      choice.harness === "claude" || choice.harness === "codex"
        ? defaultProviderAccountId(choice.harness)
        : undefined,
    intent: "plan",
    prompt,
    timeoutMs: 90_000,
    signal,
  });
}

export function warmupText(cwd: string, preferred?: HarnessId): Promise<void> {
  return warmupHarnessText(pickTextHarness(preferred), cwd);
}

export function generateCommitMessage(
  cwd: string,
  preferred?: HarnessId,
  signal?: AbortSignal,
  choice?: GitGenerationChoice,
): Promise<string> {
  const selected = choice ?? automaticGitChoice(preferred);
  if (selected) return generateSelectedCommit(cwd, selected, signal);
  return generateHarnessCommitMessage(pickTextHarness(preferred), cwd, signal);
}

async function generateSelectedCommit(
  cwd: string,
  choice: GitGenerationChoice,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  const context = await gitStagedContext(cwd);
  signal?.throwIfAborted();
  const output = await selectedGitPrompt(
    cwd,
    choice,
    buildCommitMessagePrompt({
      branch: context.branch,
      stagedSummary: context.summary,
      stagedPatch: context.patch,
    }),
    signal,
  );
  const parsed = parseCommitMessage(output);
  if (!parsed)
    throw new Error(
      "Could not generate a commit message. Retry generation or select another model.",
    );
  return formatCommitMessage(parsed);
}

export function generatePrContent(
  cwd: string,
  preferred?: HarnessId,
  choice?: GitGenerationChoice,
): Promise<(PrContent & { base: string; head: string }) | null> {
  const selected = choice ?? automaticGitChoice(preferred);
  if (selected) return generateSelectedPr(cwd, selected);
  return generateHarnessPrContent(pickTextHarness(preferred), cwd);
}

async function generateSelectedPr(cwd: string, choice: GitGenerationChoice) {
  const range = await gitRangeContext(cwd);
  const output = await selectedGitPrompt(
    cwd,
    choice,
    buildPrContentPrompt({
      baseBranch: range.base,
      headBranch: range.head,
      commitSummary: range.commitSummary,
      diffSummary: range.diffSummary,
      diffPatch: range.diffPatch,
    }),
  );
  const parsed = parsePrContent(output);
  if (!parsed)
    throw new Error(
      "Could not generate pull request content. Retry generation or select another model.",
    );
  return { ...parsed, base: range.base, head: range.head };
}
