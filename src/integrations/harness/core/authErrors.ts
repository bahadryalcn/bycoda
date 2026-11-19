import type { HarnessId } from "../../../features/sessions/model/session";

/** Why a provider CLI sign-in did not finish. The UI branches on this, never on `message`. */
export type HarnessLoginErrorCode =
  | "unsupported"
  | "stopFailed"
  | "exited"
  | "timedOut"
  | "spawnFailed";

/**
 * A failed provider CLI sign-in. `message` stays the English sentence for logs and tests;
 * screens present `code` through `presentProviderAccountError`. `detail` is the last
 * redacted line the CLI or process layer printed, already free of links and credentials.
 */
export class HarnessLoginError extends Error {
  readonly code: HarnessLoginErrorCode;
  readonly harness: HarnessId;
  readonly exitCode: number | null | undefined;
  readonly detail: string | undefined;

  constructor(
    code: HarnessLoginErrorCode,
    harness: HarnessId,
    message: string,
    options: { exitCode?: number | null; detail?: string } = {},
  ) {
    super(message);
    this.name = "HarnessLoginError";
    this.code = code;
    this.harness = harness;
    this.exitCode = options.exitCode;
    this.detail = options.detail || undefined;
  }
}
