import { gitRangeContext, gitStagedContext } from "../../../platform/tauri/fs";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  formatCommitMessage,
  parseBranchName,
  parseCommitMessage,
  parsePrContent,
  type PrContent,
} from "../../../features/source-control/model/gitText";
type GitTextOptions = {
  run: (input: {
    cwd: string;
    prompt: string;
    timeoutMs: number;
    signal?: AbortSignal;
    providerAccountId?: string;
  }) => Promise<string>;
  timeoutMs: number;
  label: string;
  commitAccount?: () => string | undefined;
};

/** Share Git prompt policy while preserving each provider's timeout and account routing. */
export function createGitTextGeneration(options: GitTextOptions) {
  async function generateCommitMessage(cwd: string, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    const context = await gitStagedContext(cwd);
    signal?.throwIfAborted();
    const output = await options.run({
      cwd,
      ...(options.commitAccount ? { providerAccountId: options.commitAccount() } : {}),
      prompt: buildCommitMessagePrompt({
        branch: context.branch,
        stagedSummary: context.summary,
        stagedPatch: context.patch,
      }),
      timeoutMs: options.timeoutMs,
      signal,
    });
    const parsed = parseCommitMessage(output);
    if (parsed) return formatCommitMessage(parsed);
    const snippet = output.trim().replace(/\s+/g, " ").slice(0, 240);
    throw new Error(
      snippet
        ? `Could not generate a commit message. Model replied: ${snippet}`
        : `Could not generate a commit message. ${options.label} returned no text.`,
    );
  }

  async function generatePrContent(
    cwd: string,
  ): Promise<(PrContent & { base: string; head: string }) | null> {
    const range = await gitRangeContext(cwd);
    let parsed: PrContent | null = null;
    try {
      const output = await options.run({
        cwd,
        prompt: buildPrContentPrompt({
          baseBranch: range.base,
          headBranch: range.head,
          commitSummary: range.commitSummary,
          diffSummary: range.diffSummary,
          diffPatch: range.diffPatch,
        }),
        timeoutMs: options.timeoutMs,
      });
      parsed = parsePrContent(output);
    } catch (error) {
      console.debug("[bycoda] pr content", error);
    }
    const title =
      parsed?.title || range.commitSummary.split(/\r?\n/)[0]?.trim() || `Update ${range.head}`;
    return {
      title,
      body: parsed?.body || range.commitSummary.trim(),
      base: range.base,
      head: range.head,
    };
  }

  async function generateBranchName(cwd: string, message: string): Promise<string | null> {
    try {
      const output = await options.run({
        cwd,
        prompt: buildBranchNamePrompt(message),
        timeoutMs: options.timeoutMs,
      });
      return parseBranchName(output);
    } catch (error) {
      console.debug("[bycoda] branch name", error);
      return null;
    }
  }

  return { generateCommitMessage, generatePrContent, generateBranchName };
}
