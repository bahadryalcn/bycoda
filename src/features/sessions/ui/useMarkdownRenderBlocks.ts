import { startTransition, useEffect, useState } from "react";

const BLOCKS_PER_FRAME = 64;

/** Preserve mounted blocks while large documents fill in between browser paints. */
export function useMarkdownRenderBlocks(blocks: string[], stream: string) {
  const [progress, setProgress] = useState({ stream, count: BLOCKS_PER_FRAME });
  const count = progress.stream === stream ? progress.count : BLOCKS_PER_FRAME;
  const pending = count < blocks.length;
  // Yield between batches so parsing/rendering thousands of blocks cannot occupy one commit.
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => {
      startTransition(() => setProgress({ stream, count: count + BLOCKS_PER_FRAME }));
    }, 16);
    return () => clearTimeout(timer);
  }, [count, pending, stream]);
  return { blocks: pending ? blocks.slice(0, count) : blocks, pending };
}
