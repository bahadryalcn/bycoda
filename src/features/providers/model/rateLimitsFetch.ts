import { errorText } from "../../../shared/lib/errors";
import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "../../../platform/tauri/fs";
import {
  errorRateLimits,
  parseClaudeOAuthUsage,
  parseCodexRateLimits,
  parseOpencodeGoUsage,
  unavailableRateLimits,
  type ProviderRateLimits,
  type RateLimitFailureReason,
} from "./rateLimits";
import {
  captureChildProcess,
  createChildProcessHandle,
  killChild,
  resolveCodexBinary,
  spawnChild,
  unwatchChild,
  watchChild,
} from "../../../integrations/harness/core/child";
import { asRecord } from "../../../integrations/harness/providers/codex/codexProtocol";
import { JsonRpcClient, JsonRpcResponseError } from "../../../integrations/harness/core/jsonRpc";
import { newRequestId } from "../../../shared/lib/id/requestId";

const USAGE_CHILD_ID = "bycoda-codex-usage";
const DISCOVERY_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 12_000;

type OpencodeGoUsageFetch = {
  status: "ok" | "error" | "unavailable" | string;
  httpStatus?: number | null;
  body?: string | null;
  error?: string | null;
};

/**
 * Fetch OpenCode Go 5h / weekly / monthly usage via the official API.
 * Runs through a Tauri command so the webview CORS policy does not apply.
 */
export async function fetchOpencodeGoRateLimits(): Promise<ProviderRateLimits> {
  let result: OpencodeGoUsageFetch;
  try {
    result = await invoke<OpencodeGoUsageFetch>("fetch_opencode_go_usage");
  } catch (error) {
    return errorRateLimits(
      "opencode",
      error instanceof Error ? error.message : "OpenCode Go usage unavailable",
    );
  }
  if (result.status === "ok" && result.body) {
    try {
      const parsed = parseOpencodeGoUsage(JSON.parse(result.body));
      if (parsed.session || parsed.weekly || parsed.monthly) return parsed;
    } catch {
      return errorRateLimits("opencode", "OpenCode Go response was not JSON");
    }
    // A 200 with no usable windows is malformed: report an error so the
    // footer retries instead of sticking in "unavailable" forever.
    return errorRateLimits("opencode", "OpenCode Go usage response was unexpected");
  }
  // No key at all (no HTTP request) or a 401 is a sign-in problem; a 403 is a valid key without a plan.
  const reason = httpSignInReason(result);
  if (result.status === "unavailable") {
    return unavailableRateLimits(
      "opencode",
      result.error?.trim() || "OpenCode Go not connected",
      reason,
    );
  }
  return errorRateLimits(
    "opencode",
    result.error?.trim() || "OpenCode Go usage unavailable",
    null,
    reason,
  );
}

/**
 * The native usage commands answer `unavailable` without an HTTP status when no
 * credential could be read, and with 401 when the provider rejected it. Nothing
 * else (403, 5xx, transport errors, an identity change) says the account is signed out.
 */
function httpSignInReason(result: {
  status: string;
  httpStatus?: number | null;
}): RateLimitFailureReason | undefined {
  if (result.httpStatus === 401) return "signedOut";
  return result.status === "unavailable" && result.httpStatus == null ? "signedOut" : undefined;
}

export type CodexRateLimitResetOutcome =
  | "reset"
  | "nothingToReset"
  | "noCredit"
  | "alreadyRedeemed";

type ClaudeUsageFetch = {
  status: "ok" | "error" | "unavailable" | string;
  httpStatus?: number | null;
  body?: string | null;
  error?: string | null;
};

export async function fetchClaudeRateLimits(
  accountId = "default",
  oneShot = false,
): Promise<ProviderRateLimits> {
  try {
    const result = await invoke<ClaudeUsageFetch>(
      oneShot ? "fetch_claude_usage_once" : "fetch_claude_usage",
      {
        accountId,
      },
    );
    if (result.status === "ok" && result.body) {
      const parsed = parseClaudeOAuthUsage(result.body);
      if (parsed.session || parsed.weekly) return parsed;
      return {
        ...parsed,
        status: parsed.status === "ok" ? "ok" : parsed.status,
      };
    }
    const reason = httpSignInReason(result);
    if (result.status === "unavailable") {
      return unavailableRateLimits(
        "claude",
        result.error?.trim() || "Claude not signed in",
        reason,
      );
    }
    if (result.status === "renewal_pending") {
      return {
        ...errorRateLimits("claude", result.error?.trim() || "Claude usage unavailable"),
        renewalPending: true,
      };
    }
    return errorRateLimits(
      "claude",
      result.error?.trim() || "Claude usage unavailable",
      null,
      reason,
    );
  } catch (error) {
    return errorRateLimits(
      "claude",
      error instanceof Error ? error.message : "Claude usage unavailable",
    );
  }
}

export async function fetchCodexRateLimits(accountId = "default"): Promise<ProviderRateLimits> {
  let path: string;
  try {
    path = (await resolveCodexBinary()).path;
  } catch {
    return unavailableRateLimits("codex", "Codex CLI not found", "cliMissing");
  }

  const cwd = await homeDir();
  try {
    const result = await requestCodexAccount<unknown>(
      path,
      cwd,
      "account/rateLimits/read",
      {},
      accountId,
    );
    const parsed = parseCodexRateLimits(result);
    if (parsed.session || parsed.weekly || parsed.monthly || parsed.resetCredits) {
      return parsed;
    }
    const rec = asRecord(result);
    if (rec && !parsed.session && !parsed.weekly) {
      return unavailableRateLimits("codex", "No Codex usage data");
    }
    return parsed;
  } catch (error) {
    const message = errorText(error);
    // Only the app-server's own refusal can mean "signed out", and it is confirmed
    // with the account's `requiresOpenaiAuth`, not by reading the refusal text.
    if (
      error instanceof JsonRpcResponseError &&
      (await codexRequiresSignIn(path, cwd, accountId))
    ) {
      return unavailableRateLimits("codex", "Codex not signed in", "signedOut");
    }
    return errorRateLimits("codex", message);
  }
}

/** Same account scope as the failed read: `account/read` reports a missing ChatGPT login. */
async function codexRequiresSignIn(path: string, cwd: string, accountId: string): Promise<boolean> {
  try {
    const account = asRecord(
      await requestCodexAccount<unknown>(path, cwd, "account/read", {}, accountId),
    );
    return account != null && !account.account && account.requiresOpenaiAuth === true;
  } catch {
    return false;
  }
}

export async function consumeCodexRateLimitResetCredit(
  creditId?: string,
  accountId = "default",
): Promise<CodexRateLimitResetOutcome> {
  const path = (await resolveCodexBinary()).path;
  const cwd = await homeDir();
  const result = await requestCodexAccount<unknown>(
    path,
    cwd,
    "account/rateLimitResetCredit/consume",
    {
      idempotencyKey: newRequestId(),
      ...(creditId ? { creditId } : {}),
    },
    accountId,
  );
  const outcome = asRecord(result)?.outcome;
  if (
    outcome === "reset" ||
    outcome === "nothingToReset" ||
    outcome === "noCredit" ||
    outcome === "alreadyRedeemed"
  ) {
    return outcome;
  }
  throw new Error("Codex returned an unknown reset result");
}

const CLAUDE_RESET_ERRORS: Record<string, string> = {
  cooldown: "Another reset was just used on this account. Try again in a minute.",
  ineligible: "This reset is no longer available. Nothing was used.",
  unavailable: "Could not confirm the reset. Check your usage in a moment before trying again.",
};

/**
 * Spend one banked Claude limit reset, as `/limit-reset` does in Claude Code.
 * `creditId` is a row id from `parseClaudeOAuthUsage`: `<grant id>:<index>`.
 */
export async function consumeClaudeLimitReset(
  creditId: string | undefined,
  accountId = "default",
): Promise<CodexRateLimitResetOutcome> {
  const grantId = creditId?.slice(0, Math.max(0, creditId.lastIndexOf(":")));
  if (!grantId) throw new Error("This reset has no id to use");
  const response = await invoke<ClaudeUsageFetch>("consume_claude_limit_reset", {
    accountId,
    grantId,
    // One id per attempt: the server deduplicates a repeated request.
    requestId: newRequestId(),
  });
  if (response.status !== "ok" || !response.body) {
    throw new Error(response.error?.trim() || "Could not use this reset");
  }
  let result: unknown;
  try {
    result = asRecord(JSON.parse(response.body))?.result;
  } catch {
    result = undefined;
  }
  if (result === "reset") return "reset";
  if (result === "not_limited") return "nothingToReset";
  if (result === "already_used") return "alreadyRedeemed";
  throw new Error(
    (typeof result === "string" && CLAUDE_RESET_ERRORS[result]) || CLAUDE_RESET_ERRORS.unavailable,
  );
}

// Every probe reuses USAGE_CHILD_ID and kills whatever holds it first, so
// probes for different accounts (footer, Settings, account picker) must not
// overlap or they terminate each other.
let codexUsageQueue: Promise<unknown> = Promise.resolve();

function requestCodexAccount<T>(
  path: string,
  cwd: string,
  method: string,
  params: unknown,
  accountId: string,
): Promise<T> {
  const run = codexUsageQueue.then(() =>
    runCodexAccountRequest<T>(path, cwd, method, params, accountId),
  );
  codexUsageQueue = run.catch(() => undefined);
  return run;
}

async function runCodexAccountRequest<T>(
  path: string,
  cwd: string,
  method: string,
  params: unknown,
  accountId: string,
): Promise<T> {
  const previous = captureChildProcess(USAGE_CHILD_ID);
  if (previous) await killChild(previous).catch(() => undefined);
  const usageProcess = createChildProcessHandle(USAGE_CHILD_ID, undefined, "management");
  const rpc = new JsonRpcClient(
    usageProcess,
    {
      onRequest: (id) => {
        void rpc.respond(id, {}).catch(() => undefined);
      },
    },
    { includeJsonrpc: false, label: "codex-usage" },
  );

  const stop = async () => {
    rpc.close();
    unwatchChild(usageProcess);
    await killChild(usageProcess).catch(() => undefined);
  };

  watchChild(
    usageProcess,
    (line) => rpc.pushLine(line),
    () => rpc.close(new Error("Codex usage probe exited")),
  );

  try {
    await spawnChild(
      usageProcess,
      path,
      ["app-server"],
      cwd,
      {
        provider: "codex",
        id: accountId,
      },
      "codex",
    );
    return await withTimeout(
      DISCOVERY_TIMEOUT_MS,
      async () => {
        await rpc.request(
          "initialize",
          {
            clientInfo: {
              name: "bycoda",
              title: "bycoda",
              version: "0.1.0",
            },
            capabilities: { experimentalApi: true },
          },
          REQUEST_TIMEOUT_MS,
        );
        await rpc.notify("initialized", undefined);

        return rpc.request<T>(method, params, REQUEST_TIMEOUT_MS);
      },
      () => {
        void stop();
      },
    );
  } finally {
    await stop();
  }
}

async function withTimeout<T>(
  ms: number,
  work: () => Promise<T>,
  onTimeout: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = work();
  try {
    return await Promise.race([
      pending,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          onTimeout();
          reject(new Error("Codex usage probe timed out"));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    void pending.catch(() => undefined);
  }
}
