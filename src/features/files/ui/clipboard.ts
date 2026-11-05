import type { useCopyFeedback } from "../../../shared/hooks/useCopyFeedback";
import { t } from "../../../shared/i18n/technical";

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

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.left = "-9999px";
    document.body.appendChild(el);
    const focused = document.activeElement;
    try {
      el.select();
      if (!document.execCommand("copy")) throw new Error(t("Could not copy. Try again."));
    } finally {
      el.remove();
      if (focused instanceof HTMLElement && focused.isConnected)
        focused.focus({ preventScroll: true });
    }
  }
}
