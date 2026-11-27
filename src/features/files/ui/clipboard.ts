import type { useCopyFeedback } from "../../../shared/hooks/useCopyFeedback";

export { copyText } from "../../../platform/tauri/clipboard";

type CopyAsync = ReturnType<typeof useCopyFeedback>["copyAsync"];

export async function copyAsyncWithFeedback(copyAsync: CopyAsync, run: () => Promise<unknown>) {
  let error: unknown;
  const copied = await copyAsync(
    () =>
      run().catch((reason) => {
        error = reason;
        throw reason;
      }),
    { parallel: true },
  );
  return { copied, error };
}
