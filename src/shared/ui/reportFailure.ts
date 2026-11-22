import { redactDiagnosticText } from "@bycoda/account-contracts";

export const FAILURE_GRACE_MS = 3_000;
export const FAILURE_RETRY_DELAYS_MS = [2_000, 4_000, 8_000] as const;

type FailurePresentation = {
  message: string;
  transient: boolean;
  notSent: boolean;
};
type FailurePolicy = (error: unknown) => FailurePresentation;
let policy: FailurePolicy = (error) => ({
  message: redactDiagnosticText(error instanceof Error ? error.message : String(error)),
  transient: false,
  notSent: false,
});

/** The desktop composition registers its transport classification before mounting. */
export function registerFailurePolicy(classify: FailurePolicy): void {
  policy = classify;
}

/** Delay transient failure announcements. Only a proven undelivered action can retry. */
export async function reportFailure(
  error: unknown,
  {
    toast,
    retry,
    signal,
  }: {
    toast: { show: (options: { tone: "danger"; message: string }) => unknown };
    retry?: () => void | Promise<unknown>;
    signal?: AbortSignal;
  },
): Promise<void> {
  if (signal?.aborted) return;
  const failure = policy(error);
  if (failure.transient) {
    const recovered = await new Promise<boolean>((resolve) => {
      const complete = (success: boolean) => {
        clearTimeout(deadline);
        clearTimeout(attempt);
        signal?.removeEventListener("abort", abort);
        resolve(success);
      };
      const abort = () => complete(true);
      const deadline = setTimeout(() => complete(false), FAILURE_GRACE_MS);
      const attempt =
        failure.notSent && retry
          ? setTimeout(() => {
              Promise.resolve()
                .then(() => {
                  if (!signal?.aborted) return retry();
                })
                .then(() => complete(true), () => undefined);
            }, FAILURE_RETRY_DELAYS_MS[0])
          : undefined;
      signal?.addEventListener("abort", abort, { once: true });
    });
    if (recovered || signal?.aborted) return;
  }
  toast.show({ tone: "danger", message: failure.message });
}
