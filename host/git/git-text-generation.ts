import type { z } from "zod";
import type { GitGenerateTextParamsSchema } from "../../src/shared/model/host-contracts/git";
import type { AgentModel } from "../../src/shared/model/agentModel";
import type { GitStagedContext, GitRangeContext } from "../../src/platform/tauri/fs";
import {
  automaticGitChoice,
  economicalGitChoice,
} from "../../src/features/source-control/model/gitGenerationChoice";
import {
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  parseCommitMessage,
  formatCommitMessage,
  parsePrContent,
} from "../../src/features/source-control/model/gitText";
import {
  nativeModelId,
  resolveModel,
  mergeModelSettings,
} from "../../src/features/sessions/model/models";
import { registerBuiltinHarnesses } from "../../src/integrations/harness/core/register";
import { runHarnessTextPrompt } from "../../src/integrations/harness/core/registry";

type Params = z.output<typeof GitGenerateTextParamsSchema>;
type Context = GitStagedContext | GitRangeContext;

/** Reads the exact authorized checkout; the provider and account belong to this Host. */
export async function generateGitText(
  cwd: string,
  params: Params,
  ports: {
    context(kind: Params["kind"]): Promise<Context>;
    authorize(): Promise<void>;
    catalog?(harness: NonNullable<Params["preferred"]>): Promise<readonly AgentModel[]>;
    run?: typeof runHarnessTextPrompt;
  },
) {
  registerBuiltinHarnesses();
  // A standalone Host has its own catalog cache, independent of the desktop picker.
  const candidates =
    !params.choice && params.preferred && ports.catalog
      ? await ports.catalog(params.preferred)
      : undefined;
  const choice =
    params.choice ??
    (candidates && params.preferred
      ? economicalGitChoice(params.preferred, candidates)
      : automaticGitChoice(params.preferred));
  if (!choice) throw new Error("No text generation model is available on this Host");
  const model =
    candidates?.find((candidate) => candidate.id === choice.model) ??
    resolveModel(choice.harness, choice.model);
  const context = await ports.context(params.kind);
  await ports.authorize();
  const prompt =
    "patch" in context
      ? buildCommitMessagePrompt({
          branch: context.branch,
          stagedSummary: context.summary,
          stagedPatch: context.patch,
        })
      : buildPrContentPrompt({
          baseBranch: context.base,
          headBranch: context.head,
          commitSummary: context.commitSummary,
          diffSummary: context.diffSummary,
          diffPatch: context.diffPatch,
        });
  const output = await (ports.run ?? runHarnessTextPrompt)({
    cwd,
    harness: choice.harness,
    model: nativeModelId(model),
    modelSettings: mergeModelSettings(model, choice.modelSettings),
    providerAccountId: choice.providerAccountId,
    intent: "plan",
    ephemeral: true,
    prompt,
    timeoutMs: 90_000,
  });
  if ("patch" in context) {
    const message = parseCommitMessage(output);
    if (!message)
      throw new Error(
        "Could not generate a commit message. Retry generation or select another model.",
      );
    return { message: formatCommitMessage(message) };
  }
  const content = parsePrContent(output);
  if (!content)
    throw new Error(
      "Could not generate pull request content. Retry generation or select another model.",
    );
  return { ...content, base: context.base, head: context.head };
}
