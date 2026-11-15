import {
  isHarnessAuthBlock,
  supportsHarnessLogin,
} from "../../../integrations/harness/core/authSupport";
import type { Block, HarnessId } from "./session";
import { registerStreamingTextUpdate, streamingTextUpdate } from "./stableBlocks";
import { collapseTranscriptErrors } from "./transcriptErrors";

/** One committed filtering: its input and what it displayed. */
export type DisplayFilterFrame = {
  harness: HarnessId | undefined;
  source: Block[];
  result: Block[];
};

/**
 * The transcript as displayed: login prompts hidden where the app offers login,
 * repeated errors collapsed. A text-only streaming frame reuses the previous
 * frame's result with the streamed block swapped in, instead of rescanning.
 */
export function filterDisplayedBlocks(
  harness: HarnessId | undefined,
  source: Block[],
  previous: DisplayFilterFrame | null | undefined,
): Block[] {
  const index =
    previous && previous.harness === harness
      ? streamingTextUpdate(previous.source, source)
      : undefined;
  const streamed =
    previous && index !== undefined ? streamedFrame(previous, source, index) : undefined;
  return streamed ?? collapseTranscriptErrors(filterAuthErrors(harness, source));
}

function filterAuthErrors(harness: HarnessId | undefined, source: Block[]): Block[] {
  if (!harness || !supportsHarnessLogin(harness)) return source;
  const visible = source.filter((block) => !isHarnessAuthBlock(block));
  return visible.length === source.length ? source : visible;
}

/** Undefined when the new text could change what the filters keep, or the block was filtered out. */
function streamedFrame(
  previous: DisplayFilterFrame,
  next: Block[],
  index: number,
): Block[] | undefined {
  const from = previous.source[index];
  const to = next[index];
  if (!from || !to || from.role !== to.role || to.role === "system" || isHarnessAuthBlock(to))
    return undefined;
  if (previous.result === previous.source) return next;
  const at = previous.result.lastIndexOf(from);
  if (at < 0) return undefined;
  const result = previous.result.slice();
  result[at] = to;
  registerStreamingTextUpdate(previous.result, result, at);
  return result;
}
