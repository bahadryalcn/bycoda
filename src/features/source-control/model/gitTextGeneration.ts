import {
  generateCommitMessage as generateSelectedCommitMessage,
  generatePrContent as generateSelectedPrContent,
} from "../../../integrations/harness/core/textHarness";
import { resolveGitGenerationChoice } from "./gitGenerationPreferences";
import { captureTextInput } from "../../../integrations/harness/core/textSource";
import { REMOTE_PATH_PREFIX } from "../../../shared/lib/remotePaths";
import { remoteGitTextGeneration } from "./remoteGitTextGeneration";
import { PrGenerationError } from "./prGenerationError";
import { isTransientTransportError } from "../../connections/public/remoteFailure";
import { gitRangeContext } from "../../../platform/tauri/fs";

/** Resolve feature-owned routing before handing concrete execution inputs to the harness. */
export async function generateCommitMessage(
  ...[cwd, preferred, signal, choice, context]: Parameters<typeof generateSelectedCommitMessage>
) {
  const captured = captureTextInput({ operationContext: context }).operationContext;
  if (cwd.startsWith(REMOTE_PATH_PREFIX)) {
    const result = await remoteGitTextGeneration(cwd, "commit", preferred, choice, signal);
    if (!("message" in result)) throw new Error("Host returned no commit message");
    return result.message;
  }
  return generateSelectedCommitMessage(
    cwd,
    preferred,
    signal,
    choice ?? (await resolveGitGenerationChoice(undefined, cwd, preferred)),
    captured,
  );
}

export async function generatePrContent(
  ...[cwd, preferred, choice, context, signal]: Parameters<typeof generateSelectedPrContent>
) {
  const captured = captureTextInput({ operationContext: context }).operationContext;
  try {
    if (cwd.startsWith(REMOTE_PATH_PREFIX)) {
      const result = await remoteGitTextGeneration(cwd, "pr", preferred, choice, signal);
      if (!("title" in result)) throw new Error("Host returned no pull request content");
      return result;
    }
    return await generateSelectedPrContent(
      cwd,
      preferred,
      await resolveGitGenerationChoice(choice, cwd, preferred),
      captured,
      signal,
    );
  } catch (error) {
    // Connection state keeps its own classified message; anything else is a provider or
    // model failure whose raw text may carry account or endpoint details.
    if (isTransientTransportError(error)) throw error;
    console.debug("[bycoda] pr content", error);
    throw new PrGenerationError(error);
  }
}

/** The branch's raw commit list as pull request text; only for an explicit owner choice after generation failed. */
export async function prContentFromCommits(cwd: string) {
  const range = await gitRangeContext(cwd);
  return {
    title: range.commitSummary.split(/\r?\n/)[0]?.trim() || `Update ${range.head}`,
    body: range.commitSummary.trim(),
    base: range.base,
    head: range.head,
  };
}
