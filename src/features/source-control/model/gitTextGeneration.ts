import {
  generateCommitMessage as generateSelectedCommitMessage,
  generatePrContent as generateSelectedPrContent,
} from "../../../integrations/harness/core/textHarness";
import { resolveGitGenerationChoice } from "./gitGenerationPreferences";
import { captureTextInput } from "../../../integrations/harness/core/textSource";

/** Resolve feature-owned routing before handing concrete execution inputs to the harness. */
export async function generateCommitMessage(
  ...[cwd, preferred, signal, choice, context]: Parameters<typeof generateSelectedCommitMessage>
) {
  const captured = captureTextInput({ operationContext: context }).operationContext;
  return generateSelectedCommitMessage(
    cwd,
    preferred,
    signal,
    await resolveGitGenerationChoice(choice, cwd, preferred),
    captured,
  );
}

export async function generatePrContent(
  ...[cwd, preferred, choice, context]: Parameters<typeof generateSelectedPrContent>
) {
  const captured = captureTextInput({ operationContext: context }).operationContext;
  return generateSelectedPrContent(
    cwd,
    preferred,
    await resolveGitGenerationChoice(choice, cwd, preferred),
    captured,
  );
}
