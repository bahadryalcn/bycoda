/** Evidence belongs to each actual utility invocation under the original context. */
export function utilityCompletionProof() {
  const pending = new Set<object>();
  const seen = new Set<object>();
  let completed = 0;
  let failed = false;
  return {
    get completed() {
      return completed > 0 && pending.size === 0 && !failed;
    },
    observe(isOwned: () => boolean) {
      return {
        onUtilityStarted(utility: object) {
          if (!isOwned()) return;
          if (seen.has(utility)) failed = true;
          seen.add(utility);
          pending.add(utility);
        },
        onUtilityCompleted(utility: object) {
          if (!isOwned()) return;
          if (!pending.delete(utility)) failed = true;
          else completed++;
        },
        onUtilityFailed(_utility: object) {
          if (isOwned()) failed = true;
        },
      };
    },
  };
}
